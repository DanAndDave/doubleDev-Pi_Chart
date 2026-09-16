import { describe, expect, test } from "bun:test";

import { MemoryAccounting, type TurnAccounting } from "../src/accounting.ts";
import { DEFAULT_TAIL_TURNS, setBudget, type Config } from "../src/config.ts";
import { assemble } from "../src/assembler.ts";
import {
	comparePacks,
	inspectCall,
	inspectConversation,
	summarise,
} from "../src/inspection.ts";
import type { Turn } from "../src/messages.ts";
import type { RecalledTurn } from "../src/thread-store.ts";

function turn(prompt: string, index?: number): Turn {
	return {
		index,
		prompt,
		messages: [
			{ role: "user", content: prompt },
			{ role: "assistant", content: `answer to ${prompt}` },
		],
	};
}

function recalled(...indices: number[]): RecalledTurn[] {
	return indices.map((turnIndex) => ({
		turnIndex,
		turn: turn(`older ${turnIndex}`, turnIndex),
	}));
}

/** Records one Call and reads it back the way an inspector would. */
async function record(options: {
	turns: Turn[];
	recalled?: RecalledTurn[];
	tailTurns: number;
	recallTurns: number;
	measured?: { promptTokens: number; nonMessageTokens: number };
	callIndex?: number;
}): Promise<TurnAccounting[]> {
	const store = new MemoryAccounting();
	const address = { turnIndex: 0, callIndex: options.callIndex ?? 0 };
	const pack = assemble(
		{ turns: options.turns, recalled: options.recalled },
		{ tailTurns: options.tailTurns, recallTurns: options.recallTurns },
	);
	await store.recordPack("conv-1", address, pack, "thread-store");
	if (options.measured) {
		await store.recordMeasurements("conv-1", [
			{ ...address, snapshot: options.measured },
		]);
	}
	return store.readAccounting("conv-1");
}

const CONVERSATION = [turn("older", 1), turn("recent", 2), turn("current")];

describe("inspecting one call", () => {
	test("itemises the pack by part", async () => {
		const turns = await record({
			turns: CONVERSATION,
			recalled: recalled(7),
			tailTurns: 2,
			recallTurns: 2,
		});

		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(view.parts.map((part) => part.source)).toEqual([
			"recalled",
			"verbatim-tail",
			"current-turn",
		]);
	});

	test("names the turns a recalled part carried", async () => {
		const turns = await record({
			turns: CONVERSATION,
			recalled: recalled(7, 9),
			tailTurns: 2,
			recallTurns: 2,
		});

		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(
			view.parts.find((part) => part.source === "recalled")?.turnIndices,
		).toEqual([7, 9]);
	});

	test("reports the floor's share of the window", async () => {
		const turns = await record({
			turns: CONVERSATION,
			tailTurns: 2,
			recallTurns: 0,
			measured: { promptTokens: 30_000, nonMessageTokens: 24_000 },
		});

		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(view.floorTokens).toBe(24_000);
		expect(view.packTokens).toBe(6_000);
		expect(view.floorShare).toBeCloseTo(0.8, 5);
	});

	test("an unmeasured call invents no figures", async () => {
		const turns = await record({
			turns: CONVERSATION,
			tailTurns: 2,
			recallTurns: 0,
		});

		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(view.packTokens).toBeUndefined();
		expect(view.floorShare).toBeUndefined();
	});
});

describe("budget spend", () => {
	test("a part trimmed by its budget says how many were dropped", async () => {
		const turns = await record({
			turns: CONVERSATION,
			recalled: recalled(5, 6, 7, 8, 9),
			tailTurns: 2,
			recallTurns: 2,
		});

		const part = inspectCall(turns[0]?.calls[0] ?? missing()).parts.find(
			(each) => each.source === "recalled",
		);

		expect(part?.trimmed).toBe(true);
		expect(part?.budget).toBe(2);
		expect(part?.dropped).toBe(3);
	});

	test("a part under its budget is not reported as trimmed", async () => {
		const turns = await record({
			turns: CONVERSATION,
			recalled: recalled(7),
			tailTurns: 2,
			recallTurns: 4,
		});

		const part = inspectCall(turns[0]?.calls[0] ?? missing()).parts.find(
			(each) => each.source === "recalled",
		);

		expect(part?.trimmed).toBe(false);
		expect(part?.dropped).toBe(0);
	});
});

