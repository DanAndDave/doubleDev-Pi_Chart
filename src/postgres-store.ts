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
import type {
	ConceptHit,
	ConceptMatches,
	ConceptMiss,
	ConceptSearch,
	IndexResult,
} from "./doc-index.ts";
import type { JournalTurn } from "./journal.ts";
import { splitConcept, type Section } from "./sections.ts";
import type { HarnessMessage, Turn } from "./messages.ts";
import { embedFingerprint, embedText } from "./embed-text.ts";
import type {
	CorpusSearch,
	FoundTurn,
	Recollections,
	RecalledTurn,
	TurnMiss,
	TurnRecall,
	TurnSink,
	TurnSource,
	VectorModels,
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
	{
		version: 9,
		statements: [
			// What the pack ceiling was, and what the parts came to before it
			// bound. Both absent on older rows, which read back as a Call
			// whose ceiling is unknown rather than as one with no ceiling.
			`ALTER TABLE call_accounting ADD COLUMN IF NOT EXISTS ceiling INTEGER`,
			`ALTER TABLE call_accounting ADD COLUMN IF NOT EXISTS before_ceiling INTEGER`,
		],
	},
	{
		version: 10,
		statements: [
			// The fingerprint of the text a Turn was embedded from. A Turn
			// whose fingerprint changes has lost its vector's subject, so
			// ingest nulls the vector rather than keeping one that describes
			// content the Turn no longer has.
			`ALTER TABLE turns ADD COLUMN IF NOT EXISTS text_hash TEXT`,
		],
	},
	{
		version: 11,
		statements: [
			// Which model produced a vector. Null on every row written before
			// this column existed, which is honest: their provenance is
			// unknown, so they count as pending rather than as hits.
			`ALTER TABLE turns ADD COLUMN IF NOT EXISTS embedding_model TEXT`,
		],
	},
	{
		version: 12,
		statements: [
			// A Conversation-scoped recall computes distance over that
			// Conversation's embedded Turns exactly. An HNSW index carries
			// one vector column and no Conversation, so completeness has to
			// come from reaching the Conversation's rows directly.
			`CREATE INDEX IF NOT EXISTS turns_conversation_embedded_idx
				ON turns (conversation_id) WHERE embedding IS NOT NULL`,
		],
	},
	{
		version: 13,
		statements: [
			// How many Turns of the Conversation held no valid vector when a
			// recall ran: a Pack that came back short for want of embedding
			// reads differently from one where nothing was relevant.
			`ALTER TABLE call_accounting ADD COLUMN IF NOT EXISTS unsearched INTEGER`,
		],
	},
	{
		version: 14,
		statements: [
			// When a Turn entered the Store, so retention can judge its age.
			// Added without a default and given one afterwards, deliberately:
			// `ADD COLUMN ... DEFAULT now()` fills every existing row, which
			// would date the whole Store one migration old and let retention
			// retire all of it together. A row written before this column has
			// nothing to say about when it arrived, so it says nothing.
			`ALTER TABLE turns ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ`,
			`ALTER TABLE turns ALTER COLUMN ingested_at SET DEFAULT now()`,
		],
	},
	{
		version: 15,
		statements: [
			// Which compaction of the Conversation the harness was on when it
			// measured this Call. Nullable and never backfilled: a Call
			// recorded before the epoch was read says nothing about it, and
			// defaulting it to zero would report every older Conversation as
			// having been compacted at its first measured Call.
			`ALTER TABLE call_accounting ADD COLUMN IF NOT EXISTS compaction_epoch INTEGER`,
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
	unsearched: number | null;
	ceiling: number | null;
	before_ceiling: number | null;
	compaction_epoch: number | null;
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

	/**
	 * Stores what the Journal holds and is not stored yet, and returns how
	 * many Turns it wrote.
	 *
	 * Resumed rather than replayed: the Store is asked for its highest Turn
	 * and everything below it is skipped, because a Journal is append-only
	 * (ADR-0002). Only the highest is reconsidered, since the sweep that
	 * stored it may have caught it mid-flush — `readJournal` drops a
	 * partially written final line — and it is reconsidered against what is
	 * stored rather than rewritten blindly, so a Conversation that has not
	 * grown costs one read and no writes.
	 *
	 * Each Turn is one transaction with its messages as a single insert, so
	 * an interrupted sweep leaves whole Turns behind and the next one
	 * resumes from them.
	 */
	async ingest(
		conversationId: string,
		turns: JournalTurn[],
		codebase?: string,
	): Promise<number> {
		const stored = await this.storedHead(conversationId);
		let written = 0;

		for (const turn of turns) {
			if (stored !== undefined && turn.turnIndex < stored.turnIndex) continue;

			// The fingerprint of what this Turn will be embedded as, so a
			// Turn re-ingested with different content loses the vector that
			// described the content it had. Derived here rather than at
			// embedding time because this is where the new content arrives.
			const fingerprint = embedFingerprint(turn.messages);
			// The highest Turn as stored is exactly the highest Turn as the
			// Journal now has it: the same messages, composing to the same
			// text. Both, because the embed text is bounded — an appended
			// message beyond it moves the count and not the hash.
			if (
				stored !== undefined &&
				turn.turnIndex === stored.turnIndex &&
				stored.textHash === fingerprint &&
				stored.messages === turn.messages.length
			) {
				continue;
			}

			await this.sql.begin(async (tx: SQL) => {
				await tx`
					INSERT INTO turns
						(conversation_id, turn_index, prompt, codebase, call_count, text_hash)
					VALUES (
						${conversationId}, ${turn.turnIndex}, ${turn.prompt},
						${codebase ?? null}, ${Math.max(turn.callCount, 1)}, ${fingerprint}
					)
					ON CONFLICT (conversation_id, turn_index)
					DO UPDATE SET
						prompt = EXCLUDED.prompt,
						call_count = EXCLUDED.call_count,
						text_hash = EXCLUDED.text_hash,
						-- The Codebase is deliberately not updated here: a Turn
						-- happened in one place, and resuming its Conversation
						-- from another directory does not move it. Not COALESCE
						-- either — that backfills a Turn stored without one
						-- from wherever the sweep happens to be running.
						--
						-- A vector outlives its content only while the content
						-- is the same. Changed text is re-embedded by the pass
						-- that embeds a new Turn, so there is one path, not two.
						embedding = CASE
							WHEN turns.text_hash IS DISTINCT FROM EXCLUDED.text_hash
							THEN NULL ELSE turns.embedding END,
						embedding_model = CASE
							WHEN turns.text_hash IS DISTINCT FROM EXCLUDED.text_hash
							THEN NULL ELSE turns.embedding_model END`;

				const rows = turn.messages.map((message, ordinal) => ({
					conversation_id: conversationId,
					turn_index: turn.turnIndex,
					ordinal,
					// A message whose Call was never recorded belongs to the
					// Turn's first: one Call is what such a Turn actually was.
					call_index: turn.calls[ordinal] ?? 0,
					role: message.role,
					message: JSON.stringify(message),
					tool_name: message.toolName ?? null,
					is_error: message.isError === true,
				}));
				if (rows.length === 0) return;
				await tx`
					INSERT INTO turn_messages ${tx(rows)}
					ON CONFLICT (conversation_id, turn_index, ordinal)
					DO UPDATE SET
						call_index = EXCLUDED.call_index,
						role = EXCLUDED.role,
						message = EXCLUDED.message,
						tool_name = EXCLUDED.tool_name,
						is_error = EXCLUDED.is_error`;
			});
			written++;
		}

		return written;
	}

	/** The highest Turn a Conversation has stored, and what it holds. */
	private async storedHead(conversationId: string): Promise<
		{ turnIndex: number; textHash: string | null; messages: number } | undefined
	> {
		const [row] = (await this.sql`
			SELECT t.turn_index, t.text_hash,
				(SELECT count(*)::int FROM turn_messages m
					WHERE m.conversation_id = t.conversation_id
						AND m.turn_index = t.turn_index) AS messages
			FROM turns t
			WHERE t.conversation_id = ${conversationId}
			ORDER BY t.turn_index DESC
			LIMIT 1`) as {
			turn_index: number;
			text_hash: string | null;
			messages: number;
		}[];
		if (!row) return undefined;
		return {
			turnIndex: row.turn_index,
			textHash: row.text_hash,
			messages: row.messages,
		};
	}

	/**
	 * Embeds Turns whose stored vector is missing or no longer valid: a Turn
	 * never embedded, one whose content changed, and one embedded by another
	 * model. Runs after ingest and never on a request's path, so backfill,
	 * repair and keeping-up are one path rather than three.
	 */
	async embedPending(conversationId?: string, batch = 32): Promise<number> {
		if (!this.embedder) return 0;
		const { model, dimensions } = await this.embedder.identity();
		if (dimensions !== PINNED_DIMENSIONS) {
			throw new Error(
				`embedder produces ${dimensions} dimensions, ` +
					`but the schema stores ${PINNED_DIMENSIONS}`,
			);
		}

		const pending = (await this.sql`
			SELECT conversation_id, turn_index
			FROM turns
			WHERE (embedding IS NULL OR embedding_model IS DISTINCT FROM ${model})
				${conversationId ? this.sql`AND conversation_id = ${conversationId}` : this.sql``}
			ORDER BY conversation_id, turn_index
			LIMIT ${batch}`) as {
			conversation_id: string;
			turn_index: number;
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
				UPDATE turns
				SET embedding = ${JSON.stringify(vector)}::vector,
					embedding_model = ${model}
				WHERE conversation_id = ${row.conversation_id}
					AND turn_index = ${row.turn_index}`;
			embedded++;
		}
		return embedded;
	}

	/**
	 * Which model made the vectors this store holds: the one in use, and any
	 * other still present with how many Turns it accounts for. No others is
	 * the ordinary case; anything else is a corpus mid-swap, which is
	 * reported rather than ranked across.
	 */
	async vectorModels(): Promise<VectorModels> {
		if (!this.embedder) return { inUse: "none", others: [] };
		const { model } = await this.embedder.identity();
		const rows = (await this.sql`
			SELECT embedding_model, count(*)::int AS turns
			FROM turns
			WHERE embedding IS NOT NULL
				AND embedding_model IS NOT NULL
				AND embedding_model <> ${model}
			GROUP BY embedding_model
			ORDER BY embedding_model`) as {
			embedding_model: string;
			turns: number;
		}[];
		return {
			inUse: model,
			others: rows.map((row) => ({ model: row.embedding_model, turns: row.turns })),
		};
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

		const messages: HarnessMessage[] = [];
		for (const row of rows) {
			const message = decode<HarnessMessage | undefined>(row.message, undefined);
			if (message) messages.push(message);
		}
		return embedText(messages);
	}

	/**
	 * The Turns of this Conversation closest in meaning to a prompt, nearest
	 * first. Ties break on Turn order so that repeated assembly cannot
	 * reorder them, which is what keeps the determinism guarantee true
	 * through a retrieval step.
	 *
	 * Exact over the Conversation rather than approximate over the corpus:
	 * an HNSW index holds one vector column and no Conversation, so a
	 * Conversation filter over it is a corpus-wide guess narrowed afterwards
	 * and can come back short without saying so. Reaching the Conversation's
	 * own rows costs its length — tens of Turns — and returns every
	 * qualifying one whatever the corpus holds.
	 */
	async similarTurns(
		conversationId: string,
		prompt: string,
		limit: number,
		maxDistance: number,
	): Promise<Recollections> {
		const empty: Recollections = {
			turns: [],
			rejected: 0,
			misses: [],
			unsearched: 0,
		};
		if (!this.embedder || limit <= 0) return empty;
		const { model } = await this.embedder.identity();
		const [vector] = await this.embedder.embedQuery([prompt]);
		if (!vector) return empty;

		const embedding = JSON.stringify(vector);
		// One statement, always one row: the Turns kept, the contenders the
		// threshold refused, and the Turns of this Conversation that hold no
		// valid vector and so were not searched at all. Counting separately
		// would re-score the Conversation, and two scans could disagree if
		// embedding ran between them.
		//
		// Only candidates that would have competed are refused: the nearest
		// `limit` of them. Reporting every distant Turn in a long
		// Conversation would say more about its length than its relevance.
		//
		// The refused ones come back named as well as counted, from the same
		// contender set: naming them costs no second scan, and a count is
		// exactly what cannot explain an absence.
		const [row] = (await this.sql`
			WITH scored AS (
				SELECT turn_index, embedding <=> ${embedding}::vector AS distance
				FROM turns
				WHERE conversation_id = ${conversationId}
					AND embedding IS NOT NULL
					AND embedding_model = ${model}
			),
			contenders AS (
				SELECT * FROM scored ORDER BY distance ASC, turn_index ASC LIMIT ${limit}
			)
			SELECT
				(SELECT count(*)::int FROM contenders WHERE distance > ${maxDistance})
					AS rejected,
				(SELECT count(*)::int FROM turns
					WHERE conversation_id = ${conversationId}
						AND (embedding IS NULL OR embedding_model IS DISTINCT FROM ${model}))
					AS unsearched,
				coalesce((
					SELECT jsonb_agg(turn_index ORDER BY distance ASC, turn_index ASC)
					FROM contenders WHERE distance <= ${maxDistance}
				), '[]'::jsonb) AS kept,
				coalesce((
					SELECT jsonb_agg(
						jsonb_build_object('turnIndex', turn_index, 'distance', distance)
						ORDER BY distance ASC, turn_index ASC)
					FROM contenders WHERE distance > ${maxDistance}
				), '[]'::jsonb) AS misses`) as {
			rejected: number;
			unsearched: number;
			kept: JsonColumn;
			misses: JsonColumn;
		}[];

		const turns: RecalledTurn[] = [];
		for (const turnIndex of decode<number[]>(row?.kept, [])) {
			const turn = await this.turnAt(conversationId, turnIndex);
			if (turn) turns.push({ turnIndex, turn });
		}

		return {
			turns,
			rejected: row?.rejected ?? 0,
			misses: decode<TurnMiss[]>(row?.misses, []),
			unsearched: row?.unsearched ?? 0,
		};
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
				 approximate_tokens, unassembled, tail_source, budgets, rejected,
				 unsearched, ceiling, before_ceiling)
			VALUES (
				${conversationId}, ${address.turnIndex}, ${address.callIndex}, now(),
				${JSON.stringify(parts)}::jsonb, ${pack.approximateTokens}, FALSE,
				${tailSource}, ${JSON.stringify(pack.budgets)}::jsonb, ${pack.rejected},
				${pack.unsearched}, ${pack.ceiling}, ${pack.beforeCeiling}
			)
			ON CONFLICT (conversation_id, turn_index, call_index)
			DO UPDATE SET
				recorded_at = EXCLUDED.recorded_at,
				parts = EXCLUDED.parts,
				approximate_tokens = EXCLUDED.approximate_tokens,
				unassembled = FALSE,
				tail_source = EXCLUDED.tail_source,
				budgets = EXCLUDED.budgets,
				rejected = EXCLUDED.rejected,
				unsearched = EXCLUDED.unsearched,
				ceiling = EXCLUDED.ceiling,
				before_ceiling = EXCLUDED.before_ceiling`;
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
			const epoch = measurement.snapshot.compactionEpoch ?? null;
			await this.sql`
				INSERT INTO call_accounting
					(conversation_id, turn_index, call_index, pack_tokens, floor_tokens,
					 compaction_epoch)
				VALUES (
					${conversationId}, ${measurement.turnIndex}, ${measurement.callIndex},
					${packTokens}, ${floor}, ${epoch}
				)
				ON CONFLICT (conversation_id, turn_index, call_index)
				DO UPDATE SET
					pack_tokens = EXCLUDED.pack_tokens,
					floor_tokens = EXCLUDED.floor_tokens,
					-- Kept where the new snapshot has none: a harness that
					-- stops reporting the epoch has not un-compacted the
					-- Conversation, and overwriting it with null would erase
					-- the one record that a compaction happened.
					compaction_epoch = coalesce(
						EXCLUDED.compaction_epoch, call_accounting.compaction_epoch)`;
		}
	}

	async readAccounting(conversationId: string): Promise<TurnAccounting[]> {
		const rows = (await this.sql`
			SELECT turn_index, call_index, recorded_at, parts, approximate_tokens,
			       pack_tokens, floor_tokens, unassembled, tail_source, budgets,
			       rejected, unsearched, ceiling, before_ceiling, compaction_epoch
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
			unsearched: row.unsearched ?? undefined,
			ceiling: row.ceiling ?? undefined,
			beforeCeiling: row.before_ceiling ?? undefined,
			compactionEpoch: row.compaction_epoch ?? undefined,
		}));

		return groupByTurn(conversationId, calls);
	}

	/**
	 * Every Conversation, searched on request. The same ordering and the
	 * same relevance threshold as recall, and the same rule about which
	 * vectors may be ranked; the only thing missing is the predicate
	 * confining it to one Conversation.
	 *
	 * This is where the approximate index earns its place: over the whole
	 * corpus an approximate neighbourhood is the point, and no caller is
	 * promised every qualifying Turn.
	 */
	async searchAll(
		query: string,
		limit: number,
		maxDistance: number,
	): Promise<FoundTurn[]> {
		if (!this.embedder || limit <= 0) return [];
		const { model } = await this.embedder.identity();
		const [vector] = await this.embedder.embedQuery([query]);
		if (!vector) return [];

		const rows = (await this.sql`
			SELECT conversation_id, turn_index, codebase, ingested_at
			FROM turns
			WHERE embedding IS NOT NULL
				AND embedding_model = ${model}
				AND (embedding <=> ${JSON.stringify(vector)}::vector) <= ${maxDistance}
			ORDER BY embedding <=> ${JSON.stringify(vector)}::vector ASC,
				conversation_id ASC, turn_index ASC
			LIMIT ${limit}`) as {
			conversation_id: string;
			turn_index: number;
			codebase: string | null;
			ingested_at: Date | null;
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
				ingestedAt: row.ingested_at?.toISOString(),
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
		const { dimensions } = await this.embedder.identity();
		if (dimensions !== PINNED_DIMENSIONS) {
			throw new Error(
				`embedder produces ${dimensions} dimensions, ` +
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
	 * Concepts relevant to a query, best section first, deduplicated, with
	 * what the relevance threshold refused.
	 *
	 * Deprecated Concepts are withheld rather than down-weighted: a
	 * superseded decision presented as current is the failure this Store
	 * must not have. Among comparable matches — within `BAND` of the best
	 * one — current and human-reviewed Concepts come first: a tie-break,
	 * not a number mixed into a distance.
	 *
	 * The refusals come out of the same candidate set, in the same
	 * statement: a curated part that carried nothing because the threshold
	 * was set tight used to read exactly like one with no bundle at all,
	 * and a second query would pay the nearest-neighbour cost twice where
	 * the model is waiting.
	 */
	async searchConcepts(
		query: string,
		limit: number,
		maxDistance: number,
	): Promise<ConceptMatches> {
		const empty: ConceptMatches = { hits: [], rejected: 0, misses: [] };
		if (!this.embedder || limit <= 0) return empty;
		const [vector] = await this.embedder.embed([query]);
		if (!vector) return empty;

		const embedding = JSON.stringify(vector);
		// The nearest-neighbour stage is shaped so the hnsw index can serve
		// it: the distance in ORDER BY, at the same level as LIMIT.
		// Lifecycle and deduplication then narrow that candidate set.
		const candidates = limit * CANDIDATE_FACTOR;
		const [row] = (await this.sql`
			WITH nearest AS (
				SELECT identity, concept_id, text, status, trust, stale,
					embedding <=> ${embedding}::vector AS distance
				FROM concept_sections
				WHERE embedding IS NOT NULL
				-- Identity breaks the tie, as it does for Turns: the index is
				-- approximate, so two equally near sections at the edge of
				-- the candidate window would otherwise be chosen by the
				-- index's own traversal and swap places after a rebuild —
				-- the flicker ADR-0003 forbids. By identity rather than
				-- concept id, so the tiebreak survives a rename.
				ORDER BY embedding <=> ${embedding}::vector, identity ASC, section_index ASC
				LIMIT ${candidates}
			),
			best AS (
				SELECT DISTINCT ON (identity)
					identity, concept_id, text, trust, stale, distance
				FROM nearest
				WHERE distance <= ${maxDistance} AND status <> 'deprecated'
				ORDER BY identity, distance ASC
			),
			-- Refused for distance alone. A deprecated Concept is withheld
			-- by lifecycle, not by relevance, and reporting it as a near
			-- miss would invite someone to loosen a threshold that was
			-- never what kept it out.
			missed AS (
				SELECT DISTINCT ON (identity) identity, concept_id, distance
				FROM nearest
				WHERE distance > ${maxDistance} AND status <> 'deprecated'
					AND identity NOT IN (SELECT identity FROM best)
				ORDER BY identity, distance ASC
			),
			ranked AS (
				SELECT *,
					distance > (SELECT min(distance) FROM best) + ${BAND} AS outside
				FROM best
			),
			chosen AS (
				SELECT concept_id, text, trust, stale, distance,
					row_number() OVER (
						-- Comparable matches first, ordered by trust and
						-- freshness. Everything beyond the band is ordered by
						-- relevance alone: a tie-break must never promote a
						-- distant Concept.
						ORDER BY
							outside ASC,
							CASE WHEN outside THEN distance END ASC,
							stale ASC,
							(trust = 'human-reviewed') DESC,
							distance ASC,
							concept_id ASC
					) AS ord
				FROM ranked
			)
			SELECT
				coalesce((
					SELECT jsonb_agg(
						jsonb_build_object(
							'conceptId', concept_id, 'text', text, 'trust', trust,
							'stale', stale, 'distance', distance)
						ORDER BY ord)
					FROM chosen WHERE ord <= ${limit}
				), '[]'::jsonb) AS hits,
				(SELECT count(*)::int FROM missed) AS rejected,
				coalesce((
					SELECT jsonb_agg(
						jsonb_build_object('conceptId', concept_id, 'distance', distance)
						ORDER BY distance ASC, concept_id ASC)
					FROM missed
				), '[]'::jsonb) AS misses`) as {
			hits: JsonColumn;
			rejected: number;
			misses: JsonColumn;
		}[];

		return {
			hits: decode<ConceptHit[]>(row?.hits, []),
			rejected: row?.rejected ?? 0,
			misses: decode<ConceptMiss[]>(row?.misses, []),
		};
	}

	/**
	 * Retires Turns older than an age, with their messages, and says how
	 * many went.
	 *
	 * A Turn with no arrival time is left alone: it was stored before the
	 * Store recorded one, and an age nobody can establish is not an age
	 * past the age retention keeps. Accounting is untouched — what a Call's Context
	 * Window contained outlives the Turn, because it is a few numbers
	 * against a Turn's whole content and the size problem is not there.
	 *
	 * The Journal remains the record (ADR-0002), so retention discards an
	 * index and never the record itself.
	 */
	async retire(olderThanDays: number): Promise<number> {
		if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) return 0;

		const cutoff = `${olderThanDays} days`;
		const retired = (await this.sql`
			WITH old AS (
				DELETE FROM turns
				WHERE ingested_at IS NOT NULL
					AND ingested_at < now() - ${cutoff}::interval
				RETURNING conversation_id, turn_index
			),
			cleared AS (
				DELETE FROM turn_messages m
				USING old
				WHERE m.conversation_id = old.conversation_id
					AND m.turn_index = old.turn_index
			)
			SELECT count(*)::int AS retired FROM old`) as { retired: number }[];
		return retired[0]?.retired ?? 0;
	}

	/** Empties the store. The Journal remains the record it is rebuilt from. */
	async truncate(): Promise<void> {
		await this.sql`TRUNCATE turns, turn_messages, call_accounting, concept_sections`;
	}
}
