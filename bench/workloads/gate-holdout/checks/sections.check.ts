import { expect, test } from "bun:test";

import { cardSections } from "./src/concept-card.ts";
import { parseConcept } from "./src/concept.ts";

const NOW = new Date("2026-06-01T00:00:00Z");

const CARDS = [
	"---",
	"type: concept",
	"cm_identity: 7d1c-cards",
	"title: Concept cards",
	"description: One screen per Concept.",
	"---",
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
	"```sh",
	"# not a heading",
	"ls bundle",
	"```",
	"",
].join("\n");

test("one entry per section: the preamble, then each heading, a short piece joined to the one before", () => {
	expect(cardSections(parseConcept("glossary/cards", CARDS, NOW))).toEqual([
		{ heading: null, text: "A card is the first thing a reader sees of a Concept in the bundle." },
		{
			heading: "Definition",
			text: "# Definition\n\nA card shows one Concept's badges, preview, tags and sections.\n\n# Status\n\nSettled.",
		},
		{
			heading: "Rationale",
			text: "## Rationale\n\nCards let a reader triage a bundle without opening every file.\n\n```sh\n# not a heading\nls bundle\n```",
		},
	]);
});

test("text drops the title and summary, however many lines they span", () => {
	const plain = "---\ntype: concept\ncm_identity: 7d1c-plain\n---\n##   Wide gaps\n\nA heading written with extra spaces after its marks.\n";
	expect(cardSections(parseConcept("glossary/plain", plain, NOW))).toEqual([
		{ heading: "Wide gaps", text: "##   Wide gaps\n\nA heading written with extra spaces after its marks." },
	]);
	const long = [
		"---",
		"type: concept",
		"cm_identity: 7d1c-long",
		"title: Long summary",
		"description: |",
		"  First paragraph of the summary.",
		"",
		"  Second paragraph of the summary.",
		"---",
		"# Only",
		"",
		"One section, long enough to stand on its own.",
		"",
	].join("\n");
	expect(cardSections(parseConcept("glossary/long", long, NOW))).toEqual([
		{ heading: "Only", text: "# Only\n\nOne section, long enough to stand on its own." },
	]);
});

test("no cm_identity, no sections", () => {
	const anonymous = "---\ntype: concept\ntitle: Anonymous\n---\n# Heading\n\nA section that splitConcept will not return.\n";
	expect(cardSections(parseConcept("glossary/anonymous", anonymous, NOW))).toEqual([]);
});

test("a non-conformant Concept is rejected", () => {
	expect(() => cardSections(parseConcept("notes/loose", "No frontmatter here.\n", NOW))).toThrow(TypeError);
});
