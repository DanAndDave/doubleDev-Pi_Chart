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
import type { JournalTurn } from "./journal.ts";
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
 * Forward-only schema. Each entry runs once, in order, recorded by version;
 * a store created by an older build becomes usable without intervention.
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
];

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
export class PostgresStore implements TurnSource, TurnSink, TurnRecall, CorpusSearch, AccountingStore {
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
				INSERT INTO turns (conversation_id, turn_index, prompt, codebase)
				VALUES (
					${conversationId}, ${turn.turnIndex}, ${turn.prompt},
					${codebase ?? null}
				)
				ON CONFLICT (conversation_id, turn_index)
				DO UPDATE SET
					prompt = EXCLUDED.prompt,
					-- Never unset a Codebase a previous ingest knew.
					codebase = COALESCE(EXCLUDED.codebase, turns.codebase)`;

			for (const [ordinal, message] of turn.messages.entries()) {
				await this.sql`
					INSERT INTO turn_messages
						(conversation_id, turn_index, ordinal, role, message, tool_name, is_error)
					VALUES (
						${conversationId}, ${turn.turnIndex}, ${ordinal}, ${message.role},
						${JSON.stringify(message)}::jsonb, ${message.toolName ?? null},
						${message.isError === true}
					)
					ON CONFLICT (conversation_id, turn_index, ordinal)
					DO UPDATE SET
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
			budgets: decode<{ tail: number; recall: number } | undefined>(
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
			});
		}
		return found;
	}

	/** Empties the store. The Journal remains the record it is rebuilt from. */
	async truncate(): Promise<void> {
		await this.sql`TRUNCATE turns, turn_messages, call_accounting`;
	}
}
