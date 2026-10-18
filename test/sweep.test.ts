import { describe, expect, test } from "bun:test";

import { type Batch, type GateKey, LOOKS, type PairRun, REFERENCE_MODEL } from "../scripts/gate.ts";
import { studentQuantile } from "../scripts/stats.ts";
import { cellsOf, confirm, roundRobin, runCapped, type ScreenRun, screen, shellBudgets } from "../scripts/sweep.ts";

/** Defaults of the test's own, so a tuned default in `src/config.ts` changes no case. */
const DEFAULTS = {
	PICHART_TAIL_TOKENS: 25000,
	PICHART_TAIL_TURNS: 8,
	PICHART_TAIL_LOW_WATER: 0.2,
	PICHART_OPENING_TOKENS: 1000,
	PICHART_PINS_TOKENS: 2000,
	PICHART_RECALL_TOKENS: 8000,
	PICHART_DOC_TOKENS: 5000,
	PICHART_GRAPH_TOKENS: 3000,
	PICHART_PACK_TOKENS: 300000,
};

const grid = (budgets: Record<string, unknown>) => ({ slug: "tail-mark", budgets });

describe("cellsOf", () => {
	test("a 3 × 3 grid gives 9 cells in file order, with the default cell found", () => {
		const cells = cellsOf(grid({ PICHART_TAIL_TOKENS: [25000, 40000, 60000], PICHART_TAIL_LOW_WATER: [0.2, 0.4, 0.6] }), DEFAULTS);

		expect(cells.map((cell) => cell.id)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]);
		expect(cells[5]?.budgets).toEqual({ PICHART_TAIL_TOKENS: "40000", PICHART_TAIL_LOW_WATER: "0.6" });
		expect(cells.filter((cell) => cell.isDefault).map((cell) => cell.id)).toEqual(["c0"]);
	});

	test("ranks follow each Budget's ascending values, whatever order the file lists them in", () => {
		const cells = cellsOf(grid({ PICHART_TAIL_TOKENS: [60000, 25000, 40000], PICHART_TAIL_LOW_WATER: [0.4, 0.2] }), DEFAULTS);
		const byBudgets = (tokens: string, water: string) =>
			cells.find((cell) => cell.budgets.PICHART_TAIL_TOKENS === tokens && cell.budgets.PICHART_TAIL_LOW_WATER === water);

		expect(byBudgets("60000", "0.4")?.ranks).toEqual([2, 1]);
		expect(byBudgets("25000", "0.2")?.ranks).toEqual([0, 0]);
		expect(byBudgets("25000", "0.2")?.isDefault).toBe(true);
	});

	test("three Budgets are refused", () => {
		const three = grid({ PICHART_TAIL_TOKENS: [25000], PICHART_TAIL_LOW_WATER: [0.2], PICHART_RECALL_TOKENS: [8000] });

		expect(() => cellsOf(three, DEFAULTS)).toThrow(/at most two Budgets/);
	});

	test("a grid sweeping no Budget is refused", () => {
		expect(() => cellsOf(grid({}), DEFAULTS)).toThrow(/sweeps no Budget/);
	});

	test("a variable outside the tunable Budgets is refused", () => {
		expect(() => cellsOf(grid({ PICHART_PINS: [8, 4] }), DEFAULTS)).toThrow(/PICHART_PINS is not a tunable Budget/);
	});

	test("4 × 3 is refused for its 12 cells", () => {
		const big = grid({ PICHART_TAIL_TOKENS: [25000, 30000, 40000, 60000], PICHART_TAIL_LOW_WATER: [0.2, 0.4, 0.6] });

		expect(() => cellsOf(big, DEFAULTS)).toThrow(/12 cells.*at most 9/);
	});

	test("a repeated value is refused", () => {
		expect(() => cellsOf(grid({ PICHART_TAIL_TOKENS: [25000, 40000, 40000] }), DEFAULTS)).toThrow(/PICHART_TAIL_TOKENS repeats 40000/);
	});

	test("a grid without the default is refused, naming it", () => {
		expect(() => cellsOf(grid({ PICHART_TAIL_TOKENS: [40000, 60000] }), DEFAULTS)).toThrow(
			/PICHART_TAIL_TOKENS leaves out 25000, the default/,
		);
	});

	test("values pi-chart would not read as given are refused", () => {
		expect(() => cellsOf(grid({ PICHART_TAIL_LOW_WATER: [0.2, 1.5] }), DEFAULTS)).toThrow(/PICHART_TAIL_LOW_WATER=1\.5/);
		expect(() => cellsOf(grid({ PICHART_DOC_TOKENS: [5000, -1] }), DEFAULTS)).toThrow(/PICHART_DOC_TOKENS=-1/);
	});

	test("every problem is named in one error", () => {
		const bad = grid({ PICHART_TAIL_TOKENS: [40000, 40000], PICHART_PINS: [4] });

		expect(() => cellsOf(bad, DEFAULTS)).toThrow(
			/PICHART_TAIL_TOKENS repeats 40000[\s\S]*PICHART_TAIL_TOKENS leaves out 25000[\s\S]*PICHART_PINS is not a tunable Budget/,
		);
	});
});

