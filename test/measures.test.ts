import { describe, expect, test } from "bun:test";

import { aggregate, measureRun, type RunMeasures } from "../scripts/measures.ts";

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
		expect(measures.plants).toEqual([
			{ id: "codeword", turn: 2, right: true },
			{ id: "build", turn: 2, right: false },
		]);
	});

	test("a Probe the Run never reached is not scored, and its unchecked steps are not graded", async () => {
		const measures = await measureRun(fixture("failed-early"));

		expect(measures.complete).toBe(false);
		expect(measures.plants).toEqual([]);
		expect(measures.steps.map((step) => step.outcome)).toEqual(["Pass", "not graded", "not graded"]);
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

	test("Retention is the share of complete Runs that scored the Plant right", () => {
		const probed = (right: boolean, complete = true) =>
			run("pi-chart", 1, [], { complete, plants: complete ? [{ id: "codeword", turn: 2, right }] : [] });

		const arms = aggregate([probed(true), probed(false), probed(true), probed(true), probed(true, false)]);

		expect(arms.get("pi-chart")?.retention).toEqual([{ id: "codeword", right: 3, of: 4 }]);
	});
});
