// Store-backed seam: "the schema applies" and "SQL returns turns in order"
// mean nothing against a fake, so these run against a real store — PGlite,
// in-process, by default, or the server `PICHART_DATABASE_URL` names.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import { loadConfig } from "../src/config.ts";
import { StubEmbedder } from "../src/embedder.ts";
import { readJournal } from "../src/journal.ts";
import { MIGRATION_VERSIONS, PostgresStore } from "../src/postgres-store.ts";
import { bunSql, type Sql } from "../src/sql.ts";
import { reconstructTurns } from "../src/turns.ts";
import { budgets } from "./fixtures.ts";
import { storeLocation } from "./store-support.ts";
import { JOURNAL_FIXTURE, turnSourceContract } from "./turn-source-contract.ts";

const describeStore = describe;
const location = storeLocation();

afterAll(() => location.dispose());

let store: PostgresStore;

describeStore("PostgresStore", () => {
	beforeAll(async () => {
		store = new PostgresStore(location.open());
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
	});

	beforeEach(async () => {
		await store.truncate();
	});

	// The same behaviour the in-memory store is held to, so the two cannot
	// drift on ordering, scoping, or idempotence.
	turnSourceContract("postgres", async () => {
		await store.truncate();
		return store;
	});

	test("an empty database is migrated and ready", async () => {
		// beforeAll already migrated; proving it took is a successful query
		// against a table only the migration creates.
		expect(await store.recentTurns("never-seen", 10)).toEqual([]);
	});

	test("migrating an already-migrated database leaves content intact", async () => {
		await store.ingest("conv-1", await readJournal(JOURNAL_FIXTURE));

		await store.migrate();

		expect(await store.recentTurns("conv-1", 100)).toHaveLength(3);
	});

	test("a real session becomes queryable, turn by turn", async () => {
		await store.ingest("conv-1", await readJournal(JOURNAL_FIXTURE));

		const turns = await store.recentTurns("conv-1", 100);

		expect(turns.map((turn) => turn.prompt)).toEqual([
			"Say: one",
			"Create a file leaf.txt with the word maple, read it back, then say done",
			"Say: three",
		]);
	});

	test("what one process ingested, a later process reads", async () => {
		// PGlite persists to its data directory: a fresh handle
		// after close stands in for a later process. On a server it is simply
		// a second connection. Either way, durability is observable.
		const durable = storeLocation();
		try {
			const first = new PostgresStore(durable.open());
			await first.migrate();
			await first.ingest("durable", await readJournal(JOURNAL_FIXTURE));
			await first.close();

			const later = new PostgresStore(durable.open());
			try {
				await later.migrate();
				expect(await later.recentTurns("durable", 100)).toHaveLength(3);
			} finally {
				await later.close();
			}
		} finally {
			durable.dispose();
		}
	});

	test("accounting written now survives a read-back", async () => {
		await store.recordPack(
			"conv-1",
			{ turnIndex: 0, callIndex: 0 },
			assemble({ turns: [{ prompt: "hi", messages: [{ role: "user", content: "hi" }] }] }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 })),
			"thread-store",
			"off",
		);
		await store.recordMeasurements("conv-1", [
			{
				turnIndex: 0,
				callIndex: 0,
				snapshot: { promptTokens: 29352, nonMessageTokens: 25588 },
			},
		]);

		// Read back through the same store: the suites' PGlite is single-writer,
		// so a later process is modelled by close-and-reopen, not a live second
		// connection. This asserts what was recorded survives a read-back.
		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.floorTokens).toBe(25588);
		expect(turn?.packTokens).toBe(29352 - 25588);
		expect(turn?.calls[0]?.tailSource).toBe("thread-store");
		expect(turn?.calls[0]?.parts[0]?.approximate).toBe(true);
	});

	test("what a call's curated part could not see survives the write", async () => {
		const pack = assemble(
			{
				turns: [{ prompt: "hi", messages: [{ role: "user", content: "hi" }] }],
				conceptsUnsearched: 5,
			},
			budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 2, graphSymbols: 0 }),
		);
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store", "off");

		const [turn] = await store.readAccounting("conv-1");

		// Read back per Call, because a Conversation spanning a model change
		// has Calls on both sides of the repair.
		expect(turn?.calls[0]?.conceptsUnsearched).toBe(5);
	});

	test("costs land on the calls a pack was recorded for, and nowhere else", async () => {
		const pack = assemble(
			{ turns: [{ prompt: "hi", messages: [{ role: "user", content: "hi" }] }] },
			budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }),
		);
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store", "off");
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 1 }, pack, "thread-store", "off");
		await store.recordMeasurements("conv-1", [
			{
				turnIndex: 0,
				callIndex: 1,
				snapshot: { promptTokens: 300, nonMessageTokens: 90 },
				usage: { input: 9, cacheRead: 7 },
			},
		]);
		const snapshot = { promptTokens: 100, nonMessageTokens: 90 };

		await store.recordCosts("conv-1", [
			{ turnIndex: 0, callIndex: 0, snapshot, usage: { input: 1, cacheRead: 60, cacheWrite: 39 } },
			// Unpriced fields keep what was recorded before.
			{ turnIndex: 0, callIndex: 1, snapshot, usage: { cacheWrite: 5 } },
			// A Call no pack was recorded for gains no row.
			{ turnIndex: 3, callIndex: 0, snapshot, usage: { input: 2 } },
		]);

		const turns = await store.readAccounting("conv-1");
		expect(turns.map((turn) => turn.turnIndex)).toEqual([0]);
		const [first, second] = turns[0]?.calls ?? [];
		expect([first?.inputTokens, first?.cacheRead, first?.cacheWrite]).toEqual([1, 60, 39]);
		expect([second?.inputTokens, second?.cacheRead, second?.cacheWrite]).toEqual([9, 7, 5]);
	});

	test("what the harness could recognise survives the write", async () => {
		const supplied = [
			{ role: "user", content: "earlier" },
			{ role: "assistant", content: "answered" },
			{ role: "user", content: "hi" },
		];
		const pack = assemble(
			{ turns: reconstructTurns(supplied), supplied },
			budgets({ tailTurns: 4, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }),
		);
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store", "off");

		const [turn] = await store.readAccounting("conv-1");

		// The figure that explains a cache line: what was charged says
		// nothing about why without it.
		expect(pack.leadingTokens).toBeGreaterThan(0);
		expect(turn?.calls[0]?.leadingTokens).toBe(pack.leadingTokens);
	});

	test("accounting for a tool-using turn groups its calls", async () => {
		const pack = assemble({ turns: [{ prompt: "hi", messages: [{ role: "user", content: "hi" }] }] }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store", "off");
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 1 }, pack, "thread-store", "off");
		await store.recordPack("conv-1", { turnIndex: 1, callIndex: 0 }, pack, "thread-store", "off");

		const turns = await store.readAccounting("conv-1");

		expect(turns.map((turn) => turn.calls.length)).toEqual([2, 1]);
	});

	test("a call whose assembly failed is kept, marked unassembled", async () => {
		await store.recordUnassembled("conv-1", { turnIndex: 0, callIndex: 0 }, "off");

		const [turn] = await store.readAccounting("conv-1");

		expect(turn?.calls[0]?.unassembled).toBe(true);
	});

	test("what the ceiling reduced survives a read-back", async () => {
		const bulky = {
			role: "toolResult" as const,
			toolName: "read",
			toolCallId: "call-1",
			content: "y".repeat(8000),
		};
		const pack = assemble(
			{
				turns: [
					{
						index: 0,
						prompt: "older",
						messages: [{ role: "user", content: "older" }, bulky],
					},
					{
						index: 1,
						prompt: "current",
						messages: [{ role: "user", content: "current" }],
					},
				],
			},
			budgets({ tailTurns: 1, packTokens: 300 }),
		);
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store", "off");

		// Read back through the same store: the reasons a pack was reduced have
		// to outlive the Call that recorded them. PGlite is single-writer, so
		// durability across processes is covered by close-and-reopen elsewhere.
		const [turn] = await store.readAccounting("conv-1");
		const call = turn?.calls[0];
		const tail = call?.parts.find((part) => part.source === "verbatim-tail");

		expect(call?.ceiling).toBe(300);
		expect(call?.beforeCeiling).toBeGreaterThan(300);
		expect(tail?.shortened).toBe(true);
		expect(tail?.withoutCeiling).toBeGreaterThan(tail?.approximateTokens ?? 0);
	});
});

