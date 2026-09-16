import { describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import type { Turn } from "../src/messages.ts";
import type { RecalledTurn } from "../src/thread-store.ts";

function turn(prompt: string, answer = `answer to ${prompt}`): Turn {
	return {
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

const CONVERSATION = [turn("recent one"), turn("recent two"), turn("current")];

function textOf(content: unknown): string {
	return typeof content === "string" ? content : JSON.stringify(content);
}

describe("recall in a pack", () => {
	test("a turn outside the tail reaches the model", () => {
		const pack = assemble(
			{ turns: CONVERSATION, recalled: recalled("the caching decision") },
			{ tailTurns: 1, recallTurns: 2 },
		);

		expect(pack.messages.map((message) => textOf(message.content)).join("\n")).toContain(
			"the caching decision",
		);
	});

	test("recalled content is attributed with its position", () => {
		const pack = assemble(
			{ turns: CONVERSATION, recalled: [{ turnIndex: 7, turn: turn("old decision") }] },
			{ tailTurns: 1, recallTurns: 2 },
		);

		const recollection = pack.parts.find((part) => part.source === "recalled");
		expect(textOf(recollection?.messages[0]?.content)).toContain("turn 7");
	});

	test("recall is its own part, accounted separately from the tail", () => {
		const pack = assemble(
			{ turns: CONVERSATION, recalled: recalled("something older") },
			{ tailTurns: 2, recallTurns: 2 },
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
			{ tailTurns: 1, recallTurns: 2 },
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
			{ tailTurns: 2, recallTurns: 6 },
		);

		const text = pack.messages.map((message) => textOf(message.content)).join("\n");
		expect(text).toContain("recent one");
		expect(text).toContain("recent two");
		expect(text).toContain("current");
	});

	test("a recall budget of zero leaves the pack otherwise unchanged", () => {
		const withRecall = assemble(
			{ turns: CONVERSATION, recalled: recalled("something older") },
			{ tailTurns: 2, recallTurns: 0 },
		);
		const without = assemble(
			{ turns: CONVERSATION },
			{ tailTurns: 2, recallTurns: 0 },
		);

		expect(withRecall).toEqual(without);
	});

	test("a turn the tail already carries is not recalled as well", () => {
		const pack = assemble(
			{
				turns: CONVERSATION,
				recalled: [{ turnIndex: 0, turn: turn("recent one") }],
			},
			{ tailTurns: 2, recallTurns: 2 },
		);

		expect(pack.parts.map((part) => part.source)).not.toContain("recalled");
	});

	test("assembling twice with recall produces an identical pack", () => {
		const input = {
			turns: CONVERSATION,
			recalled: recalled("first older", "second older"),
		};

		expect(assemble(input, { tailTurns: 2, recallTurns: 2 })).toEqual(
			assemble(input, { tailTurns: 2, recallTurns: 2 }),
		);
	});
});
