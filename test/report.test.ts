import { describe, expect, test } from "bun:test";

import type { CallView, ConversationSummary, PackDiff } from "../src/inspection.ts";
import { renderCall, renderDiff, renderSummary } from "../src/report.ts";

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
				budget: 3,
				candidates: 5,
				trimmed: false,
				dropped: 3,
			},
			{
				source: "verbatim-tail",
				approximateTokens: 67,
				carried: 2,
				turnIndices: [4, 5],
				budget: 2,
				trimmed: false,
				dropped: 0,
			},
		],
		packTokens: 4_000,
		floorTokens: 26_000,
		floorShare: 26_000 / 30_000,
		unassembled: false,
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
						budget: 8,
						trimmed: false,
						dropped: 0,
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
			{ source: "recalled", averageCarried: 2.25, budget: 3, timesTrimmed: 0 },
		],
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
		});

		expect(text).toBe("Nothing recorded for this conversation yet.");
	});
});
