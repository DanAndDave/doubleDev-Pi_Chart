import { expect, test } from "bun:test";

import { renderTable } from "./src/budget-render.ts";
import { formatCount } from "./src/budget-table.ts";

test("formatCount follows the display rule of notes/rounding.md", () => {
	expect([0, 740, 999, 1000, 1234, 1250, 12000].map((n) => formatCount(n))).toEqual([
		"0",
		"740",
		"999",
		"1.0k",
		"1.2k",
		"1.3k",
		"12.0k",
	]);
});

test("a header, then one row per histogram entry with its label, count and weighted total", () => {
	expect(renderTable([100, 300, 400, 2000, 2000, 8000])).toEqual([
		"bucket | turns | weighted",
		"feasts | 1 | 12.0k",
		"meals | 2 | 5.0k",
		"bites | 1 | 400",
		"crumbs | 2 | 200",
	]);
});

test("a huge Turn adds the banquets row; empty buckets show zeros", () => {
	expect(renderTable([600, 650, 24000])).toEqual([
		"bucket | turns | weighted",
		"banquets | 1 | 54.0k",
		"feasts | 0 | 0",
		"meals | 0 | 0",
		"bites | 2 | 1.3k",
		"crumbs | 0 | 0",
	]);
});
