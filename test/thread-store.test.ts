import { describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import { readJournal, type JournalTurn } from "../src/journal.ts";
import { MemoryTurnSource } from "../src/thread-store.ts";

const JOURNAL = new URL(
	"./fixtures/journal-tool-session.jsonl",
	import.meta.url,
).pathname;

function turn(index: number, prompt: string): JournalTurn {
	return {
		turnIndex: index,
		prompt,
		messages: [
			{ role: "user", content: prompt },
			{ role: "assistant", content: `answer ${index}` },
		],
		callCount: 1,
	};
}

describe("turn source", () => {
	test("returns the most recent turns, oldest first", async () => {
		const store = new MemoryTurnSource();
		await store.ingest("conv-1", [
			turn(0, "first"),
			turn(1, "second"),
			turn(2, "third"),
		]);

		const recent = await store.recentTurns("conv-1", 2);

		expect(recent.map((each) => each.prompt)).toEqual(["second", "third"]);
	});

	test("each turn keeps its messages in the order they occurred", async () => {
		const store = new MemoryTurnSource();
		await store.ingest("conv-1", await readJournal(JOURNAL));

		const [, toolTurn] = await store.recentTurns("conv-1", 3);

		expect(toolTurn?.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
			"toolResult",
			"assistant",
		]);
	});

	test("never returns a turn from another conversation", async () => {
		const store = new MemoryTurnSource();
		await store.ingest("conv-1", [turn(0, "mine")]);
		await store.ingest("conv-2", [turn(0, "theirs")]);

		const recent = await store.recentTurns("conv-1", 10);

		expect(recent.map((each) => each.prompt)).toEqual(["mine"]);
	});

	test("ingesting the same journal twice does not duplicate turns", async () => {
		const store = new MemoryTurnSource();
		const journal = await readJournal(JOURNAL);

		await store.ingest("conv-1", journal);
		await store.ingest("conv-1", journal);

		expect(await store.recentTurns("conv-1", 100)).toHaveLength(3);
	});

	test("ingesting a grown conversation adds only what is new", async () => {
		const store = new MemoryTurnSource();
		await store.ingest("conv-1", [turn(0, "first")]);

		await store.ingest("conv-1", [turn(0, "first"), turn(1, "second")]);

		const recent = await store.recentTurns("conv-1", 100);
		expect(recent.map((each) => each.prompt)).toEqual(["first", "second"]);
	});

	test("a rebuilt store assembles the identical pack", async () => {
		const journal = await readJournal(JOURNAL);
		const before = new MemoryTurnSource();
		await before.ingest("conv-1", journal);
		const original = assemble(await before.recentTurns("conv-1", 2), {
			tailTurns: 2,
		});

		// Discarding the store and re-ingesting from the Journal, which is the
		// record the store is only ever derived from.
		const rebuilt = new MemoryTurnSource();
		await rebuilt.ingest("conv-1", await readJournal(JOURNAL));
		const after = assemble(await rebuilt.recentTurns("conv-1", 2), {
			tailTurns: 2,
		});

		expect(after).toEqual(original);
	});

	test("asking for no turns returns none", async () => {
		const store = new MemoryTurnSource();
		await store.ingest("conv-1", [turn(0, "first")]);

		expect(await store.recentTurns("conv-1", 0)).toEqual([]);
	});
});
