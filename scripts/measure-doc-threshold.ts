/**
 * Measures how far a query sits from the Concept that answers it, and from
 * one that does not, so the Doc Store's relevance threshold is a measurement
 * rather than a number inherited from recall.
 *
 * The corpus is this repository's own decisions and glossary, turned into
 * Concepts. Run it with the project's Bun:
 *
 *     PICHART_BUN=$(which bun) bun scripts/measure-doc-threshold.ts
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readBundle } from "../src/doc-store.ts";
import { LocalEmbedder } from "../src/embedder.ts";
import { splitConcept } from "../src/sections.ts";

const PROBES: { kind: "genuine" | "unrelated"; query: string }[] = [
	{
		kind: "genuine",
		query: "why do we run as an extension instead of owning the agent loop",
	},
	{ kind: "genuine", query: "is the thread store the source of truth or derived" },
	{ kind: "genuine", query: "what does the term Floor mean in this project" },
	{ kind: "unrelated", query: "how do I bake sourdough bread at home" },
	{ kind: "unrelated", query: "what is the capital of Peru" },
];

/** Writes this repo's ADRs and glossary into a bundle the Doc Store can read. */
async function buildCorpus(root: string): Promise<void> {
	await rm(root, { recursive: true, force: true });
	await mkdir(join(root, "decisions"), { recursive: true });
	await mkdir(join(root, "standards"), { recursive: true });

	for (const name of await readdir("docs/adr")) {
		if (!name.endsWith(".md")) continue;
		const body = await readFile(join("docs/adr", name), "utf8");
		const title = body.split("\n")[0]?.replace(/^#\s*/, "").trim() ?? name;
		await writeFile(
			join(root, "decisions", name),
			frontmatter("Decision", title) + body.slice(body.indexOf("\n")).trim(),
		);
	}

	const glossary = await readFile("CONTEXT.md", "utf8");
	await writeFile(
		join(root, "standards", "vocabulary.md"),
		frontmatter("Standard", "Project vocabulary") +
			glossary.slice(glossary.indexOf("\n")).trim(),
	);
}

function frontmatter(type: string, title: string): string {
	return [
		"---",
		`type: ${type}`,
		`title: ${title}`,
		`description: ${title}`,
		"status: stable",
		"---",
		"",
		"",
	].join("\n");
}

function cosine(a: number[], b: number[]): number {
	let total = 0;
	for (const [index, value] of a.entries()) total += value * (b[index] ?? 0);
	return total;
}

const root = join(tmpdir(), "cm-threshold-corpus");
await buildCorpus(root);
const concepts = (await readBundle(root)) ?? [];

const embedder = new LocalEmbedder(process.env.PICHART_BUN);
try {
	const sections = concepts.flatMap(splitConcept);
	const wholes = concepts
		.filter((concept) => concept.conformant)
		.map((concept) => ({
			id: concept.id,
			text: `${concept.title ?? concept.id}\n\n${concept.body}`,
		}));

	const sectionVectors = await embedder.embed(
		sections.map((section) => section.text),
	);
	const wholeVectors = await embedder.embed(wholes.map((whole) => whole.text));

	console.log("| query | best section | best whole Concept |");
	console.log("| --- | --- | --- |");
	for (const probe of PROBES) {
		const [query] = await embedder.embed([probe.query]);
		if (!query) continue;

		const nearestSection = Math.min(
			...sectionVectors.map((vector) => 1 - cosine(query, vector)),
		);
		const nearestWhole = Math.min(
			...wholeVectors.map((vector) => 1 - cosine(query, vector)),
		);
		console.log(
			`| ${probe.kind}: "${probe.query}" | ${nearestSection.toFixed(3)} | ` +
				`${nearestWhole.toFixed(3)} |`,
		);
	}
} finally {
	await embedder.close();
}
