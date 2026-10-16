import { describe, expect, test } from "bun:test";

import { holm, pooledVariance, sampleVariance, studentCdf, studentQuantile } from "../scripts/stats.ts";

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
