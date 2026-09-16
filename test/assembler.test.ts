import { describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import type { HarnessMessage, Turn } from "../src/messages.ts";
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

		const pack = assemble({ turns: turns }, { tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 });
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

		const pack = assemble({ turns: turns }, { tailTurns: 10, recallTurns: 0, docConcepts: 0, graphSymbols: 0 });

		expect(pack.messages).toHaveLength(3);
	});

	test("keeps tool calls and their results intact in the tail", async () => {
		const turns = reconstructTurns(await fixture("tool-turn"));

		const pack = assemble({ turns: turns }, { tailTurns: 5, recallTurns: 0, docConcepts: 0, graphSymbols: 0 });

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
				assemble({ turns }, { tailTurns, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }).messages
					.length,
		);

		expect(counts).toEqual([1, 3, 7]);
	});

	test("the pack does not grow as the conversation does", () => {
		const sizes = [20, 200, 2000].map(
			(turnCount) =>
				assemble({ turns: reconstructTurns(conversation(turnCount)) }, { tailTurns: 3, recallTurns: 0, docConcepts: 0, graphSymbols: 0 })
					.messages.length,
		);

		expect(sizes).toEqual([7, 7, 7]);
	});

	test("assembling the same conversation twice produces an identical pack", async () => {
		// Two independent parses, so nothing is shared by reference.
		const first = assemble({ turns: reconstructTurns(await fixture("multi-turn")) }, { tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 });
		const second = assemble({ turns: reconstructTurns(await fixture("multi-turn")) }, { tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 });

		expect(first).toEqual(second);
	});

	test("a different budget is the only thing that changes the pack", async () => {
		const turns = reconstructTurns(await fixture("multi-turn"));

		const narrow = assemble({ turns: turns }, { tailTurns: 1, recallTurns: 0, docConcepts: 0, graphSymbols: 0 });
		const wide = assemble({ turns: turns }, { tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 });

		expect(narrow).not.toEqual(wide);
		expect(wide.messages.length).toBeGreaterThan(narrow.messages.length);
	});

	test("parts account for every message in the pack, in order", () => {
		const turns = reconstructTurns(conversation(3));

		const pack = assemble({ turns: turns }, { tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 });
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
			{ tailTurns: 2, recallTurns: 0, docConcepts: 2, graphSymbols: 0 },
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
			{ tailTurns: 2, recallTurns: 2, docConcepts: 2, graphSymbols: 0 },
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
			{ tailTurns: 2, recallTurns: 0, docConcepts: 2, graphSymbols: 0 },
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
			{ tailTurns: 2, recallTurns: 0, docConcepts: 2, graphSymbols: 0 },
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

		const generous = assemble(input, { tailTurns: 2, recallTurns: 1, docConcepts: 2, graphSymbols: 0 });
		const exhausted = assemble(input, { tailTurns: 2, recallTurns: 1, docConcepts: 1, graphSymbols: 0 });

		const others = (pack: ReturnType<typeof assemble>) =>
			pack.parts.filter((part) => part.source !== "curated");
		expect(others(exhausted)).toEqual(others(generous));
	});

	test("a doc budget of zero carries no concepts and changes nothing else", () => {
		const input = {
			turns: turns(1),
			concepts: [concept("decisions/caching", "We cache.")],
		};

		const off = assemble(input, { tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 });
		const without = assemble({ turns: input.turns }, {
			tailTurns: 2,
			recallTurns: 0,
			docConcepts: 2,
			graphSymbols: 0,
		});

		expect(off.parts.some((part) => part.source === "curated")).toBe(false);
		expect(off.messages).toEqual(without.messages);
	});
});