describeStore("the call a message came from", () => {
	// One connection, shared: the suites' PGlite is single-writer, so a
	// separate handle would not see this store's writes. The raw `sql` reads
	// through the very handle the store wrote through.
	let calls: PostgresStore;
	let sql: Sql;

	beforeAll(async () => {
		sql = location.open();
		calls = new PostgresStore(sql);
		await calls.migrate();
	});

	afterAll(async () => {
		// `sql` and `calls` are the same handle; closing the store closes it.
		await calls?.close();
	});

	beforeEach(async () => {
		await calls.truncate();
	});

	async function callsOf(turnIndex: number): Promise<number[]> {
		const rows = (await sql`
			SELECT call_index FROM turn_messages
			WHERE conversation_id = 'calls' AND turn_index = ${turnIndex}
			ORDER BY ordinal ASC`) as { call_index: number }[];
		return rows.map((row) => row.call_index);
	}

	test("a turn answered in several calls records which produced what", async () => {
		await calls.truncate();
		await calls.ingest("calls", await readJournal(JOURNAL_FIXTURE));

		expect(await callsOf(1)).toEqual([0, 0, 1, 1, 2, 2]);
	});

	test("a turn answered in one call is addressed to that call", async () => {
		await calls.truncate();
		await calls.ingest("calls", await readJournal(JOURNAL_FIXTURE));

		expect(await callsOf(0)).toEqual([0, 0]);
	});

	test("re-ingesting gives rows written before the column their calls", async () => {
		await calls.truncate();
		const turns = await readJournal(JOURNAL_FIXTURE);
		// What an older build left: rows at the column's default, which
		// re-ingest has to correct rather than leave alone.
		await sql`
			INSERT INTO turns (conversation_id, turn_index, prompt)
			VALUES ('calls', 1, 'old')`;
		for (const [ordinal, message] of (turns[1]?.messages ?? []).entries()) {
			await sql`
				INSERT INTO turn_messages
					(conversation_id, turn_index, ordinal, role, message)
				VALUES ('calls', 1, ${ordinal}, ${message.role},
					${JSON.stringify(message)}::jsonb)`;
		}
		expect(await callsOf(1)).toEqual([0, 0, 0, 0, 0, 0]);

		await calls.ingest("calls", turns);

		expect(await callsOf(1)).toEqual([0, 0, 1, 1, 2, 2]);
	});

	test("a turn stored before calls were recorded reads back as one call", async () => {
		await calls.truncate();
		// What an older build left: no call on the messages, none on the
		// Turn. Read back through the store rather than inspected in SQL,
		// because the claim is about reading, not about a column default.
		await sql`
			INSERT INTO turns (conversation_id, turn_index, prompt)
			VALUES ('calls', 9, 'an older ingest')`;
		await sql`
			INSERT INTO turn_messages
				(conversation_id, turn_index, ordinal, role, message)
			VALUES ('calls', 9, 0, 'user', '{"role":"user","content":"an older ingest"}'::jsonb)`;

		const embedded = new PostgresStore(location.open(), new StubEmbedder());
		try {
			await embedded.embedPending();
			const [found] = await embedded.searchAll("an older ingest", 1, 2);

			expect(found?.turnIndex).toBe(9);
			expect(found?.calls).toBe(1);
		} finally {
			await embedded.close();
		}
	});

	test("a journal the harness never annotated ingests as one call", async () => {
		await calls.truncate();
		const turns = await readJournal(JOURNAL_FIXTURE);
		const stripped = turns.map((turn) => ({
			...turn,
			messages: turn.messages.map(({ contextSnapshot, ...rest }) => rest),
			callCount: 0,
			calls: turn.messages.map(() => 0),
		}));

		await calls.ingest("calls", stripped);

		expect(await callsOf(1)).toEqual([0, 0, 0, 0, 0, 0]);
	});
});

