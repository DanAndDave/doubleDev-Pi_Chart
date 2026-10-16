import { expect, test } from "bun:test";

import { summaryLine } from "./src/budget-table.ts";

test("the fields of notes/format.md, then the footer of notes/buckets.md", () => {
	expect(summaryLine([100, 400, 2000, 9500, 30000], 50000)).toBe(
		"turns=5 · total=42000 · used=84% · peak=huge · over=2",
	);
});

test("used rounds down and may pass 100; over counts only sizes above 9000", () => {
	expect(summaryLine([1000, 9001], 3000)).toBe("turns=2 · total=10001 · used=333% · peak=large · over=1");
	expect(summaryLine([9000], 9000)).toBe("turns=1 · total=9000 · used=100% · peak=large · over=0");
});

test("no Turns: peak is none", () => {
	expect(summaryLine([], 100)).toBe("turns=0 · total=0 · used=0% · peak=none · over=0");
});

test("a budget that is not positive and finite is rejected", () => {
	expect(() => summaryLine([100], 0)).toThrow(RangeError);
	expect(() => summaryLine([100], -5)).toThrow(RangeError);
	expect(() => summaryLine([100], Number.NaN)).toThrow(RangeError);
});
