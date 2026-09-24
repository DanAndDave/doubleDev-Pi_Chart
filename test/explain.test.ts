// What a Call did not carry, and why. Pure throughout: assembly records the
// ledger, accounting round-trips it, and the inspector answers from it — no
// container, no model, no harness.

import { describe, expect, test } from "bun:test";

import {
	MemoryAccounting,
	recordPart,
	type MemoryBackendState,
	type TurnAccounting,
} from "../src/accounting.ts";
import { assemble } from "../src/assembler.ts";
import type { ConceptHit } from "../src/doc-index.ts";
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
import type { RecalledTurn, TurnMiss } from "../src/thread-store.ts";
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

function recalled(...indices: number[]): RecalledTurn[] {
	return indices.map((turnIndex) => ({
		turnIndex,
		turn: turn(`older ${turnIndex}`, turnIndex),
	}));
}

function misses(...pairs: [number, number][]): TurnMiss[] {
	return pairs.map(([turnIndex, distance]) => ({ turnIndex, distance }));
}

function concept(conceptId: string, text: string, distance: number): ConceptHit {
	return { conceptId, text, trust: "unverified", stale: false, distance };
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

function partOf(view: CallView, source: string) {
	const part = view.parts.find((each) => each.source === source);
	if (!part) throw new Error(`no ${source} part`);
	return part;
}

describe("the rejected-candidate ledger", () => {
	test("a refused turn reads back by position with its distance", async () => {
		const view = await viewOf(
			{
				turns: CONVERSATION,
				recalled: recalled(7),
				rejected: 2,
				recallMisses: misses([4, 0.61], [5, 0.58]),
			},
			budgets({ tailTurns: 2, recallTurns: 2, recallMaxDistance: 0.52 }),
		);

		const refused = partOf(view, "recalled").excludedCandidates;
		expect(refused).toEqual([
			{ turnIndex: 5, reason: "irrelevant", distance: 0.58, threshold: 0.52 },
			{ turnIndex: 4, reason: "irrelevant", distance: 0.61, threshold: 0.52 },
		]);
	});

	test("what excluded a candidate is distinguishable per candidate", async () => {
		const view = await viewOf(
			{
				turns: CONVERSATION,
				recalled: recalled(7, 8),
				rejected: 1,
				recallMisses: misses([4, 0.61]),
			},
			budgets({ tailTurns: 2, recallTurns: 1, recallMaxDistance: 0.52 }),
		);

		expect(partOf(view, "recalled").excludedCandidates).toEqual([
			{ turnIndex: 8, reason: "count", tokens: undefined, budget: 1 },
			{ turnIndex: 4, reason: "irrelevant", distance: 0.61, threshold: 0.52 },
		]);
	});

	test("the nearest are kept to the bound and the rest survive as counts", async () => {
		const view = await viewOf(
			{
				turns: CONVERSATION,
				recalled: recalled(7),
				rejected: 4,
				recallMisses: misses([4, 0.71], [5, 0.55], [6, 0.61], [9, 0.9]),
			},
			budgets({
				tailTurns: 2,
				recallTurns: 2,
				recallMaxDistance: 0.52,
				explainCandidates: 2,
			}),
		);

		const part = partOf(view, "recalled");
		expect(part.excludedCandidates.map((each) => each.turnIndex)).toEqual([5, 6]);
		// The two beyond the bound are not named, and not lost either.
		expect(part.excluded?.irrelevant).toBe(4);
	});

	test("a bound of zero names nothing and still counts everything", async () => {
		const view = await viewOf(
			{
				turns: CONVERSATION,
				recalled: recalled(7),
				rejected: 2,
				recallMisses: misses([4, 0.61], [5, 0.58]),
			},
			budgets({ tailTurns: 2, recallTurns: 2, explainCandidates: 0 }),
		);

		const part = partOf(view, "recalled");
		expect(part.excludedCandidates).toEqual([]);
		// Named nothing, but the Call is still one that kept a ledger.
		expect(part.explained).toBe(true);
		expect(part.excluded?.irrelevant).toBe(2);
	});

	test("no refused text is retained, for a turn or for a concept", async () => {
		const store = new MemoryAccounting();
		const pack = assemble(
			{
				turns: CONVERSATION,
				recalled: recalled(7, 8),
				concepts: [
					concept("decisions/caching", "We cache parsed configuration.", 0.2),
					concept("decisions/retention", "SECRET retention wording.", 0.31),
				],
				conceptMisses: [{ conceptId: "decisions/rejected", distance: 0.7 }],
				conceptsRejected: 1,
			},
			budgets({ tailTurns: 1, recallTurns: 1, docConcepts: 1, docTokens: 400 }),
		);
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store", "off");

		const [recordedTurn] = await store.readAccounting("conv-1");
		const written = JSON.stringify(recordedTurn?.calls[0]?.parts);
		expect(written).toContain("decisions/retention");
		// The section that matched is in the bundle; the ledger holds its
		// identity and nothing it said.
		expect(written).not.toContain("SECRET retention wording");
		expect(written).not.toContain("answer to older 8");
	});

	test("a call recorded before the ledger existed is unexplainable", () => {
		const view = inspectCall({
			turnIndex: 4,
			callIndex: 0,
			// As `recordPart` wrote it before this slice: no ledger field.
			parts: [
				{
					source: "recalled",
					approximateTokens: 120,
					approximate: true,
					carried: 1,
					candidates: 4,
					irrelevant: 3,
				},
			],
		});

		expect(view.explained).toBe(false);
		expect(partOf(view, "recalled").excludedCandidates).toEqual([]);
		expect(explain(view, "turn 9").unexplainable).toBe(true);
	});
});

describe("a part that contributed nothing", () => {
	const nothing = (
		input: Parameters<typeof assemble>[0],
		config: Parameters<typeof assemble>[1],
		source: string,
	) => assemble(input, config).parts.find((part) => part.source === source)?.absent;

	test("each cause reads back distinctly", () => {
		const base = { turns: CONVERSATION };
		expect(
			nothing(base, budgets({ tailTurns: 1, docConcepts: 0 }), "curated"),
		).toBe("disabled");
		expect(
			nothing(
				{ ...base, unavailable: { curated: "unconfigured" } },
				budgets({ tailTurns: 1, docConcepts: 2 }),
				"curated",
			),
		).toBe("unconfigured");
		expect(
			nothing(
				{ ...base, unavailable: { curated: "failed" } },
				budgets({ tailTurns: 1, docConcepts: 2 }),
				"curated",
			),
		).toBe("failed");
		expect(
			nothing(base, budgets({ tailTurns: 1, docConcepts: 2 }), "curated"),
		).toBe("none");
		expect(
			nothing(
				{ ...base, conceptsRejected: 3 },
				budgets({ tailTurns: 1, docConcepts: 2 }),
				"curated",
			),
		).toBe("irrelevant");
		expect(
			nothing(
				{ ...base, concepts: [concept("decisions/a", "x".repeat(4000), 0.2)] },
				budgets({ tailTurns: 1, docConcepts: 2, docTokens: 10 }),
				"curated",
			),
		).toBe("size");
	});

	test("candidates that existed outrank refusals as the cause", () => {
		// Some were refused by the threshold and what survived it did not
		// fit. The part is absent because nothing fitted: telling the
		// operator to loosen the threshold would not have carried it.
		expect(
			nothing(
				{
					turns: CONVERSATION,
					concepts: [concept("decisions/a", "x".repeat(4000), 0.2)],
					conceptsRejected: 3,
				},
				budgets({ tailTurns: 1, docConcepts: 2, docTokens: 10 }),
				"curated",
			),
		).toBe("size");
	});

	test("a part with no relevance threshold says so rather than refusing nothing", () => {
		const pack = assemble(
			{ turns: CONVERSATION },
			budgets({ tailTurns: 1, recallTurns: 2 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");
		const recall = pack.parts.find((part) => part.source === "recalled");

		expect(tail?.unranked).toBe(true);
		expect(tail?.threshold).toBeUndefined();
		// Recall ranks by distance, so it has one and reports it.
		expect(recall?.unranked).toBeUndefined();
		expect(recall?.threshold).toBe(budgets({}).recallMaxDistance);
	});

	test("a tight threshold and an unwired store read differently", async () => {
		const tight = await viewOf(
			{ turns: CONVERSATION, conceptsRejected: 4 },
			budgets({ tailTurns: 1, docConcepts: 2, docMaxDistance: 0.2 }),
		);
		const unwired = await viewOf(
			{ turns: CONVERSATION, unavailable: { curated: "unconfigured" } },
			budgets({ tailTurns: 1, docConcepts: 2 }),
		);
		const empty = await viewOf(
			{ turns: CONVERSATION },
			budgets({ tailTurns: 1, docConcepts: 2 }),
		);

		expect(renderCall(tight)).toContain("4 refused against the 0.2 threshold");
		expect(renderCall(unwired)).toContain("no store configured");
		expect(renderCall(empty)).toContain("no candidates");
		expect(renderCall(tight)).not.toContain("no candidates");
	});

	test("a part with no threshold attributes its shortfall to its budget", async () => {
		const around = (label: string) => ({
			symbol: { id: label, label, file: "src/a.ts", position: "L10" },
			edges: [],
			dropped: 0,
		});
		const view = await viewOf(
			{ turns: CONVERSATION, structure: [around("a()"), around("b()")] },
			budgets({ tailTurns: 1, graphSymbols: 1 }),
		);

		const line = renderCall(view)
			.split("\n")
			.find((each) => each.includes("structure"));
		// Its Budget kept the second symbol out; symbols carry no distance,
		// so nothing here was refused for being too far away.
		expect(line).toContain("1 over the count");
		expect(line).toContain("no relevance threshold");
		expect(line).not.toContain("not relevant enough");
	});
});

describe("addressing a call", () => {
	const recordedAt = (turnIndex: number, callIndex: number): CallView => ({
		turnIndex,
		callIndex,
		parts: [],
		unassembled: false,
		rejected: 0,
		unsearched: 0,
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
	async function call(): Promise<CallView> {
		return viewOf(
			{
				turns: CONVERSATION,
				recalled: recalled(7, 8),
				rejected: 2,
				recallMisses: misses([4, 0.61], [12, 0.55]),
				concepts: [concept("decisions/caching", "We cache.", 0.2)],
			},
			budgets({
				tailTurns: 2,
				recallTurns: 1,
				docConcepts: 1,
				recallMaxDistance: 0.52,
			}),
		);
	}

	test("a near miss is named with its distance", async () => {
		const answer = explain(await call(), "4");

		expect(answer.excluded).toHaveLength(1);
		expect(answer.excluded[0]?.candidate).toMatchObject({
			turnIndex: 4,
			distance: 0.61,
			threshold: 0.52,
			reason: "irrelevant",
		});
		const text = renderExplanation(explain(await call(), "12"));
		expect(text).toContain("turn 12");
		expect(text).toContain("distance 0.55");
		expect(text).toContain("beyond the 0.52 threshold");
	});

	test("several matching candidates are ranked nearest first", async () => {
		const view = await viewOf(
			{
				turns: CONVERSATION,
				conceptMisses: [
					{ conceptId: "decisions/retention-age", distance: 0.71 },
					{ conceptId: "decisions/retention-policy", distance: 0.55 },
					{ conceptId: "decisions/retention-report", distance: 0.63 },
				],
				conceptsRejected: 3,
			},
			budgets({ tailTurns: 2, docConcepts: 2, docMaxDistance: 0.5 }),
		);

		const answer = explain(view, "retention");
		expect(answer.excluded.map((each) => each.candidate.distance)).toEqual([
			0.55, 0.63, 0.71,
		]);
	});

	test("a budget exclusion is attributed to the budget, not to irrelevance", async () => {
		const text = renderExplanation(explain(await call(), "8"));

		expect(text).toContain("excluded by the 1 count budget");
		expect(text).not.toContain("threshold");
	});

	test("a subject that was never a candidate says so", async () => {
		const text = renderExplanation(explain(await call(), "docs/never-written"));

		expect(text).toContain("nothing matching it was considered");
	});

	test("a subject the call carried is not reported as excluded", async () => {
		const text = renderExplanation(explain(await call(), "decisions/caching"));

		expect(text).toContain("carried by curated: decisions/caching");
		expect(text).not.toContain("nothing matching it was considered");
	});

	test("a turn number does not match a concept whose id contains it", async () => {
		const view = await viewOf(
			{
				turns: CONVERSATION,
				conceptMisses: [
					{ conceptId: "decisions/0001-settlement-window", distance: 0.26 },
				],
				conceptsRejected: 1,
			},
			budgets({ tailTurns: 2, docConcepts: 2, docMaxDistance: 0.05 }),
		);

		// Asked about a Turn, answered about a Turn: a Concept id holding
		// a zero is not an answer to "why was turn 0 not carried".
		expect(explain(view, "0").excluded).toEqual([]);
		expect(explain(view, "settlement").excluded).toHaveLength(1);
	});

	test("a distance is rendered at reading precision", async () => {
		const view = await viewOf(
			{
				turns: CONVERSATION,
				conceptMisses: [
					{ conceptId: "decisions/settlement", distance: 0.25701083117529655 },
				],
				conceptsRejected: 1,
			},
			budgets({ tailTurns: 2, docConcepts: 2, docMaxDistance: 0.05 }),
		);

		const text = renderExplanation(explain(view, "settlement"));
		expect(text).toContain("distance 0.26");
		expect(text).not.toContain("0.25701083117529655");
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
	const part = recordPart({ source: "recalled", approximateTokens: 10, carried: 0 });
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

function missing(): never {
	throw new Error("nothing recorded");
}
