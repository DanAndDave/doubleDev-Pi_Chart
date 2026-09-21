import { describe, expect, test } from "bun:test";

import {
	approximateTokens,
	assemble,
	type Pack,
	type PackSource,
} from "../src/assembler.ts";
import { readJournal } from "../src/journal.ts";
import { messageText, type HarnessMessage, type Turn } from "../src/messages.ts";
import { reconstructTurns } from "../src/turns.ts";
import { fixture, budgets, UNBOUNDED } from "./fixtures.ts";
import { JOURNAL_FIXTURE } from "./turn-source-contract.ts";

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

		const pack = assemble({ turns: turns }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));
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

		const pack = assemble({ turns: turns }, budgets({ tailTurns: 10, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));

		expect(pack.messages).toHaveLength(3);
	});

	test("keeps tool calls and their results intact in the tail", async () => {
		const turns = reconstructTurns(await fixture("tool-turn"));

		const pack = assemble({ turns: turns }, budgets({ tailTurns: 5, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));

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
				assemble({ turns }, budgets({ tailTurns, recallTurns: 0, docConcepts: 0, graphSymbols: 0 })).messages
					.length,
		);

		expect(counts).toEqual([1, 3, 7]);
	});

	test("the pack does not grow as the conversation does", () => {
		const sizes = [20, 200, 2000].map(
			(turnCount) =>
				assemble({ turns: reconstructTurns(conversation(turnCount)) }, budgets({ tailTurns: 3, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }))
					.messages.length,
		);

		expect(sizes).toEqual([7, 7, 7]);
	});

	test("assembling the same conversation twice produces an identical pack", async () => {
		// Two independent parses, so nothing is shared by reference.
		const first = assemble({ turns: reconstructTurns(await fixture("multi-turn")) }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));
		const second = assemble({ turns: reconstructTurns(await fixture("multi-turn")) }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));

		expect(first).toEqual(second);
	});

	test("a different budget is the only thing that changes the pack", async () => {
		const turns = reconstructTurns(await fixture("multi-turn"));

		const narrow = assemble({ turns: turns }, budgets({ tailTurns: 1, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));
		const wide = assemble({ turns: turns }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));

		expect(narrow).not.toEqual(wide);
		expect(wide.messages.length).toBeGreaterThan(narrow.messages.length);
	});

	test("parts account for every message in the pack, in order", () => {
		const turns = reconstructTurns(conversation(3));

		const pack = assemble({ turns: turns }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));
		const fromParts = pack.parts.flatMap((part) => part.messages);

		expect(fromParts).toEqual(pack.messages);
		expect(
			pack.parts.filter((part) => part.messages.length > 0).map((part) => part.source),
		).toEqual(["verbatim-tail", "current-turn"]);
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
		distance: 0.2,
	});

	test("a concept reaches the model as its own part", () => {
		const pack = assemble({ turns: turns(1), concepts: [concept("decisions/caching", "We cache.")] }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 2, graphSymbols: 0 }));

		const curated = pack.parts.find((part) => part.source === "curated");
		expect(curated?.carried).toBe(1);
		expect(JSON.stringify(curated?.messages)).toContain("We cache.");
	});

	test("curated knowledge is attributed and distinguishable from recall", () => {
		const pack = assemble({
				turns: turns(1),
				recalled: earlier.turn ? [{ turnIndex: 9, turn: earlier.turn }] : [],
				concepts: [concept("decisions/caching", "We cache.")],
			}, budgets({ tailTurns: 2, recallTurns: 2, docConcepts: 2, graphSymbols: 0 }));

		const curated = pack.parts.find((part) => part.source === "curated");
		const recalled = pack.parts.find((part) => part.source === "recalled");
		expect(JSON.stringify(curated?.messages)).toContain(
			"[curated knowledge: decisions/caching]",
		);
		expect(JSON.stringify(recalled?.messages)).not.toContain("curated knowledge");
	});

	test("a stale concept says so", () => {
		const pack = assemble({ turns: turns(1), concepts: [concept("decisions/old", "Old news.", true)] }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 2, graphSymbols: 0 }));

		expect(JSON.stringify(pack.parts)).toContain("(stale)");
	});

	test("the doc budget bounds what is carried, and records what was offered", () => {
		const offered = [
			concept("decisions/a", "First."),
			concept("decisions/b", "Second."),
			concept("decisions/c", "Third."),
		];

		const pack = assemble({ turns: turns(1), concepts: offered }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 2, graphSymbols: 0 }));

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

		const generous = assemble(input, budgets({ tailTurns: 2, recallTurns: 1, docConcepts: 2, graphSymbols: 0 }));
		const exhausted = assemble(input, budgets({ tailTurns: 2, recallTurns: 1, docConcepts: 1, graphSymbols: 0 }));

		const others = (pack: Pack) =>
			pack.parts.filter((part) => part.source !== "curated");
		expect(others(exhausted)).toEqual(others(generous));
	});

	test("a doc budget of zero carries no concepts and changes nothing else", () => {
		const input = {
			turns: turns(1),
			concepts: [concept("decisions/caching", "We cache.")],
		};

		const off = assemble(input, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));
		const without = assemble({ turns: input.turns }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 2, graphSymbols: 0 }));

		const curated = off.parts.find((part) => part.source === "curated");
		expect(curated?.carried).toBe(0);
		// Recorded as a decision rather than as an absence of supply: the
		// Concept was there and the Budget refused it.
		expect(curated?.absent).toBe("disabled");
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
		const pack = assemble({ turns: reconstructTurns(conversation(1)), structure: [around("assemble()", "tokens()")] }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 }));

		const part = pack.parts.find((each) => each.source === "structure");
		expect(part?.carried).toBe(1);
		expect(part?.symbols).toEqual(["assemble() (src/a.ts:L10)"]);
	});

	test("a connection says where both ends are", () => {
		const pack = assemble({ turns: reconstructTurns(conversation(1)), structure: [around("assemble()", "tokens()")] }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 }));

		const text = JSON.stringify(pack.parts);
		expect(text).toContain("src/a.ts:L10");
		expect(text).toContain("src/b.ts:L20");
	});

	test("a truncated neighbourhood says how many connections it left out", () => {
		const pack = assemble({
				turns: reconstructTurns(conversation(1)),
				structure: [{ ...around("hub()", "other()"), dropped: 18 }],
			}, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 }));

		// Silence would read as "this symbol connects to one thing".
		expect(JSON.stringify(pack.parts)).toContain("18 more connections");
	});

	test("two symbols of the same name are named apart", () => {
		const pack = assemble({
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
			}, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 }));

		const part = pack.parts.find((each) => each.source === "structure");
		expect(part?.symbols).toEqual([
			".recordPack() (src/accounting.ts:L160)",
			".recordPack() (src/postgres-store.ts:L440)",
		]);
	});

	test("the structure budget bounds what is carried, and records what was offered", () => {
		const pack = assemble({
				turns: reconstructTurns(conversation(1)),
				structure: [
					around("a()", "x()"),
					around("b()", "y()"),
					around("c()", "z()"),
				],
			}, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 }));

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
					distance: 0.2,
				},
			],
			structure: [around("a()", "x()"), around("b()", "y()")],
		};

		const generous = assemble(input, budgets({ tailTurns: 2, recallTurns: 1, docConcepts: 1, graphSymbols: 2 }));
		const exhausted = assemble(input, budgets({ tailTurns: 2, recallTurns: 1, docConcepts: 1, graphSymbols: 1 }));

		const others = (pack: Pack) =>
			pack.parts.filter((part) => part.source !== "structure");
		expect(others(exhausted)).toEqual(others(generous));
	});

	test("a structure budget of zero carries nothing and changes nothing else", () => {
		const input = {
			turns: reconstructTurns(conversation(1)),
			structure: [around("assemble()", "tokens()")],
		};

		const off = assemble(input, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));
		const without = assemble({ turns: input.turns }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 2 }));

		const structure = off.parts.find((part) => part.source === "structure");
		expect(structure?.carried).toBe(0);
		expect(structure?.absent).toBe("disabled");
		expect(off.messages).toEqual(without.messages);
	});

	test("the structure budget is recorded even when nothing was found", () => {
		const pack = assemble({ turns: reconstructTurns(conversation(1)) }, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 0, graphSymbols: 4 }));

		expect(pack.budgets.graph).toBe(4);
	});
});

