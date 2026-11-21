import { describe, expect, test } from "bun:test";

import type { RecordedPart } from "../src/accounting.ts";
import type { Pack, PackPart } from "../src/assembler.ts";
import {
	inspectCall,
	viewPack,
	type CallView,
	type ConversationSummary,
	type PackDiff,
} from "../src/inspection.ts";
import {
	renderCall,
	renderDiff,
	renderGauge,
	renderPackWidget,
	renderSearch,
	renderSummary,
} from "../src/report.ts";
import { UNBOUNDED } from "./fixtures.ts";

type Part = CallView["parts"][number];

/** A part as the inspector presents it, from the fields a test cares about. */
function part(fields: Partial<Part> & Pick<Part, "source">): Part {
	return {
		approximateTokens: 0,
		carried: 0,
		turnIndices: [],
		pinIds: [],
		trimmed: false,
		dropped: 0,
		excludedCandidates: [],
		explained: false,
		...fields,
	};
}

function view(overrides: Partial<CallView> = {}): CallView {
	return {
		turnIndex: 6,
		callIndex: 0,
		parts: [
			part({
				source: "pinned",
				placement: "system-prompt",
				approximateTokens: 24,
				carried: 2,
				pinIds: [1, 3],
				budget: { count: 8, tokens: 2_000 },
				candidates: 2,
			}),
			part({
				source: "verbatim-tail",
				approximateTokens: 67,
				carried: 2,
				turnIndices: [4, 5],
				budget: { count: 8, tokens: UNBOUNDED },
			}),
		],
		packTokens: 4_000,
		floorTokens: 26_000,
		floorShare: 26_000 / 30_000,
		unassembled: false,
		compacted: false,
		explained: false,
		...overrides,
	};
}

/** The line a part is reported on. */
const lineOf = (text: string, source: string) =>
	text.split("\n").find((line) => line.trimStart().startsWith(source));

describe("rendering a call", () => {
	test("names each part, what it carried, and its budget", () => {
		const text = renderCall(view());

		expect(lineOf(text, "verbatim-tail")).toContain("turns 4, 5");
		expect(lineOf(text, "verbatim-tail")).toContain("(2 of 8)");
		expect(lineOf(text, "pinned")).toContain("pins #1, #3");
	});

	test("pins sent in the system prompt are marked, and pins recorded before they moved there are not", () => {
		const moved = renderCall(view());
		const earlier = renderCall(
			view({
				parts: [
					part({
						source: "pinned",
						approximateTokens: 24,
						carried: 2,
						pinIds: [1, 3],
						budget: { count: 8, tokens: 2_000 },
					}),
				],
			}),
		);

		expect(lineOf(moved, "pinned")).toContain("in the system prompt");
		expect(lineOf(earlier, "pinned")).toContain("pins #1, #3");
		expect(lineOf(earlier, "pinned")).not.toContain("system prompt");
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
					part({
						source: "verbatim-tail",
						approximateTokens: 67,
						carried: 2,
						budget: { count: 8, tokens: UNBOUNDED },
					}),
				],
			}),
		);

		expect(text).toContain("(2 of 8)");
	});

	test("an unassembled call is marked", () => {
		expect(renderCall(view({ unassembled: true }))).toContain("unassembled");
	});

	test("the pins and the opening are marked as sent in the system prompt, and the tail is not", () => {
		const text = renderCall(
			view({
				parts: [
					...view().parts,
					part({
						source: "opening",
						placement: "system-prompt",
						approximateTokens: 31,
						carried: 1,
						turnIndices: [0],
						budget: { count: 1, tokens: 1_000 },
						candidates: 1,
					}),
				],
			}),
		);

		expect(lineOf(text, "pinned")).toContain("system prompt");
		expect(lineOf(text, "opening")).toContain("system prompt");
		expect(lineOf(text, "verbatim-tail")).not.toContain("system prompt");
	});

	test("pins recorded while they were sent as a message carry no system-prompt mark", () => {
		const text = renderCall(
			view({
				parts: [
					part({
						source: "pinned",
						approximateTokens: 24,
						carried: 1,
						pinIds: [1],
						budget: { count: 8, tokens: 2_000 },
					}),
				],
			}),
		);

		expect(lineOf(text, "pinned")).toContain("pins #1");
		expect(lineOf(text, "pinned")).not.toContain("system prompt");
	});
});

