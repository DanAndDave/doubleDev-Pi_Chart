import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { aggregate, measureRun, type RevisitScore, type RunMeasures, type Score } from "../scripts/measures.ts";
import { readBranch } from "../src/journal.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { approximateTokens } from "../src/tokens.ts";

const fixture = (name: string) => new URL(`./fixtures/runs/${name}`, import.meta.url).pathname;

describe("measureRun", () => {
	test("Cost per Run counts subagent Calls, which sit outside every Turn", async () => {
		const measures = await measureRun(fixture("complete"));

		expect(measures.cost).toBeCloseTo(1.25, 10);
		expect(measures.calls.filter((call) => call.subagent).map((call) => call.turn)).toEqual([-1, -1]);
		expect(measures.calls.filter((call) => !call.subagent).map((call) => call.turn)).toEqual([0, 1, 1, 2]);
		expect(measures.totals.calls).toBe(6);
		expect(measures.totals.cacheWrite).toBe(9000 + 300 + 100 + 200 + 2000 + 60);
	});

	test("names the first failing step and counts Passes", async () => {
		const measures = await measureRun(fixture("complete"));

		expect(measures.passes).toBe(1);
		expect(measures.firstFail).toBe("two");
		expect(measures.steps).toEqual([
			{ id: "one", outcome: "Pass" },
			{ id: "two", outcome: "Fail" },
			{ id: "three", outcome: "Fail" },
		]);
	});

	test("scores each Plant of a Probe from the reply's text alone", async () => {
		const measures = await measureRun(fixture("complete"));

		// The build number is only in the reply's thinking, which is not the answer.
		// No Accounting was exported, so where each Plant sat is unknown.
		expect(measures.plants).toEqual([
			{ id: "codeword", turn: 2, kind: "literal", right: true, planted: 0, distance: 2, position: "unknown", source: "unknown" },
			{
				id: "build",
				turn: 2,
				kind: "literal",
				right: false,
				planted: 1,
				distance: 1,
				position: "unknown",
				source: "unknown",
				class: "unknown",
			},
		]);
	});

	test("a Probe the Run never reached is not scored, and its unchecked steps are not graded", async () => {
		const measures = await measureRun(fixture("failed-early"));

		expect(measures.complete).toBe(false);
		expect(measures.plants).toEqual([]);
		expect(measures.steps.map((step) => step.outcome)).toEqual(["Pass", "not graded", "not graded"]);
	});
});

const none = { total: 0, bands: [0, 0, 0, 0, 0] };

