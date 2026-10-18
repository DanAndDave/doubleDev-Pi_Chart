import { expect, test } from "bun:test";

import { badgesOf, statusBadge, trustBadge } from "./src/concept-card.ts";
import { parseConcept } from "./src/concept.ts";

const NOW = new Date("2026-06-01T00:00:00Z");
const concept = (frontmatter: string) => parseConcept("notes/sample", `---\ntype: concept\n${frontmatter}\n---\nBody.\n`, NOW);

test("status badges of notes/badges.md, fresh and stale", () => {
	expect(
		[
			"status: draft",
			"status: draft\nstale_after: 2026-01-01",
			"status: draft\nstale_after: 2027-01-01",
			"status: stable",
			"title: No status",
			"stale_after: 2026-01-01",
			"status: deprecated",
			"status: deprecated\nstale_after: 2026-01-01",
		].map((frontmatter) => statusBadge(concept(frontmatter))),
	).toEqual(["SKETCH", "SKETCH-OLD", "SKETCH", "", "", "OLD", "SUNSET", "SUNSET"]);
});

test("trust badges of notes/badges.md, from the trust parseConcept derives", () => {
	expect(
		[
			"title: Unverified",
			"verified:\n  by: agent:checker",
			"verified:\n  - by: human:ana",
			"generated:\n  by: agent:omp\n  at: 2026-05-01T00:00:00Z\nverified:\n  - by: human:ana\n    at: 2026-04-01T00:00:00Z",
		].map((frontmatter) => trustBadge(concept(frontmatter))),
	).toEqual(["unchecked", "bot-seen", "peer-read", "unchecked"]);
});

test("badgesOf: the status badge, then the trust badge, without an empty one", () => {
	expect(badgesOf(concept("status: draft\nverified:\n  by: agent:checker"))).toEqual(["SKETCH", "bot-seen"]);
	expect(badgesOf(concept("status: stable"))).toEqual(["unchecked"]);
	expect(badgesOf(concept("stale_after: 2026-01-01\nverified:\n  - by: human:ana"))).toEqual(["OLD", "peer-read"]);
});

test("a non-conformant Concept is rejected", () => {
	const unfenced = parseConcept("notes/loose", "No frontmatter here.\n", NOW);
	const untyped = parseConcept("notes/untyped", "---\ntitle: No type\n---\nBody.\n", NOW);
	for (const bad of [unfenced, untyped]) {
		expect(() => statusBadge(bad)).toThrow(TypeError);
		expect(() => trustBadge(bad)).toThrow(TypeError);
	}
});
