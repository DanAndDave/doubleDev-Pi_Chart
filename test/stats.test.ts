import { describe, expect, test } from "bun:test";

import { holm, pairedWithinTasks, pooledVariance, sampleVariance, studentCdf, studentQuantile, wilson } from "../scripts/stats.ts";

describe("Student t", () => {
	test("quantiles match the tabled one-sided critical values", () => {
		expect(studentQuantile(0.95, 4)).toBeCloseTo(2.1318, 4);
		expect(studentQuantile(0.95, 9)).toBeCloseTo(1.8331, 4);
		expect(studentQuantile(0.975, 9)).toBeCloseTo(2.2622, 4);
	});

	test("the CDF is symmetric about zero", () => {
		for (const [t, df] of [
			[0.5, 3],
			[1.7, 8],
			[2.9, 17],
		] as const) {
			expect(studentCdf(-t, df)).toBeCloseTo(1 - studentCdf(t, df), 12);
		}
		expect(studentCdf(0, 5)).toBeCloseTo(0.5, 12);
	});
});

describe("variance", () => {
	test("sample variance divides by n − 1", () => {
		expect(sampleVariance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(32 / 7, 12);
	});

	test("batches pool by their degrees of freedom", () => {
		const pooled = pooledVariance([
			[1, -1, 1, -1, 0],
			[2, -2, 2, -2, 2, -2, 2, -2, 2, -2],
			[0, 0, 0, 0, 0],
		]);

		expect(pooled.df).toBe(17);
		// (4 · 1 + 9 · (40 / 9) + 4 · 0) / 17
		expect(pooled.variance).toBeCloseTo(44 / 17, 12);
	});

	test("a batch of fewer than 2 adds nothing", () => {
		expect(pooledVariance([[1, -1, 1, -1, 0], [50], []])).toEqual({ variance: 1, df: 4 });
	});
});

describe("Holm", () => {
	test("two marginal p-values at the second look are both kept", () => {
		expect(holm([0.03, 0.04], 0.0467)).toEqual([false, false]);
	});

	test("the smaller rejected at α / 2 lets the larger be tested at α", () => {
		expect(holm([0.02, 0.04], 0.0467)).toEqual([true, true]);
		expect(holm([0.04, 0.02], 0.0467)).toEqual([true, true]);
		expect(holm([0.05, 0.001], 0.0467)).toEqual([false, true]);
	});

	test("the larger is not tested once the smaller is kept", () => {
		expect(holm([0.0466, 0.03], 0.0467)).toEqual([false, false]);
	});
});

describe("Wilson", () => {
	test("6 of 20 gives 14.55% to 51.90%", () => {
		const { lower, upper } = wilson(6, 20);
		expect(lower).toBeCloseTo(0.1455, 4);
		expect(upper).toBeCloseTo(0.519, 4);
	});

	test("the interval stays inside 0 to 1 at the extremes", () => {
		expect(wilson(0, 10).lower).toBe(0);
		expect(wilson(10, 10).upper).toBe(1);
	});
});

describe("pairedWithinTasks", () => {
	test("one task is the ordinary two-sided paired t", () => {
		const figure = pairedWithinTasks([[0.1, 0.2, 0.3]]);
		expect(figure).toMatchObject({ pairs: 3, tasks: 1, df: 2 });
		expect(figure.mean).toBeCloseTo(0.2, 12);
		expect(figure.se).toBeCloseTo(0.057735, 6);
		// t(0.975, 2) = 4.302653.
		expect(figure.lower).toBeCloseTo(0.2 - 0.248414, 5);
		expect(figure.upper).toBeCloseTo(0.2 + 0.248414, 5);
	});

	test("tasks weigh the same in the mean and pool their variance", () => {
		const figure = pairedWithinTasks([
			[0, 0.2],
			[1, 1.2],
		]);
		expect(figure).toMatchObject({ pairs: 4, tasks: 2, df: 2 });
		expect(figure.mean).toBeCloseTo(0.6, 12);
		expect(figure.se).toBeCloseTo(0.070711, 6);
	});

	test("a task of one pair counts in the mean but adds no degrees of freedom", () => {
		const figure = pairedWithinTasks([[0.5], [0.1, 0.3]]);
		expect(figure).toMatchObject({ pairs: 3, tasks: 2, df: 1 });
		expect(figure.mean).toBeCloseTo(0.35, 12);
		expect(figure.se).toBeCloseTo(0.086603, 6);
		expect(figure.lower).toBeDefined();
	});

	test("tasks of one pair each give a difference with no bounds", () => {
		const figure = pairedWithinTasks([[0.5], [0.1]]);
		expect(figure).toMatchObject({ pairs: 2, tasks: 2, df: 0 });
		expect(figure.mean).toBeCloseTo(0.3, 12);
		expect(figure.lower).toBeUndefined();
		expect(figure.upper).toBeUndefined();
	});

	test("no pairs give no figure", () => {
		expect(pairedWithinTasks([]).pairs).toBe(0);
		expect(pairedWithinTasks([[], []]).pairs).toBe(0);
	});
});
