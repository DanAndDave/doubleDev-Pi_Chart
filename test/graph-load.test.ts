import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { readExtraction } from "../src/graph-load.ts";

const FIXTURE = readFileSync(
	new URL("./fixtures/graph.json", import.meta.url).pathname,
	"utf8",
);

describe("reading an extraction", () => {
	test("the same text is recognised as the same extraction", () => {
		const first = readExtraction(FIXTURE, []);
		const again = readExtraction(`${FIXTURE}`, []);
		const other = readExtraction(`${FIXTURE}\n`, []);

		expect(again.hash).toBe(first.hash);
		expect(other.hash).not.toBe(first.hash);
	});

	test("an extraction already read is not parsed again", () => {
		const { hash } = readExtraction(FIXTURE, []);

		// Text that would fail to parse proves no parse was attempted.
		const broken = "{ not json";
		const brokenHash = readExtraction(broken, []).hash;

		expect(readExtraction(FIXTURE, [hash])).toEqual({ hash, skipped: true });
		expect(readExtraction(broken, [hash, brokenHash])).toEqual({
			hash: brokenHash,
			skipped: true,
		});
	});

	test("an extraction not yet read yields its programmatic connections", () => {
		const loaded = readExtraction(FIXTURE, ["someone else's hash"]);

		expect("graph" in loaded && loaded.graph.edges.map((edge) => edge.relation)).toEqual([
			"calls",
			"calls",
		]);
	});

	test("text that is not JSON is a failure saying so, not a throw", () => {
		const loaded = readExtraction("{ not json", []);

		expect("failure" in loaded && loaded.failure).toMatch(/^graph is not JSON/);
	});

	test("a graph missing what the adapter requires is a failure naming it", () => {
		const loaded = readExtraction(JSON.stringify({ links: [] }), []);

		expect("failure" in loaded && loaded.failure).toBe('graph has no "nodes" array');
	});
});
