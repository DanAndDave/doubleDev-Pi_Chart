import { expect, test } from "bun:test";

import { numberedHeadings } from "./src/concept-card.ts";
import { parseConcept } from "./src/concept.ts";

const NOW = new Date("2026-06-01T00:00:00Z");
const concept = (id: string, body: string, identity = true) =>
	parseConcept(id, `---\ntype: concept\n${identity ? `cm_identity: ${id}\n` : ""}title: Numbered\n---\n${body}`, NOW);

test("the preamble is the preface; headed sections count from i", () => {
	const body = [
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
	].join("\n");
	expect(numberedHeadings(concept("glossary/cards", body))).toEqual(["*) preface", "i) Definition", "ii) Rationale"]);
});

test("roman numerals up to x, plain digits from the 11th; # and ## alike", () => {
	const body = Array.from(
		{ length: 12 },
		(_, at) => `${at % 2 === 0 ? "#" : "##"} Part ${at + 1}\n\nText of part ${at + 1}, long enough to stand alone.\n`,
	).join("\n");
	expect(numberedHeadings(concept("glossary/parts", body))).toEqual([
		"i) Part 1",
		"ii) Part 2",
		"iii) Part 3",
		"iv) Part 4",
		"v) Part 5",
		"vi) Part 6",
		"vii) Part 7",
		"viii) Part 8",
		"ix) Part 9",
		"x) Part 10",
		"11) Part 11",
		"12) Part 12",
	]);
});

test("no sections, no labels", () => {
	expect(numberedHeadings(concept("glossary/anonymous", "# Heading\n\nA section nobody will number.\n", false))).toEqual([]);
});