describe("the schema's declared order", () => {
	test("versions ascend, because array order is what runs", () => {
		// A version declared out of place runs out of place: migration 7
		// alters a table migration 1 creates, and a later one could alter
		// a table an earlier one has not created yet.
		// Strictly: a repeated version is recorded as applied by whichever
		// entry ran first, so the second never runs at all.
		const ascending = MIGRATION_VERSIONS.every(
			(version, index) =>
				index === 0 || version > (MIGRATION_VERSIONS[index - 1] ?? 0),
		);
		expect(ascending).toBe(true);
	});
});

describe("choosing a store backend", () => {
	// `open` dials lazily, on first query, so these connect to nothing.
	test("a declined store is no store at all", () => {
		expect(
			PostgresStore.open(loadConfig({ PICHART_DATABASE_URL: "" })),
		).toBeUndefined();
	});

	test("a store not yet set up is no store either, not a guess", () => {
		expect(PostgresStore.open(loadConfig({}))).toBeUndefined();
	});

	test("a supplied and a saved url each yield a store", () => {
		expect(
			PostgresStore.open(loadConfig({ PICHART_DATABASE_URL: "postgres://x/y" })),
		).toBeInstanceOf(PostgresStore);
		expect(PostgresStore.open(loadConfig({}, "postgres://x/y"))).toBeInstanceOf(
			PostgresStore,
		);
	});
});

