import { expect, test } from "bun:test";

import { turnSizes } from "./src/budget-table.ts";
import { approximateTokens } from "./src/tokens.ts";

const stray = { role: "assistant", content: [{ type: "text", text: "Left over from before the first prompt." }] };
const first = { role: "user", content: "List the files under src/." };
const call = {
	role: "assistant",
	content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls src" } }],
};
const result = { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "a.ts\nb.ts" }] };
const answer = { role: "assistant", content: [{ type: "text", text: "Two files: a.ts and b.ts." }] };
const second = { role: "user", content: "Thanks." };
const reply = { role: "assistant", content: [{ type: "text", text: "You are welcome." }] };

test("one size per Turn, each the estimate over that Turn's messages", () => {
	expect(turnSizes([first, call, result, answer, second, reply])).toEqual([
		approximateTokens([first, call, result, answer]),
		approximateTokens([second, reply]),
	]);
});

test("a leading Turn with no prompt is dropped", () => {
	expect(turnSizes([stray, first, call, result, answer, second, reply])).toEqual([
		approximateTokens([first, call, result, answer]),
		approximateTokens([second, reply]),
	]);
});

test("no messages, no Turns", () => {
	expect(turnSizes([])).toEqual([]);
});
