import { describe, expect, test } from "bun:test";

import { reconstructTurns } from "../src/turns.ts";
import type { HarnessMessage } from "../src/messages.ts";

async function fixture(name: string): Promise<HarnessMessage[]> {
	const file = Bun.file(new URL(`./fixtures/${name}.json`, import.meta.url));
	return (await file.json()) as HarnessMessage[];
}

describe("reconstructTurns", () => {
	test("groups each user prompt with the agent output that answers it", async () => {
		const turns = reconstructTurns(await fixture("multi-turn"));

		expect(turns.map((turn) => turn.prompt)).toEqual([
			"Remember this codeword: zephyr. Reply with just: ok",
			"Now remember a second codeword: quartz. Reply with just: ok",
			"What were the two codewords?",
		]);
	});

	test("keeps a tool call together with its result", async () => {
		const turns = reconstructTurns(await fixture("tool-turn"));

		expect(turns).toHaveLength(1);
		expect(turns[0]?.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
			"toolResult",
		]);
	});

	test("marks an unanswered prompt as still in progress", async () => {
		const turns = reconstructTurns(await fixture("multi-turn"));

		expect(turns.map((turn) => turn.inProgress)).toEqual([false, false, true]);
	});

	test("keeps a failed tool result with the call that produced it", async () => {
		const turns = reconstructTurns(await fixture("failed-tool"));

		expect(turns).toHaveLength(1);
		const failed = turns[0]?.messages.filter(
			(message) => message.isError === true,
		);
		expect(failed).toHaveLength(1);
		expect(failed?.[0]?.role).toBe("toolResult");
	});

	test("treats consecutive prompts as separate turns", () => {
		const turns = reconstructTurns([
			{ role: "user", content: "first" },
			{ role: "user", content: "second" },
		]);

		expect(turns.map((turn) => turn.prompt)).toEqual(["first", "second"]);
	});

	test("a tool call awaiting its result leaves the turn in progress", () => {
		const turns = reconstructTurns([
			{ role: "user", content: "go" },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call-1", name: "read" }],
			},
		]);

		expect(turns[0]?.inProgress).toBe(true);
	});

	test("output with no prompt before it still forms a turn", () => {
		const turns = reconstructTurns([
			{ role: "assistant", content: "orphaned" },
			{ role: "user", content: "later" },
		]);

		expect(turns).toHaveLength(2);
		expect(turns[0]?.prompt).toBe("");
		expect(turns[0]?.messages).toHaveLength(1);
	});
});
