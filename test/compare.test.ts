import { describe, expect, test } from "bun:test";

import {
	type BatchPair,
	type ComparedPair,
	evocodeBatch,
	type EvoJob,
	firstFails,
	headline,
	oneArmRows,
	passCounts,
	type RunSummary,
	summaryOf,
} from "../scripts/compare.ts";
import { gateLapses, PairStop } from "../scripts/gate.ts";
import type { Banded, RunMeasures, RunRecord, Score } from "../scripts/measures.ts";

const banded = (total: number): Banded => ({ total, bands: [total, 0, 0, 0, 0] });

/** A complete Run's Measures; everything the comparison does not read is empty. */
function runMeasures(arm: string, fields: Partial<RunMeasures> = {}): RunMeasures {
	return {
		arm,
		index: 0,
		complete: true,
		turns: 9,
		calls: [],
		totals: {} as RunMeasures["totals"],
		cost: 4,
		steps: [],
		passes: 0,
		plants: [],
		probe: { lapse: banded(2), unknown: banded(0) },
		refetches: [],
		refetch: { held: banded(1), left: banded(3), unknown: banded(0) },
		revisits: [],
		...fields,
	};
}

describe("summaryOf", () => {
	const sentinel = "SENTINEL-instruction-text-7f3a";
	const record: RunRecord = {
		arm: "pi-chart",
		index: 1,
		workload: { name: "evocode-theme_x", version: 1, commit: "rev" },
		model: "anthropic/claude-opus-5-5",
		omp: "omp/18.11.0",
		cwd: "/app",
		plants: [],
		prompts: [{ step: "round-1", text: `Do this: ${sentinel}`, probes: [] }],
		checks: [{ step: "round-1", pass: true, exitCode: 0, durationMs: 5, output: `verifier saw ${sentinel}` }],
	};
	const measures = runMeasures("pi-chart", {
		steps: [{ id: "round-1", outcome: "Pass" }],
		passes: 1,
		recall: { recall: banded(4), unknown: banded(1) },
	});

	test("keeps no prompt or check text", () => {
		const summary = summaryOf({ label: "theme_x-pi-chart-1", task: "theme_x" }, record, measures, "high");

		expect(JSON.stringify(summary)).not.toContain(sentinel);
	});

	test("counts Lapses as the Gate does, and takes the thinking level from the Journal when none was given", () => {
		const summary = summaryOf({ label: "theme_x-pi-chart-1", task: "theme_x" }, record, measures, "high");

		expect(summary).toMatchObject({
			label: "theme_x-pi-chart-1",
			arm: "pi-chart",
			index: 1,
			task: "theme_x",
			model: "anthropic/claude-opus-5-5",
			thinking: "high",
			complete: true,
			cost: 4,
			passes: 1,
		});
		expect(summary.thinkingGiven).toBeUndefined();
		expect(summary.lapses).toBe(gateLapses(measures));
	});

	test("a level the Run was given wins over the Journal's", () => {
		const summary = summaryOf({ label: "pi-chart-1" }, { ...record, thinking: "low" }, measures, "high");

		expect(summary).toMatchObject({ thinking: "low", thinkingGiven: true });
	});
});

/** A Score at `distance` Turns from its planting, right or not; an unplanted one has no distance. */
function score(right: boolean, distance?: number): Score {
	return {
		id: "p",
		turn: 10,
		kind: "literal",
		right,
		...(distance === undefined ? {} : { planted: 10 - distance, distance }),
		position: distance === undefined ? "unplanted" : "tail",
		source: right ? "tail" : "none",
	};
}

function run(arm: RunSummary["arm"], fields: Partial<RunSummary> = {}): RunSummary {
	return { label: `${arm}-0`, arm, index: 0, complete: true, cost: 1, steps: [], passes: 1, lapses: 0, plants: [], ...fields };
}

function pair(vanilla: Partial<RunSummary>, piChart: Partial<RunSummary>, task = "gate"): ComparedPair {
	return { task, vanilla: run("vanilla", vanilla), piChart: run("pi-chart", piChart) };
}

function row(rows: ReturnType<typeof headline>, measure: string) {
	const found = rows.find((each) => each.measure === measure);
	if (!found) throw new Error(`no row ${measure}: ${rows.map((each) => each.measure).join(", ")}`);
	return found;
}