describe("Plant scores", () => {
	test("each kind, position and source on a pi-chart Run", async () => {
		const measures = await measureRun(fixture("pi-chart-plants"));

		const literal = { kind: "literal" } as const;
		const probe11 = { turn: 11, tools: false } as const;
		expect(measures.plants).toEqual([
			// No Accounting for Turn 7's Call.
			{ id: "build", turn: 7, ...literal, right: false, planted: 2, distance: 5, position: "unknown", source: "unknown", class: "unknown" },
			// The write's content holds the rule; the tail that held Turn 5 was carried shortened.
			{ id: "owner", turn: 8, kind: "constraint", right: true, planted: 5, distance: 3, position: "unknown", source: "unknown" },
			// Read at Turn 4, gone from the window, read again despite the prompt.
			{
				id: "secret",
				turn: 9,
				...literal,
				right: true,
				planted: 4,
				distance: 5,
				position: "evicted",
				source: "result",
				breach: true,
				tools: false,
			},
			{
				id: "port",
				turn: 10,
				kind: "superseded",
				right: true,
				planted: 3,
				distance: 7,
				position: "evicted",
				source: "pull",
				pull: "recall_earlier_turns",
			},
			{ id: "codeword", ...probe11, ...literal, right: true, planted: 0, distance: 11, position: "opening", source: "opening" },
			{ id: "build", ...probe11, ...literal, right: false, planted: 2, distance: 9, position: "evicted", source: "none", class: "lapse" },
			// Turn 10's recall and reply, in the tail, held the value; the reply gave the earlier one.
			{
				id: "port",
				...probe11,
				kind: "superseded",
				right: false,
				stale: true,
				planted: 3,
				distance: 8,
				position: "evicted",
				source: "tail",
				class: "despite",
			},
			{ id: "leaky", ...probe11, ...literal, right: true, planted: 6, distance: 5, position: "evicted", source: "none", class: "leak" },
			{ id: "ghost", ...probe11, ...literal, right: false, position: "unplanted", source: "none", class: "unplanted" },
			// Turn 9's re-read, in the tail, held it.
			{ id: "secret", ...probe11, ...literal, right: true, planted: 4, distance: 7, position: "evicted", source: "tail" },
			{ id: "pinned", ...probe11, ...literal, right: true, planted: 1, distance: 10, position: "pin", source: "pin" },
		]);
		expect(measures.probe).toEqual({
			lapse: { total: 1, bands: [0, 0, 1, 0, 0] },
			unknown: { total: 1, bands: [1, 0, 0, 0, 0] },
		});
	});

	test("a plain-omp summary holds a Plant its tail let go, and a Plant read from a file enters at the read", async () => {
		const measures = await measureRun(fixture("vanilla-plants"));

		const probe = { turn: 9, kind: "literal", tools: false } as const;
		expect(measures.plants).toEqual([
			{ id: "build", ...probe, right: true, planted: 2, distance: 7, position: "summary", source: "summary" },
			{ id: "color", ...probe, right: false, planted: 3, distance: 6, position: "evicted", source: "none", class: "lapse" },
			{ id: "mark", ...probe, right: true, planted: 7, distance: 2, position: "tail", source: "tail" },
			{ id: "tag", ...probe, right: false, planted: 1, distance: 8, position: "evicted", source: "none", class: "lapse" },
			{ id: "seal", ...probe, right: true, planted: 6, distance: 3, position: "tail", source: "tail" },
		]);
		expect(measures.probe).toEqual({ lapse: { total: 2, bands: [0, 1, 1, 0, 0] }, unknown: none });
	});

	test("a reply naming both a superseded value and its earlier one is wrong and stale", async () => {
		const dir = await variant("pi-chart-plants", (journal) =>
			journal.replace("PLUM-17, 1234, PORT-3304,", "PLUM-17, 1234, PORT-8817 or PORT-3304,"),
		);

		const port = (await measureRun(dir)).plants.find((score) => score.id === "port" && score.turn === 11);

		expect(port).toMatchObject({ right: false, stale: true });
	});

	test("failed Probes are zero in every band, not absent, on a Run whose Probes all pass", async () => {
		const dir = await variant("vanilla-plants", (journal) =>
			journal.replace("7341, UNKNOWN, MARK-77, UNKNOWN, SEAL-5", "7341, TEAL-12, MARK-77, TAG-4, SEAL-5"),
		);

		const measures = await measureRun(dir);

		expect(measures.plants.every((score) => score.right)).toBe(true);
		expect(measures.probe).toEqual({ lapse: none, unknown: none });
	});

	test("failed Probes are zero in every band, not absent, on a Run with no Probe", async () => {
		const measures = await measureRun(fixture("pi-chart-evicted"));

		expect(measures.probe).toEqual({ lapse: none, unknown: none });
	});
});

/** A copy of fixture `name` whose Journal text went through `edit`. */
async function variant(name: string, edit: (journal: string) => string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `measures-${name}-`));
	await cp(fixture(name), dir, { recursive: true });
	const path = join(dir, "journal.jsonl");
	const journal = await readFile(path, "utf8");
	const edited = edit(journal);
	if (edited === journal) throw new Error(`the edit changed nothing in ${name}'s Journal`);
	await writeFile(path, edited);
	return dir;
}

/** The windows of the main Calls answering `turn`, in Call order. */
async function windows(name: string, turn: number) {
	const measures = await measureRun(fixture(name));
	return measures.calls.filter((call) => !call.subagent && call.turn === turn).map((call) => call.window);
}

