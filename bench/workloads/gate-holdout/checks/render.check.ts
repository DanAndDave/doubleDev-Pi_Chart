import { expect, test } from "bun:test";

import { renderCard } from "./src/concept-card-render.ts";
import { bodyPreview, headerLine } from "./src/concept-card.ts";
import { parseConcept } from "./src/concept.ts";

const NOW = new Date("2026-06-01T00:00:00Z");
const concept = (frontmatter: string, body = "", id = "glossary/card") =>
	parseConcept(id, `---\ntype: concept\n${frontmatter}\n---\n${body}`, NOW);

const CARDS = concept(
	[
		"cm_identity: 7d1c-cards",
		"title: Concept cards",
		"status: draft",
		"verified:",
		"  by: agent:checker",
		"tags: [lang:ts, core:cards, area:store, misc]",
		"description: A card shows one Concept on a single screen, badges first.",
	].join("\n"),
	[
		"A card is the first thing a reader sees of a Concept in the bundle.",
		"",
		"# Definition",
		"",
		"A card shows one Concept's badges, preview, tags and sections.",
		"",
		"# Status",
		"",
		"Settled.",
		"",
		"## Rationale",
		"",
		"Cards let a reader triage a bundle without opening every file.",
		"",
	].join("\n"),
);

test("headerLine: the title or id, then each badge in brackets", () => {
	expect(headerLine(CARDS)).toBe("Concept cards [SKETCH] [bot-seen]");
	expect(headerLine(concept("status: stable", "Body.\n", "glossary/tail"))).toBe("glossary/tail [unchecked]");
	expect(headerLine(concept("title: Aged\nstale_after: 2026-01-01\nverified:\n  - by: human:ana"))).toBe(
		"Aged [OLD] [peer-read]",
	);
});

test("bodyPreview: the description, whitespace collapsed, cut back to a word as notes/preview.md says", () => {
	expect(bodyPreview(CARDS)).toBe("A card shows one Concept on a single...");
	expect(bodyPreview(concept("description: Cards in one screen."))).toBe("Cards in one screen.");
	expect(bodyPreview(concept('description: "  Spread   over\\n  two lines.  "'))).toBe("Spread over two lines.");
	expect(bodyPreview(concept(`description: ${"x".repeat(46)}`))).toBe("x".repeat(46));
	expect(bodyPreview(concept(`description: ${"x".repeat(47)}`))).toBe(`${"x".repeat(43)}...`);
	expect(bodyPreview(concept("description: The preview keeps whole words only and drops the rest"))).toBe(
		"The preview keeps whole words only and...",
	);
	// The 43 characters end on a whole word and character 44 is a space: still cut back to the last space within them.
	expect(bodyPreview(concept("description: Every card ends its preview on a whole word and never mid word."))).toBe(
		"Every card ends its preview on a whole...",
	);
});

test("bodyPreview: without a description, the first section without its heading line", () => {
	const identity = "cm_identity: 7d1c-body";
	expect(bodyPreview(concept(identity, "# Heading\n\nFirst section text,\nwrapped.\n\n# Next\n\nThe second section is never previewed.\n"))).toBe(
		"First section text, wrapped.",
	);
	expect(bodyPreview(concept(`${identity}\ndescription: "   "`, "Short lead.\n\n# Next\n\nThe second section is never previewed.\n"))).toBe(
		"Short lead.",
	);
	expect(bodyPreview(concept("title: Nothing", "No identity, so no sections.\n"))).toBe("(empty)");
});

test("renderCard: rules, header, preview, tags, then one indented line per numbered heading", () => {
	expect(renderCard(CARDS)).toEqual([
		"=".repeat(40),
		"Concept cards [SKETCH] [bot-seen]",
		"> A card shows one Concept on a single...",
		"tags: core:cards, area:store, lang:ts (+1)",
		"   *) preface",
		"   i) Definition",
		"   ii) Rationale",
		"-".repeat(40),
	]);
});

test("renderCard: a Concept with nothing to show", () => {
	expect(renderCard(concept("status: stable", "No identity, so no sections.\n", "glossary/empty"))).toEqual([
		"=".repeat(40),
		"glossary/empty [unchecked]",
		"> (empty)",
		"tags: no tags",
		"   (no sections)",
		"-".repeat(40),
	]);
});
