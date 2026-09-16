import { describe, expect, test } from "bun:test";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseConcept, type Concept } from "../src/concept.ts";
import { DocStore } from "../src/doc-store.ts";
import { splitConcept } from "../src/sections.ts";

const AT = new Date("2026-09-16T00:00:00Z");

function concept(body: string, frontmatter = "type: Decision\ntitle: Caching"): Concept {
	const parsed = parseConcept(
		"decisions/caching",
		`---\n${frontmatter}\ncm_identity: abc-123\n---\n\n${body}\n`,
		AT,
	);
	return parsed;
}

describe("splitConcept", () => {
	test("splits a concept at its top-level headings", () => {
		const sections = splitConcept(
			concept(
				"Intro paragraph that is long enough to stand on its own as text.\n\n" +
					"## Rationale\n\nBecause parsing showed up in profiles repeatedly.\n\n" +
					"## Migration\n\nInvalidate the cache when the file changes on disk.",
			),
		);

		expect(sections).toHaveLength(3);
		expect(sections[1]?.text).toContain("Rationale");
		expect(sections[2]?.text).toContain("Migration");
	});

	test("every section carries the concept's title", () => {
		const sections = splitConcept(
			concept("## Rationale\n\nBecause parsing showed up in profiles repeatedly."),
		);

		expect(sections.every((section) => section.text.startsWith("Caching"))).toBe(
			true,
		);
	});

	test("a concept with no headings is one section", () => {
		const sections = splitConcept(
			concept("A single paragraph of explanation, with no headings at all here."),
		);

		expect(sections).toHaveLength(1);
		expect(sections[0]?.index).toBe(0);
	});

	test("splits a real OKF concept, whose headings are level one", async () => {
		// The vendored reference bundle uses `# Definition`, `# What changed
		// in FY2026`, `# Trust and freshness` — the convention the format
		// itself documents.
		// On a copy: `ensureIdentities` writes, and a test must not edit the
		// fixtures it reads.
		const directory = await mkdtemp(join(tmpdir(), "cm-okf-"));
		await cp(
			new URL("./fixtures/okf-acme-retail", import.meta.url).pathname,
			directory,
			{ recursive: true },
		);
		const bundle = new DocStore(directory);
		await bundle.ensureIdentities();
		const concepts = await bundle.concepts();
		const margin = concepts.find((each) => each.id.endsWith("gross-margin"));
		if (!margin) throw new Error("fixture concept missing");

		const sections = splitConcept(margin);

		expect(sections.length).toBeGreaterThan(2);
		expect(sections.map((section) => section.text).join("\n")).toContain(
			"Trust and freshness",
		);
	});

	test("a hash comment inside a code fence is not a heading", () => {
		const sections = splitConcept(
			concept(
				"## Usage\n\nRun the importer from the repository root.\n\n" +
					"```bash\n# install first\nbun install\n# then import\nbun run import\n```\n\n" +
					"## Caveats\n\nThe importer is not idempotent across partitions.",
			),
		);

		expect(sections).toHaveLength(2);
		expect(sections[0]?.text).toContain("bun run import");
	});

	test("a short section is kept, joined to what precedes it", () => {
		const sections = splitConcept(
			concept(
				"## Decision\n\nWe keep parsed configuration in memory for the process.\n\n" +
					"## Status\n\nAccepted.",
			),
		);

		// Dropped short sections are text nothing can ever retrieve.
		expect(sections.map((section) => section.text).join("\n")).toContain(
			"Accepted.",
		);
	});

	test("a non-conformant concept yields nothing", () => {
		const broken = parseConcept("decisions/broken", "no frontmatter here", AT);

		expect(splitConcept(broken)).toEqual([]);
	});

	test("a concept with no identity yields nothing", () => {
		// Identity is what the index keys on, so an unassigned Concept is
		// not indexable yet.
		const anonymous = parseConcept(
			"decisions/anon",
			"---\ntype: Decision\n---\n\nSome body text that is long enough to keep.\n",
			AT,
		);

		expect(splitConcept(anonymous)).toEqual([]);
	});

	test("the same text always fingerprints the same way", () => {
		const first = splitConcept(concept("## A\n\nSome text long enough to keep here."));
		const second = splitConcept(concept("## A\n\nSome text long enough to keep here."));

		expect(first[0]?.hash).toBe(second[0]?.hash ?? "");
	});

	test("changed text changes the fingerprint", () => {
		const before = splitConcept(concept("## A\n\nSome text long enough to keep here."));
		const after = splitConcept(concept("## A\n\nDifferent text, also long enough."));

		expect(after[0]?.hash).not.toBe(before[0]?.hash ?? "");
	});
});