/** A tool result of roughly `tokens` estimated tokens. */
function bulky(tokens: number, marker = "x"): HarnessMessage {
	return {
		role: "toolResult",
		toolCallId: `call-${marker}`,
		toolName: "read",
		content: [{ type: "text", text: marker.repeat(tokens * 4) }],
	};
}

function turnOf(index: number, ...messages: HarnessMessage[]): Turn {
	return {
		index,
		prompt: `prompt ${index}`,
		messages: [{ role: "user", content: `prompt ${index}` }, ...messages],
	};
}

describe("the token estimate", () => {
	test("counts what is sent with a message, not its content alone", () => {
		const bare: HarnessMessage = { role: "toolResult", content: "maple" };
		const withDetails: HarnessMessage = {
			...bare,
			toolName: "read",
			toolCallId: "call-1",
			details: { totalLines: 1, meta: { source: { value: "/work/leaf.txt" } } },
		};

		expect(approximateTokens([withDetails])).toBeGreaterThan(
			approximateTokens([bare]),
		);
	});

	test("ignores what the harness records but never sends", () => {
		const sent: HarnessMessage = { role: "assistant", content: "done" };
		const recorded: HarnessMessage = {
			...sent,
			usage: { totalTokens: 29_331 },
			contextSnapshot: { promptTokens: 45_362, nonMessageTokens: 27_457 },
			timestamp: 1_789_577_144_075,
			model: "claude-opus-5",
		};

		expect(approximateTokens([recorded])).toBe(approximateTokens([sent]));
	});

	test("is the same on repeated calls and independent of message order", () => {
		const messages = [bulky(20, "a"), bulky(30, "b")];

		expect(approximateTokens(messages)).toBe(approximateTokens(messages));
		expect(approximateTokens([...messages].reverse())).toBe(
			approximateTokens(messages),
		);
	});
});

