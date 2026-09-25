import { describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import { messageText, type HarnessMessage, type Turn } from "../src/messages.ts";
import { budgets, UNBOUNDED } from "./fixtures.ts";

/**
 * Elision, driven through `assemble`.
 *
 * The seam is the Assembler rather than `elideMessage` directly, because
 * what a message may spend is a Budget's arithmetic and not a number a test
 * should invent: these read the same as they did when the elision family
 * lived in the Assembler, which is the point.
 */

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

	test("a message shortened for its metadata alone keeps its text once", () => {
		// The text fits; only the `details` beside it have to go. Head and
		// tail then cover the whole text between them, and carrying both
		// used to carry the middle twice — a message that came back longer
		// than it went in, with its content duplicated.
		const text = "the whole answer, which fits. ".repeat(20);
		const message: HarnessMessage = {
			role: "toolResult",
			toolCallId: "call-m",
			toolName: "read",
			content: text,
			details: { lines: "d".repeat(40_000) },
		};
		const pack = assemble(
			{
				turns: [
					{ index: 1, prompt: "read it", messages: [{ role: "user", content: "read it" }, message] },
					turnOf(2),
				],
			},
			budgets({ tailTurns: 1, tailTokens: 1000 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");
		const carried = messageText(
			tail?.messages.find((each) => each.role === "toolResult") ?? { role: "toolResult" },
		);

		expect(carried.split("the whole answer, which fits.")).toHaveLength(21);
		expect(carried).toContain("tool metadata");
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
