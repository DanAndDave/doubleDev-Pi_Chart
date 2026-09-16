import { describe, expect, test } from "bun:test";

import {
	LocalEmbedder,
	PINNED_DIMENSIONS,
	StubEmbedder,
} from "../src/embedder.ts";

function cosine(a: number[], b: number[]): number {
	let dot = 0;
	for (const [index, value] of a.entries()) dot += value * (b[index] ?? 0);
	return dot;
}

describe("StubEmbedder", () => {
	test("the same text always yields the same vector", async () => {
		const embedder = new StubEmbedder();

		const [first] = await embedder.embed(["a decision about caching"]);
		const [second] = await embedder.embed(["a decision about caching"]);

		expect(first).toEqual(second ?? []);
	});

	test("vectors are the pinned width", async () => {
		const [vector] = await new StubEmbedder().embed(["anything"]);

		expect(vector).toHaveLength(PINNED_DIMENSIONS);
	});

	test("shared wording ranks closer than unrelated text", async () => {
		const embedder = new StubEmbedder();

		const [subject, related, unrelated] = await embedder.embed([
			"the caching decision",
			"a decision about caching",
			"the weather in autumn",
		]);

		expect(cosine(subject ?? [], related ?? [])).toBeGreaterThan(
			cosine(subject ?? [], unrelated ?? []),
		);
	});

	test("embedding nothing yields nothing", async () => {
		expect(await new StubEmbedder().embed([])).toEqual([]);
	});
});

// Downloads and runs the pinned model, so it is gated: the stub proves the
// mechanics, this proves the stub is not the only thing that works.
const describeModel = process.env.CM_EMBED === "1" ? describe : describe.skip;

describeModel("LocalEmbedder", () => {
	test(
		"paraphrases rank closer than unrelated sentences",
		async () => {
			const embedder = new LocalEmbedder();

			const [subject, paraphrase, unrelated] = await embedder.embed([
				"we decided to cache the parsed config in memory",
				"the parsed configuration is kept in memory rather than re-read",
				"the office plants need watering on Fridays",
			]);

			expect(subject).toHaveLength(PINNED_DIMENSIONS);
			expect(cosine(subject ?? [], paraphrase ?? [])).toBeGreaterThan(
				cosine(subject ?? [], unrelated ?? []),
			);
		},
		300_000,
	);
});
