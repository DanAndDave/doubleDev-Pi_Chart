// Store-backed seam. These need a real Postgres — `docker compose up -d` and
// CM_DATABASE_URL — because "the schema applies" and "SQL returns turns in
// order" mean nothing against a fake.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import { readJournal } from "../src/journal.ts";
import { PostgresStore } from "../src/postgres-store.ts";
import { JOURNAL_FIXTURE, turnSourceContract } from "./turn-source-contract.ts";

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
			assemble({ turns: [{ prompt: "hi", messages: [{ role: "user", content: "hi" }] }] }, { tailTurns: 2, recallTurns: 0 }),
			"thread-store",
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
		const pack = assemble(
			{ turns: [{ prompt: "hi", messages: [{ role: "user", content: "hi" }] }] },
			{ tailTurns: 2, recallTurns: 0 },
		);
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store");
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 1 }, pack, "thread-store");
		await store.recordPack("conv-1", { turnIndex: 1, callIndex: 0 }, pack, "thread-store");

		const turns = await store.readAccounting("conv-1");

		expect(turns.map((turn) => turn.calls.length)).toEqual([2, 1]);
	});

	test("a call whose assembly failed is kept, marked unassembled", async () => {
		await store.recordUnassembled("conv-1", { turnIndex: 0, callIndex: 0 });

		const [turn] = await store.readAccounting("conv-1");

		expect(turn?.calls[0]?.unassembled).toBe(true);
	});
});
