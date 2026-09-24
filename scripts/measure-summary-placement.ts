/**
 * Measures where a Concept's own summary should join the text each section is
 * embedded under: every section, the first section only, or nowhere.
 *
 * Three placements over two corpora — this repository's decisions and
 * vocabulary, with summaries written as an author would, and the vendored
 * `okf-acme-retail` bundle, whose Concepts carry real summaries and several
 * subjects each. Reports the genuine and unrelated distances the Doc Store's
 * threshold was set from, whether a paraphrase of a summary finds its Concept,
 * which section of a many-subject Concept a section-shaped query returns, and
 * how far apart one Concept's sections sit — the flattening a repeated summary
 * risks. Queries are embedded the way `searchConcepts` embeds them, as
 * passages.
 *
 * Run it with the project's Bun:
 *
 *     CM_BUN=$(which bun) bun scripts/measure-summary-placement.ts
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readBundle } from "../src/doc-store.ts";
import { LocalEmbedder } from "../src/embedder.ts";
import type { Concept } from "../src/concept.ts";

/** Summaries written as an author would: subject, not body wording. */
const SUMMARIES: Record<string, string> = {
	"decisions/0001-omp-extension-not-own-loop":
		"Why this ships inside an existing coding agent rather than as a standalone tool with its own conversation loop.",
	"decisions/0002-thread-store-derived-from-journal":
		"Which copy of a conversation is authoritative, and what may be thrown away and rebuilt.",
	"decisions/0003-deterministic-assembler":
		"Why the same inputs must always produce the same window, and why the agent's built-in recall is switched off.",
	"decisions/0004-single-injector-enforced-by-disclosure":
		"How the one-injector rule is policed when the competing content lands somewhere unreachable.",
	"standards/vocabulary":
		"The words this codebase insists on, and the ones it refuses, for windows, stores, budgets and units.",
};

/** Queries paraphrasing a summary, using none of the body's wording. */
const PARAPHRASES: { id: string; query: string }[] = [
	{ id: "decisions/0001-omp-extension-not-own-loop", query: "should we build our own chat tool or live inside one that exists" },
	{ id: "decisions/0002-thread-store-derived-from-journal", query: "which copy of the conversation may be deleted and rebuilt" },
	{ id: "decisions/0003-deterministic-assembler", query: "same inputs same window every time" },
	{ id: "standards/vocabulary", query: "the words we insist on and the ones we refuse" },
];

const PROBES: { kind: "genuine" | "unrelated"; query: string }[] = [
	{ kind: "genuine", query: "why do we run as an extension instead of owning the agent loop" },
	{ kind: "genuine", query: "is the thread store the source of truth or derived" },
	{ kind: "genuine", query: "what does the term Floor mean in this project" },
	{ kind: "unrelated", query: "how do I bake sourdough bread at home" },
	{ kind: "unrelated", query: "what is the capital of Peru" },
];

/** Queries aimed at one section of a multi-section Concept in the vendored bundle. */
const SECTIONED: { id: string; section: number; query: string }[] = [
	{ id: "metrics/gross-margin", section: 0, query: "how is gross margin calculated for a period" },
	{ id: "metrics/gross-margin", section: 1, query: "what changed in the margin definition in FY2026" },
	{ id: "metrics/gross-margin", section: 2, query: "who signed off on gross margin and when does it go stale" },
	{ id: "policies/revenue-recognition", section: 0, query: "when is revenue recognised" },
	// Subject wording from the summary, about a later section: the case
	// first-section-only cannot serve if attaching the summary is what
	// makes a Concept findable by its author's paraphrase.
	{ id: "metrics/gross-margin", section: 2, query: "when does the FY2026 cost allocation margin number need re-checking" },
	{ id: "metrics/gross-margin", section: 1, query: "how did the FY2026 cost allocation standard change the margin figure" },
];

