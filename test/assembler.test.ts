import { describe, expect, test } from "bun:test";

import { approximateTokens } from "../src/tokens.ts";
import { assemblerConfig, loadConfig } from "../src/config.ts";
import {
	asCuratedKnowledge,
	assemble,
	OPENING_FRAMING,
	systemAdditions,
	tailTokens,
	type Pack,
	type PackSource,
} from "../src/assembler.ts";
import { PINS_FRAMING } from "../src/pins.ts";
import type { Exclusion } from "../src/concept.ts";
import { readJournal } from "../src/journal.ts";
import { messageText, type HarnessMessage, type Turn } from "../src/messages.ts";
import { reconstructTurns } from "../src/turns.ts";
import { fixture, budgets, toolCall, toolResult, UNBOUNDED } from "./fixtures.ts";
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

		const pack = assemble({ turns: turns }, budgets({ tailTurns: 2, tailLowWater: 1 }));
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

		const pack = assemble({ turns: turns }, budgets({ tailTurns: 10 }));

		expect(pack.messages).toHaveLength(3);
	});

	test("keeps tool calls and their results intact in the tail", async () => {
		const turns = reconstructTurns(await fixture("tool-turn"));

		const pack = assemble({ turns: turns }, budgets({ tailTurns: 5 }));

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
				assemble({ turns }, budgets({ tailTurns, tailLowWater: 1 })).messages
					.length,
		);

		expect(counts).toEqual([1, 3, 7]);
	});

	test("the pack does not grow as the conversation does", () => {
		const sizes = [20, 200, 2000].map(
			(turnCount) =>
				assemble({ turns: reconstructTurns(conversation(turnCount)) }, budgets({ tailTurns: 3, tailLowWater: 1 }))
					.messages.length,
		);

		expect(sizes).toEqual([7, 7, 7]);
	});

	test("assembling the same conversation twice produces an identical pack", async () => {
		// Two independent parses, so nothing is shared by reference.
		const first = assemble({ turns: reconstructTurns(await fixture("multi-turn")) }, budgets({ tailTurns: 2 }));
		const second = assemble({ turns: reconstructTurns(await fixture("multi-turn")) }, budgets({ tailTurns: 2 }));

		expect(first).toEqual(second);
	});

	test("a different budget is the only thing that changes the pack", async () => {
		const turns = reconstructTurns(await fixture("multi-turn"));

		const narrow = assemble({ turns: turns }, budgets({ tailTurns: 1 }));
		const wide = assemble({ turns: turns }, budgets({ tailTurns: 2 }));

		expect(narrow).not.toEqual(wide);
		expect(wide.messages.length).toBeGreaterThan(narrow.messages.length);
	});
});