describe("the window each Call sent", () => {
	test("a pi-chart Call's tail, Opening and Pins are what Accounting says it carried", async () => {
		const [first] = await windows("pi-chart-evicted", 5);

		expect(first).toEqual({ opening: 0, pins: [1], tail: { turns: [4] }, current: 5 });
	});

	test("a pi-chart Call with no Accounting has an unknown window, not an empty one", async () => {
		const turn5 = await windows("pi-chart-evicted", 5);

		expect(turn5).toHaveLength(4);
		expect(turn5[2]).toBe("unknown");
		expect(turn5[3]).toEqual({ opening: 0, pins: [1], tail: { turns: [4] }, current: 5 });
	});

	test("a pi-chart Call that went unassembled sent the whole branch", async () => {
		const [unassembled, assembled] = await windows("pi-chart-evicted", 3);

		expect(unassembled).toEqual({ pins: [], tail: { turns: [0, 1, 2] }, current: 3 });
		expect(assembled).toEqual({ opening: 0, pins: [], tail: { turns: [1, 2] }, current: 3 });
	});

	test("a plain-omp Call after a compaction holds its summary and the tail from what it kept", async () => {
		const [first] = await windows("vanilla-compacted", 9);

		expect(first).toEqual({ pins: [], summary: "k1", tail: { turns: [6, 7, 8], from: { turn: 6, message: 3 } }, current: 9 });
	});

	test("a plain-omp Call before every compaction holds the whole branch", async () => {
		const [first] = await windows("vanilla-compacted", 5);

		expect(first).toEqual({ pins: [], tail: { turns: [0, 1, 2, 3, 4] }, current: 5 });
	});

	test("a pi-chart Run whose Accounting is missing gives unknown windows, and subagent Calls none", async () => {
		const measures = await measureRun(fixture("complete"));

		expect(measures.calls.filter((call) => !call.subagent).map((call) => call.window)).toEqual([
			"unknown",
			"unknown",
			"unknown",
			"unknown",
		]);
		expect(measures.calls.filter((call) => call.subagent).map((call) => call.window)).toEqual([undefined, undefined]);
	});
});

describe("Re-fetches", () => {
	test("a pi-chart Run's Re-fetches are held, left or unknown by the window of the Call that made them", async () => {
		const measures = await measureRun(fixture("pi-chart-evicted"));

		// Not Re-fetches: Turn 4's second read of B (same Turn), the error
		// at Turns 2 and 5, the empty result at Turns 2 and 3.
		expect(measures.refetches).toEqual([
			{ turn: 4, call: 0, earlierTurn: 3, distance: 1, tool: "read", class: "held" },
			{ turn: 5, call: 0, earlierTurn: 1, distance: 4, tool: "read", class: "left" },
			{ turn: 5, call: 2, earlierTurn: 0, distance: 5, tool: "read", class: "unknown" },
		]);
		expect(measures.refetch).toEqual({
			held: { total: 1, bands: [1, 0, 0, 0, 0] },
			left: { total: 1, bands: [1, 0, 0, 0, 0] },
			unknown: { total: 1, bands: [1, 0, 0, 0, 0] },
		});
	});

	test("a plain-omp Run's Re-fetch from before a compaction's cut is left, and one from the cut on held", async () => {
		const measures = await measureRun(fixture("vanilla-compacted"));

		// D read at Turn 2, edited at Turn 3, read again with new text at Turn 4: not a Re-fetch.
		// The cut is Turn 6's message 3 (H): G, message 2 of the same Turn, is before it.
		expect(measures.refetches).toEqual([
			{ turn: 5, call: 0, earlierTurn: 1, distance: 4, tool: "read", class: "held" },
			{ turn: 9, call: 0, earlierTurn: 3, distance: 6, tool: "read", class: "left" },
			{ turn: 9, call: 1, earlierTurn: 6, distance: 3, tool: "read", class: "held" },
			{ turn: 9, call: 1, earlierTurn: 6, distance: 3, tool: "read", class: "left" },
		]);
		expect(measures.refetch).toEqual({
			held: { total: 2, bands: [2, 0, 0, 0, 0] },
			left: { total: 2, bands: [1, 1, 0, 0, 0] },
			unknown: none,
		});
	});
});

