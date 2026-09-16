import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assemble } from "../src/assembler.ts";
import { AccountingLog } from "../src/accounting.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { reconstructTurns } from "../src/turns.ts";

async function log(): Promise<AccountingLog> {
	return new AccountingLog(await mkdtemp(join(tmpdir(), "cm-acct-")));
}

function pack(prompt: string) {
	const messages: HarnessMessage[] = [{ role: "user", content: prompt }];
	return assemble(reconstructTurns(messages), { tailTurns: 4 });
}

describe("AccountingLog", () => {
	test("reads back one record per call, in call order", async () => {
		const accounting = await log();

		await accounting.recordPack("conv-1", 0, pack("first"));
		await accounting.recordPack("conv-1", 1, pack("second"));

		const records = await accounting.read("conv-1");
		expect(records.map((record) => record.callIndex)).toEqual([0, 1]);
	});

	test("separates the pack from the floor once the harness reports them", async () => {
		const accounting = await log();
		await accounting.recordPack("conv-1", 0, pack("hello"));

		await accounting.recordMeasurements("conv-1", [
			{ promptTokens: 29352, nonMessageTokens: 25588 },
		]);

		const [record] = await accounting.read("conv-1");
		expect(record?.floorTokens).toBe(25588);
		expect(record?.packTokens).toBe(29352 - 25588);
	});

	test("a trivially small pack still reports its floor", async () => {
		const accounting = await log();
		await accounting.recordPack("conv-1", 0, pack("hi"));
		await accounting.recordMeasurements("conv-1", [
			{ promptTokens: 25600, nonMessageTokens: 25588 },
		]);

		const [record] = await accounting.read("conv-1");
		expect(record?.floorTokens).toBeGreaterThan(0);
		expect(record?.packTokens).toBeLessThan(record?.floorTokens ?? 0);
	});

	test("attributes the pack to the parts that contributed it", async () => {
		const accounting = await log();
		const messages: HarnessMessage[] = [
			{ role: "user", content: "older" },
			{ role: "assistant", content: "answered" },
			{ role: "user", content: "current" },
		];
		await accounting.recordPack(
			"conv-1",
			0,
			assemble(reconstructTurns(messages), { tailTurns: 4 }),
		);

		const [record] = await accounting.read("conv-1");
		expect(record?.parts.map((part) => part.source)).toEqual([
			"verbatim-tail",
			"current-turn",
		]);
	});

	test("marks locally counted attribution as approximate", async () => {
		const accounting = await log();
		await accounting.recordPack("conv-1", 0, pack("hello"));

		const [record] = await accounting.read("conv-1");
		expect(record?.parts[0]?.approximate).toBe(true);
	});

	test("keeps conversations apart", async () => {
		const accounting = await log();
		await accounting.recordPack("conv-1", 0, pack("mine"));
		await accounting.recordPack("conv-2", 0, pack("theirs"));

		const records = await accounting.read("conv-2");
		expect(records).toHaveLength(1);
		expect(records[0]?.conversationId).toBe("conv-2");
	});

	test("an unmeasured call is readable and reports no floor", async () => {
		const accounting = await log();
		await accounting.recordPack("conv-1", 0, pack("pending"));

		const [record] = await accounting.read("conv-1");
		expect(record?.floorTokens).toBeUndefined();
		expect(record?.approximateTokens).toBeGreaterThan(0);
	});
});
