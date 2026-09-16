import { expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import { readJournal, type JournalTurn } from "../src/journal.ts";
import type { TurnSink, TurnSource } from "../src/thread-store.ts";

export const JOURNAL_FIXTURE = new URL(
	"./fixtures/journal-tool-session.jsonl",
	import.meta.url,
).pathname;

export function journalTurn(index: number, prompt: string): JournalTurn {
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

/** Yields an empty store under test. Called once per case. */
export type ContractSubject = () => Promise<TurnSource & TurnSink>;

/**
 * The behaviour every Turn source owes the Assembler, run against each
 * implementation. Written once so the in-memory and Postgres stores cannot
 * drift apart on ordering, scoping, or idempotence — the differences that
 * would otherwise only surface in the gated suite.
 */
export function turnSourceContract(name: string, fresh: ContractSubject): void {
	test(`${name}: returns the most recent turns, oldest first`, async () => {
		const store = await fresh();
		await store.ingest("conv-1", [
			journalTurn(0, "first"),
			journalTurn(1, "second"),
			journalTurn(2, "third"),
		]);

		const recent = await store.recentTurns("conv-1", 2);

		expect(recent.map((turn) => turn.prompt)).toEqual(["second", "third"]);
	});

	test(`${name}: keeps each turn's messages in the order they occurred`, async () => {
		const store = await fresh();
		await store.ingest("conv-1", await readJournal(JOURNAL_FIXTURE));

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

	test(`${name}: never returns a turn from another conversation`, async () => {
		const store = await fresh();
		await store.ingest("conv-1", [journalTurn(0, "mine")]);
		await store.ingest("conv-2", [journalTurn(0, "theirs")]);

		const recent = await store.recentTurns("conv-1", 10);

		expect(recent.map((turn) => turn.prompt)).toEqual(["mine"]);
	});

	test(`${name}: ingesting the same journal twice does not duplicate`, async () => {
		const store = await fresh();
		const journal = await readJournal(JOURNAL_FIXTURE);

		await store.ingest("conv-1", journal);
		await store.ingest("conv-1", journal);

		const turns = await store.recentTurns("conv-1", 100);
		expect(turns).toHaveLength(3);
		expect(turns[1]?.messages).toHaveLength(6);
	});

	test(`${name}: ingesting a grown conversation adds only what is new`, async () => {
		const store = await fresh();
		const journal = await readJournal(JOURNAL_FIXTURE);
		await store.ingest("conv-1", journal.slice(0, 1));

		await store.ingest("conv-1", journal);

		expect(await store.recentTurns("conv-1", 100)).toHaveLength(3);
	});

	test(`${name}: a failed tool result is kept as a failure`, async () => {
		const store = await fresh();
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

	test(`${name}: emptying and re-ingesting rebuilds the identical pack`, async () => {
		const store = await fresh();
		await store.ingest("conv-1", await readJournal(JOURNAL_FIXTURE));
		const before = assemble(
			{ turns: await store.recentTurns("conv-1", 2) },
			{ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 },
		);

		const rebuilt = await fresh();
		await rebuilt.ingest("conv-1", await readJournal(JOURNAL_FIXTURE));
		const after = assemble(
			{ turns: await rebuilt.recentTurns("conv-1", 2) },
			{ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 },
		);

		expect(after).toEqual(before);
	});

	test(`${name}: asking for no turns returns none`, async () => {
		const store = await fresh();
		await store.ingest("conv-1", [journalTurn(0, "first")]);

		expect(await store.recentTurns("conv-1", 0)).toEqual([]);
	});
}