describe("headline", () => {
	test("Cost per Run is a ratio of geometric means, with exp of the paired interval's bounds", () => {
		const rows = headline([pair({ cost: 2 }, { cost: 4 }), pair({ cost: 2 }, { cost: 3 }), pair({ cost: 4 }, { cost: 4 })], true);
		const cost = row(rows, "Cost per Run");

		expect(cost.scale).toBe("ratio");
		expect(cost.vanilla).toBeCloseTo(2.519842, 5);
		expect(cost.piChart).toBeCloseTo(3.634241, 5);
		expect(Math.exp(cost.diff.mean)).toBeCloseTo(1.44225, 5);
		expect(Math.exp(cost.diff.lower as number)).toBeCloseTo(0.607219, 5);
		expect(Math.exp(cost.diff.upper as number)).toBeCloseTo(3.425591, 5);
		expect(cost.diff.df).toBe(2);
	});

	test("a pair with no Pass on either side is left out of Cost per Pass, and counted", () => {
		const rows = headline([pair({ cost: 2, passes: 2 }, { cost: 3, passes: 1 }), pair({ cost: 2, passes: 0 }, { cost: 3, passes: 1 })], true);
		const perPass = row(rows, "Cost per Pass");

		expect(perPass.excluded).toBe(1);
		expect(perPass.diff.pairs).toBe(1);
		expect(Math.exp(perPass.diff.mean)).toBeCloseTo(3, 10);
		expect(row(rows, "Cost per Run").diff.pairs).toBe(2);
	});

	test("void pairs count in no figure", () => {
		const rows = headline([pair({ lapses: 1 }, { lapses: 2 }), pair({ lapses: 0, complete: false }, { lapses: 9 })], true);

		expect(row(rows, "Lapses per Run").diff).toMatchObject({ pairs: 1, mean: 1 });
	});

	test("Retention counts a pair in a band only when both Runs scored a planted Probe there", () => {
		const rows = headline(
			[
				pair({ plants: [score(true, 3), score(false, 4)] }, { plants: [score(true, 2)] }),
				pair({ plants: [score(true, 3)] }, { plants: [score(false)] }),
			],
			true,
		);
		const near = row(rows, "Retention, 1–5 Turns");

		expect(near.scale).toBe("share");
		expect(near.tallies).toEqual({ vanilla: { right: 1, of: 2 }, piChart: { right: 1, of: 1 } });
		expect(near.excluded).toBe(1);
		expect(near.diff).toMatchObject({ pairs: 1, mean: 0.5 });
	});

	test("a band no pair reaches shows no figure, not zero", () => {
		const far = row(headline([pair({ plants: [score(true, 3)] }, { plants: [score(true, 3)] })], true), "Retention, ≥25 Turns");

		expect(far.vanilla).toBeUndefined();
		expect(far.piChart).toBeUndefined();
		expect(far.diff.pairs).toBe(0);
	});

	test("a batch whose Workload states no Plants gives one Retention row reading n/a", () => {
		const retention = headline([pair({}, {})], false).filter((each) => each.measure.startsWith("Retention"));

		expect(retention).toHaveLength(1);
		expect(retention[0]?.note).toBe("n/a: no Plants");
	});

	test("differences are pooled within tasks, each task weighing the same", () => {
		const rows = headline(
			[pair({ lapses: 0 }, { lapses: 1 }, "a"), pair({ lapses: 0 }, { lapses: 3 }, "a"), pair({ lapses: 0 }, { lapses: 10 }, "b")],
			false,
		);

		expect(row(rows, "Lapses per Run").diff).toMatchObject({ pairs: 3, tasks: 2, mean: 6, df: 1 });
	});
});

describe("per-Run tables", () => {
	const runs = [
		run("vanilla", {
			steps: [
				{ id: "a", outcome: "Pass" },
				{ id: "b", outcome: "Fail" },
				{ id: "c", outcome: "not graded" },
			],
			firstFail: "b",
			compactions: 2,
		}),
		run("vanilla", { complete: false, steps: [{ id: "a", outcome: "Pass" }], compactions: 40 }),
		run("vanilla", { steps: [{ id: "a", outcome: "Pass" }, { id: "b", outcome: "Pass" }], compactions: 4 }),
		run("pi-chart", {
			steps: [
				{ id: "a", outcome: "Pass" },
				{ id: "b", outcome: "Pass" },
			],
			pulls: { recall_earlier_turns: { calls: 3, tokens: 90 } } as RunSummary["pulls"],
		}),
	];

	test("Passes per step count complete Runs only", () => {
		expect(passCounts(runs)).toEqual([
			{ step: "a", vanilla: { pass: 2, of: 2 }, piChart: { pass: 1, of: 1 } },
			{ step: "b", vanilla: { pass: 1, of: 2 }, piChart: { pass: 1, of: 1 } },
		]);
	});

	test("EvoCode steps are named by task", () => {
		const steps = passCounts([run("vanilla", { task: "t1", steps: [{ id: "round-1", outcome: "Pass" }] })]).map((each) => each.step);

		expect(steps).toEqual(["t1: round-1"]);
	});

	test("first failing steps are counted per Arm over complete Runs", () => {
		expect(firstFails(runs)).toEqual([
			{ step: "b", vanilla: 1, piChart: 0 },
			{ step: "none", vanilla: 1, piChart: 1 },
		]);
	});

	test("Compactions are plain omp's alone and Pulls pi-chart's alone", () => {
		const rows = oneArmRows(runs);

		expect(rows.find((each) => each.measure === "Compactions per Run")).toEqual({ measure: "Compactions per Run", vanilla: 3, piChart: "n/a" });
		expect(rows.find((each) => each.measure === "Pulls per Run: recall_earlier_turns")).toEqual({
			measure: "Pulls per Run: recall_earlier_turns",
			vanilla: "n/a",
			piChart: 3,
		});
	});
});

