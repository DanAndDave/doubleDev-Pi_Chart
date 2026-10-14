// What a Call did not carry, and why. Pure throughout: assembly records the
// ledger, accounting round-trips it, and the inspector answers from it — no
// container, no model, no harness.

import { describe, expect, test } from "bun:test";

import {
	MemoryAccounting,
	recordPart,
	type MemoryBackendState,
	type RecordedPart,
	type TurnAccounting,
} from "../src/accounting.ts";
import { assemble, systemAdditions } from "../src/assembler.ts";
import {
	explain,
	inspectCall,
	inspectConversation,
	parseAddress,
	resolveCall,
	summarise,
	type CallView,
} from "../src/inspection.ts";
import type { Turn } from "../src/messages.ts";
import {
	describeRecorded,
	renderCall,
	renderExplanation,
	renderSummary,
} from "../src/report.ts";
import { budgets } from "./fixtures.ts";

function turn(prompt: string, index?: number, body = `answer to ${prompt}`): Turn {
	return {
		index,
		prompt,
		messages: [
			{ role: "user", content: prompt },
			{ role: "assistant", content: body },
		],
	};
}

const CONVERSATION = [turn("older", 1), turn("recent", 2), turn("current", 3)];

/** One Call, recorded and read back the way the inspector reads it. */
async function viewOf(
	input: Parameters<typeof assemble>[0],
	config: Parameters<typeof assemble>[1],
): Promise<CallView> {
	const store = new MemoryAccounting();
	const address = { turnIndex: 0, callIndex: 0 };
	await store.recordPack("conv-1", address, assemble(input, config), "thread-store", "off");
	const [recordedTurn] = await store.readAccounting("conv-1");
	const call = recordedTurn?.calls[0];
	if (!call) throw new Error("nothing recorded");
	return inspectCall(call);
}

/** A Call whose Turn started with `pins` and `opening` in its system prompt. */
function withSystem(
	pins: { id: number; text: string }[],
	opening: string | undefined,
	config: Parameters<typeof assemble>[1],
): Promise<CallView> {
	const system = systemAdditions({ pins, opening, recallAvailable: true }, config);
	return viewOf({ turns: CONVERSATION, system }, config);
}

function partOf(view: CallView, source: string) {
	const part = view.parts.find((each) => each.source === source);
	if (!part) throw new Error(`no ${source} part`);
	return part;
}

describe("the excluded-candidate ledger", () => {
	test("an evicted turn reads back by position", async () => {
		const view = await viewOf({ turns: CONVERSATION }, budgets({ tailTurns: 1 }));

		expect(partOf(view, "verbatim-tail").excludedCandidates).toEqual([
			{ turnIndex: 1, reason: "evicted" },
		]);
	});

	test("a bound of zero names nothing and still counts everything", async () => {
		const view = await viewOf(
			{ turns: CONVERSATION },
			budgets({ tailTurns: 1, explainCandidates: 0 }),
		);

		const part = partOf(view, "verbatim-tail");
		expect(part.excludedCandidates).toEqual([]);
		// Named nothing, but the Call is still one that kept a ledger.
		expect(part.explained).toBe(true);
		expect(part.excluded?.evicted).toBe(1);
	});

	test("no excluded text is retained, for a turn, a pin or the opening", async () => {
		const store = new MemoryAccounting();
		const config = budgets({ tailTurns: 1, openingTokens: 3 });
		const system = systemAdditions(
			{
				pins: [{ id: 1, text: "SECRET pin wording" }],
				opening: "SECRET opening wording that will not fit",
				recallAvailable: true,
			},
			config,
		);
		const conversation = [turn("older", 1, "SECRET answer"), turn("recent", 2), turn("current", 3)];
		await store.recordPack(
			"conv-1",
			{ turnIndex: 0, callIndex: 0 },
			assemble({ turns: conversation, system }, config),
			"thread-store",
			"off",
		);

		const [recordedTurn] = await store.readAccounting("conv-1");
		const written = JSON.stringify(recordedTurn?.calls[0]?.parts);
		expect(written).toContain('"pinIds":[1]');
		expect(written).not.toContain("SECRET");
	});

	test("a call recorded before the ledger existed is unexplainable", () => {
		const view = inspectCall({
			turnIndex: 4,
			callIndex: 0,
			// As `recordPart` wrote it before the ledger: no ledger field.
			parts: [
				{
					source: "verbatim-tail",
					approximateTokens: 120,
					approximate: true,
					carried: 1,
					candidates: 4,
				},
			],
		});

		expect(view.explained).toBe(false);
		expect(partOf(view, "verbatim-tail").excludedCandidates).toEqual([]);
		expect(explain(view, "turn 9").unexplainable).toBe(true);
	});
});