describe("curated knowledge as the model reads it", () => {
	const concept = (
		conceptId: string,
		text: string,
		stale = false,
		parts: { index?: number; count?: number; exclusions?: Exclusion[] } = {},
	) =>
		messageText(
			asCuratedKnowledge({
				conceptId,
				text,
				trust: "unverified" as const,
				stale,
				distance: 0.2,
				sectionIndex: parts.index ?? 0,
				sectionCount: parts.count ?? 1,
				exclusions: parts.exclusions,
			}),
		);

	test("a concept is attributed as curated knowledge, by its id", () => {
		const text = concept("decisions/caching", "We cache.");

		expect(text).toStartWith("[curated knowledge: decisions/caching]");
		expect(text).toContain("We cache.");
	});

	test("a stale concept says so", () => {
		expect(concept("decisions/old", "Old news.", true)).toContain("(stale)");
	});

	test("a fragment names the part it is and points at the rest", () => {
		// A fragment headed with the Concept's name alone reads as the
		// Concept's complete answer, which is the one thing curated
		// knowledge must not do.
		const text = concept("metrics/gross-margin", "Revenue less full COGS.", false, {
			index: 1,
			count: 4,
		});

		expect(text).toContain("[curated knowledge: metrics/gross-margin — part 2 of 4]");
		expect(text).toContain("walk_documentation");
	});

	test("a concept carried whole is not marked as partial", () => {
		const text = concept("decisions/caching", "We cache.");

		expect(text).toContain("[curated knowledge: decisions/caching]");
		expect(text).not.toContain("part 1 of");
	});

	test("what a concept records it is not travels with it", () => {
		// A definition carried without the exclusions that qualify it
		// invites the mistake they exist to prevent.
		const text = concept("metrics/gross-margin", "Revenue less full COGS.", false, {
			exclusions: [
				{
					term: "revenue minus product cost only",
					why: "that is the pre-FY2026 definition",
					instead: "revenue minus full COGS",
				},
			],
		});

		expect(text).toContain("Not: revenue minus product cost only");
		expect(text).toContain("pre-FY2026");
		expect(text).toContain("Use instead: revenue minus full COGS");
	});

	test("a concept recording no exclusions carries no placeholder", () => {
		expect(concept("decisions/caching", "We cache.")).not.toContain("Not:");
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
	test("the tail keeps its most recent turn even when that turn alone exceeds the budget", () => {
		const pack = assemble(
			{ turns: [turnOf(1, bulky(50)), turnOf(2, bulky(900, "b")), turnOf(3)] },
			budgets({ tailTurns: 8, tailTokens: 400 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");

		expect(tail?.turnIndices).toEqual([2]);
		expect(tail?.shortened).toBe(true);
		expect(tail?.approximateTokens).toBeLessThanOrEqual(400);
		// Turn 1 left by Eviction when Turn 2 carried the tail past its Budget.
		expect(tail?.excluded).toEqual({ evicted: 1 });
	});
});

describe("a budget below what must be carried", () => {
	test("an irreducible tail turn is carried and its budget reported as exceeded", () => {
		// A prompt and a final reply are never dropped and are elided only to
		// a readable head and tail each, so together they have a floor no
		// Budget below it can reach — and the tail's newest Turn may not go.
		const pack = assemble(
			{
				turns: [
					{
						index: 1,
						prompt: "big",
						messages: [
							{ role: "user", content: "p".repeat(4_000) },
							{ role: "assistant", content: "r".repeat(4_000) },
						],
					},
					turnOf(2),
				],
			},
			budgets({ tailTurns: 1, tailTokens: 100, packTokens: UNBOUNDED }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");

		expect(tail?.carried).toBe(1);
		expect(tail?.shortened).toBe(true);
		expect(tail?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(tail?.budget?.tokens).toBe(100);
		// Carried, and honest about it: the Budget is reported beside a spend
		// that exceeds it rather than the part reading as though it fitted.
		expect(tail?.approximateTokens).toBeGreaterThan(100);
	});

	test("a configured tail token budget of nothing still carries no tail", () => {
		const pack = assemble(
			{ turns: [turnOf(1, bulky(50)), turnOf(2)] },
			budgets({ tailTurns: 1, tailTokens: 0 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");

		expect(tail?.carried).toBe(0);
		expect(tail?.messages).toEqual([]);
	});
});

/**
 * A Turn of tool-call groups, oldest first: each an assistant call to the
 * named tool and the result answering it, of roughly `tokens` tokens.
 */
function workingTurn(
	index: number,
	groups: { name: string; tokens: number }[],
	reply?: string,
): Turn {
	const messages: HarnessMessage[] = [{ role: "user", content: `prompt ${index}` }];
	groups.forEach((group, position) => {
		const id = `call-${index}-${position}`;
		messages.push(toolCall(group.name, { path: `/work/${position}` }, id));
		messages.push(
			toolResult(String(position % 10).repeat(group.tokens * 4), id, group.name),
		);
	});
	if (reply !== undefined) messages.push({ role: "assistant", content: reply });
	return { index, prompt: `prompt ${index}`, messages };
}

function tailOf(pack: Pack) {
	return pack.parts.find((part) => part.source === "verbatim-tail");
}

describe("the newest tail turn shrinks by its oldest actions", () => {
	test("a long working turn fits its tail budget with its prompt, marker and final reply", () => {
		// The incident's shape: hundreds of results, each already too short
		// to elide, so only dropping messages gets the Turn under its Budget.
		const groups = Array.from({ length: 200 }, () => ({ name: "read", tokens: 100 }));
		const pack = assemble(
			{ turns: [workingTurn(1, groups, "all done"), turnOf(2)] },
			budgets({ tailTurns: 1, tailTokens: 5_000 }),
		);
		const tail = tailOf(pack);
		const messages = tail?.messages ?? [];

		expect(tail?.carried).toBe(1);
		expect(tail?.approximateTokens).toBeLessThanOrEqual(5_000);
		expect(messages[0]?.role).toBe("user");
		expect(messageText(messages[0] ?? { role: "user" })).toContain(
			"[pi-chart did not carry",
		);
		expect(messages.at(-1)).toEqual({ role: "assistant", content: "all done" });
		expect(messages.map((message) => message.toolCallId)).toContain("call-1-199");
	});

	test("the oldest groups go first and every carried call keeps its result", () => {
		const groups = Array.from({ length: 10 }, () => ({ name: "read", tokens: 300 }));
		const tail = tailOf(
			assemble(
				{ turns: [workingTurn(1, groups, "done"), turnOf(2)] },
				budgets({ tailTurns: 1, tailTokens: 1_500 }),
			),
		);
		const messages = tail?.messages ?? [];
		const calls = messages.flatMap((message) =>
			Array.isArray(message.content)
				? message.content.flatMap((block) =>
						block.type === "toolCall" && "id" in block ? [block.id as string] : [],
					)
				: [],
		);
		const results = messages.flatMap((message) =>
			message.role === "toolResult" ? [message.toolCallId] : [],
		);

		expect(tail?.approximateTokens).toBeLessThanOrEqual(1_500);
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.length).toBeLessThan(10);
		// The newest are what survive, and no newer group is skipped.
		const firstKept = 10 - calls.length;
		expect(calls).toEqual(
			Array.from({ length: calls.length }, (_, offset) => `call-1-${firstKept + offset}`),
		);
		expect(results).toEqual(calls);
		expect(tail?.droppedMessages).toBe(firstKept * 2);
	});

	test("every group may go when the prompt and final reply fill the room", () => {
		const reply = "r".repeat(3_600);
		const groups = Array.from({ length: 5 }, () => ({ name: "bash", tokens: 100 }));
		const tail = tailOf(
			assemble(
				{ turns: [workingTurn(1, groups, reply), turnOf(2)] },
				budgets({ tailTurns: 1, tailTokens: 1_000 }),
			),
		);
		const messages = tail?.messages ?? [];

		expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(messageText(messages[0] ?? { role: "user" })).toBe(
			"prompt 1\n\n[pi-chart did not carry 10 earlier messages of this Turn: bash ×5; " +
				`${approximateTokens(workingTurn(1, groups).messages.slice(1))} tokens]`,
		);
		expect(messages[1]).toEqual({ role: "assistant", content: reply });
		expect(tail?.droppedMessages).toBe(10);
	});

	test("a turn that fits by eliding drops nothing and carries no marker", () => {
		const groups = Array.from({ length: 3 }, () => ({ name: "read", tokens: 2_000 }));
		const tail = tailOf(
			assemble(
				{ turns: [workingTurn(1, groups, "done"), turnOf(2)] },
				budgets({ tailTurns: 1, tailTokens: 2_500 }),
			),
		);

		expect(tail?.shortened).toBe(true);
		expect(tail?.droppedMessages).toBeUndefined();
		expect(tail?.messages).toHaveLength(8);
		expect(tail?.messages[0]).toEqual({ role: "user", content: "prompt 1" });
	});

	test("the marker names each tool in the order first used", () => {
		const groups = [
			...Array.from({ length: 100 }, () => ({ name: "read", tokens: 10 })),
			...Array.from({ length: 52 }, () => ({ name: "bash", tokens: 10 })),
			...Array.from({ length: 40 }, () => ({ name: "read", tokens: 10 })),
			...Array.from({ length: 13 }, () => ({ name: "edit", tokens: 10 })),
		];
		const tail = tailOf(
			assemble(
				{ turns: [workingTurn(1, groups, "done"), turnOf(2)] },
				budgets({ tailTurns: 1, tailTokens: 70 }),
			),
		);

		expect(messageText(tail?.messages[0] ?? { role: "user" })).toMatch(
			/\n\n\[pi-chart did not carry 410 earlier messages of this Turn: read ×140, bash ×52, edit ×13; ~\d+k tokens\]$/,
		);
	});

	test("the marker joins a block prompt's last text and counts an unnamed call as unknown", () => {
		const turn = workingTurn(1, [{ name: "read", tokens: 10 }], "r".repeat(2_000));
		turn.messages[0] = {
			role: "user",
			content: [
				{ type: "text", text: "look" },
				{ type: "image" },
				{ type: "text", text: "then fix" },
			],
		};
		turn.messages[1] = {
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1-0", name: "" }],
		};
		const tail = tailOf(
			assemble(
				{ turns: [turn, turnOf(2)] },
				budgets({ tailTurns: 1, tailTokens: 520 }),
			),
		);
		const content = tail?.messages[0]?.content;

		expect(Array.isArray(content) ? content.slice(0, 2) : content).toEqual([
			{ type: "text", text: "look" },
			{ type: "image" },
		]);
		expect(Array.isArray(content) ? content.slice(2) : content).toEqual([
			{
				type: "text",
				text: expect.stringMatching(
					/^then fix\n\n\[pi-chart did not carry 2 earlier messages of this Turn: unknown ×1; \d+ tokens\]$/,
				),
			},
		]);
	});

	test("below the smallest form the final reply is elided before the prompt", () => {
		const prompt = "p".repeat(1_200);
		const groups = Array.from({ length: 3 }, () => ({ name: "read", tokens: 50 }));
		const turn = workingTurn(1, groups, "r".repeat(12_000));
		turn.messages[0] = { role: "user", content: prompt };
		const tail = tailOf(
			assemble(
				{ turns: [turn, turnOf(2)] },
				budgets({ tailTurns: 1, tailTokens: 1_000 }),
			),
		);
		const [head, reply] = tail?.messages ?? [];

		expect(tail?.messages).toHaveLength(2);
		expect(messageText(reply ?? { role: "assistant" })).toContain("[pi-chart elided");
		expect(messageText(head ?? { role: "user" })).toMatch(
			new RegExp(`^${prompt}\\n\\n\\[pi-chart did not carry 6 earlier messages`),
		);
		expect(tail?.approximateTokens).toBeLessThanOrEqual(1_000);
	});

	test("when the reply alone cannot make room the prompt is elided and keeps the marker", () => {
		const groups = Array.from({ length: 3 }, () => ({ name: "read", tokens: 50 }));
		const turn = workingTurn(1, groups, "r".repeat(12_000));
		turn.messages[0] = { role: "user", content: "p".repeat(12_000) };
		const tail = tailOf(
			assemble(
				{ turns: [turn, turnOf(2)] },
				budgets({ tailTurns: 1, tailTokens: 1_000 }),
			),
		);
		const head = messageText(tail?.messages[0] ?? { role: "user" });

		expect(messageText(tail?.messages[1] ?? { role: "assistant" })).toContain(
			"[pi-chart elided",
		);
		expect(head).toContain("[pi-chart elided");
		expect(head).toMatch(/\n\n\[pi-chart did not carry 6 earlier messages of this Turn: read ×3; \d+ tokens\]$/);
		expect(tail?.approximateTokens).toBeLessThanOrEqual(1_000);
	});

	test("shrinking the same turn twice drops the same groups and carries the same marker", () => {
		const groups = Array.from({ length: 60 }, (_, index) => ({
			name: index % 3 === 0 ? "bash" : "read",
			tokens: 80 + (index % 7) * 30,
		}));
		const input = () => ({ turns: [workingTurn(1, groups, "done"), turnOf(2)] });
		const config = budgets({ tailTurns: 1, tailTokens: 2_000 });

		expect(assemble(input(), config)).toEqual(assemble(input(), config));
		expect(tailOf(assemble(input(), config))?.droppedMessages).toBeGreaterThan(0);
	});
});

describe("the ceiling never empties the tail", () => {
	const groups = Array.from({ length: 40 }, () => ({ name: "read", tokens: 100 }));

	test("the newest tail turn is carried shrunk under a ceiling below it and the current turn", () => {
		const pack = assemble(
			{ turns: [workingTurn(1, groups, "done"), turnOf(2)] },
			budgets({ tailTurns: 1, packTokens: 2_000 }),
		);
		const tail = tailOf(pack);

		expect(tail?.carried).toBe(1);
		expect(tail?.absent).toBeUndefined();
		expect(tail?.droppedMessages).toBeGreaterThan(0);
		expect(messageText(tail?.messages[0] ?? { role: "user" })).toContain(
			"[pi-chart did not carry",
		);
		expect(pack.approximateTokens).toBeLessThanOrEqual(2_000);
	});

	test("a tail whose smallest form exceeds what the current turn leaves is still carried", () => {
		// The current Turn alone nearly fills the ceiling, so even the tail's
		// prompt and reply, both elided, do not fit beside it.
		const reply = "r".repeat(4_000);
		const current = turnOf(2, bulky(2_000, "c"));
		const pack = assemble(
			{ turns: [workingTurn(1, groups, reply), current] },
			budgets({ tailTurns: 1, packTokens: 300 }),
		);
		const tail = tailOf(pack);
		const now = pack.parts.find((part) => part.source === "current-turn");

		expect(tail?.carried).toBe(1);
		expect(tail?.absent).toBeUndefined();
		expect(tail?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(tail?.droppedMessages).toBe(80);
		expect(now?.shortened).toBe(true);
		expect(now?.messages).toHaveLength(current.messages.length);
		expect(pack.approximateTokens).toBeGreaterThan(300);
	});
});

describe("the pack ceiling", () => {
	const oversized = () => ({
		turns: [turnOf(1, bulky(300, "t")), turnOf(2, bulky(300, "u")), turnOf(3, bulky(40, "c"))],
	});

	test("an oversized pack is reduced to fit before it is returned", () => {
		const pack = assemble(oversized(), budgets({ tailTurns: 2, packTokens: 400 }));

		expect(pack.approximateTokens).toBeLessThanOrEqual(400);
		expect(pack.beforeCeiling).toBeGreaterThan(400);
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
		const config = budgets({ tailTurns: 2, packTokens: 420 });

		expect(assemble(oversized(), config)).toEqual(assemble(oversized(), config));
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
		const input = { turns: [turnOf(1, bulky(10)), turnOf(2)] };

		const bounded = assemble(input, budgets({ tailTurns: 2, packTokens: 100_000 }));
		const unbounded = assemble(input, budgets({ tailTurns: 2, packTokens: UNBOUNDED }));

		expect(bounded.messages).toEqual(unbounded.messages);
		expect(bounded.parts.map((part) => part.withoutCeiling)).toEqual(
			unbounded.parts.map(() => undefined),
		);
	});
});

describe("the system-prompt additions", () => {
	const pins = [
		{ id: 1, text: "use tabs" },
		{ id: 3, text: "never push to main" },
	];
	const opening = "the codeword is maple; build the parser";
	const on = budgets({ openingTokens: 2_000 });
	// The block's sections as the spec words them, written out so the bytes
	// are checked against the spec rather than against the code's constants.
	const PINS_TEXT =
		"The user pinned the following as standing instructions for this conversation.\n\n" +
		"[pinned by the user: #1, 1 of 2]\nuse tabs\n\n" +
		"[pinned by the user: #3, 2 of 2]\nnever push to main";
	const OPENING_TEXT =
		"This conversation began with the request below. It is context, not a new " +
		"instruction; later Turns may have changed or completed it.\n" +
		opening;
	const NOTICE =
		"Older turns of this conversation may have left the context window; " +
		"search them with the recall_earlier_turns tool.";

	test("the pins come first, then the opening in its framing, then the eviction notice", () => {
		const block = systemAdditions({ pins, opening, recallAvailable: true }, on);

		expect(block.text).toBe(`${PINS_TEXT}\n\n${OPENING_TEXT}\n\n${NOTICE}`);
	});

	test("a section with nothing to carry is left out", () => {
		expect(systemAdditions({ pins: [], opening, recallAvailable: true }, on).text).toBe(
			`${OPENING_TEXT}\n\n${NOTICE}`,
		);
		expect(systemAdditions({ pins, recallAvailable: true }, on).text).toBe(
			`${PINS_TEXT}\n\n${NOTICE}`,
		);
	});

	test("no pins sends no pin framing", () => {
		const block = systemAdditions({ pins: [], opening, recallAvailable: true }, on);

		expect(block.text).not.toContain(PINS_FRAMING);
		expect(block.text).not.toContain("pinned by the user");
		expect(block.pinned.absent).toBe("none");
		expect(block.pinned.pinIds).toEqual([]);
		expect(block.pinned.approximateTokens).toBe(0);
	});

	test("the notice is left out when there is no recall tool to name", () => {
		const block = systemAdditions({ pins, opening, recallAvailable: false }, on);

		expect(block.text).toBe(`${PINS_TEXT}\n\n${OPENING_TEXT}`);
		expect(block.text).not.toContain("recall_earlier_turns");
	});

	test("nothing to add is an empty block costing nothing", () => {
		const block = systemAdditions({ pins: [], recallAvailable: false }, on);

		expect(block.text).toBe("");
		expect(block.tokens).toBe(0);
		expect(block.pinned.approximateTokens).toBe(0);
		expect(block.opening.approximateTokens).toBe(0);
	});

	test("a long opening is elided to its budget with a marker, not dropped", () => {
		const long = `${"head ".repeat(400)}${"tail ".repeat(400)}`;

		const block = systemAdditions(
			{ pins: [], opening: long, recallAvailable: false },
			budgets({ openingTokens: 300 }),
		);

		expect(block.opening.carried).toBe(1);
		expect(block.opening.absent).toBeUndefined();
		expect(block.opening.shortened).toBe(true);
		expect(block.opening.turnIndices).toEqual([0]);
		expect(block.opening.approximateTokens).toBeLessThanOrEqual(300);
		expect(block.text).toStartWith(`${OPENING_FRAMING}\nhead head`);
		expect(block.text).toEndWith("tail tail ");
		expect(block.text).toMatch(/\[pi-chart elided ~\d+ tokens from the middle of this content\]/);
	});

	test("an opening budget of nothing turns it off", () => {
		const block = systemAdditions({ pins, opening, recallAvailable: true }, budgets({}));

		expect(block.opening.absent).toBe("disabled");
		expect(block.opening.carried).toBe(0);
		expect(block.text).toBe(`${PINS_TEXT}\n\n${NOTICE}`);
	});

	test("an empty or blank turn 0 prompt carries nothing and says so", () => {
		for (const blank of ["", "  \n\t"]) {
			const block = systemAdditions({ pins: [], opening: blank, recallAvailable: true }, on);

			expect(block.opening.absent).toBe("empty");
			expect(block.opening.carried).toBe(0);
			expect(block.text).toBe(NOTICE);
		}
	});

	test("no turn 0 to offer is missing, with no stand-in", () => {
		const block = systemAdditions({ pins: [], recallAvailable: true }, on);

		expect(block.opening.absent).toBe("missing");
		expect(block.text).toBe(NOTICE);
	});

	test("an opening no store could supply is absent for that reason", () => {
		for (const reason of ["unconfigured", "failed"] as const) {
			const block = systemAdditions(
				{ pins: [], unavailable: reason, recallAvailable: true },
				on,
			);

			expect(block.opening.absent).toBe(reason);
			expect(block.text).toBe(NOTICE);
		}
	});

	test("the same sources give a byte-identical block", () => {
		const first = systemAdditions({ pins, opening, recallAvailable: true }, on);
		const second = systemAdditions(
			{ pins: pins.map((pin) => ({ ...pin })), opening: `${opening}`, recallAvailable: true },
			on,
		);

		expect(second.text).toBe(first.text);
		expect(second).toEqual(first);
	});

	test("both parts are placed in the system prompt and the block's size is its text's", () => {
		const block = systemAdditions({ pins, opening, recallAvailable: true }, on);

		expect(block.pinned).toMatchObject({
			source: "pinned",
			placement: "system-prompt",
			messages: [],
			carried: 2,
			pinIds: [1, 3],
		});
		expect(block.opening).toMatchObject({
			source: "opening",
			placement: "system-prompt",
			messages: [],
			carried: 1,
			turnIndices: [0],
			budget: { count: 1, tokens: 2_000 },
		});
		expect(block.tokens).toBe(approximateTokens([{ role: "user", content: block.text }]));
	});

	test("pins over a lowered budget are all carried and the budget reported", () => {
		const block = systemAdditions(
			{ pins, recallAvailable: false },
			budgets({ pinCount: 1, pinTokens: 10 }),
		);

		expect(block.pinned.carried).toBe(2);
		expect(block.pinned.pinIds).toEqual([1, 3]);
		expect(block.pinned.budget).toEqual({ count: 1, tokens: 10 });
		expect(block.text).toBe(PINS_TEXT);
	});
});

describe("a pack beside the system-prompt additions", () => {
	/** What a Turn started with: one Pin of `pinText`, and an Opening. */
	const startedWith = (pinText = "use tabs") =>
		systemAdditions(
			{
				pins: [{ id: 1, text: pinText }],
				opening: "the codeword is maple; build the parser",
				recallAvailable: true,
			},
			budgets({ openingTokens: UNBOUNDED }),
		);
	const partOf = (pack: Pack, source: PackSource) =>
		pack.parts.find((part) => part.source === source);

	test("the messages are the tail then the current turn, with nothing appended", () => {
		const turns = reconstructTurns(conversation(2));

		const pack = assemble({ turns, system: startedWith() }, budgets({ tailTurns: 8 }));

		expect(pack.messages).toEqual(turns.flatMap((turn) => turn.messages));
	});

	test("without the hook the pins and the opening are absent, unhooked, and cost nothing", () => {
		const turns = reconstructTurns(conversation(2));
		const config = budgets({ tailTurns: 8, openingTokens: 2_000 });

		const pack = assemble({ turns }, config);

		expect(pack.systemTokens).toBe(0);
		for (const source of ["pinned", "opening"] as const) {
			expect(partOf(pack, source)).toMatchObject({
				placement: "system-prompt",
				messages: [],
				approximateTokens: 0,
				carried: 0,
				absent: "unhooked",
			});
		}
		expect(pack.messages).toEqual(
			assemble({ turns, system: startedWith() }, config).messages,
		);
	});

	test("without the hook the whole ceiling is the tail's and the current turn's", () => {
		const turns = [turnOf(1, bulky(200, "a")), turnOf(2)];
		const exact = assemble({ turns }, budgets({ tailTurns: 1 })).approximateTokens;

		const pack = assemble({ turns }, budgets({ tailTurns: 1, packTokens: exact }));

		expect(tailOf(pack)?.carried).toBe(1);
		expect(tailOf(pack)?.withoutCeiling).toBeUndefined();
		expect(pack.approximateTokens).toBe(exact);
	});

	test("the additions are recorded as the turn started with them", () => {
		const system = startedWith();

		const pack = assemble(
			{ turns: reconstructTurns(conversation(2)), system },
			budgets({ tailTurns: 8 }),
		);

		expect(pack.systemTokens).toBe(system.tokens);
		expect(partOf(pack, "pinned")).toEqual(system.pinned);
		expect(partOf(pack, "opening")).toEqual(system.opening);
		// The additions count toward the pack beside what it sent as messages.
		const sent =
			(tailOf(pack)?.approximateTokens ?? 0) +
			(partOf(pack, "current-turn")?.approximateTokens ?? 0);
		expect(pack.approximateTokens).toBe(sent + system.tokens);
	});

	test("the additions count against the ceiling and are never reduced", () => {
		const turns = [turnOf(1, bulky(200, "a")), turnOf(2, bulky(200, "b")), turnOf(3)];
		const system = startedWith("p".repeat(800));
		const config = (packTokens: number) =>
			budgets({ tailTurns: 2, tailLowWater: 1, packTokens });
		const ceiling = assemble({ turns, system }, config(UNBOUNDED)).approximateTokens - 100;

		const pack = assemble({ turns, system }, config(ceiling));

		expect(tailOf(pack)?.turnIndices).toEqual([2]);
		expect(partOf(pack, "pinned")).toEqual(system.pinned);
		expect(partOf(pack, "opening")).toEqual(system.opening);
		expect(pack.systemTokens).toBe(system.tokens);
		expect(pack.approximateTokens).toBeLessThanOrEqual(ceiling);
		// Without the additions the same ceiling leaves room for both Turns.
		expect(tailOf(assemble({ turns }, config(ceiling)))?.turnIndices).toEqual([1, 2]);
	});

	test("the ceiling evicts the oldest tail turns first, then elides the current turn", () => {
		const turns = [
			turnOf(1, bulky(200, "a")),
			turnOf(2, bulky(200, "b")),
			turnOf(3, bulky(600, "c")),
		];
		const system = startedWith();
		const total = assemble(
			{ turns, system },
			budgets({ tailTurns: 2, tailLowWater: 1 }),
		).approximateTokens;

		// Swept, so the claim is the order things give way in and nothing
		// about where any one threshold falls.
		let lostOldest = false;
		let currentElided = false;
		let newestAloneWithCurrentWhole = false;
		for (let ceiling = total; ceiling >= 0; ceiling -= 10) {
			const pack = assemble(
				{ turns, system },
				budgets({ tailTurns: 2, tailLowWater: 1, packTokens: ceiling }),
			);
			const tail = tailOf(pack)?.turnIndices;
			const current = partOf(pack, "current-turn");

			expect([[1, 2], [2]]).toContainEqual(tail ?? []);
			if (lostOldest) expect(tail).toEqual([2]);
			lostOldest ||= tail?.length === 1;
			if (current?.shortened) {
				expect(tail).toEqual([2]);
				currentElided = true;
			} else if (tail?.length === 1) {
				newestAloneWithCurrentWhole = true;
			}
			expect(current?.carried).toBe(1);
			expect(partOf(pack, "pinned")).toEqual(system.pinned);
			expect(partOf(pack, "opening")).toEqual(system.opening);
		}

		expect(newestAloneWithCurrentWhole).toBe(true);
		expect(currentElided).toBe(true);
	});

	test("additions above the ceiling are still sent whole, and the rest goes to its minimum", () => {
		const groups = Array.from({ length: 40 }, () => ({ name: "read", tokens: 100 }));
		const current = turnOf(2, bulky(2_000, "c"));
		const turns = [workingTurn(1, groups, "r".repeat(4_000)), current];
		const system = startedWith("p".repeat(8_000));
		const ceiling = 500;
		expect(system.tokens).toBeGreaterThan(ceiling);

		const pack = assemble({ turns, system }, budgets({ tailTurns: 1, packTokens: ceiling }));

		expect(partOf(pack, "pinned")).toEqual(system.pinned);
		expect(partOf(pack, "opening")).toEqual(system.opening);
		expect(pack.systemTokens).toBe(system.tokens);
		// The newest tail Turn is kept at its smallest form, and the current
		// Turn is elided, never dropped.
		expect(tailOf(pack)?.turnIndices).toEqual([1]);
		expect(tailOf(pack)?.shortened).toBe(true);
		const now = partOf(pack, "current-turn");
		expect(now?.carried).toBe(1);
		expect(now?.shortened).toBe(true);
		expect(now?.messages).toHaveLength(current.messages.length);
		expect(pack.approximateTokens).toBeGreaterThan(ceiling);
		// The minimum is what a ceiling of nothing leaves: the same messages.
		const floor = assemble({ turns }, budgets({ tailTurns: 1, packTokens: 0 }));
		expect(pack.messages).toEqual(floor.messages);
	});
});

describe("the verbatim tail evicts to a low-water mark", () => {
	/** Turns 1 to `completed`, each `tokens` heavier than a bare prompt, then the Turn in progress. */
	const conversationOf = (completed: number, tokens = 0): Turn[] => [
		...Array.from({ length: completed }, (_, offset) =>
			tokens > 0 ? turnOf(offset + 1, bulky(tokens)) : turnOf(offset + 1),
		),
		turnOf(completed + 1),
	];
	const carried = (pack: Pack) => tailOf(pack)?.turnIndices;

	test("the start holds between evictions", () => {
		const config = budgets({ tailTurns: 8, tailLowWater: 0.6 });
		const starts = [9, 10, 11, 12, 13, 14].map(
			(completed) => carried(assemble({ turns: conversationOf(completed) }, config))?.[0],
		);

		expect(starts).toEqual([6, 6, 6, 6, 6, 11]);
		expect(carried(assemble({ turns: conversationOf(12) }, config))).toEqual([6, 7, 8, 9, 10, 11, 12]);
	});

	test("eviction drops to the mark in one step", () => {
		// Turns of about 4,000 tokens: six fit 25,000, the seventh does not,
		// and three is the most that fits a mark of 0.6, 15,000 tokens.
		const config = budgets({ tailTurns: 8, tailTokens: 25_000, tailLowWater: 0.6 });

		expect(carried(assemble({ turns: conversationOf(6, 4_000) }, config))).toEqual([1, 2, 3, 4, 5, 6]);
		const evicted = tailOf(assemble({ turns: conversationOf(7, 4_000) }, config));
		expect(evicted?.turnIndices).toEqual([5, 6, 7]);
		expect(evicted?.approximateTokens).toBeLessThanOrEqual(15_000);
	});

	test("the default mark", () => {
		// Turns of about 4,000 tokens: the seventh carries the tail past
		// 25,000. The default mark of 0.2, 5,000 tokens, keeps it alone;
		// 0.6 would keep three.
		const config = assemblerConfig(loadConfig({ PICHART_TAIL_TOKENS: "25000" }));
		const evicted = tailOf(assemble({ turns: conversationOf(7, 4_000) }, config));

		expect(evicted?.turnIndices).toEqual([7]);
		expect(evicted?.approximateTokens).toBeLessThanOrEqual(5_000);
	});

	test("the count budget evicts to its mark", () => {
		// A mark of 0.6 of 8 Turns is 4.
		const pack = assemble({ turns: conversationOf(9) }, budgets({ tailTurns: 8, tailLowWater: 0.6 }));

		expect(carried(pack)).toEqual([6, 7, 8, 9]);
	});

	test("a newest turn larger than the mark is kept alone", () => {
		const config = budgets({ tailTurns: 8, tailTokens: 1_000, tailLowWater: 0.6 });
		const ending = (tokens: number) =>
			tailOf(
				assemble(
					{ turns: [turnOf(1, bulky(300)), turnOf(2, bulky(300)), turnOf(3, bulky(tokens)), turnOf(4)] },
					config,
				),
			);

		// Over a mark of 0.6, 600 tokens, within the Budget: alone and whole.
		expect(ending(800)?.turnIndices).toEqual([3]);
		expect(ending(800)?.shortened).toBeUndefined();
		// Over the Budget as well: alone and shrunk.
		expect(ending(1_500)?.turnIndices).toEqual([3]);
		expect(ending(1_500)?.shortened).toBe(true);
	});

	test("a mark of one slides the tail", () => {
		expect(carried(assemble({ turns: conversationOf(12) }, budgets({ tailTurns: 8, tailLowWater: 1 })))).toEqual([
			5, 6, 7, 8, 9, 10, 11, 12,
		]);
		expect(
			carried(
				assemble(
					{ turns: conversationOf(9, 4_000) },
					budgets({ tailTurns: 8, tailTokens: 25_000, tailLowWater: 1 }),
				),
			),
		).toEqual([4, 5, 6, 7, 8, 9]);
	});

	test("the ceiling does not move the start", () => {
		// A Pin too heavy for the ceiling takes the tail's oldest Turns on
		// one Call; removed, the next Call's Pack fits again.
		const turns = conversationOf(3, 200);
		const config = budgets({ tailTurns: 8, packTokens: 900 });
		const heavy = systemAdditions(
			{ pins: [{ id: 1, text: "p".repeat(1_600) }], recallAvailable: false },
			config,
		);
		const pinned = assemble({ turns, system: heavy }, config);
		const next = assemble({ turns }, config);

		expect(carried(pinned)).not.toEqual([1, 2, 3]);
		expect(carried(next)).toEqual([1, 2, 3]);
		expect(tailOf(next)).toEqual(tailOf(assemble({ turns }, budgets({ tailTurns: 8 }))));
	});

	test("the start is the same however it is reached", () => {
		// Sizes that vary, so the count Budget evicts on some Calls (the
		// ninth) and the token Budget on others (the fourteenth).
		const conversation = Array.from({ length: 30 }, (_, offset) =>
			turnOf(offset + 1, bulky(((offset * 37) % 11) * 120 + 20)),
		);
		const sizes = conversation.map((turn) => ({ index: turn.index ?? 0, tokens: tailTokens(turn) }));
		const config = budgets({ tailTurns: 8, tailTokens: 5_000 });

		for (let completed = 1; completed < conversation.length; completed++) {
			// The answering process: the Store's recent Turns, then the Turn in progress.
			const answering = assemble(
				{
					turns: conversation.slice(Math.max(completed - 8, 0), completed + 1),
					tailSizes: sizes.slice(0, completed),
				},
				config,
			);
			// A fresh process holding the whole Conversation.
			const fresh = assemble(
				{ turns: conversation.slice(0, completed + 1), tailSizes: sizes.slice(0, completed) },
				config,
			);

			expect(carried(answering)?.[0]).toBe(carried(fresh)?.[0]);
		}
	});

	test("evicted turns are recorded as evicted", () => {
		const tail = tailOf(assemble({ turns: conversationOf(9) }, budgets({ tailTurns: 8, tailLowWater: 0.6 })));

		expect(tail?.excluded).toEqual({ evicted: 5 });
		expect(tail?.excludedCandidates?.map((each) => [each.turnIndex, each.reason])).toEqual([
			[5, "evicted"],
			[4, "evicted"],
			[3, "evicted"],
			[2, "evicted"],
			[1, "evicted"],
		]);
	});
});