// Two sessions are two processes, each with its own connection; only a
// server can stand for that, so these need PICHART_DATABASE_URL.
const server = process.env.PICHART_DATABASE_URL;
const describeServer = server ? describe : describe.skip;

describeServer("sessions sharing one server", () => {
	const scratch = `pi_chart_sessions_${process.pid}`;
	let fresh: string;
	let admin: Sql;

	beforeAll(async () => {
		admin = bunSql(server as string);
		await admin.unsafe(`CREATE DATABASE ${scratch}`);
		const url = new URL(server as string);
		url.pathname = `/${scratch}`;
		fresh = url.toString();
	});

	afterAll(async () => {
		await admin.unsafe(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
		await admin.end();
	});

	test("two sessions migrating an empty database at once each record a version once", async () => {
		const first = new PostgresStore(bunSql(fresh));
		const second = new PostgresStore(bunSql(fresh));
		try {
			await Promise.all([first.migrate(), second.migrate()]);

			const reader = bunSql(fresh);
			try {
				const rows = await reader`
					SELECT version, count(*)::int AS times FROM schema_migrations GROUP BY version`;
				expect(rows.map((row: { version: number }) => row.version).sort((a: number, b: number) => a - b)).toEqual(
					[...MIGRATION_VERSIONS],
				);
				expect(rows.every((row: { times: number }) => row.times === 1)).toBe(true);
			} finally {
				await reader.end();
			}
		} finally {
			await first.close();
			await second.close();
		}
	});

	test("each session reads back the Turns the other ingested", async () => {
		const journal = await readJournal(JOURNAL_FIXTURE);
		const first = new PostgresStore(bunSql(fresh));
		const second = new PostgresStore(bunSql(fresh));
		try {
			await Promise.all([first.migrate(), second.migrate()]);
			await Promise.all([first.ingest("first", journal), second.ingest("second", journal)]);

			expect(await first.recentTurns("second", 100)).toHaveLength(3);
			expect(await second.recentTurns("first", 100)).toHaveLength(3);
		} finally {
			await first.close();
			await second.close();
		}
	});

	test("costs batched into one statement reach the server's rows", async () => {
		// The driver sends a string bound at a jsonb site as a JSON string;
		// PGlite does not, so only a real server proves the cast.
		const store = new PostgresStore(bunSql(fresh));
		try {
			await store.migrate();
			const at = { turnIndex: 0, callIndex: 0 };
			const pack = assemble(
				{ turns: [{ prompt: "hi", messages: [{ role: "user", content: "hi" }] }] },
				budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }),
			);
			await store.recordPack("costs", at, pack, "thread-store", "off");

			await store.recordCosts("costs", [
				{
					...at,
					snapshot: { promptTokens: 100, nonMessageTokens: 90 },
					usage: { input: 1, cacheRead: 60, cacheWrite: 39 },
				},
			]);

			const [call] = (await store.readAccounting("costs"))[0]?.calls ?? [];
			expect([call?.inputTokens, call?.cacheRead, call?.cacheWrite]).toEqual([1, 60, 39]);
		} finally {
			await store.close();
		}
	});
});
