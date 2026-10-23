import { describe, expect, test } from "bun:test";

import { asRecollection, assemble } from "../src/assembler.ts";
import { messageText, type HarnessMessage, type Turn } from "../src/messages.ts";
import { approximateTokens } from "../src/tokens.ts";
import { budgets } from "./fixtures.ts";

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
		expect(shortened?.piChartShortened).toBe(true);
	});

	test("a tool result whose text fits is carried whole, however large its details", () => {
		// `details` never reach a provider, so they cost nothing and are no
		// reason to touch the message.
		const message: HarnessMessage = {
			role: "toolResult",
			toolCallId: "call-m",
			toolName: "read",
			content: "the whole answer, which fits. ".repeat(20),
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

		expect(tail?.messages.find((each) => each.role === "toolResult")).toEqual(message);
	});

	test("a shortened tool result keeps its details", () => {
		const details = { lines: "d".repeat(30_000) };
		const heavy: HarnessMessage = {
			role: "toolResult",
			toolCallId: "call-d",
			toolName: "read",
			content: "c".repeat(40_000),
			details,
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
		const shortened = tail?.messages.find((message) => message.role === "toolResult");
		const text = messageText(shortened ?? { role: "toolResult" });

		expect(shortened?.piChartShortened).toBe(true);
		expect(shortened?.details).toEqual(details);
		expect(text).toContain("elided");
		// The Budget is spent on content, not on details that cost nothing.
		expect(tail?.approximateTokens).toBeGreaterThan(1000);
		expect(tail?.approximateTokens).toBeLessThanOrEqual(2000);
	});

	test("a shortened tool result keeps the blocks it arrived in", () => {
		const pack = assemble(
			{ turns: [turnOf(1, bulky(2000, "m")), turnOf(2)] },
			budgets({ tailTurns: 1, tailTokens: 500 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");
		const shortened = tail?.messages.find(
			(message) => message.role === "toolResult",
		);

		// Shape is protocol: a provider is handed a tool result as the
		// blocks it arrived in, and a bare string where blocks were is a
		// request it refuses — a Turn that fails rather than one that
		// carries less.
		expect(Array.isArray(shortened?.content)).toBe(true);
		expect(messageText(shortened ?? { role: "toolResult" })).toContain("elided");
	});

	test("a shortened tool call still passes an object", () => {
		const call: HarnessMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call-w",
					name: "write",
					arguments: { path: "/tmp/notes.md", content: "z".repeat(20_000) },
				},
			],
		};
		const pack = assemble(
			{
				turns: [
					{
						index: 1,
						prompt: "write it",
						messages: [
							{ role: "user", content: "write it" },
							call,
							// Answered, or the tail withholds the call and there
							// is nothing to shorten.
							{ role: "toolResult", toolCallId: "call-w", content: "written" },
						],
					},
					turnOf(2),
				],
			},
			budgets({ tailTurns: 1, tailTokens: 600 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");
		const blocks = tail?.messages.find((message) => message.role === "assistant")
			?.content;
		const passed = Array.isArray(blocks)
			? (blocks.find((block) => block.type === "toolCall") as
					| { arguments?: Record<string, unknown> }
					| undefined)?.arguments
			: undefined;

		// The arguments the model produced are an object to the provider,
		// whatever the Budget did to what is in them.
		expect(typeof passed).toBe("object");
		expect(passed?.path).toBe("/tmp/notes.md");
		expect(String(passed?.content)).toContain("elided");
		expect(String(passed?.content).length).toBeLessThan(20_000);
	});

	test("a prompt and assistant reasoning in the current turn are never shortened", () => {
		// The newest tail Turn's are elided below its smallest form (ADR-0012);
		// the current Turn's never are, whatever the ceiling.
		const reasoning = "why ".repeat(4000);
		const pack = assemble(
			{
				turns: [
					turnOf(1),
					{
						index: 2,
						prompt: "long prompt",
						messages: [
							{ role: "user", content: reasoning },
							{ role: "assistant", content: reasoning },
						],
					},
				],
			},
			budgets({ tailTurns: 1, packTokens: 100 }),
		);
		const current = pack.parts.find((part) => part.source === "current-turn");

		expect(current?.messages.map((message) => message.content)).toEqual([
			reasoning,
			reasoning,
		]);
		expect(current?.shortened).toBeUndefined();
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
		const message = asRecollection({ turnIndex: 2, turn: turnOf(2, bulky(3000, "r")) }, 600);
		const text = messageText(message);

		expect(message.piChartShortened).toBe(true);
		expect(text).toContain("[recalled from turn 2 of this conversation]");
		expect(text).toContain("elided");
		expect(approximateTokens([message])).toBeLessThanOrEqual(600);
	});

	test("a recollection whose bulk is prose is shortened rather than dropped", () => {
		// The fixture above is tool-result heavy, so it passes even when only
		// outputs may give way. This Turn's bulk is the agent's own prose: if
		// prose cannot give way the recollection never fits its allowance,
		// which `context-assembly` forbids.
		const reasoning = "because ".repeat(3000);
		const message = asRecollection(
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
			400,
		);
		const text = messageText(message);

		expect(message.piChartShortened).toBe(true);
		expect(text).toContain("[recalled from turn 4 of this conversation]");
		expect(text).toContain("elided");
		expect(approximateTokens([message])).toBeLessThanOrEqual(400);
	});
});