describe("evocodeBatch", () => {
	const pairOf = (job: EvoJob, complete = true): BatchPair => ({
		index: job.index,
		task: job.task,
		vanilla: `${job.task}-vanilla-${job.replica}`,
		piChart: `${job.task}-pi-chart-${job.replica}`,
		complete,
	});

	test("runs every task's first pair before any task's second", async () => {
		const started: string[] = [];
		await evocodeBatch({
			tasks: ["a", "b"],
			perTask: 2,
			cap: 100,
			width: 1,
			runPair: async (job) => {
				started.push(`${job.index} ${job.task} ${job.replica}`);
				return { pair: pairOf(job), cost: 1 };
			},
		});

		expect(started).toEqual(["0 a 0", "1 b 0", "2 a 1", "3 b 1"]);
	});

	test("a void pair is kept and not run again", async () => {
		let calls = 0;
		const batch = await evocodeBatch({
			tasks: ["a", "b"],
			perTask: 1,
			cap: 100,
			width: 1,
			runPair: async (job) => {
				calls++;
				return { pair: pairOf(job, job.task !== "a"), cost: 1 };
			},
		});

		expect(calls).toBe(2);
		expect(batch.pairs.map((each) => each.complete)).toEqual([false, true]);
		expect(batch.capped).toBe(false);
	});

	test("the cap leaves the remaining pairs unstarted", async () => {
		const batch = await evocodeBatch({
			tasks: ["a", "b", "c", "d"],
			perTask: 2,
			cap: 125,
			width: 1,
			runPair: async (job) => ({ pair: pairOf(job), cost: 25 }),
		});

		expect(batch.pairs).toHaveLength(5);
		expect(batch.capped).toBe(true);
		expect(batch.spent).toBe(125);
	});

	test("a pair that cannot count stops the batch, and what its finished Run cost is spent", async () => {
		let calls = 0;
		const batch = await evocodeBatch({
			tasks: ["a", "b", "c"],
			perTask: 1,
			cap: 100,
			width: 1,
			runPair: async (job) => {
				calls++;
				if (job.index === 1) throw new PairStop("b-pi-chart-0: harbor run exited 1", 3);
				return { pair: pairOf(job), cost: 2 };
			},
		});

		expect(calls).toBe(2);
		expect(batch.pairs).toHaveLength(1);
		expect(batch.spent).toBe(5);
		expect(batch.stopped).toBe("b-pi-chart-0: harbor run exited 1");
		expect(batch.capped).toBe(false);
	});

	test("a resumed batch runs only the pairs its record lacks, and keeps the void one", async () => {
		const started: number[] = [];
		const batch = await evocodeBatch({
			tasks: ["a", "b"],
			perTask: 2,
			cap: 100,
			width: 1,
			prior: { pairs: [pairOf({ index: 0, task: "a", replica: 0 }, false), pairOf({ index: 1, task: "b", replica: 0 })], spent: 10 },
			runPair: async (job) => {
				started.push(job.index);
				return { pair: pairOf(job), cost: 2 };
			},
		});

		expect(started).toEqual([2, 3]);
		expect(batch.pairs.map((each) => [each.index, each.complete])).toEqual([
			[0, false],
			[1, true],
			[2, true],
			[3, true],
		]);
		expect(batch.spent).toBe(14);
	});

	test("a resumed batch's cap counts what it spent before it stopped", async () => {
		const batch = await evocodeBatch({
			tasks: ["a", "b", "c", "d"],
			perTask: 2,
			cap: 125,
			width: 1,
			prior: { pairs: [0, 1, 2, 3].map((index) => pairOf({ index, task: "abcd"[index] as string, replica: 0 })), spent: 120 },
			runPair: async (job) => ({ pair: pairOf(job), cost: 25 }),
		});

		expect(batch.pairs).toHaveLength(5);
		expect(batch.spent).toBe(145);
		expect(batch.capped).toBe(true);
	});
});