async function buildRepoCorpus(root: string): Promise<void> {
	await rm(root, { recursive: true, force: true });
	await mkdir(join(root, "decisions"), { recursive: true });
	await mkdir(join(root, "standards"), { recursive: true });

	for (const name of await readdir(join("docs/adr"))) {
		if (!name.endsWith(".md")) continue;
		const body = await readFile(join("docs/adr", name), "utf8");
		const title = body.split("\n")[0]?.replace(/^#\s*/, "").trim() ?? name;
		const id = `decisions/${name.replace(/\.md$/, "")}`;
		await writeFile(
			join(root, "decisions", name),
			frontmatter("Decision", title, SUMMARIES[id] ?? title) +
				body.slice(body.indexOf("\n")).trim(),
		);
	}

	const glossary = await readFile(join("CONTEXT.md"), "utf8");
	await writeFile(
		join(root, "standards", "vocabulary.md"),
		frontmatter("Standard", "Project vocabulary", SUMMARIES["standards/vocabulary"] ?? "") +
			glossary.slice(glossary.indexOf("\n")).trim(),
	);
}

function frontmatter(type: string, title: string, description: string): string {
	return ["---", `type: ${type}`, `title: ${title}`, `description: ${description}`, "status: stable", "---", "", ""].join("\n");
}

// The three shapes under test. `splitConcept`'s own rules (top-level
// headings, short pieces folded back) are reproduced here so the variants
// differ only in where the summary goes.
const HEADING = /^#{1,2}\s+\S/;
const FENCE = /^\s*(```|~~~)/;
const MINIMUM = 40;

function pieces(body: string): string[] {
	const out: string[] = [];
	let current: string[] = [];
	let fenced = false;
	for (const line of body.split("\n")) {
		if (FENCE.test(line)) fenced = !fenced;
		if (!fenced && HEADING.test(line) && current.length > 0) {
			out.push(current.join("\n").trim());
			current = [];
		}
		current.push(line);
	}
	out.push(current.join("\n").trim());
	const divided = out.filter((piece) => piece.length > 0);
	const folded: string[] = [];
	for (const piece of divided) {
		const previous = folded.at(-1);
		if (piece.length < MINIMUM && previous !== undefined) {
			folded[folded.length - 1] = `${previous}\n\n${piece}`;
			continue;
		}
		folded.push(piece);
	}
	return folded;
}

type Variant = "none" | "every" | "first";

interface Piece {
	conceptId: string;
	index: number;
	text: string;
}

function sectionsOf(concept: Concept, variant: Variant): Piece[] {
	if (!concept.conformant) return [];
	const title = concept.title ?? concept.id;
	const summary = concept.description ?? "";
	return pieces(concept.body.trim()).map((piece, index) => {
		const attach =
			summary !== "" &&
			(variant === "every" || (variant === "first" && index === 0));
		const head = attach ? `${title}\n${summary}` : title;
		return { conceptId: concept.id, index, text: `${head}\n\n${piece}` };
	});
}

function cosine(a: number[], b: number[]): number {
	let total = 0;
	for (const [index, value] of a.entries()) total += value * (b[index] ?? 0);
	return total;
}

const repoRoot = "/tmp/cm-summary-corpus";
await buildRepoCorpus(repoRoot);
const repoConcepts = (await readBundle(repoRoot)) ?? [];
const fixtureConcepts =
	(await readBundle(join("test/fixtures/okf-acme-retail"))) ?? [];

const embedder = new LocalEmbedder(process.env.CM_BUN);
try {
	const queries = [
		...PROBES.map((probe) => probe.query),
		...PARAPHRASES.map((each) => each.query),
		...SECTIONED.map((each) => each.query),
	];
	const queryVectors = await embedder.embed(queries);
	const vectorFor = new Map(queries.map((q, i) => [q, queryVectors[i] ?? []]));

	for (const variant of ["none", "every", "first"] as Variant[]) {
		const repoPieces = repoConcepts.flatMap((c) => sectionsOf(c, variant));
		const fixturePieces = fixtureConcepts.flatMap((c) => sectionsOf(c, variant));
		const repoVectors = await embedder.embed(repoPieces.map((p) => p.text));
		const fixtureVectors = await embedder.embed(fixturePieces.map((p) => p.text));

		const near = (vectors: number[][], pieces: Piece[], query: string) =>
			pieces
				.map((piece, index) => ({
					piece,
					distance: 1 - cosine(vectorFor.get(query) ?? [], vectors[index] ?? []),
				}))
				.sort((a, b) => a.distance - b.distance);

		console.log(`\n## ${variant}`);
		for (const probe of PROBES) {
			const [best] = near(repoVectors, repoPieces, probe.query);
			console.log(
				`  ${probe.kind.padEnd(9)} ${best?.distance.toFixed(3)}  ${best?.piece.conceptId}#${best?.piece.index}  "${probe.query.slice(0, 40)}"`,
			);
		}
		let found = 0;
		for (const each of PARAPHRASES) {
			const ranked = near(repoVectors, repoPieces, each.query);
			const rank = ranked.findIndex((r) => r.piece.conceptId === each.id);
			const top = ranked[0];
			if (rank === 0) found++;
			console.log(
				`  summary   rank ${rank} at ${ranked[rank]?.distance.toFixed(3)} (top ${top?.piece.conceptId}#${top?.piece.index} ${top?.distance.toFixed(3)})  "${each.query.slice(0, 40)}"`,
			);
		}
		let right = 0;
		for (const each of SECTIONED) {
			const ranked = near(fixtureVectors, fixturePieces, each.query);
			const best = ranked.find((r) => r.piece.conceptId === each.id);
			const topIsConcept = ranked[0]?.piece.conceptId === each.id;
			if (best?.piece.index === each.section) right++;
			console.log(
				`  section   wanted ${each.id}#${each.section}, got #${best?.piece.index} at ${best?.distance.toFixed(3)}${topIsConcept ? "" : ` (corpus top ${ranked[0]?.piece.conceptId}#${ranked[0]?.piece.index})`}`,
			);
		}
		// The design's stated risk: one summary repeated across sections
		// drags them toward a common vector. Measured as the mean pairwise
		// distance between the sections of one Concept.
		const byConcept = new Map<string, number[][]>();
		for (const [index, piece] of fixturePieces.entries()) {
			byConcept.set(piece.conceptId, [...(byConcept.get(piece.conceptId) ?? []), fixtureVectors[index] ?? []]);
		}
		let pairs = 0;
		let total = 0;
		for (const vectors of byConcept.values()) {
			for (let a = 0; a < vectors.length; a++) {
				for (let b = a + 1; b < vectors.length; b++) {
					total += 1 - cosine(vectors[a] ?? [], vectors[b] ?? []);
					pairs++;
				}
			}
		}
		// And the margin that decides a section: how much nearer the right
		// section is than the next-best section of the same Concept.
		const margins: number[] = [];
		for (const each of SECTIONED) {
			const ranked = near(fixtureVectors, fixturePieces, each.query).filter((r) => r.piece.conceptId === each.id);
			const wanted = ranked.find((r) => r.piece.index === each.section);
			const others = ranked.filter((r) => r.piece.index !== each.section);
			if (wanted && others[0]) margins.push(others[0].distance - wanted.distance);
		}
		console.log(`  summary probes found first: ${found}/${PARAPHRASES.length}; right section: ${right}/${SECTIONED.length}`);
		console.log(`  intra-concept spread: ${(total / Math.max(pairs, 1)).toFixed(3)} over ${pairs} pairs; section margin mean ${(margins.reduce((s, m) => s + m, 0) / Math.max(margins.length, 1)).toFixed(3)} min ${Math.min(...margins).toFixed(3)}`);
	}
} finally {
	await embedder.close();
}
