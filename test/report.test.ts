import { describe, expect, test } from "bun:test";

import type { CallView, ConversationSummary, PackDiff } from "../src/inspection.ts";
import {
	renderCall,
	renderDiff,
	renderSearch,
	renderSummary,
} from "../src/report.ts";
import { UNBOUNDED } from "./fixtures.ts";

function view(overrides: Partial<CallView> = {}): CallView {
	return {
		turnIndex: 6,
		callIndex: 0,
		parts: [
			{
				source: "recalled",
				approximateTokens: 112,
				carried: 2,
				turnIndices: [1, 3],
				conceptIds: [],
				symbols: [],
				budget: { count: 3, tokens: UNBOUNDED },
				candidates: 5,
				trimmed: false,
				dropped: 3,
				irrelevant: 0,
				excludedCandidates: [],
				explained: false,
				unranked: false,
			},
			{
				source: "verbatim-tail",
				approximateTokens: 67,
				carried: 2,
				turnIndices: [4, 5],
				conceptIds: [],
				symbols: [],
				budget: { count: 2, tokens: UNBOUNDED },
				trimmed: false,
				dropped: 0,
				irrelevant: 0,
				excludedCandidates: [],
				explained: false,
				unranked: false,
			},
		],
		packTokens: 4_000,
		floorTokens: 26_000,
		floorShare: 26_000 / 30_000,
		unassembled: false,
		rejected: 0,
		unsearched: 0,
		conceptsUnsearched: 0,
		compacted: false,
		explained: false,
		...overrides,
	};
}

describe("rendering a call", () => {
	test("names each part, what it carried, and its budget", () => {
		const text = renderCall(view());

		expect(text).toContain("recalled");
		expect(text).toContain("turns 1, 3");
		expect(text).toContain("of 3");
	});

	test("reports the floor's share as a percentage", () => {
		const text = renderCall(view());

		expect(text).toContain("floor is 87% of the window");
	});

	test("an unmeasured call says so instead of showing figures", () => {
		const text = renderCall(
			view({ packTokens: undefined, floorTokens: undefined, floorShare: undefined }),
		);

		expect(text).toContain("not reported yet");
		expect(text).not.toContain("%");
	});

	test("a part whose turns have no positions still reports what it carried", () => {
		const text = renderCall(
			view({
				parts: [
					{
						source: "verbatim-tail",
						approximateTokens: 67,
						carried: 2,
						turnIndices: [],
						conceptIds: [],
						symbols: [],
						budget: { count: 8, tokens: UNBOUNDED },
						trimmed: false,
						dropped: 0,
						irrelevant: 0,
						excludedCandidates: [],
						explained: false,
						unranked: false,
					},
				],
			}),
		);

		expect(text).toContain("(2 of 8)");
	});

	test("an unassembled call is marked", () => {
		expect(renderCall(view({ unassembled: true }))).toContain("unassembled");
	});
});

describe("rendering a diff", () => {
	test("shows what entered and left", () => {
		const diff: PackDiff = {
			entered: [{ source: "recalled", turnIndex: 9 }],
			left: [{ source: "recalled", turnIndex: 7 }],
			unchanged: [{ source: "verbatim-tail", turnIndex: 4 }],
		};

		const text = renderDiff(diff);

		expect(text).toContain("+ recalled turn 9");
		expect(text).toContain("- recalled turn 7");
		expect(text).toContain("1 unchanged");
	});

	test("says so when nothing changed", () => {
		const text = renderDiff({ entered: [], left: [], unchanged: [] });

		expect(text).toBe("No change between these packs.");
	});
});

describe("rendering a summary", () => {
	const summary: ConversationSummary = {
		conversationId: "conv-1",
		calls: 7,
		measuredCalls: 7,
		averagePackTokens: 3_881,
		averageFloorTokens: 25_588,
		averageFloorShare: 0.868,
		budgetUse: [
			{ source: "recalled", averageCarried: 2.25, averageIrrelevant: 0, budget: 3, timesTrimmed: 0 },
		],
		compactions: [],
		exposed: [],
	};

	test("reports the floor's share and each budget's spend", () => {
		const text = renderSummary(summary);

		expect(text).toContain("7 calls, 7 measured");
		expect(text).toContain("floor is 87% of the window");
		expect(text).toContain("carried 2.25 of 3");
	});

	test("an empty conversation says so rather than printing zeroes", () => {
		const text = renderSummary({
			conversationId: "conv-1",
			calls: 0,
			measuredCalls: 0,
			budgetUse: [],
			compactions: [],
			exposed: [],
		});

		expect(text).toBe("Nothing recorded for this conversation yet.");
	});
});