describe("shellBudgets", () => {
	test("names the tunable Budgets the environment sets, and nothing else", () => {
		expect(shellBudgets({ PICHART_DOC_TOKENS: "8000", PICHART_DATABASE_URL: "postgres://x", PICHART_PINS: "4" })).toEqual([
			"PICHART_DOC_TOKENS",
		]);
	});
});

describe("roundRobin", () => {
	test("each round runs every cell once, rotated by one from the round before", () => {
		const jobs = roundRobin(["a", "b", "c"], 3);

		expect(jobs.map(({ cell, round }) => `${round}${cell}`)).toEqual(["0a", "0b", "0c", "1c", "1a", "1b", "2b", "2c", "2a"]);
	});
});

describe("runCapped", () => {
	/** A job costing `cost` that resolves on the next tick, noting how many jobs run beside it. */
	const tracker = () => {
		let inFlight = 0;
		let most = 0;
		let started = 0;
		const job = (cost: number) => async () => {
			started++;
			most = Math.max(most, ++inFlight);
			await Bun.sleep(1);
			inFlight--;
			return { cost };
		};
		return { job, most: () => most, started: () => started };
	};

	test("no job starts once spend reaches the cap", async () => {
		const { job, started } = tracker();
		const capped = await runCapped({ jobs: Array.from({ length: 27 }, () => job(120.3 / 26)), width: 1, cap: 120 });

		expect(started()).toBe(26);
		expect(capped).toBe(true);
	});

	test("every job runs under the cap, never more than `width` at once", async () => {
		const { job, most, started } = tracker();
		const capped = await runCapped({ jobs: Array.from({ length: 7 }, () => job(1)), width: 3, cap: 120 });

		expect(most()).toBe(3);
		expect(started()).toBe(7);
		expect(capped).toBe(false);
	});

	test("a throwing job starts nothing more, lets the jobs in flight finish, then rejects", async () => {
		const finished: number[] = [];
		const jobs = [0, 1, 2, 3].map((at) => async () => {
			if (at === 0) throw new Error("model mismatch");
			await Bun.sleep(5);
			finished.push(at);
			return { cost: 1 };
		});

		await expect(runCapped({ jobs, width: 2, cap: 120 })).rejects.toThrow("model mismatch");
		expect(finished).toEqual([1]);
	});
});

const KEY: GateKey = { workload: { name: "gate", version: 1 }, model: REFERENCE_MODEL, omp: "omp/18.11.0" };
/** An A/A batch of 5 pairs whose differences have sample SD `cost` (log ratio) and `lapses`. */
const aa = (cost: number, lapses: number): Batch => ({
	kind: "aa",
	key: KEY,
	date: "2026-10-17T00:00:00.000Z",
	base: "b",
	candidate: "b",
	out: "/tmp/x",
	pairs: [-1, 1, -1, 1, 0].map((sign) => ({
		base: { cost: 4, lapses: 20 },
		candidate: { cost: 4 * Math.exp(sign * cost), lapses: 20 + sign * lapses },
	})),
});

