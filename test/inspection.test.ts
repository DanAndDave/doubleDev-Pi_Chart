import { describe, expect, test } from "bun:test";

import {
	MemoryAccounting,
	recordPart,
	type TurnAccounting,
} from "../src/accounting.ts";
import {
	DEFAULT_RECALL_MAX_DISTANCE,
	DEFAULT_TAIL_TURNS,
	loadConfig,
	setBudget,
	type Config,
} from "../src/config.ts";
import { assemble } from "../src/assembler.ts";
import {
	comparePacks,
	inspectCall,
	inspectConversation,
	summarise,
} from "../src/inspection.ts";
import type { Turn } from "../src/messages.ts";
import { reconstructTurns } from "../src/turns.ts";
import { renderCall } from "../src/report.ts";
import type { RecalledTurn } from "../src/thread-store.ts";
import { budgets, settings, UNBOUNDED } from "./fixtures.ts";

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
	const pack = assemble({ turns: options.turns, recalled: options.recalled }, budgets({ tailTurns: options.tailTurns, recallTurns: options.recallTurns, docConcepts: 0, graphSymbols: 0 }));
	await store.recordPack("conv-1", address, pack, "thread-store", "off");
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

		expect(
			view.parts.filter((part) => part.carried > 0).map((part) => part.source),
		).toEqual(["recalled", "verbatim-tail", "current-turn"]);
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
		expect(part?.budget?.count).toBe(2);
		expect(part?.dropped).toBe(3);
	});

	test("a call recorded before the budget was one value still reads", () => {
		const view = inspectCall({
			turnIndex: 0,
			callIndex: 0,
			parts: [
				{
					source: "recalled",
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
		const part = view.parts.find((each) => each.source === "recalled");

		expect(part?.budget).toEqual({ count: 4, tokens: 8_000 });
		expect(part?.dropped).toBe(3);
	});

	test("a call recorded before sizes were kept has no size budget invented", () => {
		const view = inspectCall({
			turnIndex: 0,
			callIndex: 0,
			parts: [
				{
					source: "recalled",
					approximateTokens: 900,
					approximate: true,
					carried: 2,
					// Older still: a count, and no size at all.
					budget: 4,
					candidates: 5,
				},
			],
		});
		const part = view.parts.find((each) => each.source === "recalled");

		// Zero would read as a Budget the part overran, and `/pack` would
		// call every such part irreducible.
		expect(part?.budget).toEqual({ count: 4, tokens: undefined });
		expect(renderCall(view)).not.toContain("irreducible");
		expect(renderCall(view)).toContain("2 of 4");
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
		const pack = assemble({ turns: CONVERSATION, recalled: recalled(7) }, budgets({ tailTurns: 2, recallTurns: 2, docConcepts: 0, graphSymbols: 0 }));
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
		return settings({
			tailTurns: DEFAULT_TAIL_TURNS,
			recallTurns: 4,
			recallMaxDistance: 0.5,
			docConcepts: 0,
			docMaxDistance: 0.5,
			graphSymbols: 0,
			graphExtract: false,
			specsVerify: false,
			docBundle: "/unused",
		});
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

		expect(
			view.parts.find((part) => part.source === "recalled")?.carried,
		).toBe(0);
		expect(view.budgets).toEqual({ tail: 5, recall: 3, docs: 0, graph: 0 });
	});
});

describe("relevance against budget", () => {
	test("a part that found little is not reported as trimmed", async () => {
		const store = new MemoryAccounting();
		const pack = assemble({ turns: CONVERSATION, recalled: recalled(7), rejected: 4 }, budgets({ tailTurns: 2, recallTurns: 3, docConcepts: 0, graphSymbols: 0 }));
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store", "off");

		const part = inspectCall(
			(await store.readAccounting("conv-1"))[0]?.calls[0] ?? missing(),
		).parts.find((each) => each.source === "recalled");

		expect(part?.carried).toBe(1);
		expect(part?.trimmed).toBe(false);
		expect(part?.irrelevant).toBe(4);
	});

	test("a call where everything was rejected reports the part as refused", async () => {
		const store = new MemoryAccounting();
		const pack = assemble({ turns: CONVERSATION, recalled: [], rejected: 6 }, budgets({ tailTurns: 2, recallTurns: 3, docConcepts: 0, graphSymbols: 0 }));
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store", "off");

		const view = inspectCall(
			(await store.readAccounting("conv-1"))[0]?.calls[0] ?? missing(),
		);

		const recalled = view.parts.find((part) => part.source === "recalled");
		expect(recalled?.carried).toBe(0);
		// Refused, not missing: six candidates were measured and none was
		// near enough, which is not an empty Conversation.
		expect(recalled?.absent).toBe("irrelevant");
		expect(recalled?.irrelevant).toBe(6);
		expect(view.budgets).toEqual({ tail: 2, recall: 3, docs: 0, graph: 0 });
	});

	test("trimming still outranks irrelevance when both happened", async () => {
		const store = new MemoryAccounting();
		const pack = assemble({ turns: CONVERSATION, recalled: recalled(5, 6, 7, 8), rejected: 2 }, budgets({ tailTurns: 2, recallTurns: 2, docConcepts: 0, graphSymbols: 0 }));
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store", "off");

		const part = inspectCall(
			(await store.readAccounting("conv-1"))[0]?.calls[0] ?? missing(),
		).parts.find((each) => each.source === "recalled");

		expect(part?.trimmed).toBe(true);
		expect(part?.dropped).toBe(2);
		expect(part?.irrelevant).toBe(2);
	});
});

describe("configuration of the threshold", () => {
	test("an unset threshold falls back to the measured default", () => {
		expect(loadConfig({}).recallMaxDistance).toBe(DEFAULT_RECALL_MAX_DISTANCE);
	});

	test("a usable threshold is taken as given", () => {
		expect(loadConfig({ CM_RECALL_MAX_DISTANCE: "0.35" }).recallMaxDistance).toBe(
			0.35,
		);
	});

	test("an unusable threshold falls back rather than disabling recall", () => {
		for (const value of ["tight", "-1", "5", ""]) {
			expect(loadConfig({ CM_RECALL_MAX_DISTANCE: value }).recallMaxDistance).toBe(
				DEFAULT_RECALL_MAX_DISTANCE,
			);
		}
	});
});

describe("the curated part in accounting", () => {
	test("a call's parts are attributed separately, concepts included", () => {
		const pack = assemble({
				turns: reconstructTurns([
					{ role: "user", content: "prompt 1" },
					{ role: "assistant", content: "answer 1" },
					{ role: "user", content: "now" },
				]),
				concepts: [
					{
						conceptId: "decisions/caching",
						text: "We cache.",
						trust: "unverified",
						sectionIndex: 0,
						sectionCount: 1,
						stale: false,
						distance: 0,
					},
				],
			}, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 2, graphSymbols: 0 }));

		const view = inspectCall({
			turnIndex: 1,
			callIndex: 0,
			parts: pack.parts.map(recordPart),
		});

		const curated = view.parts.find((part) => part.source === "curated");
		const tail = view.parts.find((part) => part.source === "verbatim-tail");
		expect(curated?.carried).toBe(1);
		expect(curated?.conceptIds).toEqual(["decisions/caching"]);
		// Separately: each part is charged its own tokens, and together they
		// account for the pack.
		const total = view.parts.reduce(
			(sum, part) => sum + part.approximateTokens,
			0,
		);
		expect(total).toBe(pack.approximateTokens);
		expect(tail?.approximateTokens).toBeGreaterThan(0);
	});

	test("the report names the concepts a call carried", () => {
		const view = inspectCall({
			turnIndex: 1,
			callIndex: 0,
			parts: [
				recordPart({
					source: "curated",
					approximateTokens: 40,
					carried: 1,
					conceptIds: ["decisions/caching"],
					budget: { count: 2, tokens: UNBOUNDED },
					candidates: 1,
				}),
			],
		});

		expect(renderCall(view)).toContain("decisions/caching");
	});
});

