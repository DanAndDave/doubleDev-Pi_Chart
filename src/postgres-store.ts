import { SQL } from "bun";

import {
	groupByTurn,
	type AccountingStore,
	type CallAccounting,
	recordPart,
	type RecordedPart,
	type CallAddress,
	type Measurement,
	type TailSource,
	type TurnAccounting,
} from "./accounting.ts";
import type { Pack, PackSource } from "./assembler.ts";
import { PINNED_DIMENSIONS, type Embedder } from "./embedder.ts";
import type { Concept, TrustTier } from "./concept.ts";
import type { ConceptHit, ConceptSearch, IndexResult } from "./doc-index.ts";
import type { JournalTurn } from "./journal.ts";
import { splitConcept, type Section } from "./sections.ts";
import type { HarnessMessage, Turn } from "./messages.ts";
import { messageText } from "./messages.ts";
import type {
	CorpusSearch,
	FoundTurn,
	Recollections,
	RecalledTurn,
	TurnRecall,
	TurnSink,
	TurnSource,
} from "./thread-store.ts";

/**
 * How many sections the nearest-neighbour stage fetches per Concept asked
 * for. Comfortably above the Budget so deduplication by Concept and the
 * lifecycle filter still leave enough to rank.
 */
const CANDIDATE_FACTOR = 10;

/**
 * How much further than the best match still counts as comparable, and so
 * lets trust and freshness decide the order. Relative to the best distance,
 * not an absolute bucket: a fixed bucket puts 0.249 and 0.251 in different
 * bands while 0.151 and 0.249 share one.
 */
const BAND = 0.05;

/**
 * Forward-only schema. Each entry runs once, **in array order**, recorded by
 * version; a store created by an older build becomes usable without
 * intervention. Array order is execution order, so entries stay ascending;
 * `MIGRATION_VERSIONS` exists so a test can hold them that way.
 */