describe("a part that contributed nothing", () => {
	test("each cause of an absent opening reads back distinctly", async () => {
		const on = budgets({ tailTurns: 1, openingTokens: 400 });
		const failed = systemAdditions(
			{ pins: [], unavailable: "failed", recallAvailable: true },
			on,
		);
		const views = [
			await viewOf({ turns: CONVERSATION }, on),
			await withSystem([], "", on),
			await withSystem([], undefined, on),
			await viewOf({ turns: CONVERSATION, system: failed }, on),
			await withSystem([], "a prompt too long for a three-token budget", budgets({ tailTurns: 1, openingTokens: 3 })),
			await withSystem([], "the request", budgets({ tailTurns: 1, openingTokens: 0 })),
		];

		expect(views.map((view) => partOf(view, "opening").absent)).toEqual([
			"unhooked",
			"empty",
			"missing",
			"failed",
			"size",
			"disabled",
		]);
		const lines = views.map((view) =>
			renderCall(view).split("\n").find((line) => line.trimStart().startsWith("opening")),
		);
		expect(new Set(lines).size).toBe(views.length);
	});

	test("pins the hook never reached are named, not hidden", async () => {
		const view = await viewOf({ turns: CONVERSATION }, budgets({ tailTurns: 1 }));

		expect(renderCall(view)).toContain("the harness never offered the system prompt");
	});
});

describe("addressing a call", () => {
	const recordedAt = (turnIndex: number, callIndex: number): CallView => ({
		turnIndex,
		callIndex,
		parts: [],
		unassembled: false,
		compacted: false,
		explained: true,
	});
	const conversation = [
		recordedAt(0, 0),
		recordedAt(1, 0),
		recordedAt(1, 1),
		recordedAt(2, 0),
	];

	test("an address names a turn and optionally a call within it", () => {
		expect(parseAddress("12")).toEqual({ turnIndex: 12, callIndex: undefined });
		expect(parseAddress("12.3")).toEqual({ turnIndex: 12, callIndex: 3 });
		expect(parseAddress("why")).toBeUndefined();
		expect(parseAddress("12.")).toBeUndefined();
	});

	test("a turn without a call resolves to its last recorded call", () => {
		expect(resolveCall(conversation, { turnIndex: 1 })?.callIndex).toBe(1);
	});

	test("an address that was never recorded resolves to nothing", () => {
		expect(resolveCall(conversation, { turnIndex: 1, callIndex: 7 })).toBeUndefined();
		expect(resolveCall(conversation, { turnIndex: 9 })).toBeUndefined();
		// And what is recorded can be named in the refusal.
		expect(describeRecorded(conversation)).toBe("turns 0 to 2, 4 calls");
	});
});