describe("comparing packs that carried concepts", () => {
	const callWith = (conceptIds: string[]) =>
		inspectCall({
			turnIndex: 1,
			callIndex: 0,
			parts: [
				recordPart({
					source: "curated",
					approximateTokens: 40,
					carried: conceptIds.length,
					conceptIds,
					budget: { count: 2, tokens: UNBOUNDED },
				}),
			],
		});

	test("a concept that entered and one that left are both visible", () => {
		const diff = comparePacks(
			callWith(["decisions/caching"]),
			callWith(["decisions/sharding"]),
		);

		expect(diff.entered.map((item) => item.conceptId)).toEqual([
			"decisions/sharding",
		]);
		expect(diff.left.map((item) => item.conceptId)).toEqual([
			"decisions/caching",
		]);
	});

	test("a concept carried by both calls is unchanged", () => {
		const diff = comparePacks(
			callWith(["decisions/caching"]),
			callWith(["decisions/caching"]),
		);

		expect(diff.entered).toEqual([]);
		expect(diff.unchanged.map((item) => item.conceptId)).toEqual([
			"decisions/caching",
		]);
	});
});

describe("the doc budget in accounting", () => {
	test("is recorded even when nothing relevant was found", () => {
		const pack = assemble({
				turns: reconstructTurns([{ role: "user", content: "now" }]),
				concepts: [],
			}, budgets({ tailTurns: 2, recallTurns: 0, docConcepts: 3, graphSymbols: 0 }));

		// The part is accounted for whether or not it carried anything: a
		// Call that found nothing must not read like one where the Store
		// was switched off, and the cause is what tells them apart.
		const curated = pack.parts.find((part) => part.source === "curated");
		expect(curated?.carried).toBe(0);
		expect(curated?.absent).toBe("none");
		expect(pack.budgets.docs).toBe(3);
	});
});