describe("compactions per Run", () => {
	test("count the compactions on a plain-omp Run's branch", async () => {
		expect((await measureRun(fixture("vanilla-compacted"))).compactions).toBe(1);
	});

	test("are absent on pi-chart, which suppresses compaction", async () => {
		expect((await measureRun(fixture("pi-chart-evicted"))).compactions).toBeUndefined();
	});

	test("are zero, not absent, on a plain-omp Run that never compacted, which counts zero Re-fetches", async () => {
		const dir = await mkdtemp(join(tmpdir(), "measures-vanilla-"));
		await cp(fixture("complete"), dir, { recursive: true });
		const record = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
		await writeFile(join(dir, "run.json"), JSON.stringify({ ...record, arm: "vanilla" }));

		const measures = await measureRun(dir);

		expect(measures.compactions).toBe(0);
		expect(measures.refetches).toEqual([]);
		expect(measures.refetch).toEqual({ held: none, left: none, unknown: none });
	});
});

/**
 * The estimated tokens of every result `tool` returned in the fixture's main
 * Journal, summed: called directly, or run through the tool device.
 */
async function returned(name: string, tool: string): Promise<number> {
	const { turns } = await readBranch(join(fixture(name), "journal.jsonl"));
	const ran = (message: HarnessMessage) => {
		const xdev = (message.details as { xdev?: { tool?: unknown; mode?: unknown } } | undefined)?.xdev;
		return xdev?.mode === "execute" ? xdev.tool : message.toolName;
	};
	const results = turns.flatMap((turn) => turn.messages).filter((message) => ran(message) === tool);
	return results.reduce((sum, result) => sum + approximateTokens([result]), 0);
}

describe("Pulls", () => {
	test("are counted per tool with the tokens their results returned, failed calls included", async () => {
		const measures = await measureRun(fixture("pi-chart-pulls"));

		const calls = Object.fromEntries(Object.entries(measures.pulls ?? {}).map(([tool, { calls }]) => [tool, calls]));
		expect(calls).toEqual({
			recall_earlier_turns: 3,
			recall_across_conversations: 5,
			search_documentation: 2,
			walk_documentation: 1,
			codebase_structure: 1,
		});
		for (const tool of Object.keys(calls)) {
			expect(measures.pulls?.[tool as keyof typeof measures.pulls].tokens).toBe(await returned("pi-chart-pulls", tool));
		}
		expect(measures.pulls?.search_documentation.tokens).toBeGreaterThan(0);
	});

	test("a write to the bundle is counted apart and is not a Pull", async () => {
		const measures = await measureRun(fixture("pi-chart-pulls"));

		expect(measures.writes).toBe(2);
		expect(Object.keys(measures.pulls ?? {})).not.toContain("write_documentation");
	});

	test("are zero, not absent, for every tool a pi-chart Run never called", async () => {
		const measures = await measureRun(fixture("pi-chart-evicted"));

		expect(measures.pulls).toEqual({
			recall_earlier_turns: { calls: 0, tokens: 0 },
			recall_across_conversations: { calls: 0, tokens: 0 },
			search_documentation: { calls: 0, tokens: 0 },
			walk_documentation: { calls: 0, tokens: 0 },
			codebase_structure: { calls: 0, tokens: 0 },
		});
		expect(measures.writes).toBe(0);
	});

	test("are absent on plain omp, which has no Pull tool", async () => {
		const measures = await measureRun(fixture("vanilla-compacted"));

		expect(measures.pulls).toBeUndefined();
		expect(measures.writes).toBeUndefined();
		expect(measures.recalls).toBeUndefined();
		expect(measures.recall).toBeUndefined();
	});
});

