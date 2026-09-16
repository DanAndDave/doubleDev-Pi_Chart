import { describe, expect, test } from "bun:test";

import { MemoryAccounting, type CallAddress } from "../src/accounting.ts";
import { assemble } from "../src/assembler.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { reconstructTurns } from "../src/turns.ts";

function pack(...messages: HarnessMessage[]) {
	return assemble({ turns: reconstructTurns(messages) }, { tailTurns: 4, recallTurns: 0, docConcepts: 0, graphSymbols: 0 });
}

function at(turnIndex: number, callIndex: number): CallAddress {
	return { turnIndex, callIndex };
}

const PROMPT: HarnessMessage = { role: "user", content: "hello" };

describe("accounting", () => {
	test("reads back turns in turn order", async () => {
		const store = new MemoryAccounting();

		await store.recordPack("conv-1", at(1, 0), pack(PROMPT), "thread-store");
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store");

		const turns = await store.readAccounting("conv-1");
		expect(turns.map((turn) => turn.turnIndex)).toEqual([0, 1]);
	});

	test("groups every call of a tool-using turn under that turn", async () => {
		const store = new MemoryAccounting();

		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store");
		await store.recordPack("conv-1", at(0, 1), pack(PROMPT), "thread-store");
		await store.recordPack("conv-1", at(1, 0), pack(PROMPT), "thread-store");

		const turns = await store.readAccounting("conv-1");
		expect(turns.map((turn) => turn.calls.length)).toEqual([2, 1]);
	});

	test("separates the pack from the floor once the harness reports them", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store");

		await store.recordMeasurements("conv-1", [
			{ ...at(0, 0), snapshot: { promptTokens: 29352, nonMessageTokens: 25588 } },
		]);

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.floorTokens).toBe(25588);
		expect(turn?.packTokens).toBe(29352 - 25588);
	});

	test("a turn's pack size is the widest window it reached", async () => {
		const store = new MemoryAccounting();
		await store.recordMeasurements("conv-1", [
			{ ...at(0, 0), snapshot: { promptTokens: 26000, nonMessageTokens: 25588 } },
			{ ...at(0, 1), snapshot: { promptTokens: 27000, nonMessageTokens: 25588 } },
		]);

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.packTokens).toBe(27000 - 25588);
	});

	test("a trivially small pack still reports its floor", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store");
		await store.recordMeasurements("conv-1", [
			{ ...at(0, 0), snapshot: { promptTokens: 25600, nonMessageTokens: 25588 } },
		]);

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.floorTokens).toBeGreaterThan(0);
		expect(turn?.packTokens).toBeLessThan(turn?.floorTokens ?? 0);
	});

	test("attributes the pack to the parts that contributed it", async () => {
		const store = new MemoryAccounting();
		await store.recordPack(
			"conv-1",
			at(0, 0),
			pack(
				{ role: "user", content: "older" },
				{ role: "assistant", content: "answered" },
				{ role: "user", content: "current" },
			),
			"thread-store",
		);

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.calls[0]?.parts.map((part) => part.source)).toEqual([
			"verbatim-tail",
			"current-turn",
		]);
	});

	test("marks locally counted attribution as approximate", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store");

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.calls[0]?.parts[0]?.approximate).toBe(true);
	});

	test("records where the verbatim tail came from", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "harness-fallback");

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.calls[0]?.tailSource).toBe("harness-fallback");
	});

	test("keeps a turn whose assembly failed, marked unassembled", async () => {
		const store = new MemoryAccounting();
		await store.recordUnassembled("conv-1", at(0, 0));
		await store.recordMeasurements("conv-1", [
			{ ...at(0, 0), snapshot: { promptTokens: 30000, nonMessageTokens: 25588 } },
		]);

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.calls[0]?.unassembled).toBe(true);
		expect(turn?.floorTokens).toBe(25588);
	});

	test("a measurement with no pack still records the call", async () => {
		const store = new MemoryAccounting();
		await store.recordMeasurements("conv-1", [
			{ ...at(0, 0), snapshot: { promptTokens: 30000, nonMessageTokens: 25588 } },
		]);

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.calls).toHaveLength(1);
		expect(turn?.packTokens).toBe(30000 - 25588);
	});

	test("keeps conversations apart", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store");
		await store.recordPack("conv-2", at(0, 0), pack(PROMPT), "thread-store");

		const turns = await store.readAccounting("conv-2");
		expect(turns).toHaveLength(1);
		expect(turns[0]?.conversationId).toBe("conv-2");
	});

	test("an unmeasured call is readable and reports no floor", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store");

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.floorTokens).toBeUndefined();
		expect(turn?.calls[0]?.approximateTokens).toBeGreaterThan(0);
	});
});
