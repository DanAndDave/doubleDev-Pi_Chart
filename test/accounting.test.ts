import { describe, expect, test } from "bun:test";

import { MemoryAccounting, type CallAddress } from "../src/accounting.ts";
import { assemble, systemAdditions } from "../src/assembler.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { reconstructTurns } from "../src/turns.ts";
import { budgets } from "./fixtures.ts";

function pack(...messages: HarnessMessage[]) {
	return assemble({ turns: reconstructTurns(messages) }, budgets({ tailTurns: 4 }));
}

/** A Pack whose Turn started with two Pins and the Opening in its system prompt. */
function packWithSystem(...messages: HarnessMessage[]) {
	const config = budgets({ tailTurns: 4, openingTokens: 2000 });
	const system = systemAdditions(
		{
			pins: [
				{ id: 1, text: "answer in British English" },
				{ id: 2, text: "never touch the migrations" },
			],
			opening: "build the accounting report",
			recallAvailable: true,
		},
		config,
	);
	return assemble({ turns: reconstructTurns(messages), system }, config);
}

function at(turnIndex: number, callIndex: number): CallAddress {
	return { turnIndex, callIndex };
}

const PROMPT: HarnessMessage = { role: "user", content: "hello" };

describe("accounting", () => {
	test("reads back turns in turn order", async () => {
		const store = new MemoryAccounting();

		await store.recordPack("conv-1", at(1, 0), pack(PROMPT), "thread-store", "off");
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store", "off");

		const turns = await store.readAccounting("conv-1");
		expect(turns.map((turn) => turn.turnIndex)).toEqual([0, 1]);
	});

	test("groups every call of a tool-using turn under that turn", async () => {
		const store = new MemoryAccounting();

		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store", "off");
		await store.recordPack("conv-1", at(0, 1), pack(PROMPT), "thread-store", "off");
		await store.recordPack("conv-1", at(1, 0), pack(PROMPT), "thread-store", "off");

		const turns = await store.readAccounting("conv-1");
		expect(turns.map((turn) => turn.calls.length)).toEqual([2, 1]);
	});

	test("separates the pack from the floor once the harness reports them", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store", "off");

		await store.recordMeasurements("conv-1", [
			{ ...at(0, 0), snapshot: { promptTokens: 29352, nonMessageTokens: 25588 } },
		]);

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.floorTokens).toBe(25588);
		expect(turn?.packTokens).toBe(29352 - 25588);
	});

	test("pi-chart's system-prompt additions count toward the pack, not the floor", async () => {
		const store = new MemoryAccounting();
		const assembled = packWithSystem(PROMPT);
		expect(assembled.systemTokens).toBeGreaterThan(0);
		await store.recordPack("conv-1", at(0, 0), assembled, "harness", "off");

		await store.recordMeasurements("conv-1", [
			{ ...at(0, 0), snapshot: { promptTokens: 29352, nonMessageTokens: 25588 } },
		]);

		const [turn] = await store.readAccounting("conv-1");
		const call = turn?.calls[0];
		expect(call?.systemTokens).toBe(assembled.systemTokens);
		expect(call?.floorTokens).toBe(25588 - assembled.systemTokens);
		// The window is the window: what leaves the Floor joins the pack.
		expect((call?.floorTokens ?? 0) + (call?.packTokens ?? 0)).toBe(29352);
	});

	test("the floor never goes below zero", async () => {
		const store = new MemoryAccounting();
		const assembled = packWithSystem(PROMPT);
		await store.recordPack("conv-1", at(0, 0), assembled, "harness", "off");

		// A harness reporting less than pi-chart added: the estimate is
		// over, and a negative Floor would be an invented figure.
		await store.recordMeasurements("conv-1", [
			{ ...at(0, 0), snapshot: { promptTokens: 500, nonMessageTokens: 1 } },
		]);

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.calls[0]?.floorTokens).toBe(0);
		expect(turn?.calls[0]?.packTokens).toBe(500);
	});

	test("a call without additions keeps its whole non-message size as floor", async () => {
		const store = new MemoryAccounting();
		// No hook for the Turn: nothing was added to the system prompt.
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "harness", "off");
		await store.recordMeasurements("conv-1", [
			{ ...at(0, 0), snapshot: { promptTokens: 29352, nonMessageTokens: 25588 } },
		]);

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.calls[0]?.floorTokens).toBe(25588);
		expect(turn?.calls[0]?.packTokens).toBe(3764);
	});

	test("records the pins and the opening as placed in the system prompt", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), packWithSystem(PROMPT), "harness", "off");

		const [turn] = await store.readAccounting("conv-1");
		const parts = turn?.calls[0]?.parts ?? [];
		const pinned = parts.find((part) => part.source === "pinned");
		const opening = parts.find((part) => part.source === "opening");
		expect(pinned?.placement).toBe("system-prompt");
		expect(pinned?.pinIds).toEqual([1, 2]);
		expect(opening?.placement).toBe("system-prompt");
		expect(opening?.turnIndices).toEqual([0]);
		expect(
			parts.find((part) => part.source === "verbatim-tail")?.placement,
		).toBeUndefined();
	});

	test("a turn the hook never reached records its system-prompt parts as unhooked", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "harness", "off");

		const [turn] = await store.readAccounting("conv-1");
		const parts = turn?.calls[0]?.parts ?? [];
		expect(parts.find((part) => part.source === "pinned")?.absent).toBe("unhooked");
		expect(parts.find((part) => part.source === "opening")?.absent).toBe("unhooked");
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
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store", "off");
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
			"off",
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
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store", "off");

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.calls[0]?.parts[0]?.approximate).toBe(true);
	});

	test("records where the verbatim tail came from", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "harness-fallback", "off");
		await store.recordPack("conv-1", at(1, 0), pack(PROMPT), "harness", "off");

		const turns = await store.readAccounting("conv-1");
		expect(turns.map((turn) => turn.calls[0]?.tailSource)).toEqual([
			"harness-fallback",
			"harness",
		]);
	});

	test("keeps a turn whose assembly failed, marked unassembled", async () => {
		const store = new MemoryAccounting();
		await store.recordUnassembled("conv-1", at(0, 0), "off");
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
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store", "off");
		await store.recordPack("conv-2", at(0, 0), pack(PROMPT), "thread-store", "off");

		const turns = await store.readAccounting("conv-2");
		expect(turns).toHaveLength(1);
		expect(turns[0]?.conversationId).toBe("conv-2");
	});

	test("an unmeasured call is readable and reports no floor", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store", "off");

		const [turn] = await store.readAccounting("conv-1");
		expect(turn?.floorTokens).toBeUndefined();
		expect(turn?.calls[0]?.approximateTokens).toBeGreaterThan(0);
	});

	test("records the estimate beside the size the harness reported", async () => {
		const store = new MemoryAccounting();
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store", "off");

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
			"off",
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
		await store.recordPack("conv-1", at(0, 0), pack(PROMPT), "thread-store", "off");

		const [turn] = await store.readAccounting("conv-1");
		const part = turn?.calls[0]?.parts[0];
		// Nothing was excluded, so the detail is absent rather than zeroed —
		// which is also how a row from an earlier version reads.
		expect(part?.excluded).toBeUndefined();
		expect(part?.withoutCeiling).toBeUndefined();
		expect(part?.shortened).toBeUndefined();
	});
});
