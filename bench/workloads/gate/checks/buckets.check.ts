import { expect, test } from "bun:test";

import { bucketOf } from "./src/budget-table.ts";

test("bucketOf follows the thresholds of notes/buckets.md, lower bounds inclusive", () => {
	expect([0, 349, 350, 1799, 1800, 6999, 7000, 23999, 24000, 500000].map((size) => bucketOf(size))).toEqual([
		"tiny",
		"tiny",
		"small",
		"small",
		"medium",
		"medium",
		"large",
		"large",
		"huge",
		"huge",
	]);
});

test("bucketOf rejects a negative or non-finite size", () => {
	expect(() => bucketOf(-1)).toThrow(RangeError);
	expect(() => bucketOf(Number.NaN)).toThrow(RangeError);
	expect(() => bucketOf(Number.POSITIVE_INFINITY)).toThrow(RangeError);
});
