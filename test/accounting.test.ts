import { describe, expect, test } from "bun:test";

import { MemoryAccounting, type CallAddress } from "../src/accounting.ts";
import { assemble } from "../src/assembler.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { reconstructTurns } from "../src/turns.ts";
import { budgets } from "./fixtures.ts";

function pack(...messages: HarnessMessage[]) {
	return assemble({ turns: reconstructTurns(messages) }, budgets({ tailTurns: 4, recallTurns: 0, docConcepts: 0, graphSymbols: 0 }));
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
		// The parts that contributed, not every part accounted for: a Call
		// records the absent ones too, with the cause.
		expect(
			turn?.calls[0]?.parts
				.filter((part) => part.absent === undefined)
				.map((part) => part.source),
		).toEqual(["verbatim-tail", "current-turn"]);
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

	test("records the estimate beside the size the harness reported", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store");

		await store.recordMeasurements("conv-1", [
			{ ...at(0, 0), snapshot: { promptTokens: 29352, nonMessageTokens: 25588 } },
		]);

		const [turn] = await store.readAccounting("conv-1");
		const call = turn?.calls[0];
		// Both figures, distinguishable: ours is the estimate the ceiling was
		// applied to, theirs is what the window actually cost.
		expect(call?.approximateTokens).toBeGreaterThan(0);
		expect(call?.packTokens).toBe(29352 - 25588);
		expect(call?.approximateTokens).not.toBe(call?.packTokens);
	});

	test("records why a part carried less, by reason", async () => {
		const store = new MemoryAccounting();
		const recalled = [1, 2, 3].map((index) => ({
			turnIndex: index,
			turn: {
				index,
				prompt: `prompt ${index}`,
				messages: [
					{ role: "user" as const, content: `prompt ${index}` },
					{
						role: "toolResult" as const,
						toolName: "read",
						toolCallId: `call-${index}`,
						content: "x".repeat(1600),
					},
				],
			},
		}));

		await store.recordPack(
			"conv-1",
			at(0, 0),
			assemble(
				{ turns: reconstructTurns([PROMPT]), recalled, rejected: 5 },
				budgets({ recallTurns: 2, recallTokens: 500 }),
			),
			"thread-store",
		);

		const [turn] = await store.readAccounting("conv-1");
		const recall = turn?.calls[0]?.parts.find(
			(part) => part.source === "recalled",
		);
		// Three distinct facts, not one shortfall: five were never relevant
		// enough, the count refused the third candidate, and the size Budget
		// refused what was left.
		expect(recall?.excluded?.irrelevant).toBe(5);
		expect(recall?.excluded?.count).toBe(1);
		expect(recall?.excluded?.size).toBeGreaterThan(0);
	});

	test("records what the ceiling cost a part and the pack", async () => {
		const store = new MemoryAccounting();
		const bulky = {
			role: "toolResult" as const,
			toolName: "read",
			toolCallId: "call-1",
			content: "y".repeat(8000),
		};

		await store.recordPack(
			"conv-1",
			at(0, 0),
			assemble(
				{
					turns: [
						{ index: 0, prompt: "older", messages: [PROMPT, bulky] },
						{ index: 1, prompt: "current", messages: [PROMPT] },
					],
				},
				budgets({ tailTurns: 1, packTokens: 300 }),
			),
			"thread-store",
		);

		const [turn] = await store.readAccounting("conv-1");
		const call = turn?.calls[0];
		const tail = call?.parts.find((part) => part.source === "verbatim-tail");

		expect(call?.ceiling).toBe(300);
		expect(call?.beforeCeiling).toBeGreaterThan(300);
		expect(call?.approximateTokens).toBeLessThanOrEqual(300);
		expect(tail?.withoutCeiling).toBeGreaterThan(tail?.approximateTokens ?? 0);
		expect(tail?.shortened).toBe(true);
	});

	test("a record written before these reasons existed still reads", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store");

		const [turn] = await store.readAccounting("conv-1");
		const part = turn?.calls[0]?.parts[0];
		// Nothing was excluded, so the detail is absent rather than zeroed —
		// which is also how a row from an earlier version reads.
		expect(part?.excluded).toBeUndefined();
		expect(part?.withoutCeiling).toBeUndefined();
		expect(part?.shortened).toBeUndefined();
	});
});
