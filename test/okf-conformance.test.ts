// Read against the format authors' own example bundle, vendored verbatim.
// Our hand-written fixtures encode what we expect OKF to look like; this one
// encodes what it actually looks like, so a wrong assumption fails here first.

import { describe, expect, test } from "bun:test";

import { DocStore } from "../src/doc-store.ts";

const BUNDLE = new URL("./fixtures/okf-acme-retail", import.meta.url).pathname;
const AT = new Date("2026-09-16T00:00:00Z");

function store(): DocStore {
	return new DocStore(BUNDLE, { now: () => AT });
}

describe("the specification's own bundle", () => {
	test("reads with no diagnostics", async () => {
		const concepts = await store().concepts();

		const problems = concepts
			.filter((concept) => !concept.conformant)
			.map((concept) => `${concept.id}: ${concept.problem}`);
		expect(problems).toEqual([]);
		expect(concepts.length).toBeGreaterThan(5);
	});

	test("types the format uses are reported as given", async () => {
		const concepts = await store().concepts();

		const types = [...new Set(concepts.map((concept) => concept.type))].sort();
		expect(types).toContain("Attested Computation");
		expect(types).toContain("Metric");
	});

	test("a deprecated concept is distinguishable from a stable one", async () => {
		const concepts = await store().concepts();

		const deprecated = concepts.filter(
			(concept) => concept.status === "deprecated",
		);
		expect(deprecated.map((concept) => concept.id)).toEqual([
			"metrics/gross-margin-legacy",
		]);
	});

	test("trust tiers separate human-reviewed concepts from unverified ones", async () => {
		const concepts = await store().concepts();

		const byTier = new Map(
			concepts.map((concept) => [concept.id, concept.trust]),
		);
		expect(byTier.get("metrics/gross-margin")).toBe("human-reviewed");
		expect(byTier.get("skills/run-on-bq")).toBe("unverified");
	});

	test("the bundle can be walked from the root", async () => {
		const root = await store().list("");

		expect(root.levels).toEqual([
			"attesters",
			"computations",
			"metrics",
			"policies",
			"skills",
			"tables",
		]);
	});

	test("reserved files are not mistaken for concepts", async () => {
		const ids = (await store().concepts()).map((concept) => concept.id);

		expect(ids.filter((id) => id.endsWith("index") || id.endsWith("log"))).toEqual(
			[],
		);
	});
});
