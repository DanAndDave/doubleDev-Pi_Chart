import { describe, expect, test } from "bun:test";

import { readJournal } from "../src/journal.ts";
import { MemoryTurnSource } from "../src/thread-store.ts";
import {
	JOURNAL_FIXTURE,
	journalTurn,
	turnSourceContract,
} from "./turn-source-contract.ts";

describe("turn source contract", () => {
	turnSourceContract("memory", async () => new MemoryTurnSource());
});

describe("MemoryTurnSource", () => {
	test("a conversation it has never seen has no turns", async () => {
		const store = new MemoryTurnSource();
		await store.ingest("conv-1", [journalTurn(0, "first")]);

		expect(await store.recentTurns("conv-2", 10)).toEqual([]);
	});

	test("ingest preserves the prompt recorded in the journal", async () => {
		const store = new MemoryTurnSource();
		await store.ingest("conv-1", await readJournal(JOURNAL_FIXTURE));

		const turns = await store.recentTurns("conv-1", 100);

		expect(turns.map((turn) => turn.prompt)).toEqual([
			"Say: one",
			"Create a file leaf.txt with the word maple, read it back, then say done",
			"Say: three",
		]);
	});
});