describe("codebase structure in a pack", () => {
	const around = (label: string, calls: string) => ({
		symbol: { id: label, label, file: "src/a.ts", position: "L10" },
		edges: [
			{
				from: { id: label, label, file: "src/a.ts", position: "L10" },
				to: { id: calls, label: calls, file: "src/b.ts", position: "L20" },
				relation: "calls",
			},
		],
		dropped: 0,
	});

	test("structure reaches the model as its own part", () => {
		const pack = assemble(
			{ turns: reconstructTurns(conversation(1)), structure: [around("assemble()", "tokens()")] },
			{ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 },
		);

		const part = pack.parts.find((each) => each.source === "structure");
		expect(part?.carried).toBe(1);
		expect(part?.symbols).toEqual(["assemble() (src/a.ts:L10)"]);
	});

	test("a connection says where both ends are", () => {
		const pack = assemble(
			{ turns: reconstructTurns(conversation(1)), structure: [around("assemble()", "tokens()")] },
			{ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 },
		);

		const text = JSON.stringify(pack.parts);
		expect(text).toContain("src/a.ts:L10");
		expect(text).toContain("src/b.ts:L20");
	});

	test("a truncated neighbourhood says how many connections it left out", () => {
		const pack = assemble(
			{
				turns: reconstructTurns(conversation(1)),
				structure: [{ ...around("hub()", "other()"), dropped: 18 }],
			},
			{ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 },
		);

		// Silence would read as "this symbol connects to one thing".
		expect(JSON.stringify(pack.parts)).toContain("18 more connections");
	});

	test("two symbols of the same name are named apart", () => {
		const pack = assemble(
			{
				turns: reconstructTurns(conversation(1)),
				structure: [
					{
						symbol: {
							id: "a",
							label: ".recordPack()",
							file: "src/accounting.ts",
							position: "L160",
						},
						edges: [],
						dropped: 0,
					},
					{
						symbol: {
							id: "b",
							label: ".recordPack()",
							file: "src/postgres-store.ts",
							position: "L440",
						},
						edges: [],
						dropped: 0,
					},
				],
			},
			{ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 },
		);

		const part = pack.parts.find((each) => each.source === "structure");
		expect(part?.symbols).toEqual([
			".recordPack() (src/accounting.ts:L160)",
			".recordPack() (src/postgres-store.ts:L440)",
		]);
	});

	test("the structure budget bounds what is carried, and records what was offered", () => {
		const pack = assemble(
			{
				turns: reconstructTurns(conversation(1)),
				structure: [
					around("a()", "x()"),
					around("b()", "y()"),
					around("c()", "z()"),
				],
			},
			{ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 },
		);

		const part = pack.parts.find((each) => each.source === "structure");
		expect(part?.carried).toBe(2);
		expect(part?.candidates).toBe(3);
	});

	test("exhausting the structure budget leaves the other parts untouched", () => {
		const input = {
			turns: reconstructTurns(conversation(2)),
			recalled: [{ turnIndex: 9, turn: reconstructTurns(conversation(1))[0] }].filter(
				(each): each is { turnIndex: number; turn: Turn } => each.turn !== undefined,
			),
			concepts: [
				{
					conceptId: "decisions/caching",
					text: "We cache.",
					trust: "unverified" as const,
					stale: false,
				},
			],
			structure: [around("a()", "x()"), around("b()", "y()")],
		};

		const generous = assemble(input, {
			tailTurns: 2,
			recallTurns: 1,
			docConcepts: 1,
			graphSymbols: 2,
		});
		const exhausted = assemble(input, {
			tailTurns: 2,
			recallTurns: 1,
			docConcepts: 1,
			graphSymbols: 1,
		});

		const others = (pack: ReturnType<typeof assemble>) =>
			pack.parts.filter((part) => part.source !== "structure");
		expect(others(exhausted)).toEqual(others(generous));
	});

	test("a structure budget of zero carries nothing and changes nothing else", () => {
		const input = {
			turns: reconstructTurns(conversation(1)),
			structure: [around("assemble()", "tokens()")],
		};

		const off = assemble(input, {
			tailTurns: 2,
			recallTurns: 0,
			docConcepts: 0,
			graphSymbols: 0,
		});
		const without = assemble(
			{ turns: input.turns },
			{ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 },
		);

		expect(off.parts.some((part) => part.source === "structure")).toBe(false);
		expect(off.messages).toEqual(without.messages);
	});

	test("the structure budget is recorded even when nothing was found", () => {
		const pack = assemble(
			{ turns: reconstructTurns(conversation(1)) },
			{ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 4 },
		);

		expect(pack.budgets.graph).toBe(4);
	});
});
