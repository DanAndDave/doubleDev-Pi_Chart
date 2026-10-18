import { expect, test } from "bun:test";

import { rankedTags, tagPreview } from "./src/concept-card.ts";
import { parseConcept } from "./src/concept.ts";

const NOW = new Date("2026-06-01T00:00:00Z");
const tagged = (tags: string[]) => parseConcept("glossary/tagged", `---\ntype: concept\ntags: ${JSON.stringify(tags)}\n---\nBody.\n`, NOW);

const MANY = [
	"lang:ts",
	"misc",
	"core:cards",
	"area:store",
	"beta",
	"area:index",
	"core:cards",
	"Zulu",
	"Core:upper",
	"lang:go",
	"area:x:core",
	"core",
];

test("weights by prefix from notes/tags.md, heaviest first, ties in code-unit order, once each", () => {
	expect(rankedTags(tagged(MANY))).toEqual([
		{ tag: "core:cards", weight: 7 },
		{ tag: "area:index", weight: 4 },
		{ tag: "area:store", weight: 4 },
		{ tag: "area:x:core", weight: 4 },
		{ tag: "lang:go", weight: 2 },
		{ tag: "lang:ts", weight: 2 },
		{ tag: "Core:upper", weight: 1 },
		{ tag: "Zulu", weight: 1 },
		{ tag: "beta", weight: 1 },
		{ tag: "core", weight: 1 },
		{ tag: "misc", weight: 1 },
	]);
});

test("empty and whitespace-only tags are left out", () => {
	expect(rankedTags(tagged(["", "  ", "area:a"]))).toEqual([{ tag: "area:a", weight: 4 }]);
	expect(rankedTags(tagged([]))).toEqual([]);
});

test("tagPreview: the first three ranked tags, then how many were left out", () => {
	expect(tagPreview(tagged(MANY))).toBe("core:cards, area:index, area:store (+8)");
	expect(tagPreview(tagged(["lang:ts", "core:a", "b"]))).toBe("core:a, lang:ts, b");
	expect(tagPreview(tagged(["x", "x"]))).toBe("x");
});

test("no tags", () => {
	expect(tagPreview(tagged([]))).toBe("no tags");
	expect(tagPreview(tagged(["", " "]))).toBe("no tags");
});