const MIGRATIONS: { version: number; statements: string[] }[] = [
	{
		version: 1,
		statements: [
			`CREATE EXTENSION IF NOT EXISTS vector`,
			`CREATE TABLE IF NOT EXISTS turns (
				conversation_id TEXT NOT NULL,
				turn_index      INTEGER NOT NULL,
				prompt          TEXT NOT NULL DEFAULT '',
				PRIMARY KEY (conversation_id, turn_index)
			)`,
			`CREATE TABLE IF NOT EXISTS turn_messages (
				conversation_id TEXT NOT NULL,
				turn_index      INTEGER NOT NULL,
				ordinal         INTEGER NOT NULL,
				role            TEXT NOT NULL,
				message         JSONB NOT NULL,
				tool_name       TEXT,
				is_error        BOOLEAN NOT NULL DEFAULT FALSE,
				PRIMARY KEY (conversation_id, turn_index, ordinal)
			)`,
			`CREATE TABLE IF NOT EXISTS call_accounting (
				conversation_id    TEXT NOT NULL,
				turn_index         INTEGER NOT NULL,
				call_index         INTEGER NOT NULL,
				recorded_at        TIMESTAMPTZ,
				parts              JSONB NOT NULL DEFAULT '[]'::jsonb,
				approximate_tokens INTEGER,
				pack_tokens        INTEGER,
				floor_tokens       INTEGER,
				unassembled        BOOLEAN NOT NULL DEFAULT FALSE,
				tail_source        TEXT,
				PRIMARY KEY (conversation_id, turn_index, call_index)
			)`,
		],
	},
	{
		version: 2,
		statements: [
			// Width is pinned with the schema: a model change invalidates every
			// stored vector, so a mismatch must be an error, not a silently
			// wrong nearest neighbour.
			`ALTER TABLE turns ADD COLUMN IF NOT EXISTS embedding vector(${PINNED_DIMENSIONS})`,
			`CREATE INDEX IF NOT EXISTS turns_embedding_idx
				ON turns USING hnsw (embedding vector_cosine_ops)`,
		],
	},
	{
		version: 3,
		statements: [
			`ALTER TABLE call_accounting ADD COLUMN IF NOT EXISTS budgets JSONB`,
		],
	},
	{
		// A separate version: three is already recorded as applied on any
		// store that has run this code, so adding to it would never execute.
		version: 4,
		statements: [
			`ALTER TABLE call_accounting ADD COLUMN IF NOT EXISTS rejected INTEGER`,
		],
	},
	{
		version: 5,
		statements: [`ALTER TABLE turns ADD COLUMN IF NOT EXISTS codebase TEXT`],
	},
	{
		version: 6,
		statements: [
			`CREATE TABLE IF NOT EXISTS concept_sections (
				identity      TEXT NOT NULL,
				section_index INTEGER NOT NULL,
				concept_id    TEXT NOT NULL,
				status        TEXT NOT NULL DEFAULT 'stable',
				trust         TEXT NOT NULL DEFAULT 'unverified',
				stale         BOOLEAN NOT NULL DEFAULT FALSE,
				hash          TEXT NOT NULL,
				text          TEXT NOT NULL,
				embedding     vector(${PINNED_DIMENSIONS}),
				PRIMARY KEY (identity, section_index)
			)`,
			`CREATE INDEX IF NOT EXISTS concept_sections_embedding_idx
				ON concept_sections USING hnsw (embedding vector_cosine_ops)`,
		],
	},
	{
		version: 7,
		statements: [
			// Zero is right for every Turn answered in one Call, and honest
			// for older rows whose Calls were never recorded.
			`ALTER TABLE turn_messages
				ADD COLUMN IF NOT EXISTS call_index INTEGER NOT NULL DEFAULT 0`,
		],
	},
	{
		// Its own version: seven is already recorded as applied on stores
		// that ran it, and a statement added to an applied version never
		// executes.
		version: 8,
		statements: [
			// How many Calls the Turn took, which is not the same as the
			// highest Call its content carries: a Turn whose last message
			// is not the snapshot carrier has content in a Call that was
			// begun and never recorded.
			`ALTER TABLE turns ADD COLUMN IF NOT EXISTS call_count INTEGER`,
		],
	},
];

/**
 * The schema's versions in the order they are applied. Exported so a test
 * can hold them ascending: array order is execution order, and a version out
 * of place is a statement running before the table it alters exists.
 */
export const MIGRATION_VERSIONS: number[] = MIGRATIONS.map(
	(migration) => migration.version,
);

/** `jsonb` arrives as text from the driver, so it is decoded on read. */
type JsonColumn = string | unknown;

interface TurnMessageRow {
	turn_index: number;
	prompt: string;
	message: JsonColumn;
}

interface AccountingRow {
	turn_index: number;
	call_index: number;
	recorded_at: Date | null;
	parts: JsonColumn;
	approximate_tokens: number | null;
	pack_tokens: number | null;
	floor_tokens: number | null;
	unassembled: boolean;
	tail_source: TailSource | null;
	budgets: JsonColumn;
	rejected: number | null;
}