describe("explaining an absence", () => {
	test("an evicted turn is attributed to eviction", async () => {
		// Turn 2 carried a one-Turn tail past its count, and Turn 1 went.
		const view = await viewOf({ turns: CONVERSATION }, budgets({ tailTurns: 1 }));
		const text = renderExplanation(explain(view, "1"));

		expect(text).toContain("turn 1");
		expect(text).toContain("evicted from the tail");
		expect(text).not.toContain("budget");
	});

	test("a tail with a zero budget attributes the turn to its count", async () => {
		const view = await viewOf({ turns: CONVERSATION }, budgets({ tailTurns: 0 }));
		const text = renderExplanation(explain(view, "turn 2"));

		expect(text).toContain("excluded by the 0 count budget");
	});

	test("a turn the pack ceiling dropped is attributed to the ceiling", async () => {
		const bulky = (prompt: string, index: number) => turn(prompt, index, "z".repeat(400));
		const view = await viewOf(
			{ turns: [bulky("a", 1), bulky("b", 2), bulky("c", 3), turn("current", 4)] },
			budgets({ tailTurns: 8, packTokens: 200 }),
		);
		const text = renderExplanation(explain(view, "1"));

		expect(text).toContain("dropped for the pack ceiling");
	});

	test("an opening over its budget is explained with its size", async () => {
		const view = await withSystem(
			[],
			"a prompt too long for a three-token budget",
			budgets({ tailTurns: 1, openingTokens: 3 }),
		);
		const text = renderExplanation(explain(view, "turn 0"));

		expect(text).toMatch(/opening +turn 0 +~\d+ tokens +excluded by the 3 token budget/);
	});

	test("the opening and the pins the hook never reached say so by name", async () => {
		const view = await viewOf({ turns: CONVERSATION }, budgets({ tailTurns: 1, openingTokens: 400 }));

		for (const subject of ["opening", "pins", "#2"]) {
			const text = renderExplanation(explain(view, subject));
			expect(text).toContain("the harness never offered the system prompt");
			expect(text).not.toContain("nothing matching it was considered");
		}
	});

	test("a pin the call carried is named as carried", async () => {
		const view = await withSystem(
			[{ id: 2, text: "use tabs" }],
			undefined,
			budgets({ tailTurns: 1 }),
		);

		expect(renderExplanation(explain(view, "pin 2"))).toContain("carried by pinned: #2");
		expect(renderExplanation(explain(view, "#5"))).toContain(
			"nothing matching it was considered",
		);
	});

	test("a subject that was never a candidate says so", async () => {
		const view = await viewOf({ turns: CONVERSATION }, budgets({ tailTurns: 1 }));

		expect(renderExplanation(explain(view, "docs/never-written"))).toContain(
			"nothing matching it was considered",
		);
	});

	test("a turn the call carried is not reported as excluded", async () => {
		const view = await viewOf({ turns: CONVERSATION }, budgets({ tailTurns: 1 }));
		const text = renderExplanation(explain(view, "2"));

		expect(text).toContain("carried by verbatim-tail: turn 2");
		expect(text).not.toContain("nothing matching it was considered");
	});

	test("a call recorded with retrieval parts still explains", () => {
		// An earlier version's record: a recalled part whose ledger holds a
		// reason and fields this version no longer writes.
		const older = {
			source: "recalled",
			approximateTokens: 40,
			approximate: true,
			carried: 1,
			turnIndices: [7],
			excludedCandidates: [{ turnIndex: 4, reason: "irrelevant", distance: 0.61, threshold: 0.52 }],
		} as unknown as RecordedPart;
		const view = inspectCall({ turnIndex: 3, callIndex: 0, parts: [older] });

		const text = renderExplanation(explain(view, "4"));
		expect(text).toContain("turn 4");
		expect(text).toContain("excluded: irrelevant");
		expect(renderExplanation(explain(view, "7"))).toContain("carried by recalled: turn 7");
	});

	test("a call holding only counts says it is unexplainable, naming the call", () => {
		const view = inspectCall({
			turnIndex: 3,
			callIndex: 1,
			parts: [recordPartWithoutLedger()],
		});

		const text = renderExplanation(explain(view, "turn 9"));
		expect(text).toContain("turn 3, call 1");
		expect(text).toContain("no detail about what it excluded");
	});
});

/** A part as it was recorded before identities were retained. */
function recordPartWithoutLedger() {
	const part = recordPart({ source: "verbatim-tail", approximateTokens: 10, carried: 0 });
	const { excludedCandidates: _dropped, ...older } = part;
	return older;
}

describe("the estimate against the reported window", () => {
	async function measured(snapshot?: {
		promptTokens: number;
		nonMessageTokens: number;
		compactionEpoch?: number;
	}) {
		const store = new MemoryAccounting();
		const address = { turnIndex: 0, callIndex: 0 };
		await store.recordPack(
			"conv-1",
			address,
			assemble({ turns: CONVERSATION }, budgets({ tailTurns: 2 })),
			"thread-store",
			"off",
		);
		if (snapshot) {
			await store.recordMeasurements("conv-1", [{ ...address, snapshot }]);
		}
		return store.readAccounting("conv-1");
	}

	test("both figures are reported, and neither is presented as the other", async () => {
		const turns = await measured({ promptTokens: 1_200, nonMessageTokens: 200 });
		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(view.packTokens).toBe(1_000);
		expect(view.approximateTokens).toBeGreaterThan(0);
		expect(view.estimateRatio).toBeCloseTo((view.approximateTokens ?? 0) / 1_000, 2);
		const text = renderCall(view);
		expect(text).toContain(`~${view.approximateTokens} estimated against 1000 reported`);
	});

	test("a call the harness never measured is rendered as unmeasured", async () => {
		const turns = await measured();
		const view = inspectCall(turns[0]?.calls[0] ?? missing());

		expect(view.estimateRatio).toBeUndefined();
		const text = renderCall(view);
		expect(text).toContain("unmeasured against the window");
		expect(text).not.toContain("reported size");
	});

	test("a conversation with no measured call summarises without inventing figures", async () => {
		const summary = summarise("conv-1", await measured());

		expect(summary.averageEstimateRatio).toBeUndefined();
		expect(renderSummary(summary)).not.toContain("the reported size");
	});

	test("a conversation reports the estimate's bias across its measured calls", async () => {
		const store = new MemoryAccounting();
		for (const [callIndex, promptTokens] of [1_200, 2_200].entries()) {
			const address = { turnIndex: 0, callIndex };
			await store.recordPack(
				"conv-1",
				address,
				assemble({ turns: CONVERSATION }, budgets({ tailTurns: 2 })),
				"thread-store",
				"off",
			);
			await store.recordMeasurements("conv-1", [
				{ ...address, snapshot: { promptTokens, nonMessageTokens: 200 } },
			]);
		}
		const calls = inspectConversation(await store.readAccounting("conv-1"));
		const summary = summarise("conv-1", await store.readAccounting("conv-1"));

		// An average of both Calls, not a repeat of either: the same
		// estimate against a 1,000-token window and a 2,000-token one, so
		// the figure has to sit between the two ratios.
		const ratios = calls.map((call) => call.estimateRatio ?? 0);
		expect(ratios).toHaveLength(2);
		expect(ratios[0]).toBeGreaterThan(ratios[1]!);
		expect(summary.averageEstimateRatio).toBeLessThan(ratios[0]!);
		expect(summary.averageEstimateRatio).toBeGreaterThan(ratios[1]!);
		expect(renderSummary(summary)).toContain(
			`${summary.averageEstimateRatio}× the reported size`,
		);
	});
});

