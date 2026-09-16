import { describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { reconstructTurns } from "../src/turns.ts";
import { fixture } from "./fixtures.ts";

function conversation(turnCount: number): HarnessMessage[] {
	const messages: HarnessMessage[] = [];
	for (let index = 1; index <= turnCount; index++) {
		messages.push({ role: "user", content: `prompt ${index}` });
		messages.push({ role: "assistant", content: `answer ${index}` });
	}
	messages.push({ role: "user", content: "current prompt" });
	return messages;
}

describe("assemble", () => {
	test("carries the current prompt and the last N turns, dropping older ones", () => {
		const turns = reconstructTurns(conversation(5));

		const pack = assemble({ turns: turns }, { tailTurns: 2, recallTurns: 0, docConcepts: 0 });
		const texts = pack.messages.map((message) => message.content);

		expect(texts).toEqual([
			"prompt 4",
			"answer 4",
			"prompt 5",
			"answer 5",
			"current prompt",
		]);
	});

	test("a shorter conversation is carried whole", () => {
		const turns = reconstructTurns(conversation(1));

		const pack = assemble({ turns: turns }, { tailTurns: 10, recallTurns: 0, docConcepts: 0 });

		expect(pack.messages).toHaveLength(3);
	});

	test("keeps tool calls and their results intact in the tail", async () => {
		const turns = reconstructTurns(await fixture("tool-turn"));

		const pack = assemble({ turns: turns }, { tailTurns: 5, recallTurns: 0, docConcepts: 0 });

		expect(pack.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
			"toolResult",
		]);
	});

	test("changing N changes how many turns are carried", () => {
		const turns = reconstructTurns(conversation(5));

		const counts = [0, 1, 3].map(
			(tailTurns) =>
				assemble({ turns }, { tailTurns, recallTurns: 0, docConcepts: 0 }).messages
					.length,
		);

		expect(counts).toEqual([1, 3, 7]);
	});

	test("the pack does not grow as the conversation does", () => {
		const sizes = [20, 200, 2000].map(
			(turnCount) =>
				assemble({ turns: reconstructTurns(conversation(turnCount)) }, { tailTurns: 3, recallTurns: 0, docConcepts: 0 })
					.messages.length,
		);

		expect(sizes).toEqual([7, 7, 7]);
	});

	test("assembling the same conversation twice produces an identical pack", async () => {
		// Two independent parses, so nothing is shared by reference.
		const first = assemble({ turns: reconstructTurns(await fixture("multi-turn")) }, { tailTurns: 2, recallTurns: 0, docConcepts: 0 });
		const second = assemble({ turns: reconstructTurns(await fixture("multi-turn")) }, { tailTurns: 2, recallTurns: 0, docConcepts: 0 });

		expect(first).toEqual(second);
	});

	test("a different budget is the only thing that changes the pack", async () => {
		const turns = reconstructTurns(await fixture("multi-turn"));

		const narrow = assemble({ turns: turns }, { tailTurns: 1, recallTurns: 0, docConcepts: 0 });
		const wide = assemble({ turns: turns }, { tailTurns: 2, recallTurns: 0, docConcepts: 0 });

		expect(narrow).not.toEqual(wide);
		expect(wide.messages.length).toBeGreaterThan(narrow.messages.length);
	});

	test("parts account for every message in the pack, in order", () => {
		const turns = reconstructTurns(conversation(3));

		const pack = assemble({ turns: turns }, { tailTurns: 2, recallTurns: 0, docConcepts: 0 });
		const fromParts = pack.parts.flatMap((part) => part.messages);

		expect(fromParts).toEqual(pack.messages);
		expect(pack.parts.map((part) => part.source)).toEqual([
			"verbatim-tail",
			"current-turn",
		]);
	});
});

describe("curated knowledge in a pack", () => {
	const turns = (count: number) => reconstructTurns(conversation(count));
	const earlier = { turnIndex: 9, turn: reconstructTurns(conversation(1))[0] };
	const concept = (conceptId: string, text: string, stale = false) => ({
		conceptId,
		text,
		trust: "unverified" as const,
		stale,
	});

	test("a concept reaches the model as its own part", () => {
		const pack = assemble(
			{ turns: turns(1), concepts: [concept("decisions/caching", "We cache.")] },
			{ tailTurns: 2, recallTurns: 0, docConcepts: 2 },
		);

		const curated = pack.parts.find((part) => part.source === "curated");
		expect(curated?.carried).toBe(1);
		expect(JSON.stringify(curated?.messages)).toContain("We cache.");
	});

	test("curated knowledge is attributed and distinguishable from recall", () => {
		const pack = assemble(
			{
				turns: turns(1),
				recalled: earlier.turn ? [{ turnIndex: 9, turn: earlier.turn }] : [],
				concepts: [concept("decisions/caching", "We cache.")],
			},
			{ tailTurns: 2, recallTurns: 2, docConcepts: 2 },
		);

		const curated = pack.parts.find((part) => part.source === "curated");
		const recalled = pack.parts.find((part) => part.source === "recalled");
		expect(JSON.stringify(curated?.messages)).toContain(
			"[curated knowledge: decisions/caching]",
		);
		expect(JSON.stringify(recalled?.messages)).not.toContain("curated knowledge");
	});

	test("a stale concept says so", () => {
		const pack = assemble(
			{ turns: turns(1), concepts: [concept("decisions/old", "Old news.", true)] },
			{ tailTurns: 2, recallTurns: 0, docConcepts: 2 },
		);

		expect(JSON.stringify(pack.parts)).toContain("(stale)");
	});

	test("the doc budget bounds what is carried, and records what was offered", () => {
		const offered = [
			concept("decisions/a", "First."),
			concept("decisions/b", "Second."),
			concept("decisions/c", "Third."),
		];

		const pack = assemble(
			{ turns: turns(1), concepts: offered },
			{ tailTurns: 2, recallTurns: 0, docConcepts: 2 },
		);

		const curated = pack.parts.find((part) => part.source === "curated");
		expect(curated?.carried).toBe(2);
		expect(curated?.candidates).toBe(3);
	});

	test("exhausting the doc budget leaves the tail and recall untouched", () => {
		const input = {
			turns: turns(2),
			recalled: earlier.turn ? [{ turnIndex: 9, turn: earlier.turn }] : [],
			concepts: [concept("decisions/a", "First."), concept("decisions/b", "Second.")],
		};

		const generous = assemble(input, { tailTurns: 2, recallTurns: 1, docConcepts: 2 });
		const exhausted = assemble(input, { tailTurns: 2, recallTurns: 1, docConcepts: 1 });

		const others = (pack: ReturnType<typeof assemble>) =>
			pack.parts.filter((part) => part.source !== "curated");
		expect(others(exhausted)).toEqual(others(generous));
	});

	test("a doc budget of zero carries no concepts and changes nothing else", () => {
		const input = {
			turns: turns(1),
			concepts: [concept("decisions/caching", "We cache.")],
		};

		const off = assemble(input, { tailTurns: 2, recallTurns: 0, docConcepts: 0 });
		const without = assemble({ turns: input.turns }, {
			tailTurns: 2,
			recallTurns: 0,
			docConcepts: 2,
		});

		expect(off.parts.some((part) => part.source === "curated")).toBe(false);
		expect(off.messages).toEqual(without.messages);
	});
});
