import { describe, expect, test } from "bun:test";

import { reconstructTurns } from "../src/turns.ts";
import { fixture } from "./fixtures.ts";

describe("reconstructTurns", () => {
	test("groups each user prompt with the agent output that answers it", async () => {
		const turns = reconstructTurns(await fixture("multi-turn"));

		expect(turns.map((turn) => turn.prompt)).toEqual([
			"Remember this codeword: zephyr. Reply with just: ok",
			"Now remember a second codeword: quartz. Reply with just: ok",
			"What were the two codewords?",
		]);
	});

	test("a single exchange is one turn", async () => {
		const turns = reconstructTurns(await fixture("plain-exchange"));

		expect(turns).toHaveLength(1);
		expect(turns[0]?.prompt).toBe("Say the single word: apricot. Then stop.");
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
