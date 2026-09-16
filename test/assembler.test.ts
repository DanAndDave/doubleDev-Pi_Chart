import { describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { reconstructTurns } from "../src/turns.ts";

async function fixture(name: string): Promise<HarnessMessage[]> {
	const file = Bun.file(new URL(`./fixtures/${name}.json`, import.meta.url));
	return (await file.json()) as HarnessMessage[];
}

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

		const pack = assemble(turns, { tailTurns: 2 });
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

		const pack = assemble(turns, { tailTurns: 10 });

		expect(pack.messages).toHaveLength(3);
	});

	test("keeps tool calls and their results intact in the tail", async () => {
		const turns = reconstructTurns(await fixture("tool-turn"));

		const pack = assemble(turns, { tailTurns: 5 });

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
			(tailTurns) => assemble(turns, { tailTurns }).messages.length,
		);

		expect(counts).toEqual([1, 3, 7]);
	});

	test("assembling twice from the same inputs produces an identical pack", () => {
		const turns = reconstructTurns(conversation(4));

		const first = assemble(turns, { tailTurns: 2 });
		const second = assemble(turns, { tailTurns: 2 });

		expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
	});

	test("parts account for every message in the pack, in order", async () => {
		const turns = reconstructTurns(conversation(3));

		const pack = assemble(turns, { tailTurns: 2 });
		const fromParts = pack.parts.flatMap((part) => part.messages);

		expect(fromParts).toEqual(pack.messages);
		expect(pack.parts.map((part) => part.source)).toEqual([
			"verbatim-tail",
			"current-turn",
		]);
	});
});