describe("recall Pulls", () => {
	test("are the Pulls that returned a Turn of the Run the window did not carry, at the nearest such Turn", async () => {
		const measures = await measureRun(fixture("pi-chart-pulls"));

		// Not here: Turn 4's failed recall, Turn 5's documentation and
		// structure Pulls, Turn 8's search of another Conversation only and
		// its search of Turn 7, which the tail carried.
		expect(measures.recalls).toEqual([
			// Turns returned, none named: the record cannot say which.
			{ turn: 6, call: 0, tool: "recall_across_conversations", class: "unknown" },
			// No Accounting for this Call: Turn 1 may have been carried.
			{ turn: 7, call: 0, tool: "recall_across_conversations", distance: 6, class: "unknown" },
			// The tool returns only what is before the tail, whatever the record says.
			{ turn: 7, call: 0, tool: "recall_earlier_turns", distance: 7, class: "recall" },
			{ turn: 9, call: 0, tool: "recall_earlier_turns", distance: 4, class: "recall" },
			// Turn 8 was carried and the other Conversation's Turn 4 is not the Run's: Turn 3 decides.
			{ turn: 9, call: 0, tool: "recall_across_conversations", distance: 6, class: "recall" },
		]);
	});

	test("are banded by distance, and one with no distance counts in its total only", async () => {
		const measures = await measureRun(fixture("pi-chart-pulls"));

		expect(measures.recall).toEqual({
			recall: { total: 3, bands: [1, 2, 0, 0, 0] },
			unknown: { total: 2, bands: [0, 1, 0, 0, 0] },
		});
	});

	test("are zero in every band, not absent, on a pi-chart Run that made none", async () => {
		const measures = await measureRun(fixture("pi-chart-evicted"));

		expect(measures.recalls).toEqual([]);
		expect(measures.recall).toEqual({ recall: none, unknown: none });
	});
});

describe("Revisit scores", () => {
	test("each class on a pi-chart Run, judged by whether a call named the file and where the window held the earlier read", async () => {
		const measures = await measureRun(fixture("pi-chart-revisits"));

		expect(measures.revisits).toEqual([
			// Fetched again while the tail still carried Turn 2.
			{ id: "table", file: "notes/table.md", step: "s4", turn: 4, read: 2, distance: 2, fetched: 4, position: "tail", class: "held", outcome: "Pass" },
			// Changed at Turn 2: whatever the step did, it is not scored by the window.
			{ id: "edit", file: "notes/edit.md", step: "s5", turn: 5, read: 1, distance: 4, position: "evicted", class: "edited", outcome: "Pass" },
			// A ranged read with different text is still a fetch, and the tail had let Turn 1 go.
			{ id: "scale", file: "notes/scale.md", step: "s6", turn: 6, read: 1, distance: 5, fetched: 6, position: "evicted", class: "left", outcome: "Pass" },
			// The read failed, and the search that found the file never named it.
			{ id: "grid", file: "notes/grid.md", step: "s7", turn: 7, read: 3, distance: 4, position: "evicted", class: "unfetched", outcome: "Fail" },
			{ id: "never", file: "notes/never.md", step: "s8", turn: 8, position: "unread", class: "unread", outcome: "Fail" },
			{
				id: "spec",
				file: "notes/spec.md",
				step: "s9",
				turn: 9,
				read: 0,
				distance: 9,
				position: "evicted",
				class: "unfetched",
				pull: "recall_earlier_turns",
				outcome: "Pass",
			},
			// The most recent read is Turn 4's; Turn 10 has no Accounting.
			{ id: "table2", file: "notes/table.md", step: "s10", turn: 10, read: 4, distance: 6, fetched: 10, position: "unknown", class: "unknown", outcome: "Pass" },
		]);
	});

	test("a plain-omp Revisit is held before a compaction, and sits in the summary after its cut", async () => {
		const measures = await measureRun(fixture("vanilla-revisits"));

		expect(measures.revisits).toEqual([
			{ id: "a", file: "notes/a.md", step: "s3", turn: 3, read: 1, distance: 2, fetched: 3, position: "tail", class: "held", outcome: "Pass" },
			{ id: "b", file: "notes/b.md", step: "s7", turn: 7, read: 2, distance: 5, position: "summary", class: "unfetched", outcome: "Pass" },
			{ id: "a2", file: "notes/a.md", step: "s8", turn: 8, read: 3, distance: 5, fetched: 8, position: "summary", class: "left", outcome: "Pass" },
		]);
	});

	test("a Revisit whose step the Run never finished is not scored, nor is a record without Revisits", async () => {
		expect((await measureRun(fixture("failed-early"))).revisits).toEqual([]);
		expect((await measureRun(fixture("complete"))).revisits).toEqual([]);
	});
});