describe("screen", () => {
	// c0 (25000, 0.2) is the default; c1 (25000, 0.4), c2 (40000, 0.2), c3 (40000, 0.4), c4 (60000, 0.2), c5 (60000, 0.4).
	const CELLS = cellsOf(grid({ PICHART_TAIL_TOKENS: [25000, 40000, 60000], PICHART_TAIL_LOW_WATER: [0.2, 0.4] }), DEFAULTS);
	/** A cell's three Runs, one per round: all complete and passing `render` unless told otherwise. */
	const runsOf = (cell: string, spec: { cost?: number; lapses?: number; complete?: boolean[]; render?: boolean[] } = {}): ScreenRun[] =>
		[0, 1, 2].map((round) => ({
			cell,
			round,
			label: `${cell}-r${round}`,
			cost: spec.cost ?? 4,
			lapses: spec.lapses ?? 20,
			complete: spec.complete?.[round] ?? true,
			steps: { render: spec.render?.[round] ?? true },
		}));
	const cellResult = (result: ReturnType<typeof screen>, id: string) => result.cells.find((cell) => cell.cell === id);
	// Three constant pairs beside the A/A batch's 4 df: the pooled variance is 4σ²/6 on 6 df, and SE its root over 3.
	const se = (sd: number) => Math.sqrt((4 * sd * sd) / 6 / 3);

	test("a cell whose Lapse test has p = 0.03 is ineligible, whatever its cost", () => {
		const rise = studentQuantile(0.97, 6) * se(2);
		const result = screen({
			cells: CELLS,
			runs: [...runsOf("c0"), ...runsOf("c1", { cost: 2, lapses: 20 + rise })],
			history: [aa(0.02, 2)],
			key: KEY,
		});

		expect(cellResult(result, "c1")?.versusDefault?.lapses?.p).toBeCloseTo(0.03, 8);
		expect(cellResult(result, "c1")?.eligible).toBe(false);
		expect(result.winner).toBe("c0");
	});

	test("two fewer passes on a step is a collapse, one fewer is not", () => {
		const result = screen({
			cells: CELLS,
			runs: [
				...runsOf("c0", { cost: 5 }),
				...runsOf("c1", { cost: 3, render: [true, false, false] }),
				...runsOf("c2", { cost: 4, render: [true, true, false] }),
			],
			history: [aa(0.02, 2)],
			key: KEY,
		});

		expect(cellResult(result, "c1")?.eligible).toBe(false);
		expect(cellResult(result, "c2")?.eligible).toBe(true);
		expect(result.best).toBe("c2");
	});

	test("an incomplete Run voids its round's pair, and fewer than 2 pairs with the default is ineligible", () => {
		const result = screen({
			cells: CELLS,
			runs: [
				...runsOf("c0"),
				...runsOf("c1", { complete: [true, false, true] }),
				...runsOf("c2", { complete: [true, false, false] }),
			],
			history: [aa(0.02, 2)],
			key: KEY,
		});

		expect(cellResult(result, "c1")?.versusDefault?.pairs).toBe(2);
		expect(cellResult(result, "c1")?.eligible).toBe(true);
		expect(cellResult(result, "c2")?.versusDefault?.pairs).toBe(1);
		expect(cellResult(result, "c2")?.eligible).toBe(false);
	});

	test("the default wins a tie: 0.94 with a 95% interval of [0.86, 1.03]", () => {
		// The SD that puts the upper bound of a constant 0.94 ratio at 1.03.
		const sd = Math.log(1.03 / 0.94) / studentQuantile(0.975, 6) / se(1);
		const result = screen({
			cells: CELLS,
			runs: [...runsOf("c0"), ...runsOf("c3", { cost: 4 * 0.94 })],
			history: [aa(sd, 2)],
			key: KEY,
		});
		const versusBest = cellResult(result, "c0")?.versusBest;

		expect(result.best).toBe("c3");
		// The default against the best: the same interval, inverted.
		expect(1 / (versusBest?.cost?.ratioUpper as number)).toBeCloseTo(0.94 ** 2 / 1.03, 6);
		expect(1 / (versusBest?.cost?.ratioLower as number)).toBeCloseTo(1.03, 6);
		expect(result.tied).toEqual(["c0", "c3"]);
		expect(result.winner).toBe("c0");
	});

	test("without the default, the tied cell with the lowest rank sum wins", () => {
		const result = screen({
			cells: CELLS,
			runs: [...runsOf("c0", { cost: 6 }), ...runsOf("c2", { cost: 4 }), ...runsOf("c5", { cost: 3.99 })],
			history: [aa(0.02, 2)],
			key: KEY,
		});

		expect(result.best).toBe("c5");
		expect(result.tied).toEqual(["c2", "c5"]);
		expect(result.winner).toBe("c2");
	});

	test("an equal rank sum goes to the lower rank on the first Budget", () => {
		const result = screen({
			cells: CELLS,
			runs: [...runsOf("c0", { cost: 6 }), ...runsOf("c1", { cost: 4 }), ...runsOf("c2", { cost: 4 }), ...runsOf("c5", { cost: 3.99 })],
			history: [aa(0.02, 2)],
			key: KEY,
		});

		expect(result.tied).toEqual(["c1", "c2", "c5"]);
		expect(result.winner).toBe("c1");
	});

	test("fewer than 2 pairs with the best counts as tied", () => {
		const result = screen({
			cells: CELLS,
			runs: [
				...runsOf("c0", { cost: 6 }),
				...runsOf("c2", { cost: 4, complete: [true, true, false] }),
				...runsOf("c5", { cost: 3.99, complete: [false, true, true] }),
			],
			history: [aa(0.02, 2)],
			key: KEY,
		});

		expect(cellResult(result, "c2")?.versusBest).toEqual({ pairs: 1, tied: true });
		expect(result.winner).toBe("c2");
	});

	test("a default with fewer than 2 complete Runs wins, every other cell short of pairs", () => {
		const result = screen({
			cells: CELLS,
			runs: [...runsOf("c0", { complete: [true, false, false] }), ...runsOf("c1", { cost: 2 })],
			history: [aa(0.02, 2)],
			key: KEY,
		});

		expect(cellResult(result, "c1")?.eligible).toBe(false);
		expect(result.winner).toBe("c0");
	});
});