describe("token budgets", () => {
	test("a size budget binds before a count budget", () => {
		const recalled = [1, 2, 3].map((index) => ({
			turnIndex: index,
			turn: turnOf(index, bulky(400, String(index))),
		}));

		const pack = assemble(
			{ turns: [turnOf(9)], recalled },
			budgets({ recallTurns: 3, recallTokens: 900 }),
		);
		const part = pack.parts.find((each) => each.source === "recalled");

		expect(part?.carried).toBe(2);
		expect(part?.turnIndices).toEqual([1, 2]);
		expect(part?.excluded?.size).toBe(1);
		expect(part?.excluded?.count).toBeUndefined();
	});

	test("a count budget binds before a size budget", () => {
		const recalled = [1, 2, 3].map((index) => ({
			turnIndex: index,
			turn: turnOf(index),
		}));

		const pack = assemble(
			{ turns: [turnOf(9)], recalled },
			budgets({ recallTurns: 1, recallTokens: UNBOUNDED }),
		);
		const part = pack.parts.find((each) => each.source === "recalled");

		expect(part?.carried).toBe(1);
		expect(part?.excluded?.count).toBe(2);
		expect(part?.excluded?.size).toBeUndefined();
	});

	test("one part's exhausted size budget leaves the others whole", () => {
		const input = {
			turns: [turnOf(1, bulky(50)), turnOf(2)],
			recalled: [{ turnIndex: 8, turn: turnOf(8, bulky(400)) }],
		};

		const starved = assemble(
			input,
			budgets({ tailTurns: 1, recallTurns: 1, recallTokens: 10 }),
		);
		const generous = assemble(
			input,
			budgets({ tailTurns: 1, recallTurns: 1, recallTokens: UNBOUNDED }),
		);

		const recalled = starved.parts.find((part) => part.source === "recalled");
		expect(recalled?.carried).toBe(0);
		// Nothing fitted, which is not the same as nothing being relevant.
		expect(recalled?.absent).toBe("size");
		expect(starved.parts.find((part) => part.source === "verbatim-tail")).toEqual(
			generous.parts.find((part) => part.source === "verbatim-tail"),
		);
	});

	test("the tail keeps its most recent turn even when that turn alone exceeds the budget", () => {
		const pack = assemble(
			{ turns: [turnOf(1, bulky(50)), turnOf(2, bulky(900, "b")), turnOf(3)] },
			budgets({ tailTurns: 8, tailTokens: 400 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");

		expect(tail?.turnIndices).toEqual([2]);
		expect(tail?.shortened).toBe(true);
		expect(tail?.approximateTokens).toBeLessThanOrEqual(400);
		expect(tail?.excluded?.size).toBe(1);
	});
});

describe("shortening", () => {
	test("a shortened tool result keeps its head and tail and says what went", () => {
		const pack = assemble(
			{ turns: [turnOf(1, bulky(2000, "m")), turnOf(2)] },
			budgets({ tailTurns: 1, tailTokens: 500 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");
		const shortened = tail?.messages.find(
			(message) => message.role === "toolResult",
		);
		const text = messageText(shortened ?? { role: "toolResult" });

		expect(text).toContain("elided");
		expect(text.startsWith("mmm")).toBe(true);
		expect(text.endsWith("mmm")).toBe(true);
		expect(shortened?.cmShortened).toBe(true);
	});

	test("dropped tool metadata is counted and named, not silently removed", () => {
		// `details` rivals the content it summarises: counting it as overhead
		// starved the text of an allowance already spent on something being
		// deleted, and the marker never mentioned it.
		const heavy: HarnessMessage = {
			role: "toolResult",
			toolCallId: "call-d",
			toolName: "read",
			content: "c".repeat(40_000),
			details: { lines: "d".repeat(30_000) },
		};
		const pack = assemble(
			{
				turns: [
					{ index: 1, prompt: "read it", messages: [{ role: "user", content: "read it" }, heavy] },
					turnOf(2),
				],
			},
			budgets({ tailTurns: 1, tailTokens: 2000 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");
		const shortened = tail?.messages.find(
			(message) => message.role === "toolResult",
		);
		const text = messageText(shortened ?? { role: "toolResult" });
		const elided = Number(/~(\d+) tokens/.exec(text)?.[1] ?? "0");

		expect(shortened?.details).toBeUndefined();
		// Named, so the agent knows the metadata went too.
		expect(text).toContain("tool metadata");
		// Counted: the marker covers the dropped metadata as well as the text.
		expect(elided).toBeGreaterThan(30_000 / 4);
		// And the Budget is spent on content rather than on the overhead of
		// something being deleted.
		expect(tail?.approximateTokens).toBeGreaterThan(1000);
		expect(tail?.approximateTokens).toBeLessThanOrEqual(2000);
	});

	test("a recollection too large for the room left is shortened, not dropped", () => {
		const pack = assemble(
			{
				turns: [turnOf(9)],
				recalled: [
					{ turnIndex: 2, turn: turnOf(2, bulky(100, "a")) },
					{ turnIndex: 5, turn: turnOf(5, bulky(4000, "b")) },
				],
			},
			budgets({ recallTurns: 2, recallTokens: 3000 }),
		);
		const part = pack.parts.find((each) => each.source === "recalled");

		// The second recollection does not fit the room the first left, and is
		// carried shortened rather than lost: the Conversation has one Turn
		// that said the thing.
		expect(part?.turnIndices).toEqual([2, 5]);
		expect(part?.shortened).toBe(true);
		expect(part?.approximateTokens).toBeLessThanOrEqual(3000);
	});

	test("a prompt and assistant reasoning are never shortened", () => {
		const reasoning = "why ".repeat(4000);
		const pack = assemble(
			{
				turns: [
					{
						index: 1,
						prompt: "long prompt",
						messages: [
							{ role: "user", content: reasoning },
							{ role: "assistant", content: reasoning },
						],
					},
					turnOf(2),
				],
			},
			budgets({ tailTurns: 1, tailTokens: 100 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");

		expect(tail?.messages.map((message) => message.content)).toEqual([
			reasoning,
			reasoning,
		]);
		expect(tail?.shortened).toBeUndefined();
	});

	test("content within its budget is carried unaltered and unmarked", () => {
		const turn = turnOf(1, bulky(10));
		const pack = assemble(
			{ turns: [turn, turnOf(2)] },
			budgets({ tailTurns: 1, tailTokens: 5000 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");

		expect(tail?.messages).toEqual(turn.messages);
		expect(tail?.shortened).toBeUndefined();
	});

	test("an oversized recollection is shortened rather than dropped", () => {
		const pack = assemble(
			{
				turns: [turnOf(9)],
				recalled: [{ turnIndex: 2, turn: turnOf(2, bulky(3000, "r")) }],
			},
			budgets({ recallTurns: 1, recallTokens: UNBOUNDED, packTokens: 600 }),
		);
		const part = pack.parts.find((each) => each.source === "recalled");
		const text = messageText(part?.messages[0] ?? { role: "user" });

		expect(part?.carried).toBe(1);
		expect(part?.shortened).toBe(true);
		expect(text).toContain("[recalled from turn 2 of this conversation]");
		expect(text).toContain("elided");
		expect(pack.approximateTokens).toBeLessThanOrEqual(600);
	});

	test("a recollection whose bulk is prose is shortened rather than dropped", () => {
		// The fixture above is tool-result heavy, so it passes even when only
		// outputs may give way. This Turn's bulk is the agent's own prose: if
		// prose cannot give way the recollection never fits and `fit` drops
		// it, which `context-assembly` forbids.
		const reasoning = "because ".repeat(3000);
		const pack = assemble(
			{
				turns: [turnOf(9)],
				recalled: [
					{
						turnIndex: 4,
						turn: {
							index: 4,
							prompt: "why did that work",
							messages: [
								{ role: "user", content: "why did that work" },
								{ role: "assistant", content: reasoning },
							],
						},
					},
				],
			},
			budgets({ recallTurns: 1, recallTokens: 400 }),
		);
		const part = pack.parts.find((each) => each.source === "recalled");
		const text = messageText(part?.messages[0] ?? { role: "user" });

		expect(part?.carried).toBe(1);
		expect(part?.turnIndices).toEqual([4]);
		expect(part?.shortened).toBe(true);
		expect(text).toContain("[recalled from turn 4 of this conversation]");
		expect(text).toContain("elided");
		expect(part?.approximateTokens).toBeLessThanOrEqual(400);
	});
});

describe("a budget below what must be carried", () => {
	test("an irreducible tail turn is carried and its budget reported as exceeded", () => {
		// Many tool results, each already at the shortest length worth
		// carrying, so no amount of eliding gets the Turn under the Budget —
		// and the tail's newest Turn may not be dropped.
		const many = Array.from({ length: 40 }, (_, index) =>
			bulky(300, String.fromCharCode(97 + (index % 26))),
		);
		const pack = assemble(
			{
				turns: [
					{
						index: 1,
						prompt: "big",
						messages: [{ role: "user", content: "big" }, ...many],
					},
					turnOf(2),
				],
			},
			budgets({ tailTurns: 1, tailTokens: 500, packTokens: UNBOUNDED }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");

		expect(tail?.carried).toBe(1);
		expect(tail?.shortened).toBe(true);
		expect(tail?.tokenBudget).toBe(500);
		// Carried, and honest about it: the Budget is reported beside a spend
		// that exceeds it rather than the part reading as though it fitted.
		expect(tail?.approximateTokens).toBeGreaterThan(500);
	});
});

describe("the pack ceiling", () => {
	const oversized = () => ({
		turns: [turnOf(1, bulky(300, "t")), turnOf(2, bulky(40, "c"))],
		recalled: [{ turnIndex: 8, turn: turnOf(8, bulky(300, "r")) }],
		concepts: [
			{
				conceptId: "decisions/caching",
				text: "k".repeat(1200),
				trust: "unverified" as const,
				stale: false,
				distance: 0.2,
			},
		],
		structure: [
			{
				symbol: {
					id: "assemble()",
					label: "assemble()",
					file: "src/assembler.ts",
					position: "L154",
				},
				edges: [
					{
						from: {
							id: "assemble()",
							label: "assemble()",
							file: "src/assembler.ts",
							position: "L154",
						},
						to: {
							id: "approximateTokens()",
							label: "approximateTokens()",
							file: "src/assembler.ts",
							position: "L497",
						},
						relation: "calls",
					},
				],
				dropped: 0,
			},
		],
	});

	test("an oversized pack is reduced to fit before it is returned", () => {
		const pack = assemble(oversized(), budgets({
			tailTurns: 2,
			recallTurns: 1,
			docConcepts: 1,
			graphSymbols: 1,
			packTokens: 400,
		}));

		expect(pack.approximateTokens).toBeLessThanOrEqual(400);
		expect(pack.beforeCeiling).toBeGreaterThan(400);
	});

	test("reduction gives up structure, then curated, then recall, then the tail", () => {
		const surviving = (packTokens: number) =>
			assemble(
				oversized(),
				budgets({
					tailTurns: 2,
					recallTurns: 1,
					docConcepts: 1,
					graphSymbols: 1,
					packTokens,
				}),
			)
				.parts.filter((part) => (part.carried ?? 0) > 0)
				.map((part) => part.source);

		// Swept rather than sampled at chosen numbers: the claim is the order
		// parts are given up in, and a threshold in the test would be a
		// second, unchecked claim about their sizes.
		const whole = surviving(UNBOUNDED);
		const total = assemble(
			oversized(),
			budgets({
				tailTurns: 2,
				recallTurns: 1,
				docConcepts: 1,
				graphSymbols: 1,
				packTokens: UNBOUNDED,
			}),
		).approximateTokens;

		// Ordered by the widest ceiling at which a part is already absent: the
		// part given up first is the one that disappears while there is still
		// the most room. Stated this way the test asserts the order and
		// nothing about the parts' sizes.
		const step = Math.ceil(total / 100);
		const firstAbsent = new Map<PackSource, number>();
		for (let ceiling = total; ceiling >= 0; ceiling -= step) {
			const now = surviving(ceiling);
			for (const source of whole) {
				if (now.includes(source) || firstAbsent.has(source)) continue;
				firstAbsent.set(source, ceiling);
			}
		}

		expect(whole).toEqual([
			"recalled",
			"curated",
			"structure",
			"verbatim-tail",
			"current-turn",
		]);
		expect(
			[...firstAbsent.entries()]
				.sort(([, a], [, b]) => b - a)
				.map(([source]) => source),
		).toEqual(["structure", "curated", "recalled", "verbatim-tail"]);
		// The current Turn is never given up, because it is the prompt.
		expect(firstAbsent.has("current-turn")).toBe(false);
		expect(surviving(0)).toEqual(["current-turn"]);
	});

	test("the tail gives up its oldest turn first", () => {
		const pack = assemble(
			{
				turns: [
					turnOf(1, bulky(200, "a")),
					turnOf(2, bulky(200, "b")),
					turnOf(3),
				],
			},
			budgets({ tailTurns: 2, tailTokens: UNBOUNDED, packTokens: 260 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");

		expect(tail?.turnIndices).toEqual([2]);
	});

	test("a real journal's largest turn survives a ceiling far below it", async () => {
		const recorded = await readJournal(JOURNAL_FIXTURE);
		const largest = recorded.reduce((widest, turn) =>
			approximateTokens(turn.messages) > approximateTokens(widest.messages)
				? turn
				: widest,
		);
		const whole = approximateTokens(largest.messages);
		const ceiling = Math.floor(whole / 2);

		const pack = assemble(
			{
				turns: [
					{
						index: largest.turnIndex,
						prompt: largest.prompt,
						messages: largest.messages,
					},
				],
			},
			budgets({ tailTurns: 0, packTokens: ceiling }),
		);
		const current = pack.parts.find((part) => part.source === "current-turn");

		// The Turn is the prompt being answered: it is never dropped, whatever
		// the ceiling says. This fixture's Turn is many small messages with
		// nothing large enough to elide, so the pack goes out over budget
		// rather than losing the prompt — the case the extension reports.
		expect(current?.carried).toBe(1);
		expect(current?.messages).toEqual(largest.messages);
		expect(pack.approximateTokens).toBeGreaterThan(ceiling);
		expect(pack.beforeCeiling).toBe(whole);
	});

	test("reducing the same selection twice produces identical packs", () => {
		const config = budgets({
			tailTurns: 2,
			recallTurns: 1,
			docConcepts: 1,
			graphSymbols: 1,
			packTokens: 420,
		});

		expect(assemble(oversized(), config)).toEqual(
			assemble(oversized(), config),
		);
	});

	test("the current turn survives a ceiling it cannot fit, shortened", () => {
		const pack = assemble(
			{ turns: [turnOf(1), turnOf(2, bulky(5000, "z"))] },
			budgets({ tailTurns: 1, packTokens: 300 }),
		);
		const current = pack.parts.find((part) => part.source === "current-turn");

		expect(current?.carried).toBe(1);
		expect(current?.messages).toHaveLength(2);
		expect(pack.approximateTokens).toBeLessThanOrEqual(300);
		expect(current?.shortened).toBe(true);
		expect(current?.withoutCeiling).toBeGreaterThan(300);
	});

	test("a pack already within the ceiling is the pack assembled without one", () => {
		const input = {
			turns: [turnOf(1, bulky(10)), turnOf(2)],
			concepts: [
				{
					conceptId: "decisions/x",
					text: "small",
					trust: "unverified" as const,
					stale: false,
					distance: 0.2,
				},
			],
		};
		const counts = { tailTurns: 2, recallTurns: 0, docConcepts: 1, graphSymbols: 0 };

		const bounded = assemble(input, budgets({ ...counts, packTokens: 100_000 }));
		const unbounded = assemble(input, budgets({ ...counts, packTokens: UNBOUNDED }));

		expect(bounded.messages).toEqual(unbounded.messages);
		expect(bounded.parts.map((part) => part.withoutCeiling)).toEqual(
			unbounded.parts.map(() => undefined),
		);
	});
});
