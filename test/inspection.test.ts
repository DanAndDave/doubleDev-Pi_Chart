import { describe, expect, test } from "bun:test";

import {
	MemoryAccounting,
	recordPart,
	type TailSource,
	type TurnAccounting,
} from "../src/accounting.ts";
import {
	assemblerConfig,
	DEFAULT_RECALL_MAX_DISTANCE,
	DEFAULT_TAIL_TURNS,
	loadConfig,
	setBudget,
	type Config,
} from "../src/config.ts";
import { assemble, systemAdditions } from "../src/assembler.ts";
import {
	comparePacks,
	inspectCall,
	inspectConversation,
	summarise,
} from "../src/inspection.ts";
import type { Turn } from "../src/messages.ts";
import { renderCall, renderDiff } from "../src/report.ts";
import { budgets, settings } from "./fixtures.ts";

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

/** Records one Call and reads it back the way an inspector would. */
async function record(options: {
	turns: Turn[];
	tailTurns: number;
	measured?: { promptTokens: number; nonMessageTokens: number };
	callIndex?: number;
}): Promise<TurnAccounting[]> {
	const store = new MemoryAccounting();
	const address = { turnIndex: 0, callIndex: options.callIndex ?? 0 };
	const pack = assemble({ turns: options.turns }, budgets({ tailTurns: options.tailTurns }));
	await store.recordPack("conv-1", address, pack, "thread-store", "off");
	if (options.measured) {
		await store.recordMeasurements("conv-1", [
			{ ...address, snapshot: options.measured },
		]);
	}
	return store.readAccounting("conv-1");
}

const CONVERSATION = [turn("older", 1), turn("recent", 2), turn("current")];
const LONGER = [turn("a", 1), turn("b", 2), turn("c", 3), turn("d", 4), turn("current")];

describe("inspecting one call", () => {
	test("itemises the pack by part", async () => {
		const turns = await record({ turns: CONVERSATION, tailTurns: 2 });

		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(
			view.parts.filter((part) => part.carried > 0).map((part) => part.source),
		).toEqual(["verbatim-tail", "current-turn"]);
	});

	test("names the turns the tail carried", async () => {
		const turns = await record({ turns: CONVERSATION, tailTurns: 2 });

		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(
			view.parts.find((part) => part.source === "verbatim-tail")?.turnIndices,
		).toEqual([1, 2]);
	});

	test("reports the floor's share of the window", async () => {
		const turns = await record({
			turns: CONVERSATION,
			tailTurns: 2,
			measured: { promptTokens: 30_000, nonMessageTokens: 24_000 },
		});

		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(view.floorTokens).toBe(24_000);
		expect(view.packTokens).toBe(6_000);
		expect(view.floorShare).toBeCloseTo(0.8, 5);
	});

	test("an unmeasured call invents no figures", async () => {
		const turns = await record({ turns: CONVERSATION, tailTurns: 2 });

		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(view.packTokens).toBeUndefined();
		expect(view.floorShare).toBeUndefined();
	});
});

