import { expect, test } from "bun:test";

import { histogram } from "./src/budget-table.ts";

test("the sample of notes/samples.md", () => {
	expect(histogram([120, 90, 2400, 400, 8000])).toEqual([
		{ bucket: "large", count: 1 },
		{ bucket: "medium", count: 1 },
		{ bucket: "small", count: 1 },
		{ bucket: "tiny", count: 2 },
	]);
});

test("a huge Turn adds huge first; other empty buckets stay at zero", () => {
	expect(histogram([30000, 100, 24000])).toEqual([
		{ bucket: "huge", count: 2 },
		{ bucket: "large", count: 0 },
		{ bucket: "medium", count: 0 },
		{ bucket: "small", count: 0 },
		{ bucket: "tiny", count: 1 },
	]);
});

test("no sizes: every bucket but huge, at zero", () => {
	expect(histogram([])).toEqual([
		{ bucket: "large", count: 0 },
		{ bucket: "medium", count: 0 },
		{ bucket: "small", count: 0 },
		{ bucket: "tiny", count: 0 },
	]);
});