describe("the structure part in accounting", () => {
	test("is attributed separately and names the symbols it carried", () => {
		const view = inspectCall({
			turnIndex: 1,
			callIndex: 0,
			parts: [
				recordPart({
					source: "structure",
					approximateTokens: 63,
					carried: 1,
					symbols: ["assemble()"],
					budget: { count: 3, tokens: UNBOUNDED },
					candidates: 2,
				}),
				recordPart({
					source: "verbatim-tail",
					approximateTokens: 120,
					carried: 2,
					turnIndices: [1, 2],
				}),
			],
		});

		const structure = view.parts.find((part) => part.source === "structure");
		expect(structure?.symbols).toEqual(["assemble()"]);
		expect(renderCall(view)).toContain("symbols assemble()");
		// Two candidates, one carried, a Budget of three: supply ran out,
		// the Budget did not bind, and the inspector must not claim it did.
		expect(structure?.trimmed).toBe(false);
		expect(structure?.dropped).toBe(1);
	});

	test("a structure part the budget bound is reported as trimmed", () => {
		const view = inspectCall({
			turnIndex: 1,
			callIndex: 0,
			parts: [
				recordPart({
					source: "structure",
					approximateTokens: 200,
					carried: 2,
					symbols: ["a()", "b()"],
					budget: { count: 2, tokens: UNBOUNDED },
					candidates: 4,
				}),
			],
		});

		const structure = view.parts.find((part) => part.source === "structure");
		expect(structure?.trimmed).toBe(true);
		expect(structure?.dropped).toBe(2);
	});

	test("a symbol that entered or left is visible in a diff", () => {
		const callWith = (symbols: string[]) =>
			inspectCall({
				turnIndex: 1,
				callIndex: 0,
				parts: [
					recordPart({
						source: "structure",
						approximateTokens: 63,
						carried: symbols.length,
						symbols,
					}),
				],
			});

		const diff = comparePacks(callWith(["assemble()"]), callWith(["recall()"]));

		expect(diff.entered.map((item) => item.symbol)).toEqual(["recall()"]);
		expect(diff.left.map((item) => item.symbol)).toEqual(["assemble()"]);
	});
});

describe("degradation in the inspector", () => {
	test("a tail served by the harness rather than the store is visible", () => {
		const view = inspectCall({
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
			tailSource: "harness-fallback",
		});

		// A session spent running without the store must be visible
		// afterwards rather than mysterious.
		expect(view.tailSource).toBe("harness-fallback");
		expect(renderCall(view)).toContain("not the store");
	});

	test("a tail served by the store is not remarked upon", () => {
		const view = inspectCall({
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
			tailSource: "thread-store",
		});

		expect(renderCall(view)).not.toContain("not the store");
	});
});
