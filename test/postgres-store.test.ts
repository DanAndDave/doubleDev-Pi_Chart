// Store-backed seam. These need a real Postgres — `docker compose up -d` and
// CM_DATABASE_URL — because "the schema applies" and "SQL returns turns in
// order" mean nothing against a fake.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";

import { assemble } from "../src/assembler.ts";
import { StubEmbedder } from "../src/embedder.ts";
import { readJournal } from "../src/journal.ts";
import {
	MIGRATION_VERSIONS,
	PostgresStore,
} from "../src/postgres-store.ts";
import { JOURNAL_FIXTURE, turnSourceContract } from "./turn-source-contract.ts";
import { budgets } from "./fixtures.ts";

const databaseUrl = process.env.CM_DATABASE_URL;
const describeStore = databaseUrl ? describe : describe.skip;

let store: PostgresStore;

describeStore("PostgresStore", () => {
	beforeAll(async () => {
		store = PostgresStore.connect(databaseUrl ?? "");
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

	test("accounting written now is readable by a later connection", async () => {
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

		// A separate connection stands in for a later process.
		const reader = PostgresStore.connect(databaseUrl ?? "");
		try {
			const [turn] = await reader.readAccounting("conv-1");
			expect(turn?.floorTokens).toBe(25588);
			expect(turn?.packTokens).toBe(29352 - 25588);
			expect(turn?.calls[0]?.tailSource).toBe("thread-store");
			expect(turn?.calls[0]?.parts[0]?.approximate).toBe(true);
		} finally {
			await reader.close();
		}
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

		// A separate connection stands in for a later process: the reasons a
		// pack was reduced have to outlive the Call that recorded them.
		const reader = PostgresStore.connect(databaseUrl ?? "");
		try {
			const [turn] = await reader.readAccounting("conv-1");
			const call = turn?.calls[0];
			const tail = call?.parts.find((part) => part.source === "verbatim-tail");

			expect(call?.ceiling).toBe(300);
			expect(call?.beforeCeiling).toBeGreaterThan(300);
			expect(tail?.shortened).toBe(true);
			expect(tail?.withoutCeiling).toBeGreaterThan(tail?.approximateTokens ?? 0);
		} finally {
			await reader.close();
		}
	});
});

describeStore("the call a message came from", () => {
	// Its own connections: the block above closes the shared store when it
	// finishes, and a test that depends on file order is not a test.
	let calls: PostgresStore;
	let sql: SQL;

	beforeAll(async () => {
		calls = PostgresStore.connect(databaseUrl ?? "");
		await calls.migrate();
		sql = new SQL(databaseUrl ?? "");
	});

	afterAll(async () => {
		await calls?.close();
		await sql?.close();
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

		const embedded = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
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
