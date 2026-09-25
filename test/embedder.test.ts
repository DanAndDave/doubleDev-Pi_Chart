import { describe, expect, test } from "bun:test";

import { DEFAULT_DOC_MAX_DISTANCE, DEFAULT_RECALL_MAX_DISTANCE } from "../src/config.ts";
import { embedText } from "../src/embed-text.ts";
import {
	LocalEmbedder,
	PINNED_DIMENSIONS,
	StubEmbedder,
} from "../src/embedder.ts";

const BUN = process.env.PICHART_BUN ?? "bun";

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
const describeModel = process.env.PICHART_EMBED === "1" ? describe : describe.skip;

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

// The threshold's default only means anything against the real model, and
// only through the path recall actually takes: a query carrying the model's
// instruction, against a Turn composed the way the Thread Store composes it.
describeModel("the default relevance threshold", () => {
	test(
		"keeps the turn that answered a question and rejects an unrelated one",
		async () => {
			const embedder = new LocalEmbedder(BUN);
			const turn = embedText([
				{ role: "user", content: "where should the parsed config live" },
				{
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "c1",
							name: "read",
							arguments: { path: "src/config.ts" },
						},
					],
				},
				{
					role: "toolResult",
					toolCallId: "c1",
					toolName: "read",
					content: [{ type: "text", text: "export function loadConfig(env) {}" }],
				},
				{
					role: "assistant",
					content:
						"we keep the parsed configuration in memory instead of " +
						"re-reading it each turn",
				},
			]);
			const [answering, unrelated] = await embedder.embed([
				turn,
				"Proof the sourdough overnight at 22°C, then bake at 240°C with steam.",
			]);
			// Asked in other words, and derived the way a recall query is.
			const [query] = await embedder.embedQuery([
				"what did we decide about caching parsed configuration",
			]);

			// Cosine distance is what pgvector's <=> returns and what the
			// threshold is expressed in.
			const near = 1 - cosine(query ?? [], answering ?? []);
			const far = 1 - cosine(query ?? [], unrelated ?? []);

			expect(near).toBeLessThan(DEFAULT_RECALL_MAX_DISTANCE);
			expect(far).toBeGreaterThan(DEFAULT_RECALL_MAX_DISTANCE);
		},
		300_000,
	);
});

// Curated prose is longer and more formal than a prompt, so the Doc Store's
// threshold was measured separately even though it landed on the same value.
// This is where that measurement is checked rather than assumed.
describeModel("the default doc relevance threshold", () => {
	test(
		"keeps a concept the query is about and rejects one it is not",
		async () => {
			const embedder = new LocalEmbedder(BUN);
			const concept =
				"Run as an extension, not our own loop\n\n" +
				"## Decision\n\nThe context manager runs inside the existing agent " +
				"harness as an extension, replacing the message array it sends, " +
				"rather than reimplementing the agent loop.";
			const [about, unrelated, section] = await embedder.embed([
				"why do we run as an extension instead of owning the agent loop",
				"how do I bake sourdough bread at home",
				concept,
			]);

			const near = 1 - cosine(about ?? [], section ?? []);
			const far = 1 - cosine(unrelated ?? [], section ?? []);

			expect(near).toBeLessThan(DEFAULT_DOC_MAX_DISTANCE);
			expect(far).toBeGreaterThan(DEFAULT_DOC_MAX_DISTANCE);
		},
		300_000,
	);
});
