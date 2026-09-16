// Store-backed seam. These need a real Postgres — `docker compose up -d` and
// CM_DATABASE_URL — because "the schema applies" and "SQL returns turns in
// order" mean nothing against a fake.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import { readJournal } from "../src/journal.ts";
import { PostgresStore } from "../src/postgres-store.ts";

const databaseUrl = process.env.CM_DATABASE_URL;
const describeStore = databaseUrl ? describe : describe.skip;

const JOURNAL = new URL(
	"./fixtures/journal-tool-session.jsonl",
	import.meta.url,
).pathname;

describeStore("PostgresStore", () => {
	let store: PostgresStore;

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

	test("migrating an already-migrated database leaves content intact", async () => {
		await store.ingest("conv-1", await readJournal(JOURNAL));

		await store.migrate();

		expect(await store.recentTurns("conv-1", 100)).toHaveLength(3);
	});

	test("a real session becomes queryable, turn by turn", async () => {
		await store.ingest("conv-1", await readJournal(JOURNAL));

		const turns = await store.recentTurns("conv-1", 100);

		expect(turns.map((turn) => turn.prompt)).toEqual([
			"Say: one",
			"Create a file leaf.txt with the word maple, read it back, then say done",
			"Say: three",
		]);
	});

	test("a tool-using turn keeps its calls and results, in order", async () => {
		await store.ingest("conv-1", await readJournal(JOURNAL));

		const [, toolTurn] = await store.recentTurns("conv-1", 100);

		expect(toolTurn?.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
			"toolResult",
			"assistant",
		]);
	});

	test("ingesting the same journal twice does not duplicate anything", async () => {
		const journal = await readJournal(JOURNAL);
		await store.ingest("conv-1", journal);
		await store.ingest("conv-1", journal);

		const turns = await store.recentTurns("conv-1", 100);

		expect(turns).toHaveLength(3);
		expect(turns[1]?.messages).toHaveLength(6);
	});

	test("a grown conversation adds only what is new", async () => {
		const journal = await readJournal(JOURNAL);
		await store.ingest("conv-1", journal.slice(0, 1));

		await store.ingest("conv-1", journal);

		expect(await store.recentTurns("conv-1", 100)).toHaveLength(3);
	});

	test("only the most recent turns come back, oldest first", async () => {
		await store.ingest("conv-1", await readJournal(JOURNAL));

		const turns = await store.recentTurns("conv-1", 2);

		expect(turns.map((turn) => turn.prompt)).toEqual([
			"Create a file leaf.txt with the word maple, read it back, then say done",
			"Say: three",
		]);
	});

	test("another conversation's turns stay out", async () => {
		const journal = await readJournal(JOURNAL);
		await store.ingest("conv-1", journal);
		await store.ingest("conv-2", journal.slice(0, 1));

		expect(await store.recentTurns("conv-2", 100)).toHaveLength(1);
	});

	test("emptying the store and re-ingesting rebuilds the identical pack", async () => {
		await store.ingest("conv-1", await readJournal(JOURNAL));
		const before = assemble(await store.recentTurns("conv-1", 2), {
			tailTurns: 2,
		});

		await store.truncate();
		await store.ingest("conv-1", await readJournal(JOURNAL));
		const after = assemble(await store.recentTurns("conv-1", 2), {
			tailTurns: 2,
		});

		expect(after).toEqual(before);
	});

	test("accounting written now is readable by a later connection", async () => {
		await store.recordPack(
			"conv-1",
			{ turnIndex: 0, callIndex: 0 },
			assemble([{ prompt: "hi", messages: [{ role: "user", content: "hi" }] }], {
				tailTurns: 2,
			}),
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

	test("a failed tool result is stored as a failure", async () => {
		await store.ingest("conv-1", [
			{
				turnIndex: 0,
				prompt: "read a missing file",
				messages: [
					{ role: "user", content: "read a missing file" },
					{
						role: "toolResult",
						toolName: "read",
						isError: true,
						content: [{ type: "text", text: "not found" }],
					},
				],
				callCount: 1,
			},
		]);

		const [turn] = await store.recentTurns("conv-1", 1);
		const failure = turn?.messages.find((message) => message.isError === true);
		expect(failure?.toolName).toBe("read");
	});
});