describe("rendering where the tail came from", () => {
	const tailLine = (text: string) =>
		text.split("\n").find((line) => line.startsWith("  tail "));

	test("a tail that used store copies says so", () => {
		expect(tailLine(renderCall(view({ tailSource: "thread-store" })))).toContain(
			"some tail Turns are the store's copies",
		);
	});

	test("a tail sent without store sizes says it fell back to the harness", () => {
		expect(tailLine(renderCall(view({ tailSource: "harness-fallback" })))).toContain(
			"from the harness's own history, not the store",
		);
	});

	test("a tail sent from live history adds no line", () => {
		expect(tailLine(renderCall(view({ tailSource: "harness" })))).toBeUndefined();
		// Nor does a Call recorded before the source was.
		expect(tailLine(renderCall(view()))).toBeUndefined();
	});
});

describe("rendering the opening", () => {
	const opening = (fields: Partial<Part>): Part =>
		part({
			source: "opening",
			placement: "system-prompt",
			budget: { count: 1, tokens: 1_000 },
			...fields,
		});

	test("a carried opening names Turn 0 and refuses nothing", () => {
		const text = renderCall(
			view({ parts: [opening({ approximateTokens: 31, carried: 1, turnIndices: [0], candidates: 1 })] }),
		);

		expect(lineOf(text, "opening")).toContain("~31 tokens");
		expect(lineOf(text, "opening")).toContain("turns 0");
		expect(lineOf(text, "opening")).not.toContain("refused");
		expect(lineOf(text, "opening")).not.toContain("dropped");
	});

	test("each reason it is absent reads differently", () => {
		const causes = ["empty", "missing", "unconfigured", "failed", "disabled", "size", "unhooked"] as const;
		const lines = causes.map((absent) =>
			lineOf(renderCall(view({ parts: [opening({ absent })] })), "opening"),
		);

		expect(new Set(lines).size).toBe(causes.length);
	});

	test("an opening the hook never reached says the system prompt was not offered", () => {
		const text = renderCall(view({ parts: [opening({ absent: "unhooked" })] }));

		expect(lineOf(text, "opening")).toContain("the harness never offered the system prompt");
	});
});

describe("rendering pins the hook never reached", () => {
	test("are reported absent for that reason rather than hidden", () => {
		const text = renderCall(
			view({
				parts: [
					part({
						source: "pinned",
						placement: "system-prompt",
						budget: { count: 8, tokens: 2_000 },
						absent: "unhooked",
					}),
				],
			}),
		);

		expect(lineOf(text, "pinned")).toContain("the harness never offered the system prompt");
	});

	test("a conversation holding no pins still says nothing about them", () => {
		const text = renderCall(
			view({
				parts: [
					part({
						source: "pinned",
						placement: "system-prompt",
						budget: { count: 8, tokens: 2_000 },
						absent: "none",
					}),
				],
			}),
		);

		expect(text).not.toContain("pinned");
	});
});

describe("rendering an older record", () => {
	test("a call that carried retrieval parts still renders", () => {
		// As an earlier version wrote it: a recalled part with relevance
		// detail, and a curated part absent for a cause no longer recorded.
		const older = [
			{
				source: "recalled",
				approximateTokens: 120,
				approximate: true,
				carried: 1,
				turnIndices: [2],
				irrelevant: 3,
				threshold: 0.52,
				excludedCandidates: [{ turnIndex: 4, reason: "irrelevant", distance: 0.61, threshold: 0.52 }],
			},
			{ source: "curated", approximateTokens: 0, approximate: true, absent: "irrelevant" },
		] as unknown as RecordedPart[];

		const text = renderCall(inspectCall({ turnIndex: 3, callIndex: 0, parts: older }));

		expect(lineOf(text, "recalled")).toContain("turns 2");
		expect(lineOf(text, "curated")).toContain("irrelevant");
		expect(text).not.toContain("undefined");
	});
});