describe("comparing packs", () => {
	test("names what entered and what left", async () => {
		const before = inspectCall(
			(await record({
				turns: CONVERSATION,
				recalled: recalled(7),
				tailTurns: 2,
				recallTurns: 1,
			}))[0]?.calls[0] ?? missing(),
		);
		const after = inspectCall(
			(await record({
				turns: CONVERSATION,
				recalled: recalled(9),
				tailTurns: 2,
				recallTurns: 1,
			}))[0]?.calls[0] ?? missing(),
		);

		const diff = comparePacks(before, after);

		expect(diff.entered.map((item) => item.turnIndex)).toContain(9);
		expect(diff.left.map((item) => item.turnIndex)).toContain(7);
		expect(diff.unchanged.map((item) => item.turnIndex)).toContain(1);
	});

	test("a pack compared with itself has no difference", async () => {
		const view = inspectCall(
			(await record({
				turns: CONVERSATION,
				recalled: recalled(7),
				tailTurns: 2,
				recallTurns: 2,
			}))[0]?.calls[0] ?? missing(),
		);

		const diff = comparePacks(view, view);

		expect(diff.entered).toEqual([]);
		expect(diff.left).toEqual([]);
	});
});

describe("summarising a conversation", () => {
	test("reports the floor's share across measured calls", async () => {
		const store = new MemoryAccounting();
		const pack = assemble(
			{ turns: CONVERSATION, recalled: recalled(7) },
			{ tailTurns: 2, recallTurns: 2 },
		);
		for (const callIndex of [0, 1]) {
			const address = { turnIndex: callIndex, callIndex: 0 };
			await store.recordPack("conv-1", address, pack, "thread-store");
			await store.recordMeasurements("conv-1", [
				{ ...address, snapshot: { promptTokens: 30_000, nonMessageTokens: 24_000 } },
			]);
		}

		const summary = summarise("conv-1", await store.readAccounting("conv-1"));

		expect(summary.measuredCalls).toBe(2);
		expect(summary.averageFloorShare).toBeCloseTo(0.8, 2);
		expect(summary.averageFloorTokens).toBe(24_000);
	});

	test("reports how much of each budget was spent", async () => {
		const turns = await record({
			turns: CONVERSATION,
			recalled: recalled(5, 6, 7),
			tailTurns: 2,
			recallTurns: 1,
		});

		const summary = summarise("conv-1", turns);

		const recall = summary.budgetUse.find((each) => each.source === "recalled");
		expect(recall?.budget).toBe(1);
		expect(recall?.averageCarried).toBe(1);
		expect(recall?.timesTrimmed).toBe(1);
	});

	test("a conversation with nothing recorded summarises to nothing", () => {
		const summary = summarise("conv-1", []);

		expect(summary.calls).toBe(0);
		expect(summary.averageFloorShare).toBeUndefined();
	});
});

describe("inspection is read-only", () => {
	test("inspecting leaves the accounting unchanged", async () => {
		const turns = await record({
			turns: CONVERSATION,
			recalled: recalled(7),
			tailTurns: 2,
			recallTurns: 2,
			measured: { promptTokens: 30_000, nonMessageTokens: 24_000 },
		});
		const before = JSON.stringify(turns);

		inspectConversation(turns);
		summarise("conv-1", turns);
		comparePacks(
			inspectCall(turns[0]?.calls[0] ?? missing()),
			inspectCall(turns[0]?.calls[0] ?? missing()),
		);

		expect(JSON.stringify(turns)).toBe(before);
	});
});

function missing(): never {
	throw new Error("expected a recorded call");
}