describe("rendering relevance", () => {
	test("a part that found little says so rather than reading as trimmed", () => {
		const text = renderCall(
			view({
				parts: [
					{
						source: "recalled",
						approximateTokens: 40,
						carried: 1,
						turnIndices: [2],
						conceptIds: [],
						symbols: [],
						budget: { count: 3, tokens: UNBOUNDED },
						candidates: 1,
						trimmed: false,
						dropped: 0,
						irrelevant: 4,
						excludedCandidates: [],
						explained: false,
						unranked: false,
					},
				],
			}),
		);

		expect(text).toContain("not relevant enough");
		expect(text).not.toContain("dropped");
	});

	test("a trimmed part still reads as trimmed", () => {
		const text = renderCall(
			view({
				parts: [
					{
						source: "recalled",
						approximateTokens: 40,
						carried: 2,
						turnIndices: [1, 2],
						conceptIds: [],
						symbols: [],
						budget: { count: 2, tokens: UNBOUNDED },
						candidates: 5,
						trimmed: true,
						dropped: 3,
						irrelevant: 1,
						excludedCandidates: [],
						explained: false,
						unranked: false,
					},
				],
			}),
		);

		expect(text).toContain("3 dropped");
	});

	test("a size-reduced part reads differently from a count-trimmed one", () => {
		const overCount = renderCall(
			view({
				parts: [
					{
						source: "recalled",
						approximateTokens: 40,
						carried: 2,
						turnIndices: [1, 2],
						conceptIds: [],
						symbols: [],
						budget: { count: 2, tokens: UNBOUNDED },
						candidates: 5,
						trimmed: true,
						dropped: 3,
						irrelevant: 0,
						excluded: { count: 3 },
						excludedCandidates: [],
						explained: false,
						unranked: false,
					},
				],
			}),
		);
		const overSize = renderCall(
			view({
				parts: [
					{
						source: "recalled",
						approximateTokens: 40,
						carried: 2,
						turnIndices: [1, 2],
						conceptIds: [],
						symbols: [],
						budget: { count: 4, tokens: UNBOUNDED },
						candidates: 5,
						trimmed: false,
						dropped: 3,
						irrelevant: 0,
						excluded: { size: 3 },
						excludedCandidates: [],
						explained: false,
						unranked: false,
					},
				],
			}),
		);

		expect(overCount).toContain("3 over the count");
		expect(overCount).not.toContain("size budget");
		expect(overSize).toContain("3 over the size budget");
		expect(overSize).not.toContain("over the count");
	});

	test("a part the ceiling reduced says what it would have carried", () => {
		const text = renderCall(
			view({
				ceiling: 300,
				beforeCeiling: 1200,
				reduced: true,
				parts: [
					{
						source: "verbatim-tail",
						approximateTokens: 280,
						carried: 1,
						turnIndices: [4],
						conceptIds: [],
						symbols: [],
						budget: { count: 8, tokens: UNBOUNDED },
						trimmed: false,
						dropped: 0,
						irrelevant: 0,
						excluded: { ceiling: 0 },
						withoutCeiling: 1100,
						shortened: true,
						excludedCandidates: [],
						explained: false,
						unranked: false,
					},
				],
			}),
		);

		expect(text).toContain("content shortened");
		expect(text).toContain("~1100 tokens without the ceiling");
		expect(text).toContain("~1200 of 300 tokens");
		expect(text).toContain("parts reduced to fit");
	});

	test("a part with no count budget still reports why it carried less", () => {
		// The current Turn has no count Budget and is the part the ceiling
		// elides, so hanging the reasons off the Budget hid exactly the case
		// worth reading.
		const text = renderCall(
			view({
				ceiling: 300,
				beforeCeiling: 5290,
				reduced: true,
				parts: [
					{
						source: "current-turn",
						approximateTokens: 290,
						carried: 1,
						turnIndices: [3],
						conceptIds: [],
						symbols: [],
						trimmed: false,
						dropped: 0,
						irrelevant: 0,
						excluded: { ceiling: 0 },
						withoutCeiling: 5000,
						shortened: true,
						excludedCandidates: [],
						explained: false,
						unranked: false,
					},
				],
			}),
		);

		expect(text).toContain("content shortened");
		expect(text).toContain("~5000 tokens without the ceiling");
	});
});

