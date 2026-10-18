import { expect, test } from "bun:test";

import { cardLines } from "./src/concept-card-render.ts";
import { cardFooter } from "./src/concept-card.ts";
import { parseConcept } from "./src/concept.ts";

const NOW = new Date("2026-06-01T00:00:00Z");
const concept = (frontmatter: string, body = "", id = "glossary/card") =>
	parseConcept(id, `---\ntype: concept\n${frontmatter}\n---\n${body}`, NOW);

const BODY = [
	"A card is the first thing a reader sees of a Concept in the bundle.",
	"",
	"# Definition",
	"",
	"A card shows one Concept's badges, preview, tags and sections.",
	"",
	"## Rationale",
	"",
	"Cards let a reader triage a bundle without opening every file.",
	"",
].join("\n");

const CARD = concept(
	[
		"cm_identity: 7d1c-card",
		"title: Concept cards",
		"description: Cards in one screen.",
		"tags: [core:cards]",
		"generated:",
		"  by: agent:omp",
		"  at: 2026-05-01T00:00:00Z",
		"verified:",
		"  - by: agent:checker",
		"    at: 2026-05-02T00:00:00Z",
		"sources:",
		"  - title: First",
		"    resource: https://example.test/a",
		"  - title: Talk only",
		"  - resource: https://example.test/b",
	].join("\n"),
	BODY,
);

test("the fields of notes/footer.md, then the marks of notes/badges.md", () => {
	expect(cardFooter(CARD)).toBe("glossary/card :: by agent:omp :: 3 parts :: seal=B :: cites=2");
});

test("seal: A only when human-reviewed and fresh, B only when machine-confirmed and fresh", () => {
	const identity = "cm_identity: 7d1c-seal";
	const human = "verified:\n  - by: human:ana";
	const machine = "verified:\n  - by: agent:checker";
	const stale = "stale_after: 2026-01-01";
	expect(
		[`${identity}\n${human}`, `${identity}\n${human}\n${stale}`, `${identity}\n${machine}\n${stale}`, identity].map((frontmatter) =>
			cardFooter(concept(frontmatter, BODY, "glossary/seal")),
		),
	).toEqual([
		"glossary/seal :: by nobody :: 3 parts :: seal=A :: cites=0",
		"glossary/seal :: by nobody :: 3 parts :: seal=C :: cites=0",
		"glossary/seal :: by nobody :: 3 parts :: seal=C :: cites=0",
		"glossary/seal :: by nobody :: 3 parts :: seal=C :: cites=0",
	]);
});

test("one part, no producer, no sections", () => {
	expect(cardFooter(concept("cm_identity: 7d1c-one", "# Only\n\nOne section, long enough to stand on its own.\n", "glossary/one"))).toBe(
		"glossary/one :: by nobody :: 1 part :: seal=C :: cites=0",
	);
	expect(cardFooter(concept("generated:\n  at: 2026-05-01T00:00:00Z", "No identity, so no sections.\n", "glossary/none"))).toBe(
		"glossary/none :: by nobody :: 0 parts :: seal=C :: cites=0",
	);
});

test("a non-conformant Concept is rejected", () => {
	expect(() => cardFooter(parseConcept("notes/loose", "No frontmatter here.\n", NOW))).toThrow(TypeError);
});

test("cardLines: the card with the footer just before the bottom rule", () => {
	expect(cardLines(CARD)).toEqual([
		"=".repeat(40),
		"Concept cards [bot-seen]",
		"> Cards in one screen.",
		"tags: core:cards",
		"   *) preface",
		"   i) Definition",
		"   ii) Rationale",
		"glossary/card :: by agent:omp :: 3 parts :: seal=B :: cites=2",
		"-".repeat(40),
	]);
});