describe("a harness compaction", () => {
	const epochs = async (...reported: (number | undefined)[]) => {
		const store = new MemoryAccounting();
		for (const [callIndex, compactionEpoch] of reported.entries()) {
			const address = { turnIndex: callIndex, callIndex: 0 };
			await store.recordPack(
				"conv-1",
				address,
				assemble({ turns: CONVERSATION }, budgets({ tailTurns: 2 })),
				"thread-store",
				"off",
			);
			await store.recordMeasurements("conv-1", [
				{
					...address,
					snapshot: { promptTokens: 900, nonMessageTokens: 200, compactionEpoch },
				},
			]);
		}
		return store.readAccounting("conv-1");
	};

	test("the call the epoch changed at carries it, and the earlier one does not", async () => {
		const calls = inspectConversation(await epochs(0, 0, 1));

		expect(calls.map((call) => call.compacted)).toEqual([false, false, true]);
		expect(renderCall(calls[2] ?? missing())).toContain("compacted this conversation");
		expect(renderCall(calls[1] ?? missing())).not.toContain("compacted");
	});

	test("a conversation the harness never compacted reports none", async () => {
		const turns = await epochs(0, 0, 0);
		const summary = summarise("conv-1", turns);

		expect(inspectConversation(turns).some((call) => call.compacted)).toBe(false);
		expect(summary.compactions).toEqual([]);
		expect(renderSummary(summary)).not.toContain("compacted");
	});

	test("a conversation first seen after a compaction reports none", async () => {
		// Real Journals here open at epoch 2, 3 and 46: a Conversation taken
		// up again after the harness compacted it starts where it starts,
		// and the epoch it starts on is not a compaction it saw happen.
		const turns = await epochs(46, 46);

		expect(inspectConversation(turns).some((call) => call.compacted)).toBe(false);
		expect(summarise("conv-1", turns).compactions).toEqual([]);
	});

	test("a summary names where the conversation was compacted", async () => {
		const summary = summarise("conv-1", await epochs(0, 1));

		expect(summary.compactions).toEqual([{ turnIndex: 1, callIndex: 0 }]);
		expect(renderSummary(summary)).toContain("at turn 1, call 0");
	});

	test("a conversation whose epoch was never reported reports no compaction", async () => {
		const calls = inspectConversation(await epochs(undefined, undefined));

		expect(calls.some((call) => call.compacted)).toBe(false);
	});
});

