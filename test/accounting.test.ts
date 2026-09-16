import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Accounting } from "../src/accounting.ts";
import { assemble } from "../src/assembler.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { reconstructTurns } from "../src/turns.ts";

async function accounting(): Promise<Accounting> {
	return new Accounting(await mkdtemp(join(tmpdir(), "cm-acct-")));
}

function pack(...messages: HarnessMessage[]) {
	return assemble(reconstructTurns(messages), { tailTurns: 4 });
}

const PROMPT: HarnessMessage = { role: "user", content: "hello" };

describe("Accounting", () => {
	test("reads back turns in turn order", async () => {
		const log = await accounting();

		await log.recordPack("conv-1", { turnIndex: 1, callIndex: 1 }, pack(PROMPT));
		await log.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack(PROMPT));

		const turns = await log.read("conv-1");
		expect(turns.map((turn) => turn.turnIndex)).toEqual([0, 1]);
	});

	test("groups every call of a tool-using turn under that turn", async () => {
		const log = await accounting();

		await log.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack(PROMPT));
		await log.recordPack("conv-1", { turnIndex: 0, callIndex: 1 }, pack(PROMPT));
		await log.recordPack("conv-1", { turnIndex: 1, callIndex: 2 }, pack(PROMPT));

		const turns = await log.read("conv-1");
		expect(turns.map((turn) => turn.calls.length)).toEqual([2, 1]);
		expect(turns[0]?.calls.map((call) => call.callIndex)).toEqual([0, 1]);
	});

	test("separates the pack from the floor once the harness reports them", async () => {
		const log = await accounting();
		await log.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack(PROMPT));

		await log.recordMeasurements("conv-1", [
			{
				turnIndex: 0,
				callIndex: 0,
				snapshot: { promptTokens: 29352, nonMessageTokens: 25588 },
			},
		]);

		const [turn] = await log.read("conv-1");
		expect(turn?.floorTokens).toBe(25588);
		expect(turn?.packTokens).toBe(29352 - 25588);
	});

	test("a turn's pack size is the widest window it reached", async () => {
		const log = await accounting();
		await log.recordMeasurements("conv-1", [
			{
				turnIndex: 0,
				callIndex: 0,
				snapshot: { promptTokens: 26000, nonMessageTokens: 25588 },
			},
			{
				turnIndex: 0,
				callIndex: 1,
				snapshot: { promptTokens: 27000, nonMessageTokens: 25588 },
			},
		]);

		const [turn] = await log.read("conv-1");
		expect(turn?.packTokens).toBe(27000 - 25588);
	});

	test("a trivially small pack still reports its floor", async () => {
		const log = await accounting();
		await log.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack(PROMPT));
		await log.recordMeasurements("conv-1", [
			{
				turnIndex: 0,
				callIndex: 0,
				snapshot: { promptTokens: 25600, nonMessageTokens: 25588 },
			},
		]);

		const [turn] = await log.read("conv-1");
		expect(turn?.floorTokens).toBeGreaterThan(0);
		expect(turn?.packTokens).toBeLessThan(turn?.floorTokens ?? 0);
	});

	test("attributes the pack to the parts that contributed it", async () => {
		const log = await accounting();
		await log.recordPack(
			"conv-1",
			{ turnIndex: 0, callIndex: 0 },
			pack(
				{ role: "user", content: "older" },
				{ role: "assistant", content: "answered" },
				{ role: "user", content: "current" },
			),
		);

		const [turn] = await log.read("conv-1");
		expect(turn?.calls[0]?.parts.map((part) => part.source)).toEqual([
			"verbatim-tail",
			"current-turn",
		]);
	});

	test("marks locally counted attribution as approximate", async () => {
		const log = await accounting();
		await log.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack(PROMPT));

		const [turn] = await log.read("conv-1");
		expect(turn?.calls[0]?.parts[0]?.approximate).toBe(true);
	});

	test("keeps a turn whose assembly failed, marked unassembled", async () => {
		const log = await accounting();
		await log.recordUnassembled("conv-1", { turnIndex: 0, callIndex: 0 });
		await log.recordMeasurements("conv-1", [
			{
				turnIndex: 0,
				callIndex: 0,
				snapshot: { promptTokens: 30000, nonMessageTokens: 25588 },
			},
		]);

		const [turn] = await log.read("conv-1");
		expect(turn?.calls[0]?.unassembled).toBe(true);
		expect(turn?.floorTokens).toBe(25588);
	});

	test("a measurement with no pack still records the call", async () => {
		const log = await accounting();
		await log.recordMeasurements("conv-1", [
			{
				turnIndex: 0,
				callIndex: 0,
				snapshot: { promptTokens: 30000, nonMessageTokens: 25588 },
			},
		]);

		const [turn] = await log.read("conv-1");
		expect(turn?.calls).toHaveLength(1);
		expect(turn?.packTokens).toBe(30000 - 25588);
	});

	test("keeps conversations apart", async () => {
		const log = await accounting();
		await log.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack(PROMPT));
		await log.recordPack("conv-2", { turnIndex: 0, callIndex: 0 }, pack(PROMPT));

		const turns = await log.read("conv-2");
		expect(turns).toHaveLength(1);
		expect(turns[0]?.conversationId).toBe("conv-2");
	});

	test("an unmeasured call is readable and reports no floor", async () => {
		const log = await accounting();
		await log.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack(PROMPT));

		const [turn] = await log.read("conv-1");
		expect(turn?.floorTokens).toBeUndefined();
		expect(turn?.calls[0]?.approximateTokens).toBeGreaterThan(0);
	});
});
