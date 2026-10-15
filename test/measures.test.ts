import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const none = { total: 0, bands: [0, 0, 0, 0, 0] };

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
		refetches: [],
		refetch: { held: none, left: none, unknown: none },
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
