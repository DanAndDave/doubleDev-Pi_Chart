import { SQL } from "bun";

import {
	groupByTurn,
	type AccountingStore,
	type CallAccounting,
	type CallAddress,
	type Measurement,
	type TailSource,
	type TurnAccounting,
} from "./accounting.ts";
import type { Pack, PackSource } from "./assembler.ts";
import type { JournalTurn } from "./journal.ts";
import type { HarnessMessage, Turn } from "./messages.ts";
import type { TurnSink, TurnSource } from "./thread-store.ts";

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
export class PostgresStore implements TurnSource, TurnSink, AccountingStore {
	constructor(private readonly sql: SQL) {}

	static connect(url: string): PostgresStore {
		return new PostgresStore(new SQL(url));
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

	async ingest(conversationId: string, turns: JournalTurn[]): Promise<void> {
		for (const turn of turns) {
			await this.sql`
				INSERT INTO turns (conversation_id, turn_index, prompt)
				VALUES (${conversationId}, ${turn.turnIndex}, ${turn.prompt})
				ON CONFLICT (conversation_id, turn_index)
				DO UPDATE SET prompt = EXCLUDED.prompt`;

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
				turns.push({ prompt: row.prompt, messages: [] });
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
		const parts = pack.parts.map((part) => ({
			source: part.source,
			approximateTokens: part.approximateTokens,
		}));

		await this.sql`
			INSERT INTO call_accounting
				(conversation_id, turn_index, call_index, recorded_at, parts,
				 approximate_tokens, unassembled, tail_source)
			VALUES (
				${conversationId}, ${address.turnIndex}, ${address.callIndex}, now(),
				${JSON.stringify(parts)}::jsonb, ${pack.approximateTokens}, FALSE,
				${tailSource}
			)
			ON CONFLICT (conversation_id, turn_index, call_index)
			DO UPDATE SET
				recorded_at = EXCLUDED.recorded_at,
				parts = EXCLUDED.parts,
				approximate_tokens = EXCLUDED.approximate_tokens,
				unassembled = FALSE,
				tail_source = EXCLUDED.tail_source`;
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
			       pack_tokens, floor_tokens, unassembled, tail_source
			FROM call_accounting
			WHERE conversation_id = ${conversationId}
			ORDER BY turn_index ASC, call_index ASC`) as AccountingRow[];

		const calls: CallAccounting[] = rows.map((row) => ({
			turnIndex: row.turn_index,
			callIndex: row.call_index,
			at: row.recorded_at?.toISOString(),
			parts: decode<{ source: PackSource; approximateTokens: number }[]>(
				row.parts,
				[],
			).map((part) => ({ ...part, approximate: true as const })),
			approximateTokens: row.approximate_tokens ?? undefined,
			packTokens: row.pack_tokens ?? undefined,
			floorTokens: row.floor_tokens ?? undefined,
			unassembled: row.unassembled || undefined,
			tailSource: row.tail_source ?? undefined,
		}));

		return groupByTurn(conversationId, calls);
	}

	/** Empties the store. The Journal remains the record it is rebuilt from. */
	async truncate(): Promise<void> {
		await this.sql`TRUNCATE turns, turn_messages, call_accounting`;
	}
}