describe("confirm", () => {
	const [base, winner] = cellsOf(grid({ PICHART_TAIL_TOKENS: [25000, 40000] }), DEFAULTS) as [ReturnType<typeof cellsOf>[number], ReturnType<typeof cellsOf>[number]];
	/** Pairs whose winner Run costs `ratio` times the default's and has `rise` more Lapses; each Run costs `cost` or so. */
	const pairing = (ratio: number, rise = 0, cost = 4) => {
		const started: number[] = [];
		const runPair = async (index: number): Promise<PairRun> => {
			started.push(index);
			await Bun.sleep(1);
			return {
				index,
				base: { cost, lapses: 20, complete: true },
				candidate: { cost: cost * ratio, lapses: 20 + rise, complete: true },
			};
		};
		return { runPair, started };
	};
	const critical = (look: number, df: number) => studentQuantile(1 - (LOOKS[look] as { alpha: number }).alpha, df);
	// n constant pairs beside the A/A batch's 4 df: pooled variance 4σ²/(n + 3) on n + 3 df, SE its root over n.
	const se = (sd: number, n: number) => Math.sqrt((4 * sd * sd) / (n + 3) / n);
	const input = (sd: number, lapseSd: number, runPair: (index: number) => Promise<PairRun>) => ({
		winner,
		defaultCell: base,
		history: [aa(sd, lapseSd)],
		key: KEY,
		width: 1,
		runPair,
	});

	test("an upper ratio bound of 0.93 at the first look adopts, and no further pair starts", async () => {
		const sd = Math.log(0.93 / 0.9) / critical(0, 8) / se(1, 5);
		const { runPair, started } = pairing(0.9);
		const result = await confirm(input(sd, 2, runPair));

		expect(result.looks.map((look) => look.verdict)).toEqual(["pass"]);
		expect(result.looks[0]?.cost.ratioUpper).toBeCloseTo(0.93, 6);
		expect([result.outcome, started.length]).toEqual(["adopt", 5]);
	});

	test("an upper bound of 1.04 at the second look keeps the default: not shown cheaper", async () => {
		const sd = Math.log(1.04) / critical(1, 13) / se(1, 10);
		const { runPair } = pairing(1);
		const result = await confirm(input(sd, 2, runPair));

		expect(result.looks.map((look) => look.verdict)).toEqual(["continue", "inconclusive"]);
		expect(result.looks[1]?.cost.ratioUpper).toBeCloseTo(1.04, 6);
		expect([result.outcome, result.reason]).toEqual(["keep the default", "not shown cheaper"]);
	});

	test("a rejected Lapse test keeps the default: forgets more", async () => {
		const { runPair } = pairing(0.8, 5);
		const result = await confirm(input(0.02, 1, runPair));

		expect(result.looks.map((look) => look.verdict)).toEqual(["fail"]);
		expect([result.outcome, result.reason]).toEqual(["keep the default", "forgets more"]);
	});

	test("a cap reached short of a look keeps the default: not shown cheaper", async () => {
		const { runPair, started } = pairing(0.8, 0, 15);
		const result = await confirm(input(0.02, 1, runPair));

		expect(started).toEqual([0, 1, 2]);
		expect([result.capped, result.spent]).toEqual([true, 81]);
		expect([result.outcome, result.reason]).toEqual(["keep the default", "not shown cheaper"]);
	});

	test("a default winner starts no pair and keeps the default", async () => {
		const { runPair, started } = pairing(0.8);
		const result = await confirm({ ...input(0.02, 1, runPair), winner: base });

		expect(started).toEqual([]);
		expect(result.outcome).toBe("keep the default");
	});
});