function decode<T>(value: JsonColumn, fallback: T): T {
	if (typeof value !== "string") return (value as T | undefined) ?? fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

/**
 * The Thread Store: a derived, rebuildable index over the harness's Journal
 * (ADR-0002). Holds the Turns the Assembler reads its verbatim tail from, and
 * the accounting that describes each Context Window.
 */
export class PostgresStore implements
		TurnSource,
		TurnSink,
		TurnRecall,
		CorpusSearch,
		ConceptSearch,
		AccountingStore {
	constructor(
		private readonly sql: SQL,
		private readonly embedder?: Embedder,
	) {}

	static connect(url: string, embedder?: Embedder): PostgresStore {
		return new PostgresStore(new SQL(url), embedder);
	}

	async migrate(): Promise<void> {
		await this.sql`CREATE TABLE IF NOT EXISTS schema_migrations (
			version     INTEGER PRIMARY KEY,
			applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
		)`;

		const applied = await this.sql`SELECT version FROM schema_migrations`;
		const done = new Set(applied.map((row: { version: number }) => row.version));

		for (const migration of MIGRATIONS) {
			if (done.has(migration.version)) continue;
			for (const statement of migration.statements) {
				await this.sql.unsafe(statement);
			}
			await this.sql`INSERT INTO schema_migrations ${this.sql({ version: migration.version })}`;
		}
	}

	async close(): Promise<void> {
		await this.sql.end();
	}

	async ingest(
		conversationId: string,
		turns: JournalTurn[],
		codebase?: string,
	): Promise<void> {
		for (const turn of turns) {
			await this.sql`
				INSERT INTO turns
					(conversation_id, turn_index, prompt, codebase, call_count)
				VALUES (
					${conversationId}, ${turn.turnIndex}, ${turn.prompt},
					${codebase ?? null}, ${Math.max(turn.callCount, 1)}
				)
				ON CONFLICT (conversation_id, turn_index)
				DO UPDATE SET
					prompt = EXCLUDED.prompt,
					call_count = EXCLUDED.call_count,
					-- Never unset a Codebase a previous ingest knew.
					codebase = COALESCE(EXCLUDED.codebase, turns.codebase)`;

			for (const [ordinal, message] of turn.messages.entries()) {
				// A message whose Call was never recorded belongs to the
				// Turn's first: one Call is what such a Turn actually was.
				const callIndex = turn.calls[ordinal] ?? 0;
				await this.sql`
					INSERT INTO turn_messages
						(conversation_id, turn_index, ordinal, call_index, role, message,
						 tool_name, is_error)
					VALUES (
						${conversationId}, ${turn.turnIndex}, ${ordinal}, ${callIndex},
						${message.role}, ${JSON.stringify(message)}::jsonb,
						${message.toolName ?? null}, ${message.isError === true}
					)
					ON CONFLICT (conversation_id, turn_index, ordinal)
					DO UPDATE SET
						call_index = EXCLUDED.call_index,
						role = EXCLUDED.role,
						message = EXCLUDED.message,
						tool_name = EXCLUDED.tool_name,
						is_error = EXCLUDED.is_error`;
			}
		}
	}

	/**
	 * Embeds Turns that have no vector yet. Runs after ingest and never on a
	 * request's path; running it again is how a Conversation ingested before
	 * embeddings existed catches up, so backfill and keeping-up are one path.
	 */
	async embedPending(conversationId?: string, batch = 32): Promise<number> {
		if (!this.embedder) return 0;
		if (this.embedder.dimensions !== PINNED_DIMENSIONS) {
			throw new Error(
				`embedder produces ${this.embedder.dimensions} dimensions, ` +
					`but the schema stores ${PINNED_DIMENSIONS}`,
			);
		}

		const pending = (await this.sql`
			SELECT conversation_id, turn_index, prompt
			FROM turns
			WHERE embedding IS NULL
				${conversationId ? this.sql`AND conversation_id = ${conversationId}` : this.sql``}
			ORDER BY conversation_id, turn_index
			LIMIT ${batch}`) as {
			conversation_id: string;
			turn_index: number;
			prompt: string;
		}[];
		if (pending.length === 0) return 0;

		const texts = await Promise.all(
			pending.map((row) => this.turnText(row.conversation_id, row.turn_index)),
		);
		const vectors = await this.embedder.embed(texts);

		// The count returned is what was *written*, not what was selected: a
		// batch that embeds nothing must end the caller's loop rather than
		// re-selecting the same rows forever.
		let embedded = 0;
		for (const [index, row] of pending.entries()) {
			const vector = vectors[index];
			if (!vector) continue;
			await this.sql`
				UPDATE turns SET embedding = ${JSON.stringify(vector)}::vector
				WHERE conversation_id = ${row.conversation_id}
					AND turn_index = ${row.turn_index}`;
			embedded++;
		}
		return embedded;
	}

	/** What a Turn is embedded as: its prompt and everything answering it. */
	private async turnText(
		conversationId: string,
		turnIndex: number,
	): Promise<string> {
		const rows = (await this.sql`
			SELECT message FROM turn_messages
			WHERE conversation_id = ${conversationId} AND turn_index = ${turnIndex}
			ORDER BY ordinal ASC`) as { message: JsonColumn }[];

		const parts: string[] = [];
		for (const row of rows) {
			const message = decode<HarnessMessage | undefined>(row.message, undefined);
			if (message) parts.push(messageText(message));
		}
		return parts.filter(Boolean).join("\n");
	}

	/**
	 * The Turns closest in meaning to a prompt, nearest first. Ties break on
	 * Turn order so that repeated assembly cannot reorder them, which is what
	 * keeps the determinism guarantee true through a retrieval step.
	 */
	async similarTurns(
		conversationId: string,
		prompt: string,
		limit: number,
		maxDistance: number,
	): Promise<Recollections> {
		const empty: Recollections = { turns: [], rejected: 0 };
		if (!this.embedder || limit <= 0) return empty;
		const [vector] = await this.embedder.embed([prompt]);
		if (!vector) return empty;

		const embedding = JSON.stringify(vector);
		// One scan: distance is computed once, the threshold filters, and the
		// rejects are counted from the same scored set. Counting separately
		// would re-score every Turn without the index, and the two scans
		// could disagree if embedding ran between them.
		//
		// Only candidates that would have competed are counted: the nearest
		// `limit` of them. Reporting every distant Turn in a long
		// Conversation would say more about its length than its relevance.
		const rows = (await this.sql`
			WITH scored AS (
				SELECT turn_index, embedding <=> ${embedding}::vector AS distance
				FROM turns
				WHERE conversation_id = ${conversationId} AND embedding IS NOT NULL
			),
			contenders AS (
				SELECT * FROM scored ORDER BY distance ASC, turn_index ASC LIMIT ${limit}
			)
			SELECT turn_index,
				(SELECT count(*)::int FROM contenders WHERE distance > ${maxDistance})
					AS rejected
			FROM contenders
			WHERE distance <= ${maxDistance}
			ORDER BY distance ASC, turn_index ASC`) as {
			turn_index: number;
			rejected: number;
		}[];

		const turns: RecalledTurn[] = [];
		for (const row of rows) {
			const turn = await this.turnAt(conversationId, row.turn_index);
			if (turn) turns.push({ turnIndex: row.turn_index, turn });
		}

		// With no surviving row the subquery has nothing to ride on, so the
		// count is asked for directly — the case that matters most to explain.
		if (rows.length > 0) return { turns, rejected: rows[0]?.rejected ?? 0 };

		const [counted] = (await this.sql`
			SELECT count(*)::int AS rejected FROM (
				SELECT embedding <=> ${embedding}::vector AS distance
				FROM turns
				WHERE conversation_id = ${conversationId} AND embedding IS NOT NULL
				ORDER BY distance ASC LIMIT ${limit}
			) contenders WHERE distance > ${maxDistance}`) as { rejected: number }[];
		return { turns, rejected: counted?.rejected ?? 0 };
	}

	private async turnAt(
		conversationId: string,
		turnIndex: number,
	): Promise<Turn | undefined> {
		const rows = (await this.sql`
			SELECT m.turn_index, t.prompt, m.message
			FROM turn_messages m
			JOIN turns t ON t.conversation_id = m.conversation_id
				AND t.turn_index = m.turn_index
			WHERE m.conversation_id = ${conversationId} AND m.turn_index = ${turnIndex}
			ORDER BY m.ordinal ASC`) as TurnMessageRow[];
		if (rows.length === 0) return undefined;

		const messages: HarnessMessage[] = [];
		for (const row of rows) {
			const message = decode<HarnessMessage | undefined>(row.message, undefined);
			if (message) messages.push(message);
		}
		return { index: turnIndex, prompt: rows[0]?.prompt ?? "", messages };
	}

	async recentTurns(conversationId: string, limit: number): Promise<Turn[]> {
		if (limit <= 0) return [];

		const rows = (await this.sql`
			SELECT m.turn_index, t.prompt, m.message
			FROM turn_messages m
			JOIN turns t
				ON t.conversation_id = m.conversation_id
				AND t.turn_index = m.turn_index
			WHERE m.conversation_id = ${conversationId}
				AND m.turn_index IN (
					SELECT turn_index FROM turns
					WHERE conversation_id = ${conversationId}
					ORDER BY turn_index DESC
					LIMIT ${limit}
				)
			ORDER BY m.turn_index ASC, m.ordinal ASC`) as TurnMessageRow[];

		const turns: Turn[] = [];
		let currentIndex: number | undefined;
		for (const row of rows) {
			if (row.turn_index !== currentIndex) {
				turns.push({ index: row.turn_index, prompt: row.prompt, messages: [] });
				currentIndex = row.turn_index;
			}
			const message = decode<HarnessMessage | undefined>(row.message, undefined);
			if (message) turns[turns.length - 1]?.messages.push(message);
		}
		return turns;
	}

	async recordPack(
		conversationId: string,
		address: CallAddress,
		pack: Pack,
		tailSource: TailSource,
	): Promise<void> {
		const parts = pack.parts.map(recordPart);

		await this.sql`
			INSERT INTO call_accounting
				(conversation_id, turn_index, call_index, recorded_at, parts,
				 approximate_tokens, unassembled, tail_source, budgets, rejected)
			VALUES (
				${conversationId}, ${address.turnIndex}, ${address.callIndex}, now(),
				${JSON.stringify(parts)}::jsonb, ${pack.approximateTokens}, FALSE,
				${tailSource}, ${JSON.stringify(pack.budgets)}::jsonb, ${pack.rejected}
			)
			ON CONFLICT (conversation_id, turn_index, call_index)
			DO UPDATE SET
				recorded_at = EXCLUDED.recorded_at,
				parts = EXCLUDED.parts,
				approximate_tokens = EXCLUDED.approximate_tokens,
				unassembled = FALSE,
				tail_source = EXCLUDED.tail_source,
				budgets = EXCLUDED.budgets,
				rejected = EXCLUDED.rejected`;
	}

	async recordUnassembled(
		conversationId: string,
		address: CallAddress,
	): Promise<void> {
		await this.sql`
			INSERT INTO call_accounting
				(conversation_id, turn_index, call_index, recorded_at, unassembled)
			VALUES (${conversationId}, ${address.turnIndex}, ${address.callIndex}, now(), TRUE)
			ON CONFLICT (conversation_id, turn_index, call_index)
			DO UPDATE SET recorded_at = EXCLUDED.recorded_at, unassembled = TRUE`;
	}

	async recordMeasurements(
		conversationId: string,
		measurements: Measurement[],
	): Promise<void> {
		for (const measurement of measurements) {
			const floor = measurement.snapshot.nonMessageTokens;
			const packTokens = measurement.snapshot.promptTokens - floor;
			await this.sql`
				INSERT INTO call_accounting
					(conversation_id, turn_index, call_index, pack_tokens, floor_tokens)
				VALUES (
					${conversationId}, ${measurement.turnIndex}, ${measurement.callIndex},
					${packTokens}, ${floor}
				)
				ON CONFLICT (conversation_id, turn_index, call_index)
				DO UPDATE SET
					pack_tokens = EXCLUDED.pack_tokens,
					floor_tokens = EXCLUDED.floor_tokens`;
		}
	}

	async readAccounting(conversationId: string): Promise<TurnAccounting[]> {
		const rows = (await this.sql`
			SELECT turn_index, call_index, recorded_at, parts, approximate_tokens,
			       pack_tokens, floor_tokens, unassembled, tail_source, budgets,
			       rejected
			FROM call_accounting
			WHERE conversation_id = ${conversationId}
			ORDER BY turn_index ASC, call_index ASC`) as AccountingRow[];

		const calls: CallAccounting[] = rows.map((row) => ({
			turnIndex: row.turn_index,
			callIndex: row.call_index,
			at: row.recorded_at?.toISOString(),
			// Older rows carry only source and size; the added detail simply
			// reads back absent rather than failing.
			parts: decode<RecordedPart[]>(row.parts, []).map((part) => ({
				...part,
				approximate: true as const,
			})),
			approximateTokens: row.approximate_tokens ?? undefined,
			packTokens: row.pack_tokens ?? undefined,
			floorTokens: row.floor_tokens ?? undefined,
			unassembled: row.unassembled || undefined,
			tailSource: row.tail_source ?? undefined,
			budgets: decode<
				{ tail: number; recall: number; docs: number; graph?: number } | undefined
			>(
				row.budgets,
				undefined,
			),
			rejected: row.rejected ?? undefined,
		}));

		return groupByTurn(conversationId, calls);
	}

	/**
	 * Every Conversation, searched on request. The same ordering and the
	 * same relevance threshold as recall; the only thing missing is the
	 * predicate confining it to one Conversation.
	 */
	async searchAll(
		query: string,
		limit: number,
		maxDistance: number,
	): Promise<FoundTurn[]> {
		if (!this.embedder || limit <= 0) return [];
		const [vector] = await this.embedder.embed([query]);
		if (!vector) return [];

		const rows = (await this.sql`
			SELECT conversation_id, turn_index, codebase
			FROM turns
			WHERE embedding IS NOT NULL
				AND (embedding <=> ${JSON.stringify(vector)}::vector) <= ${maxDistance}
			ORDER BY embedding <=> ${JSON.stringify(vector)}::vector ASC,
				conversation_id ASC, turn_index ASC
			LIMIT ${limit}`) as {
			conversation_id: string;
			turn_index: number;
			codebase: string | null;
		}[];

		const found: FoundTurn[] = [];
		for (const row of rows) {
			const turn = await this.turnAt(row.conversation_id, row.turn_index);
			if (!turn) continue;
			found.push({
				turnIndex: row.turn_index,
				turn,
				conversationId: row.conversation_id,
				codebase: row.codebase ?? undefined,
				calls: await this.callsIn(row.conversation_id, row.turn_index),
			});
		}
		return found;
	}

	/**
	 * How many Calls a Turn took, as the Journal counted them.
	 *
	 * Not the highest Call its content carries: a message recorded after
	 * the last snapshot belongs to a Call that never completed, so deriving
	 * the count from the content overstates it — measured, on four of this
	 * machine's 298 recorded Turns. Older rows have no count and fall back
	 * to the content, which is right for every Turn that ended on its
	 * snapshot and no worse than what they had.
	 */
	private async callsIn(
		conversationId: string,
		turnIndex: number,
	): Promise<number> {
		const [row] = (await this.sql`
			SELECT t.call_count, max(m.call_index) AS highest
			FROM turns t
			LEFT JOIN turn_messages m
				ON m.conversation_id = t.conversation_id
				AND m.turn_index = t.turn_index
			WHERE t.conversation_id = ${conversationId}
				AND t.turn_index = ${turnIndex}
			GROUP BY t.call_count`) as {
			call_count: number | null;
			highest: number | null;
		}[];
		return row?.call_count ?? (row?.highest ?? 0) + 1;
	}

	/**
	 * Brings the index in line with the bundle.
	 *
	 * Only sections whose text changed are embedded, and Concepts no longer
	 * in the bundle leave — so keeping the index current costs about as much
	 * as the edit that prompted it. Returns how many sections it embedded.
	 *
	 * A section's vector is written in the same statement as its new text,
	 * so a failed embed leaves the previous vector in place: a Concept is
	 * never made less retrievable by an interrupted re-index.
	 *
	 * Deprecated Concepts are not indexed at all, so a superseded decision
	 * cannot crowd out the one that replaced it.
	 */
	async indexConcepts(concepts: Concept[], batch = 32): Promise<IndexResult> {
		if (!this.embedder) return { embedded: 0, contested: [] };
		if (this.embedder.dimensions !== PINNED_DIMENSIONS) {
			throw new Error(
				`embedder produces ${this.embedder.dimensions} dimensions, ` +
					`but the schema stores ${PINNED_DIMENSIONS}`,
			);
		}

		const byIdentity = new Map<string, Concept>();
		const contested: string[] = [];
		for (const concept of concepts) {
			if (!concept.identity) continue;
			// First file wins a contested identity — the usual cause is a
			// Concept copied to start another — so one Concept's sections
			// can never be interleaved with another's under one key. The
			// loser is named, because a Concept nothing can find is worse
			// when nobody is told.
			if (byIdentity.has(concept.identity)) {
				contested.push(concept.id);
				continue;
			}
			// Deprecated Concepts are kept out of the index entirely, not
			// merely filtered at query time: sections nothing may return
			// would otherwise fill the nearest-neighbour window and hide
			// the Concepts that superseded them.
			if (concept.status === "deprecated") continue;
			byIdentity.set(concept.identity, concept);
		}
		const sections = [...byIdentity.values()].flatMap(splitConcept);

		await this.pruneConcepts(byIdentity, sections);

		const known = new Map<string, string>();
		const rows = (await this.sql`
			SELECT identity, section_index, hash FROM concept_sections
			WHERE embedding IS NOT NULL`) as {
			identity: string;
			section_index: number;
			hash: string;
		}[];
		for (const row of rows) {
			known.set(`${row.identity}:${row.section_index}`, row.hash);
		}

		// Frontmatter can change without the body changing — deprecating a
		// Concept is exactly that — so metadata is refreshed regardless.
		for (const [identity, concept] of byIdentity) {
			await this.sql`
				UPDATE concept_sections
				SET concept_id = ${concept.id}, status = ${concept.status},
					trust = ${concept.trust}, stale = ${concept.stale}
				WHERE identity = ${identity}
					AND (concept_id, status, trust, stale) IS DISTINCT FROM
						(${concept.id}, ${concept.status}, ${concept.trust}, ${concept.stale})`;
		}

		const changed = sections.filter(
			(section) =>
				known.get(`${section.identity}:${section.index}`) !== section.hash,
		);

		let embedded = 0;
		for (let start = 0; start < changed.length; start += batch) {
			// In batches: the embedder is one process shared with recall, and
			// a whole bundle in one call would hold it for the length of the
			// corpus rather than the length of a batch.
			const slice = changed.slice(start, start + batch);
			const vectors = await this.embedder.embed(slice.map((each) => each.text));
			for (const [index, section] of slice.entries()) {
				const vector = vectors[index];
				const concept = byIdentity.get(section.identity);
				if (!vector || !concept) continue;
				await this.sql`
					INSERT INTO concept_sections
						(identity, section_index, concept_id, status, trust, stale,
						 hash, text, embedding)
					VALUES (
						${section.identity}, ${section.index}, ${section.conceptId},
						${concept.status}, ${concept.trust}, ${concept.stale},
						${section.hash}, ${section.text},
						${JSON.stringify(vector)}::vector
					)
					ON CONFLICT (identity, section_index) DO UPDATE SET
						concept_id = EXCLUDED.concept_id,
						status = EXCLUDED.status,
						trust = EXCLUDED.trust,
						stale = EXCLUDED.stale,
						text = EXCLUDED.text,
						hash = EXCLUDED.hash,
						embedding = EXCLUDED.embedding`;
				embedded++;
			}
		}
		return { embedded, contested };
	}

	/** Drops Concepts the bundle no longer has, and sections an edit removed. */
	private async pruneConcepts(
		byIdentity: Map<string, Concept>,
		sections: Section[],
	): Promise<void> {
		// Seeded from the bundle, not from the sections: a Concept still
		// present but no longer yielding any — emptied, or edited into
		// non-conformance — must lose its rows rather than keep stale ones.
		const kept = new Map<string, number>();
		for (const identity of byIdentity.keys()) kept.set(identity, 0);
		for (const section of sections) {
			kept.set(section.identity, (kept.get(section.identity) ?? 0) + 1);
		}

		const indexed = (await this.sql`
			SELECT DISTINCT identity FROM concept_sections`) as { identity: string }[];
		for (const row of indexed) {
			if (byIdentity.has(row.identity)) continue;
			await this.sql`
				DELETE FROM concept_sections WHERE identity = ${row.identity}`;
		}
		for (const [identity, count] of kept) {
			await this.sql`
				DELETE FROM concept_sections
				WHERE identity = ${identity} AND section_index >= ${count}`;
		}
	}

	/**
	 * Concepts relevant to a query, best section first, deduplicated.
	 *
	 * Deprecated Concepts are withheld rather than down-weighted: a
	 * superseded decision presented as current is the failure this Store
	 * must not have. Among comparable matches — within `BAND` of the best
	 * one — current and human-reviewed Concepts come first: a tie-break,
	 * not a number mixed into a distance.
	 */
	async searchConcepts(
		query: string,
		limit: number,
		maxDistance: number,
	): Promise<ConceptHit[]> {
		if (!this.embedder || limit <= 0) return [];
		const [vector] = await this.embedder.embed([query]);
		if (!vector) return [];

		const embedding = JSON.stringify(vector);
		// The nearest-neighbour stage is shaped so the hnsw index can serve
		// it: the distance in ORDER BY, at the same level as LIMIT.
		// Lifecycle and deduplication then narrow that candidate set.
		const candidates = limit * CANDIDATE_FACTOR;
		const rows = (await this.sql`
			WITH nearest AS (
				SELECT identity, concept_id, text, status, trust, stale,
					embedding <=> ${embedding}::vector AS distance
				FROM concept_sections
				WHERE embedding IS NOT NULL
				ORDER BY embedding <=> ${embedding}::vector
				LIMIT ${candidates}
			),
			best AS (
				SELECT DISTINCT ON (identity)
					identity, concept_id, text, trust, stale, distance
				FROM nearest
				WHERE distance <= ${maxDistance} AND status <> 'deprecated'
				ORDER BY identity, distance ASC
			),
			ranked AS (
				SELECT *,
					distance > (SELECT min(distance) FROM best) + ${BAND} AS outside
				FROM best
			)
			SELECT concept_id, text, trust, stale, distance
			FROM ranked
			ORDER BY
				-- Comparable matches first, ordered by trust and freshness.
				-- Everything beyond the band is ordered by relevance alone:
				-- a tie-break must never promote a distant Concept.
				outside ASC,
				CASE WHEN outside THEN distance END ASC,
				stale ASC,
				(trust = 'human-reviewed') DESC,
				distance ASC,
				concept_id ASC
			LIMIT ${limit}`) as {
			concept_id: string;
			text: string;
			trust: TrustTier;
			stale: boolean;
			distance: number;
		}[];

		return rows.map((row) => ({
			conceptId: row.concept_id,
			text: row.text,
			trust: row.trust,
			stale: row.stale,
		}));
	}

	/** Empties the store. The Journal remains the record it is rebuilt from. */
	async truncate(): Promise<void> {
		await this.sql`TRUNCATE turns, turn_messages, call_accounting, concept_sections`;
	}
}
