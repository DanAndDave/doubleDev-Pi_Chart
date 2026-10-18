import { describe, expect, test } from "bun:test";

import type { CalibrationSet, CalibrationUnit } from "../scripts/ablation.ts";
import { agreement, cellId, chooseCell, comparable, GRID, ppi, ppiFor, ruleFor } from "../scripts/calibration.ts";
import { DEFAULT_RULE } from "../scripts/utilisation.ts";

/** A calibration unit of `kind`, with its verdict and its Used verdict per cell id. */
function unit(
	verdict: CalibrationUnit["verdict"],
	used: Record<string, boolean> = {},
	{ arm = "vanilla", kind = "tool-call", duplicated = false }: { arm?: string; kind?: CalibrationUnit["unit"]["kind"]; duplicated?: boolean } = {},
): CalibrationUnit {
	return {
		arm,
		folder: `${arm}-0`,
		run: 0,
		call: 1,
		turn: 1,
		unit: { kind, turn: 0, callId: "t", tool: "read", tokens: 100, duplicated },
		content: "",
		original: [],
		verdict,
		used,
	};
}

/** A set of `units` under the `gate` v1 key, with `rule` when calibrated. */
function set(units: CalibrationUnit[], rule?: CalibrationSet["rule"]): CalibrationSet {
	return {
		key: { workload: { name: "gate", version: 1 }, model: "anthropic/claude-opus-5-5", omp: "omp/18.11.0" },
		date: "2026-10-17",
		units,
		nulls: [],
		control: { share: { k: 9, n: 10, share: 0.9, lower: 0.6, upper: 1 }, trusted: true },
		...(rule ? { rule } : {}),
	};
}

/** Used at every cell `at` names, unused at the others. */
const usedAt = (...at: string[]) => Object.fromEntries(GRID.map((cell) => [cellId(cell), at.includes(cellId(cell))]));

/** `count` pairs, each Used and Needed as given. */
const pairs = (count: number, used: boolean, needed: boolean) => Array.from({ length: count }, () => ({ used, needed }));

describe("agreement between Used and Needed", () => {
	test("8 both, 2 Used only, 2 Needed only and 88 neither give κ 0.78, precision and recall 80%", () => {
		const figures = agreement([...pairs(8, true, true), ...pairs(2, true, false), ...pairs(2, false, true), ...pairs(88, false, false)]);

		expect(figures.kappa).toBeCloseTo(0.78, 2);
		expect(figures.precision).toBe(0.8);
		expect(figures.recall).toBe(0.8);
		expect(figures).toMatchObject({ both: 8, usedOnly: 2, neededOnly: 2, neither: 88, n: 100 });
	});

	test("κ is undefined when Used and Needed each hold one value", () => {
		expect(agreement(pairs(5, false, false)).kappa).toBeNaN();
	});

	test("precision is undefined with nothing Used; recall stays defined", () => {
		const figures = agreement([...pairs(2, false, true), ...pairs(8, false, false)]);

		expect(figures.precision).toBeNaN();
		expect(figures.recall).toBe(0);
		expect(figures.kappa).toBe(0);
	});
});

describe("the units a calibration compares", () => {
	test("unclear, Opening and Pin units are not compared; a duplicated unit is", () => {
		const kept = [unit("needed"), unit("not-needed", {}, { duplicated: true }), unit("not-needed", {}, { kind: "summary" })];
		const units = [...kept, unit("unclear"), unit("needed", {}, { kind: "opening" }), unit("not-needed", {}, { kind: "pin" })];

		expect(comparable(units)).toEqual(kept);
	});

	test("47 judged units and 1 unclear give κ over 47", () => {
		const units = [
			...Array.from({ length: 2 }, () => unit("needed", usedAt("s8k2"))),
			...Array.from({ length: 45 }, () => unit("not-needed", usedAt())),
			unit("unclear", usedAt()),
		];

		for (const { pooled } of chooseCell(units).cells) expect(pooled.n).toBe(47);
	});
});

describe("the chosen cell", () => {
	test("a tie goes to the smaller s, then the smaller k", () => {
		const units = [unit("needed", usedAt("s8k1", "s6k2")), unit("not-needed", usedAt()), unit("not-needed", usedAt())];

		const { chosen, kappa } = chooseCell(units);
		expect(chosen).toEqual({ s: 6, k: 2 });
		expect(kappa).toBe(1);
	});

	test("an undefined κ is never chosen over a defined one", () => {
		// s6k1 is Used on nothing and every unit is not Needed: κ undefined. Elsewhere one unit is Used: κ 0.
		const units = Array.from({ length: 4 }, (_, at) => unit("not-needed", at === 0 ? usedAt(...GRID.slice(1).map(cellId)) : usedAt()));

		const { cells, chosen, kappa } = chooseCell(units);
		expect(cells[0]?.pooled.kappa).toBeNaN();
		expect(chosen).toEqual({ s: 6, k: 2 });
		expect(kappa).toBe(0);
	});

	test("each cell gives its figures per Arm beside the pooled ones", () => {
		const units = [
			unit("needed", usedAt("s6k1"), { arm: "pi-chart" }),
			unit("not-needed", usedAt(), { arm: "pi-chart" }),
			unit("needed", usedAt(), { arm: "vanilla" }),
			unit("not-needed", usedAt("s6k1"), { arm: "vanilla" }),
		];

		const [first] = chooseCell(units).cells;
		expect(first?.arms["pi-chart"]).toMatchObject({ both: 1, neither: 1, kappa: 1 });
		expect(first?.arms.vanilla).toMatchObject({ usedOnly: 1, neededOnly: 1, kappa: -1 });
		expect(first?.pooled).toMatchObject({ n: 4, kappa: 0 });
	});

	test("a compared unit with no Used verdict at a cell is an error", () => {
		expect(() => chooseCell([unit("needed", { s6k1: true })])).toThrow(/s6k2/);
	});
});