describe("changing a budget", () => {
	function config(): Config {
		return {
			tailTurns: DEFAULT_TAIL_TURNS,
			recallTurns: 4,
			recallMaxDistance: 0.5,
			docBundle: "/unused",
		};
	}

	test("a valid budget replaces the one in force", () => {
		const current = config();

		const result = setBudget(current, "recall", "2");

		expect(result).toEqual({ ok: true, budget: 2 });
		expect(current.recallTurns).toBe(2);
	});

	test("zero is a budget, not a rejection", () => {
		const current = config();

		expect(setBudget(current, "recall", "0").ok).toBe(true);
		expect(current.recallTurns).toBe(0);
	});

	test("something that is not a count is refused and changes nothing", () => {
		const current = config();

		const result = setBudget(current, "recall", "lots");

		expect(result.ok).toBe(false);
		expect(current.recallTurns).toBe(4);
	});

	test("a negative budget is refused", () => {
		const current = config();

		expect(setBudget(current, "tail", "-1").ok).toBe(false);
		expect(current.tailTurns).toBe(DEFAULT_TAIL_TURNS);
	});

	test("an unknown budget name is refused", () => {
		const current = config();

		const result = setBudget(current, "floor", "3");

		expect(result.ok).toBe(false);
		expect(current.tailTurns).toBe(DEFAULT_TAIL_TURNS);
		expect(current.recallTurns).toBe(4);
	});
});

describe("parts whose turns have no recorded position", () => {
	test("a tail is reported by what it carried, not by what it can name", async () => {
		// Early in a Conversation the tail comes from the harness's own
		// history, where Turns have no durable position yet.
		const anonymous = [turn("older"), turn("recent"), turn("current")];
		const turns = await record({
			turns: anonymous,
			tailTurns: 4,
			recallTurns: 0,
		});

		const part = inspectCall(turns[0]?.calls[0] ?? missing()).parts.find(
			(each) => each.source === "verbatim-tail",
		);

		expect(part?.carried).toBe(2);
		expect(part?.turnIndices).toEqual([]);
	});

	test("a summary counts what was carried, not what was named", async () => {
		const anonymous = [turn("older"), turn("recent"), turn("current")];
		const turns = await record({
			turns: anonymous,
			tailTurns: 4,
			recallTurns: 0,
		});

		const summary = summarise("conv-1", turns);

		expect(
			summary.budgetUse.find((each) => each.source === "verbatim-tail")
				?.averageCarried,
		).toBe(2);
	});

	test("the budgets in force are recorded even when a part carried nothing", async () => {
		const turns = await record({
			turns: [turn("current")],
			tailTurns: 5,
			recallTurns: 3,
		});

		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(view.parts.map((part) => part.source)).not.toContain("recalled");
		expect(view.budgets).toEqual({ tail: 5, recall: 3 });
	});
});

describe("relevance against budget", () => {
	test("a part that found little is not reported as trimmed", async () => {
		const store = new MemoryAccounting();
		const pack = assemble(
			{ turns: CONVERSATION, recalled: recalled(7), rejected: 4 },
			{ tailTurns: 2, recallTurns: 3 },
		);
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store");

		const part = inspectCall(
			(await store.readAccounting("conv-1"))[0]?.calls[0] ?? missing(),
		).parts.find((each) => each.source === "recalled");

		expect(part?.carried).toBe(1);
		expect(part?.trimmed).toBe(false);
		expect(part?.irrelevant).toBe(4);
	});

	test("a call where everything was rejected records the count with no recalled part", async () => {
		const store = new MemoryAccounting();
		const pack = assemble(
			{ turns: CONVERSATION, recalled: [], rejected: 6 },
			{ tailTurns: 2, recallTurns: 3 },
		);
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store");

		const view = inspectCall(
			(await store.readAccounting("conv-1"))[0]?.calls[0] ?? missing(),
		);

		expect(view.parts.map((part) => part.source)).not.toContain("recalled");
		expect(view.budgets).toEqual({ tail: 2, recall: 3 });
	});

	test("trimming still outranks irrelevance when both happened", async () => {
		const store = new MemoryAccounting();
		const pack = assemble(
			{ turns: CONVERSATION, recalled: recalled(5, 6, 7, 8), rejected: 2 },
			{ tailTurns: 2, recallTurns: 2 },
		);
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store");

		const part = inspectCall(
			(await store.readAccounting("conv-1"))[0]?.calls[0] ?? missing(),
		).parts.find((each) => each.source === "recalled");

		expect(part?.trimmed).toBe(true);
		expect(part?.dropped).toBe(2);
		expect(part?.irrelevant).toBe(2);
	});
});