describe("rendering a diff", () => {
	test("shows what entered and left", () => {
		const diff: PackDiff = {
			entered: [{ source: "verbatim-tail", turnIndex: 9 }],
			left: [{ source: "verbatim-tail", turnIndex: 7 }],
			unchanged: [{ source: "pinned", pinId: 1 }],
		};

		const text = renderDiff(diff);

		expect(text).toContain("+ verbatim-tail turn 9");
		expect(text).toContain("- verbatim-tail turn 7");
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
			{ source: "verbatim-tail", averageCarried: 2.25, budget: 3, timesTrimmed: 0 },
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

describe("rendering budget spend", () => {
	test("a trimmed part from an older record still reads as trimmed", () => {
		const text = renderCall(
			view({
				parts: [
					part({
						source: "verbatim-tail",
						approximateTokens: 40,
						carried: 2,
						turnIndices: [1, 2],
						budget: { count: 2, tokens: UNBOUNDED },
						candidates: 5,
						trimmed: true,
						dropped: 3,
					}),
				],
			}),
		);

		expect(text).toContain("3 dropped");
	});

	test("a size-reduced part reads differently from a count-trimmed one", () => {
		const reduced = (excluded: { count?: number; size?: number }) =>
			renderCall(
				view({
					parts: [
						part({
							source: "opening",
							placement: "system-prompt",
							budget: { count: 1, tokens: 10 },
							candidates: 1,
							dropped: 1,
							excluded,
						}),
					],
				}),
			);

		expect(reduced({ count: 1 })).toContain("1 over the count");
		expect(reduced({ count: 1 })).not.toContain("size budget");
		expect(reduced({ size: 1 })).toContain("1 over the size budget");
		expect(reduced({ size: 1 })).not.toContain("over the count");
	});

	test("an evicted turn is attributed to eviction", () => {
		const tail = (excluded: { evicted?: number; count?: number }) =>
			renderCall(
				view({
					parts: [
						part({
							source: "verbatim-tail",
							approximateTokens: 40,
							carried: 4,
							turnIndices: [6, 7, 8, 9],
							budget: { count: 8, tokens: UNBOUNDED },
							candidates: 9,
							dropped: 5,
							excluded,
						}),
					],
				}),
			);

		expect(tail({ evicted: 5 })).toContain("5 evicted");
		expect(tail({ evicted: 5 })).not.toContain("over the count");
		// A record from before Eviction reads as it always did.
		expect(tail({ count: 5 })).toContain("5 over the count");
		expect(tail({ count: 5 })).not.toContain("evicted");
	});

	test("a part the ceiling reduced says what it would have carried", () => {
		const text = renderCall(
			view({
				ceiling: 300,
				beforeCeiling: 1200,
				reduced: true,
				parts: [
					part({
						source: "verbatim-tail",
						approximateTokens: 280,
						carried: 1,
						turnIndices: [4],
						budget: { count: 8, tokens: UNBOUNDED },
						excluded: { ceiling: 0 },
						withoutCeiling: 1100,
						shortened: true,
					}),
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
					part({
						source: "current-turn",
						approximateTokens: 290,
						carried: 1,
						turnIndices: [3],
						excluded: { ceiling: 0 },
						withoutCeiling: 5000,
						shortened: true,
					}),
				],
			}),
		);

		expect(text).toContain("content shortened");
		expect(text).toContain("~5000 tokens without the ceiling");
	});

	test("a part that dropped messages says so apart from shortening, and an older record says neither", () => {
		const recorded = (fields: { droppedMessages?: number }) =>
			renderCall(
				inspectCall({
					turnIndex: 10,
					callIndex: 0,
					parts: [
						{
							source: "verbatim-tail",
							approximateTokens: 4_900,
							approximate: true,
							carried: 1,
							turnIndices: [9],
							budget: { count: 8, tokens: 5_000 },
							candidates: 9,
							excludedCandidates: [],
							shortened: true,
							...fields,
						},
					],
				}),
			);

		const shrunk = recorded({ droppedMessages: 412 });
		expect(shrunk).toContain("412 messages dropped");
		expect(shrunk).toContain("content shortened");
		expect(shrunk.indexOf("412 messages dropped")).toBeLessThan(
			shrunk.indexOf("content shortened"),
		);
		expect(recorded({})).not.toContain("messages dropped");
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

	test("a search that found nothing says so", () => {
		expect(renderSearch([])).toBe("No conversation holds anything relevant to that.");
	});
});

/** A pack as the Assembler hands it back, from the figures a test cares about. */
function livePack(
	fields: Partial<Omit<Pack, "parts">> & { parts?: (Partial<PackPart> & Pick<PackPart, "source">)[] } = {},
): Pack {
	const { parts = [], ...rest } = fields;
	return {
		messages: [],
		systemTokens: 0,
		budgets: { tail: 8, opening: 1_000, pins: 2_000 },
		ceiling: 1_000,
		beforeCeiling: 100,
		approximateTokens: 100,
		...rest,
		parts: parts.map((each) => ({ messages: [], approximateTokens: 0, ...each })),
	};
}

describe("the live pack's view", () => {
	test("a pack that fitted within the share carries no mark", () => {
		expect(viewPack(livePack({ approximateTokens: 400, beforeCeiling: 400 }), 0.75).mark).toBeUndefined();
	});

	test("a pack is near the ceiling only once it is past the share", () => {
		const at = viewPack(livePack({ approximateTokens: 750, beforeCeiling: 750 }), 0.75);
		const past = viewPack(livePack({ approximateTokens: 751, beforeCeiling: 751 }), 0.75);

		expect([at.mark, past.mark]).toEqual([undefined, "near"]);
	});

	test("a pack the ceiling reduced is marked reduced, even past the share", () => {
		const view = viewPack(livePack({ approximateTokens: 980, beforeCeiling: 1_400 }), 0.75);

		expect(view.mark).toBe("reduced");
		expect(view.beforeCeiling).toBe(1_400);
	});

	test("a pack reduced and still over the ceiling is over, and nothing else", () => {
		const view = viewPack(livePack({ approximateTokens: 1_200, beforeCeiling: 2_000 }), 0.75);

		expect(view.mark).toBe("over");
	});

	test("with no ceiling in force there is no mark at all", () => {
		const view = viewPack(
			livePack({ ceiling: 0, approximateTokens: 5_000, beforeCeiling: 5_000 }),
			0.75,
		);

		expect(view.mark).toBeUndefined();
	});
});

describe("the pack gauge", () => {
	const gauge = (fields: Partial<Omit<Pack, "parts">>) =>
		renderGauge(viewPack(livePack({ ceiling: 300_000, ...fields }), 0.9));
	const full = (cells: number) => "█".repeat(cells);
	const empty = (cells: number) => "\u00a0".repeat(cells);

	test("a pack that fits shows its size against the ceiling, unmarked", () => {
		expect(gauge({ approximateTokens: 123_000, beforeCeiling: 123_000 })).toBe(
			`pack ▕${full(9)}▊${empty(14)}▏ 41% ~123k/300k`,
		);
	});

	test("a pack past the share is near the ceiling", () => {
		expect(gauge({ approximateTokens: 294_000, beforeCeiling: 294_000 })).toBe(
			`pack ▕${full(23)}▌▏ 98% ~294k/300k · near ceiling`,
		);
	});

	test("a reduced pack says what it was reduced from", () => {
		expect(gauge({ approximateTokens: 298_000, beforeCeiling: 410_000 })).toBe(
			`pack ▕${full(23)}▊▏ 99% ~298k/300k · reduced from ~410k`,
		);
	});

	test("a pack over the ceiling fills the bar and goes no further", () => {
		expect(gauge({ approximateTokens: 804_839, beforeCeiling: 900_000 })).toBe(
			`pack ▕${full(24)}▏ 268% ~805k/300k · over ceiling`,
		);
	});

	test("an empty pack draws an empty bar", () => {
		expect(gauge({ approximateTokens: 0, beforeCeiling: 0 })).toBe(
			`pack ▕${empty(24)}▏ 0% 0/300k`,
		);
	});

	test("the bar keeps its width and its share through pi's footer, which collapses runs of spaces", () => {
		const shown = gauge({ approximateTokens: 24_000, beforeCeiling: 24_000 })
			?.replace(/ +/g, " ")
			.trim();

		expect(shown).toBe(`pack ▕█▉${empty(22)}▏ 8% ~24k/300k`);
	});

	test("with no ceiling in force it shows the size alone", () => {
		expect(gauge({ ceiling: 0, approximateTokens: 123_000, beforeCeiling: 123_000 })).toBe(
			"pack ~123k",
		);
	});

	test("an unassembled call says so, and no call clears it", () => {
		expect(renderGauge("unassembled")).toBe("pack: not assembled");
		expect(renderGauge(undefined)).toBeUndefined();
	});
});

describe("the pack widget", () => {
	/** Pins and the Opening in the system prompt, a tail the ceiling cut, a current Turn over the ceiling on its own. */
	const overrun = () =>
		viewPack(
			livePack({
				ceiling: 300_000,
				approximateTokens: 804_839,
				beforeCeiling: 900_000,
				parts: [
					{ source: "pinned", placement: "system-prompt", approximateTokens: 4_000, carried: 2, pinIds: [1, 2], budget: { count: 5, tokens: 8_000 }, candidates: 2 },
					{ source: "opening", placement: "system-prompt", approximateTokens: 9_000, carried: 1, turnIndices: [0], budget: { count: 1, tokens: 10_000 }, candidates: 1 },
					{ source: "verbatim-tail", approximateTokens: 151_000, carried: 1, turnIndices: [9], budget: { count: 8, tokens: 200_000 }, candidates: 5, excluded: { ceiling: 4 }, droppedMessages: 412 },
					{ source: "current-turn", approximateTokens: 612_000, carried: 1, turnIndices: [10], shortened: true },
				],
			}),
			0.9,
		);
	const lineOf = (lines: string[], source: string) =>
		lines.find((line) => line.startsWith(source)) ?? "";
	const barOf = (line: string) => line.match(/[█▏▎▍▌▋▊▉]+/)?.[0] ?? "";

	test("heads the parts with the size, the ceiling and the gauge's mark", () => {
		expect(renderPackWidget(overrun())[0]).toBe("pack ~805k of 300k (268%) · over ceiling");
	});

	test("lists each part once, in the order /pack lists them, in at most five lines", () => {
		const lines = renderPackWidget(overrun());

		expect(lines.slice(1).map((line) => line.split(" ")[0])).toEqual([
			"pinned",
			"opening",
			"verbatim-tail",
			"current-turn",
		]);
		expect(lines.length).toBeLessThanOrEqual(5);
	});

	test("the pins and the opening are marked as sent in the system prompt, in the words /pack uses", () => {
		const lines = renderPackWidget(overrun());

		expect(lineOf(lines, "pinned")).toContain("in the system prompt (2 of 5)");
		expect(lineOf(lines, "opening")).toContain("in the system prompt (1 of 1)");
		expect(lineOf(lines, "verbatim-tail")).not.toContain("system prompt");
		expect(lineOf(lines, "current-turn")).not.toContain("system prompt");
	});

	test("a tail the ceiling cut says so in the words /pack uses for it", () => {
		const pack = overrun();
		const tail = lineOf(renderPackWidget(pack), "verbatim-tail");
		const inspected = renderCall(view({ parts: pack.parts }))
			.split("\n")
			.find((line) => line.trimStart().startsWith("verbatim-tail"));

		expect(tail).toContain("(1 of 8, 4 for the pack ceiling, 412 messages dropped");
		expect(tail).toContain(inspected?.match(/\(.*\)/)?.[0] ?? "no reasons in /pack");
	});

	test("bars are drawn against the larger of the ceiling and the pack, so none overflows", () => {
		const lines = renderPackWidget(overrun()).slice(1);

		for (const line of lines) expect(barOf(line).length).toBeLessThanOrEqual(20);
		// 612k of 805k: three quarters, not a bar pinned full against 300k.
		expect(barOf(lineOf(lines, "current-turn"))).toBe("███████████████▏");
	});

	test("a part that contributed nothing says why", () => {
		const lines = renderPackWidget(
			viewPack(livePack({ parts: [{ source: "opening", placement: "system-prompt", absent: "missing" }] }), 0.9),
		);

		expect(lineOf(lines, "opening")).toContain("absent: the first turn is no longer stored");
	});

	test("pins the conversation does not hold get no line", () => {
		const lines = renderPackWidget(
			viewPack(livePack({ parts: [{ source: "pinned", placement: "system-prompt", carried: 0 }] }), 0.9),
		);

		expect(lines).toHaveLength(1);
	});

	test("an unassembled call and a conversation with none each say so", () => {
		expect(renderPackWidget("unassembled")).toEqual([
			"pack: not assembled — the harness's history went out",
		]);
		expect(renderPackWidget(undefined)).toEqual([
			"pack: no call assembled yet in this conversation",
		]);
	});
});