describe("the rule a key's Runs are judged at", () => {
	test("a set whose cell has κ of at least 0.4 gives that cell and its κ", () => {
		expect(ruleFor(set([], { s: 6, k: 1, kappa: 0.52 }))).toEqual({ rule: { s: 6, k: 1 }, kappa: 0.52 });
		expect(ruleFor(set([], { s: 12, k: 1, kappa: 0.4 }))).toEqual({ rule: { s: 12, k: 1 }, kappa: 0.4 });
	});

	test("no set, an uncalibrated set, a weak κ or no κ keeps s 8, k 2 with no κ", () => {
		expect(ruleFor(undefined)).toEqual({ rule: DEFAULT_RULE });
		expect(ruleFor(set([]))).toEqual({ rule: DEFAULT_RULE });
		expect(ruleFor(set([], { s: 12, k: 3, kappa: 0.31 }))).toEqual({ rule: DEFAULT_RULE });
		expect(ruleFor(set([], { s: 6, k: 1, kappa: null }))).toEqual({ rule: DEFAULT_RULE });
	});
});

describe("the PPI Needed share", () => {
	/** A Call holding `unitTokens` of units, `judged` of them tail and summary, `used` of those Used. */
	const held = (used: number, judged: number, unitTokens: number) => ({ used, judged, unitTokens });
	/** `ones` residuals of `value`, the rest of `count` zero. */
	const residuals = (count: number, ones: number, value = 1) => Array.from({ length: count }, (_, at) => (at < ones ? value : 0));

	test("the prediction term weights each Call the way Ablation draws: 16.7%, not 25%", () => {
		const estimate = ppi([held(500, 1000, 2000), held(0, 1000, 1000)], [0, 0]);

		expect(estimate?.term).toBeCloseTo(1 / 6, 10);
		expect(estimate?.share).toBeCloseTo(1 / 6, 10);
	});

	test("the correction is subtracted, and both terms' variance makes the interval", () => {
		// Each Call 30% Used: the term has no variance. Residuals 1 once in 10: mean 0.10, variance 0.1, so SE 0.1.
		const estimate = ppi([held(300, 1000, 1000), held(300, 1000, 1000)], residuals(10, 1));

		expect(estimate?.correction).toBeCloseTo(0.1, 10);
		expect(estimate?.share).toBeCloseTo(0.2, 10);
		expect(estimate?.lower).toBeCloseTo(0.2 - 0.196, 10);
		expect(estimate?.upper).toBeCloseTo(0.2 + 0.196, 10);
	});

	test("the estimate and its bounds are clamped to 0–100%", () => {
		expect(ppi([held(0, 1000, 1000), held(0, 1000, 1000)], [1, 1])).toMatchObject({ share: 0, lower: 0, upper: 0 });
		expect(ppi([held(1000, 1000, 1000), held(1000, 1000, 1000)], [-1, -1])).toMatchObject({ share: 1, lower: 1, upper: 1 });
	});

	test("fewer than 2 compared units give no figure", () => {
		expect(ppi([held(300, 1000, 1000), held(300, 1000, 1000)], [0])).toBeUndefined();
	});

	describe("from a set", () => {
		const calls = [held(300, 1000, 1000), held(300, 1000, 1000)];
		const units = [
			unit("not-needed", usedAt(), { arm: "pi-chart" }),
			unit("needed", usedAt(), { arm: "pi-chart" }),
			unit("not-needed", usedAt("s6k1"), { arm: "vanilla" }),
			unit("unclear", usedAt("s6k1"), { arm: "pi-chart" }),
		];

		test("the Arm's own compared units at the chosen cell make the correction", () => {
			// pi-chart residuals 0 and −1: mean −0.5.
			expect(ppiFor(set(units, { s: 6, k: 1, kappa: 0.52 }), "pi-chart", calls)?.share).toBeCloseTo(0.8, 10);
		});

		test("below the κ floor, or with fewer than 2 of the Arm's units, there is no figure", () => {
			expect(ppiFor(set(units, { s: 6, k: 1, kappa: 0.31 }), "pi-chart", calls)).toBeUndefined();
			expect(ppiFor(set(units), "pi-chart", calls)).toBeUndefined();
			expect(ppiFor(set(units, { s: 6, k: 1, kappa: 0.52 }), "vanilla", calls)).toBeUndefined();
		});
	});
});
