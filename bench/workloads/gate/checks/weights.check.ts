import { expect, test } from "bun:test";

import { weighted } from "./src/budget-table.ts";

test("each size times its bucket's weight from notes/weights.md, in order", () => {
	expect(weighted([100, 1000, 2000, 8000, 24000])).toEqual([50, 1000, 2500, 12000, 54000]);
});

test("rounded to the nearest multiple of 10, halves up, as notes/rounding.md says", () => {
	expect(weighted([365, 1802, 1804, 349, 7003])).toEqual([370, 2250, 2260, 170, 10500]);
});

test("no sizes, no weighted sizes", () => {
	expect(weighted([])).toEqual([]);
});
