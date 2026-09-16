import { describe, expect, test } from "bun:test";

import { DEFAULT_RECALL_MAX_DISTANCE } from "../src/config.ts";
import {
	LocalEmbedder,
	PINNED_DIMENSIONS,
	StubEmbedder,
} from "../src/embedder.ts";

const BUN = process.env.CM_BUN ?? "bun";

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

describe("LocalEmbedder failure", () => {
	test("a worker that cannot run rejects rather than hanging", async () => {
		// The context handler awaits embedding, so a promise nobody settles
		// would block the Turn instead of degrading it.
		const embedder = new LocalEmbedder("/bin/false", 5_000);

		await expect(embedder.embed(["anything"])).rejects.toThrow(/exited/);
	});

	test("a worker that never replies rejects on its deadline", async () => {
		const silent = new URL("./fixtures/silent-worker.ts", import.meta.url)
			.pathname;
		const embedder = new LocalEmbedder(BUN, 250, silent);

		await expect(embedder.embed(["anything"])).rejects.toThrow(/timed out/);
		embedder.close();
	});

	test("a failure does not poison the embedder for later batches", async () => {
		const embedder = new LocalEmbedder("/bin/false", 5_000);
		await expect(embedder.embed(["first"])).rejects.toThrow();

		// A second attempt starts a fresh worker rather than reusing the dead one.
		await expect(embedder.embed(["second"])).rejects.toThrow(/exited/);
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

// The threshold's default only means anything against the real model, so this
// is where the measured number is checked rather than assumed.
describeModel("the default relevance threshold", () => {
	test(
		"keeps a paraphrase and rejects an unrelated turn",
		async () => {
			const embedder = new LocalEmbedder(BUN);
			const [prompt, paraphrase, unrelated] = await embedder.embed([
				"what did we decide about caching parsed configuration",
				"we keep the parsed configuration in memory instead of re-reading it",
				"name a river, one word only",
			]);

			// Cosine distance is what pgvector's <=> returns and what the
			// threshold is expressed in.
			const near = 1 - cosine(prompt ?? [], paraphrase ?? []);
			const far = 1 - cosine(prompt ?? [], unrelated ?? []);

			expect(near).toBeLessThan(DEFAULT_RECALL_MAX_DISTANCE);
			expect(far).toBeGreaterThan(DEFAULT_RECALL_MAX_DISTANCE);
		},
		300_000,
	);
});