describe("budget spend", () => {
	test("a tail its count bound says what it left out", async () => {
		const turns = await record({ turns: LONGER, tailTurns: 2 });

		const part = inspectCall(turns[0]?.calls[0] ?? missing()).parts.find(
			(each) => each.source === "verbatim-tail",
		);

		expect(part?.budget?.count).toBe(2);
		expect(part?.dropped).toBe(2);
		expect(part?.excluded).toEqual({ evicted: 2 });
	});

	test("a call recorded before the budget was one value still reads", () => {
		const view = inspectCall({
			turnIndex: 0,
			callIndex: 0,
			parts: [
				{
					source: "verbatim-tail",
					approximateTokens: 900,
					approximate: true,
					carried: 2,
					// The shape `token-budgets` wrote: a count and a size, as
					// two fields. Rows like it are history, and history is not
					// migrated.
					budget: 4,
					tokenBudget: 8_000,
					candidates: 5,
				},
			],
		});
		const part = view.parts.find((each) => each.source === "verbatim-tail");

		expect(part?.budget).toEqual({ count: 4, tokens: 8_000 });
		expect(part?.dropped).toBe(3);
	});

	test("a call recorded before sizes were kept has no size budget invented", () => {
		const view = inspectCall({
			turnIndex: 0,
			callIndex: 0,
			parts: [
				{
					source: "verbatim-tail",
					approximateTokens: 900,
					approximate: true,
					carried: 2,
					// Older still: a count, and no size at all.
					budget: 4,
					candidates: 5,
				},
			],
		});
		const part = view.parts.find((each) => each.source === "verbatim-tail");

		// Zero would read as a Budget the part overran, and `/pack` would
		// call every such part irreducible.
		expect(part?.budget).toEqual({ count: 4, tokens: undefined });
		expect(renderCall(view)).not.toContain("irreducible");
		expect(renderCall(view)).toContain("2 of 4");
	});

	test("a part under its budget is not reported as trimmed", async () => {
		const turns = await record({ turns: CONVERSATION, tailTurns: 4 });

		const part = inspectCall(turns[0]?.calls[0] ?? missing()).parts.find(
			(each) => each.source === "verbatim-tail",
		);

		expect(part?.trimmed).toBe(false);
		expect(part?.dropped).toBe(0);
	});
});

describe("comparing packs", () => {
	test("names what entered and what left", async () => {
		const before = inspectCall(
			(await record({ turns: LONGER.slice(0, 4), tailTurns: 2 }))[0]?.calls[0] ?? missing(),
		);
		const after = inspectCall(
			(await record({ turns: LONGER, tailTurns: 2 }))[0]?.calls[0] ?? missing(),
		);

		const diff = comparePacks(before, after);

		// Turn 4 was in progress, then finished into the tail beside Turn 3.
		expect(diff.entered).toContainEqual({ source: "verbatim-tail", turnIndex: 4 });
		expect(diff.left).toContainEqual({ source: "current-turn", turnIndex: 4 });
		expect(diff.unchanged).toContainEqual({ source: "verbatim-tail", turnIndex: 3 });
	});

	test("a pack compared with itself has no difference", async () => {
		const view = inspectCall(
			(await record({ turns: CONVERSATION, tailTurns: 2 }))[0]?.calls[0] ?? missing(),
		);

		const diff = comparePacks(view, view);

		expect(diff.entered).toEqual([]);
		expect(diff.left).toEqual([]);
	});
});