describe("a call's competing injector", () => {
	const recorded = async (
		...states: MemoryBackendState[]
	): Promise<TurnAccounting[]> => {
		const store = new MemoryAccounting();
		for (const [callIndex, state] of states.entries()) {
			await store.recordPack(
				"conv-1",
				{ turnIndex: callIndex, callIndex: 0 },
				assemble({ turns: CONVERSATION }, budgets({ tailTurns: 2 })),
				"thread-store",
				state,
			);
		}
		return store.readAccounting("conv-1");
	};

	const recordedWith = async (
		...states: MemoryBackendState[]
	): Promise<CallView[]> => inspectConversation(await recorded(...states));

	test("an exposed call says so, and a clean one says nothing", async () => {
		const [exposed, clean] = await recordedWith("active", "off");

		// The report at the Conversation's start scrolls away; this is what
		// answers "was that window contaminated" afterwards.
		expect(renderCall(exposed ?? missing())).toContain(
			"memory backend was active",
		);
		expect(renderCall(clean ?? missing())).not.toContain("memory");
	});

	test("an unconfirmed call reads as unconfirmed, not as clean", async () => {
		const [unconfirmed] = await recordedWith("unconfirmed");
		// A row from before the state was recorded at all, which is what the
		// Thread Store returns for a Call written by an earlier version.
		const unrecorded = inspectCall({ turnIndex: 1, callIndex: 0, parts: [] });

		expect(renderCall(unconfirmed ?? missing())).toContain(
			"unconfirmed rather than clean",
		);
		expect(unrecorded.memoryBackend).toBeUndefined();
		expect(renderCall(unrecorded)).not.toContain("memory");
	});

	test("a conversation names the calls that ran with a second injector", async () => {
		const mixed = summarise("conv-1", await recorded("active", "active", "off"));
		const clean = summarise("conv-1", await recorded("off", "off"));

		// Which Calls, not whether any: a backend switched off partway
		// leaves a Conversation whose earlier windows are the suspect ones.
		expect(mixed.exposed).toEqual([
			{ turnIndex: 0, callIndex: 0, state: "active" },
			{ turnIndex: 1, callIndex: 0, state: "active" },
		]);
		expect(renderSummary(mixed)).toContain("not off for 2 of 3 calls");
		expect(renderSummary(mixed)).toContain("0.0 (active), 1.0 (active)");
		expect(clean.exposed).toEqual([]);
		expect(renderSummary(clean)).not.toContain("memory backend");
	});
});

describe("what a call's window cost", () => {
	const measured = async (
		usage?: { input: number; cacheRead: number; cacheWrite: number },
	): Promise<CallView> => {
		const store = new MemoryAccounting();
		const at = { turnIndex: 0, callIndex: 0 };
		await store.recordPack(
			"conv-1",
			at,
			assemble({ turns: CONVERSATION }, budgets({ tailTurns: 2 })),
			"thread-store",
			"off",
		);
		await store.recordMeasurements("conv-1", [
			{ ...at, snapshot: { promptTokens: 29328, nonMessageTokens: 25588 }, usage },
		]);
		const [turn] = await store.readAccounting("conv-1");
		const call = turn?.calls[0];
		if (!call) throw new Error("nothing recorded");
		return inspectCall(call);
	};

	test("the share is of the pack, not of the window", async () => {
		const readBelowTheFloor = await measured({
			input: 4,
			cacheRead: 20488,
			cacheWrite: 8836,
		});
		const readPastTheFloor = await measured({
			input: 4,
			cacheRead: 27458,
			cacheWrite: 1866,
		});

		// 20,488 of 29,328 is 69.9% of the window and none of the pack: the
		// Floor alone is 25,588, and the Floor is the head of the prefix, so
		// nothing beyond it can have been read from cache.
		expect(readBelowTheFloor.cachedPackShare).toBe(0);
		expect(renderCall(readBelowTheFloor)).toContain(
			"0% of the pack read from cache",
		);
		// 27,458 leaves 1,870 above the Floor, of a 3,740-token pack.
		expect(readPastTheFloor.cachedPackShare).toBe(0.5);
		expect(renderCall(readPastTheFloor)).toContain("50% of the pack");
	});

	test("a call the provider priced nothing for reads as unmeasured", async () => {
		const view = await measured();

		// Not zero: a window nobody priced did not cost nothing, and a zero
		// here would read as a pack that was never cached.
		expect(view.cachedPackShare).toBeUndefined();
		expect(renderCall(view)).toContain("cache         not reported");
		expect(renderCall(view)).not.toContain("0% of the pack");
	});

	test("a priced call with no pack to measure says so", async () => {
		const store = new MemoryAccounting();
		const at = { turnIndex: 0, callIndex: 0 };
		await store.recordPack(
			"conv-1",
			at,
			assemble({ turns: CONVERSATION }, budgets({ tailTurns: 2 })),
			"thread-store",
			"off",
		);
		// A window the harness reports as all Floor: priced, with nothing to
		// take the price against.
		await store.recordMeasurements("conv-1", [
			{
				...at,
				snapshot: { promptTokens: 25588, nonMessageTokens: 25588 },
				usage: { input: 4, cacheRead: 20488, cacheWrite: 5096 },
			},
		]);
		const [turn] = await store.readAccounting("conv-1");
		const view = inspectCall(turn?.calls[0] ?? missing());

		expect(view.cachedPackShare).toBeUndefined();
		expect(renderCall(view)).toContain("share of the pack unmeasured");
		expect(renderCall(view)).not.toContain("0% of the pack");
	});
});

function missing(): never {
	throw new Error("nothing recorded");
}