describe("rendering a call that recalled nothing", () => {
	test("says how many were rejected even with no recalled part", () => {
		const text = renderCall(
			view({
				parts: [
					{
						source: "current-turn",
						approximateTokens: 18,
						carried: 1,
						turnIndices: [4],
						conceptIds: [],
						symbols: [],
						trimmed: false,
						dropped: 0,
						irrelevant: 0,
						excludedCandidates: [],
						explained: false,
						unranked: false,
					},
				],
				rejected: 6,
			}),
		);

		expect(text).toContain("recalled");
		expect(text).toContain("6 not relevant enough");
	});

	test("stays quiet when nothing was rejected", () => {
		const text = renderCall(view({ rejected: 0 }));

		expect(text).not.toContain("not relevant enough");
	});

	test("a recall that came back short reads differently from an irrelevant one", () => {
		const noRecall = [
			{
				source: "current-turn" as const,
				approximateTokens: 18,
				carried: 1,
				turnIndices: [4],
				conceptIds: [],
				symbols: [],
				trimmed: false,
				dropped: 0,
				irrelevant: 0,
				excludedCandidates: [],
				explained: false,
				unranked: false,
			},
		];
		const short = renderCall(
			view({ parts: noRecall, rejected: 0, unsearched: 7 }),
		);
		const irrelevant = renderCall(
			view({ parts: noRecall, rejected: 7, unsearched: 0 }),
		);

		expect(short).toContain("7 turns of this conversation");
		expect(short).toContain("awaiting embedding");
		expect(short).not.toContain("not relevant enough");
		expect(irrelevant).toContain("7 not relevant enough");
		expect(irrelevant).not.toContain("awaiting embedding");
	});

	test("stays quiet when the whole conversation was searched", () => {
		const text = renderCall(view({ unsearched: 0 }));

		expect(text).not.toContain("awaiting embedding");
	});

	test("the prefix the harness can recognise is reported beside the cache", () => {
		const led = renderCall(view({ leadingTokens: 3412 }));
		const none = renderCall(view({ leadingTokens: 0 }));

		// A cache figure with no prefix figure beside it cannot be acted on:
		// the remedy for 0% cached is more of the harness's own messages at
		// the head, and this is the number that says how many there were.
		expect(led).toContain("~3412 tokens the harness sent itself");
		expect(none).toContain("~0 tokens the harness sent itself");
	});

	test("a curated part mid-repair is named apart from a thin recall", () => {
		const curated = renderCall(view({ unsearched: 0, conceptsUnsearched: 3 }));
		const recall = renderCall(view({ unsearched: 7, conceptsUnsearched: 0 }));

		// Both Stores embed on their own schedule, so a reader must be able
		// to tell which one is behind.
		expect(curated).toContain("3 concepts of the bundle");
		expect(curated).not.toContain("turns of this conversation");
		expect(recall).toContain("7 turns of this conversation");
		expect(recall).not.toContain("concepts of the bundle");
	});
});

describe("rendering a search", () => {
	const hit = (calls: number) => ({
		turnIndex: 3,
		turn: {
			index: 3,
			prompt: "why did the importer stall",
			messages: [
				{ role: "user", content: "why did the importer stall" },
				{ role: "assistant", content: "the salt changed" },
			],
		},
		conversationId: "c1",
		codebase: "/work/a",
		calls,
	});

	test("a turn that took several calls says how many", () => {
		// The only surface where a person sees how much work a Turn took.
		expect(renderSearch([hit(4)])).toContain("turn 3, 4 calls");
	});

	test("a turn answered in one call says nothing about calls", () => {
		expect(renderSearch([hit(1)])).not.toContain("calls");
	});
});
