import { describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import type { Turn } from "../src/messages.ts";
import type { RecalledTurn } from "../src/thread-store.ts";

function turn(prompt: string, answer = `answer to ${prompt}`, index?: number): Turn {
	return {
		index,
		prompt,
		messages: [
			{ role: "user", content: prompt },
			{ role: "assistant", content: answer },
		],
	};
}

function recalled(...prompts: string[]): RecalledTurn[] {
	return prompts.map((prompt, index) => ({
		turnIndex: index,
		turn: turn(prompt),
	}));
}

// Stored Turns carry their position; the Turn in progress has none yet.
const CONVERSATION = [
	turn("recent one", undefined, 10),
	turn("recent two", undefined, 11),
	turn("current"),
];

function textOf(content: unknown): string {
	return typeof content === "string" ? content : JSON.stringify(content);
}

describe("recall in a pack", () => {
	test("a turn outside the tail reaches the model", () => {
		const pack = assemble(
			{ turns: CONVERSATION, recalled: recalled("the caching decision") },
			{ tailTurns: 1, recallTurns: 2, docConcepts: 0, graphSymbols: 0 },
		);

		expect(pack.messages.map((message) => textOf(message.content)).join("\n")).toContain(
			"the caching decision",
		);
	});

	test("recalled content is attributed with its position", () => {
		const pack = assemble(
			{ turns: CONVERSATION, recalled: [{ turnIndex: 7, turn: turn("old decision") }] },
			{ tailTurns: 1, recallTurns: 2, docConcepts: 0, graphSymbols: 0 },
		);

		const recollection = pack.parts.find((part) => part.source === "recalled");
		expect(textOf(recollection?.messages[0]?.content)).toContain("turn 7");
	});

	test("recall is its own part, accounted separately from the tail", () => {
		const pack = assemble(
			{ turns: CONVERSATION, recalled: recalled("something older") },
			{ tailTurns: 2, recallTurns: 2, docConcepts: 0, graphSymbols: 0 },
		);

		expect(pack.parts.map((part) => part.source)).toEqual([
			"recalled",
			"verbatim-tail",
			"current-turn",
		]);
	});

	test("recall is trimmed to its budget, strongest matches kept", () => {
		const pack = assemble(
			{
				turns: CONVERSATION,
				// Retrieval returns these strongest-first.
				recalled: recalled("best match", "second match", "third match"),
			},
			{ tailTurns: 1, recallTurns: 2, docConcepts: 0, graphSymbols: 0 },
		);

		const text = textOf(
			pack.parts.find((part) => part.source === "recalled")?.messages
				.map((message) => message.content)
				.join("\n"),
		);
		expect(text).toContain("best match");
		expect(text).toContain("second match");
		expect(text).not.toContain("third match");
	});

	test("recall cannot crowd out the tail or the current prompt", () => {
		const pack = assemble(
			{
				turns: CONVERSATION,
				recalled: recalled("a", "b", "c", "d", "e", "f"),
			},
			{ tailTurns: 2, recallTurns: 6, docConcepts: 0, graphSymbols: 0 },
		);

		const text = pack.messages.map((message) => textOf(message.content)).join("\n");
		expect(text).toContain("recent one");
		expect(text).toContain("recent two");
		expect(text).toContain("current");
	});

	test("a recall budget of zero leaves the pack otherwise unchanged", () => {
		const withRecall = assemble(
			{ turns: CONVERSATION, recalled: recalled("something older") },
			{ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 },
		);
		const without = assemble(
			{ turns: CONVERSATION },
			{ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 },
		);

		expect(withRecall).toEqual(without);
	});

	test("a turn the tail already carries is not recalled as well", () => {
		const pack = assemble(
			{
				turns: CONVERSATION,
				recalled: [{ turnIndex: 10, turn: turn("recent one", undefined, 10) }],
			},
			{ tailTurns: 2, recallTurns: 2, docConcepts: 0, graphSymbols: 0 },
		);

		expect(pack.parts.map((part) => part.source)).not.toContain("recalled");
	});

	test("a different turn that happens to share a prompt is still recalled", () => {
		// "continue" twice is two Turns, not one. De-duplicating on wording
		// would silently drop the older one and under-fill the budget.
		const pack = assemble(
			{
				turns: [turn("continue", "did the first thing", 10), turn("current")],
				recalled: [{ turnIndex: 3, turn: turn("continue", "did the older thing", 3) }],
			},
			{ tailTurns: 2, recallTurns: 2, docConcepts: 0, graphSymbols: 0 },
		);

		const recollection = pack.parts.find((part) => part.source === "recalled");
		expect(recollection).toBeTruthy();
		expect(JSON.stringify(recollection?.messages)).toContain("older thing");
	});

	test("assembling twice with recall produces an identical pack", () => {
		const input = {
			turns: CONVERSATION,
			recalled: recalled("first older", "second older"),
		};

		expect(assemble(input, { tailTurns: 2, recallTurns: 2, docConcepts: 0, graphSymbols: 0 })).toEqual(
			assemble(input, { tailTurns: 2, recallTurns: 2, docConcepts: 0, graphSymbols: 0 }),
		);
	});
});