describe("summarising a conversation", () => {
	test("reports the floor's share across measured calls", async () => {
		const store = new MemoryAccounting();
		const pack = assemble({ turns: CONVERSATION }, budgets({ tailTurns: 2 }));
		for (const callIndex of [0, 1]) {
			const address = { turnIndex: callIndex, callIndex: 0 };
			await store.recordPack("conv-1", address, pack, "thread-store", "off");
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
		const turns = await record({ turns: LONGER, tailTurns: 1 });

		const summary = summarise("conv-1", turns);

		const tail = summary.budgetUse.find((each) => each.source === "verbatim-tail");
		expect(tail?.budget).toBe(1);
		expect(tail?.averageCarried).toBe(1);
		expect(tail?.timesTrimmed).toBe(1);
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
			tailTurns: 2,
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
		return settings({
			tailTurns: DEFAULT_TAIL_TURNS,
			recallMaxDistance: 0.5,
			graphExtract: false,
			specsVerify: false,
			docBundle: "/unused",
		});
	}

	test("a valid budget replaces the one in force", () => {
		const current = config();

		const result = setBudget(current, "tail", "2");

		expect(result).toEqual({ ok: true, budget: 2 });
		expect(current.tailTurns).toBe(2);
	});

	test("zero is a budget, not a rejection", () => {
		const current = config();

		expect(setBudget(current, "pins", "0").ok).toBe(true);
		expect(current.pinCount).toBe(0);
	});

	test("something that is not a count is refused and changes nothing", () => {
		const current = config();

		const result = setBudget(current, "tail", "lots");

		expect(result.ok).toBe(false);
		expect(current.tailTurns).toBe(DEFAULT_TAIL_TURNS);
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
	});

	test("the retired part budgets are refused, naming the keys that remain", () => {
		const current = config();
		const before = JSON.stringify(current);

		for (const name of ["recall", "docs", "graph"]) {
			const result = setBudget(current, name, "3");

			expect(result.ok).toBe(false);
			const reason = result.ok ? "" : result.reason;
			for (const key of ["tail", "tail-tokens", "opening-tokens", "pack", "pins", "pins-tokens"]) {
				expect(reason).toContain(key);
			}
		}
		expect(JSON.stringify(current)).toBe(before);
	});

	test("the token budgets and the ceiling are settable by name", () => {
		const current = config();

		expect(setBudget(current, "tail-tokens", "12000")).toEqual({
			ok: true,
			budget: 12_000,
		});
		expect(setBudget(current, "pack", "90000")).toEqual({
			ok: true,
			budget: 90_000,
		});

		expect(current.tailTokens).toBe(12_000);
		expect(current.packTokens).toBe(90_000);
		// The counts are a separate dimension and are left alone.
		expect(current.tailTurns).toBe(DEFAULT_TAIL_TURNS);
	});

	test("the pin budget is settable by name, in count and in tokens", () => {
		const current = config();

		expect(setBudget(current, "pins", "3")).toEqual({ ok: true, budget: 3 });
		expect(setBudget(current, "pins-tokens", "500")).toEqual({
			ok: true,
			budget: 500,
		});

		expect(current.pinCount).toBe(3);
		expect(current.pinTokens).toBe(500);
	});

	test("the opening budget is settable by name, and zero turns it off", () => {
		const current = config();

		expect(setBudget(current, "opening-tokens", "400")).toEqual({ ok: true, budget: 400 });
		expect(current.openingTokens).toBe(400);

		expect(setBudget(current, "opening-tokens", "0")).toEqual({ ok: true, budget: 0 });
		expect(assemblerConfig(current).opening).toEqual({ count: 0, tokens: 0 });
	});

	test("an unusable token budget is refused with a reason and changes nothing", () => {
		const current = config();
		const before = current.packTokens;

		const result = setBudget(current, "pack", "plenty");

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toContain("not a count");
		expect(current.packTokens).toBe(before);
	});
});

describe("parts whose turns have no recorded position", () => {
	test("a tail is reported by what it carried, not by what it can name", async () => {
		// Early in a Conversation the tail comes from the harness's own
		// history, where Turns have no durable position yet.
		const anonymous = [turn("older"), turn("recent"), turn("current")];
		const turns = await record({ turns: anonymous, tailTurns: 4 });

		const part = inspectCall(turns[0]?.calls[0] ?? missing()).parts.find(
			(each) => each.source === "verbatim-tail",
		);

		expect(part?.carried).toBe(2);
		expect(part?.turnIndices).toEqual([]);
	});

	test("a summary counts what was carried, not what was named", async () => {
		const anonymous = [turn("older"), turn("recent"), turn("current")];
		const turns = await record({ turns: anonymous, tailTurns: 4 });

		const summary = summarise("conv-1", turns);

		expect(
			summary.budgetUse.find((each) => each.source === "verbatim-tail")
				?.averageCarried,
		).toBe(2);
	});

	test("the budgets in force are recorded even when a part carried nothing", async () => {
		const turns = await record({ turns: [turn("current")], tailTurns: 5 });

		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(
			view.parts.find((part) => part.source === "verbatim-tail")?.carried,
		).toBe(0);
		expect(view.budgets).toEqual({ tail: 5, opening: 0, pins: 8 });
	});
});

describe("configuration of the threshold", () => {
	test("an unset threshold falls back to the measured default", () => {
		expect(loadConfig({}).recallMaxDistance).toBe(DEFAULT_RECALL_MAX_DISTANCE);
	});

	test("a usable threshold is taken as given", () => {
		expect(loadConfig({ PICHART_RECALL_MAX_DISTANCE: "0.35" }).recallMaxDistance).toBe(
			0.35,
		);
	});

	test("an unusable threshold falls back rather than disabling recall", () => {
		for (const value of ["tight", "-1", "5", ""]) {
			expect(loadConfig({ PICHART_RECALL_MAX_DISTANCE: value }).recallMaxDistance).toBe(
				DEFAULT_RECALL_MAX_DISTANCE,
			);
		}
	});
});

describe("the system prompt in the inspector", () => {
	/** One Call whose Turn started with a Pin and the Opening in its system prompt. */
	async function recorded() {
		const config = budgets({ tailTurns: 2, openingTokens: 400 });
		const system = systemAdditions(
			{ pins: [{ id: 1, text: "use tabs" }], opening: "build it", recallAvailable: true },
			config,
		);
		const store = new MemoryAccounting();
		await store.recordPack(
			"conv-1",
			{ turnIndex: 0, callIndex: 0 },
			assemble({ turns: CONVERSATION, system }, config),
			"harness",
			"off",
		);
		return inspectCall((await store.readAccounting("conv-1"))[0]?.calls[0] ?? missing());
	}

	test("the pins and the opening are shown as sent in the system prompt", async () => {
		const text = renderCall(await recorded());
		const lineOf = (source: string) =>
			text.split("\n").find((line) => line.trimStart().startsWith(source));

		expect(lineOf("pinned")).toContain("in the system prompt");
		expect(lineOf("opening")).toContain("in the system prompt");
		expect(lineOf("opening")).toContain("turns 0");
		expect(lineOf("verbatim-tail")).not.toContain("system prompt");
	});

	test("a tail wholly from the harness's live history adds no line", async () => {
		expect(renderCall(await recorded())).not.toMatch(/^ {2}tail /m);
	});
});

describe("comparing packs as the opening enters", () => {
	test("the opening entering between two calls is named as Turn 0 from the opening", () => {
		const callWith = (opened: boolean) =>
			inspectCall({
				turnIndex: 6,
				callIndex: 0,
				parts: [
					recordPart({
						source: "opening",
						placement: "system-prompt",
						approximateTokens: opened ? 30 : 0,
						carried: opened ? 1 : 0,
						turnIndices: opened ? [0] : [],
						budget: { count: 1, tokens: 1_000 },
						absent: opened ? undefined : "unhooked",
					}),
				],
			});

		const diff = comparePacks(callWith(false), callWith(true));

		expect(diff.entered).toEqual([{ source: "opening", turnIndex: 0 }]);
		expect(diff.left).toEqual([]);
	});
});

describe("degradation in the inspector", () => {
	const tailFrom = (tailSource: TailSource) =>
		inspectCall({
			turnIndex: 1,
			callIndex: 0,
			parts: [
				recordPart({
					source: "verbatim-tail",
					approximateTokens: 100,
					carried: 2,
					turnIndices: [1, 2],
				}),
			],
			tailSource,
		});

	test("a tail served by the harness rather than the store is visible", () => {
		const view = tailFrom("harness-fallback");

		// A session spent running without the store must be visible
		// afterwards rather than mysterious.
		expect(view.tailSource).toBe("harness-fallback");
		expect(renderCall(view)).toContain("not the store");
	});

	test("a tail holding the store's copies says so", () => {
		expect(renderCall(tailFrom("thread-store"))).toContain(
			"some tail Turns are the store's copies",
		);
	});

	test("a tail from the harness's live history is not remarked upon", () => {
		const text = renderCall(tailFrom("harness"));

		expect(text).not.toContain("not the store");
		expect(text).not.toContain("store's copies");
	});
});

describe("pins in the record", () => {
	/** One assembled Call carrying `pins`, read back as an inspector reads it. */
	async function callWith(
		pins: { id: number; text: string }[],
		callIndex = 0,
		pinBudget = { pinCount: 8, pinTokens: 2_000 },
	) {
		const store = new MemoryAccounting();
		const config = budgets({ tailTurns: 2, ...pinBudget });
		const system = systemAdditions({ pins, recallAvailable: true }, config);
		const pack = assemble({ turns: CONVERSATION, system }, config);
		await store.recordPack(
			"conv-1",
			{ turnIndex: 0, callIndex },
			pack,
			"thread-store",
			"off",
		);
		const [recorded] = (await store.readAccounting("conv-1"))[0]?.calls ?? [];
		return { recorded: recorded ?? missing(), view: inspectCall(recorded ?? missing()) };
	}

	test("a call's pins are itemised by id against their budget, without their text", async () => {
		const { recorded, view } = await callWith([
			{ id: 1, text: "use tabs" },
			{ id: 3, text: "never push to main" },
		]);
		const pinned = view.parts.find((part) => part.source === "pinned");

		expect(pinned?.pinIds).toEqual([1, 3]);
		expect(renderCall(view)).toMatch(
			/pinned +~\d+ tokens in the system prompt \(2 of 8\) pins #1, #3/,
		);
		expect(JSON.stringify(recorded)).not.toContain("never push to main");
	});

	test("pins over a lowered budget are reported as exceeding it", async () => {
		const { view } = await callWith(
			[{ id: 1, text: "use tabs" }],
			0,
			{ pinCount: 8, pinTokens: 5 },
		);

		expect(renderCall(view)).toContain("over its 5-token budget, irreducible");
	});

	test("a pin added between calls enters, and one removed leaves, by id", async () => {
		const before = (await callWith([{ id: 1, text: "a" }, { id: 2, text: "b" }])).view;
		const after = (await callWith([{ id: 2, text: "b" }, { id: 3, text: "c" }], 1)).view;

		const diff = comparePacks(before, after);

		expect(diff.entered.filter((item) => item.source === "pinned")).toEqual([
			{ source: "pinned", pinId: 3 },
		]);
		expect(diff.left.filter((item) => item.source === "pinned")).toEqual([
			{ source: "pinned", pinId: 1 },
		]);
		expect(renderDiff(diff)).toContain("+ pinned #3");
		expect(renderDiff(diff)).toContain("- pinned #1");
	});

	test("a call recorded before pins existed reads with none, and later pins enter", async () => {
		const old = inspectCall({
			turnIndex: 0,
			callIndex: 0,
			parts: [
				{
					source: "verbatim-tail",
					approximateTokens: 40,
					approximate: true,
					carried: 1,
					turnIndices: [1],
				},
			],
		});
		const later = (await callWith([{ id: 1, text: "a" }], 1)).view;

		expect(old.parts.some((part) => part.source === "pinned")).toBe(false);
		expect(renderCall(old)).not.toContain("pinned");
		expect(comparePacks(old, later).entered).toContainEqual({
			source: "pinned",
			pinId: 1,
		});
	});

	test("a conversation holding no pins says nothing about them", async () => {
		const { view } = await callWith([]);

		expect(renderCall(view)).not.toContain("pinned");
	});

	test("a conversation summary reports the pins' typical spend against their budget", async () => {
		const first = (await callWith([{ id: 1, text: "a" }])).recorded;
		const second = (await callWith([{ id: 1, text: "a" }, { id: 2, text: "b" }], 1)).recorded;

		const summary = summarise("conv-1", [
			{ conversationId: "conv-1", turnIndex: 0, calls: [first, second] },
		]);
		const pinned = summary.budgetUse.find((each) => each.source === "pinned");

		expect(pinned?.averageCarried).toBe(1.5);
		expect(pinned?.budget).toBe(8);
	});
});