/** A Run's Measures with only what `aggregate` reads set; the rest are inert. */
function run(arm: string, cost: number, outcomes: ("Pass" | "Fail")[], extra: Partial<RunMeasures> = {}): RunMeasures {
	const steps = outcomes.map((outcome, at) => ({ id: `s${at}`, outcome }));
	return {
		arm,
		index: 0,
		complete: true,
		turns: 1,
		calls: [],
		totals: {
			calls: 0,
			input: 0,
			cacheRead: 0,
			cacheWrite: 0,
			output: 0,
			prompt: 0,
			effective: 0,
			cost,
			peak: 0,
			floor: Number.NaN,
			prefixHeld: Number.NaN,
			earlyWrite: 0,
		},
		cost,
		steps,
		passes: outcomes.filter((outcome) => outcome === "Pass").length,
		firstFail: steps.find((step) => step.outcome === "Fail")?.id,
		plants: [],
		probe: { lapse: none, unknown: none },
		refetches: [],
		refetch: { held: none, left: none, unknown: none },
		revisits: [],
		...extra,
	};
}

describe("aggregate", () => {
	test("Cost per Pass is summed cost over summed Passes", () => {
		const arms = aggregate([
			run("pi-chart", 3, ["Pass", "Pass", "Pass", "Pass"]),
			run("pi-chart", 5, ["Pass", "Pass", "Fail", "Fail"]),
		]);

		expect(arms.get("pi-chart")?.costPerPass).toEqual({ usd: 8 / 6 });
	});

	test("graded Runs without a Pass have no Pass, not zero or infinity", () => {
		const arms = aggregate([run("vanilla", 2, ["Fail"]), run("vanilla", 3, ["Fail", "Fail"])]);

		expect(arms.get("vanilla")?.costPerPass).toBe("no Pass");
	});

	test("an ungraded Workload's Cost per Pass is not applicable", () => {
		const arms = aggregate([run("vanilla", 2, []), run("pi-chart", 1, [])]);

		expect(arms.get("vanilla")?.costPerPass).toBe("n/a");
		expect(arms.get("pi-chart")?.costPerPass).toBe("n/a");
	});

	test("incomplete Runs are left out and counted", () => {
		const arms = aggregate([
			run("pi-chart", 3, ["Pass"]),
			run("pi-chart", 4, ["Pass"]),
			run("pi-chart", 100, ["Pass"], { complete: false }),
		]);

		const piChart = arms.get("pi-chart");
		expect(piChart?.complete.length).toBe(2);
		expect(piChart?.excluded).toBe(1);
		expect(piChart?.costPerPass).toEqual({ usd: 7 / 2 });
	});

	const score = (extra: Partial<Score> = {}): Score => ({
		id: "build",
		turn: 9,
		kind: "literal",
		right: true,
		planted: 2,
		distance: 7,
		position: "tail",
		source: "tail",
		...extra,
	});
	const scored = (scores: Score[], complete = true) => run("pi-chart", 1, [], { complete, plants: scores });

	test("Retention is per Probe: the complete Runs that scored that Plant right at that Turn", () => {
		const arms = aggregate([
			scored([score(), score({ turn: 12 })]),
			scored([score({ right: false, class: "despite" }), score({ turn: 12 })]),
			scored([score({ right: false, class: "despite" }), score({ turn: 12 })], false),
		]);

		expect(arms.get("pi-chart")?.retention).toEqual([
			{ id: "build", turn: 9, kind: "literal", right: 1, of: 2 },
			{ id: "build", turn: 12, kind: "literal", right: 2, of: 2 },
		]);
	});

	test("Retention by position and band, sources and counts are over complete Runs", () => {
		const evicted = score({ right: false, position: "evicted", source: "none", class: "lapse" });
		const arms = aggregate([
			scored([score()]),
			scored([evicted]),
			scored([evicted]),
			scored([score({ position: "evicted", source: "none", class: "leak" })]),
			scored([
				score({ right: false, planted: undefined, distance: undefined, position: "unplanted", source: "none", class: "unplanted" }),
			]),
			scored([evicted, evicted], false),
		]);

		const piChart = arms.get("pi-chart");
		expect(piChart?.byPosition?.tail).toEqual({ right: 1, of: 1 });
		expect(piChart?.byPosition?.evicted).toEqual({ right: 1, of: 3 });
		expect(piChart?.byPosition?.unplanted).toEqual({ right: 0, of: 1 });
		// Band 6–7 holds every score with a distance; the unplanted one is in none.
		expect(piChart?.byBand).toEqual([
			{ right: 0, of: 0 },
			{ right: 2, of: 4 },
			{ right: 0, of: 0 },
			{ right: 0, of: 0 },
			{ right: 0, of: 0 },
		]);
		expect(piChart?.sources?.none).toEqual({ right: 1, wrong: 3 });
		expect(piChart?.sources?.tail).toEqual({ right: 1, wrong: 0 });
		expect(piChart?.counts).toEqual({ leak: 1, despite: 0, stale: 0, breach: 0 });
	});

	const revisit = (extra: Partial<RevisitScore> = {}): RevisitScore => ({
		id: "offset",
		file: "notes/scale.md",
		step: "add-shift",
		turn: 9,
		read: 1,
		distance: 8,
		position: "evicted",
		class: "unfetched",
		outcome: "Pass",
		...extra,
	});
	const revisited = (scores: RevisitScore[], complete = true) => run("pi-chart", 1, [], { complete, revisits: scores });
	const classes = (counts: Partial<Record<RevisitScore["class"], number>>) => ({
		held: 0,
		left: 0,
		unknown: 0,
		unfetched: 0,
		edited: 0,
		unread: 0,
		...counts,
	});

	test("Revisits are judged by the step's check whether the agent fetched the file or answered directly", () => {
		const arms = aggregate([
			revisited([revisit({ class: "left", fetched: 9 })]),
			revisited([revisit()]),
			revisited([revisit({ outcome: "Fail" })]),
			revisited([revisit({ class: "left", fetched: 9 })], false),
		]);

		const revisits = arms.get("pi-chart")?.revisits;
		expect(revisits?.each).toEqual([
			{ id: "offset", file: "notes/scale.md", step: "add-shift", classes: classes({ left: 1, unfetched: 2 }) },
		]);
		expect(revisits?.byClass.left).toEqual({ pass: 1, of: 1 });
		expect(revisits?.byClass.unfetched).toEqual({ pass: 1, of: 2 });
		expect(revisits?.byPosition.evicted).toEqual({ pass: 2, of: 3 });
	});

	test("a Revisit whose step was not graded is counted, but in no Pass figure", () => {
		const arms = aggregate([revisited([revisit({ outcome: "not graded" })]), revisited([revisit({ position: "tail" })])]);

		const revisits = arms.get("pi-chart")?.revisits;
		expect(revisits?.each[0]?.classes).toEqual(classes({ unfetched: 2 }));
		expect(revisits?.byClass.unfetched).toEqual({ pass: 1, of: 1 });
		expect(revisits?.byPosition).toEqual({
			tail: { pass: 1, of: 1 },
			summary: { pass: 0, of: 0 },
			evicted: { pass: 0, of: 0 },
			unknown: { pass: 0, of: 0 },
			unread: { pass: 0, of: 0 },
		});
	});

	test("Revisits have no figure, not zero, when a complete Run was measured before Revisits were scored", () => {
		const { revisits: _absent, ...rest } = revisited([]);
		// A `bench.json` written before Revisits were scored has Measures without the field.
		const old = rest as RunMeasures;

		const arms = aggregate([revisited([revisit()]), old]);

		expect(arms.get("pi-chart")?.revisits).toBeUndefined();
	});
});
