import type { Concept } from "./concept.ts";

/** A slice of a Concept, small enough to match one subject. */
export interface Section {
	/** Rename-stable identity of the Concept this came from. */
	identity: string;
	/** The Concept's path-derived id, for display. */
	conceptId: string;
	index: number;
	/** What is embedded: the Concept's title and summary, then the section. */
	text: string;
	/** Content fingerprint, so re-indexing can skip what has not changed. */
	hash: string;
}

/**
 * Top-level body headings. OKF's convention is level one — `# Definition`,
 * `# Examples` — and hand-written Concepts often use level two instead, so
 * both count as a top-level division.
 */
const HEADING = /^#{1,2}\s+\S/;
/** Shorter than this, a piece is a label rather than a subject of its own. */
const MINIMUM = 40;

/**
 * Splits a Concept at its top-level body headings.
 *
 * A Concept covering a definition, a rationale and a migration note has three
 * subjects; one vector for all three matches none of them well. Each section
 * carries the Concept's title and its author's own summary, so it keeps both
 * what it is about and what the Concept as a whole is about.
 *
 * The summary goes on every section rather than the first, measured by
 * `scripts/measure-summary-placement.ts` over this repository's decisions and
 * the vendored bundle: it moved genuine queries
 * from 0.244-0.438 to 0.229-0.427 while unrelated ones stayed at 0.597-0.644,
 * and it put the right section of a multi-subject Concept first in 5 of 6
 * probes against 3 with the summary on the first section alone. Repeating one
 * summary does draw a Concept's sections together — mean distance between
 * them fell from 0.239 to 0.100 — but ranking is relative, and the section's
 * own text still decided which one won.
 */
export function splitConcept(concept: Concept): Section[] {
	if (!concept.conformant || !concept.identity) return [];

	const title = concept.title ?? concept.id;
	const summary = concept.description?.trim();
	const head = summary ? `${title}\n${summary}` : title;
	const body = concept.body.trim();
	if (body.length === 0) return [];

	const sections: Section[] = [];
	for (const piece of divide(body)) {
		// A short piece — `# Status`, `# Supersedes` — is joined to what
		// precedes it rather than dropped: a section nothing embeds is a
		// section nothing can retrieve.
		const previous = sections.at(-1);
		if (piece.length < MINIMUM && previous) {
			previous.text = `${previous.text}\n\n${piece}`;
			previous.hash = fingerprint(previous.text);
			continue;
		}
		const text = `${head}\n\n${piece}`;
		sections.push({
			identity: concept.identity,
			conceptId: concept.id,
			index: sections.length,
			text,
			hash: fingerprint(text),
		});
	}

	return sections;
}

const FENCE = /^\s*(```|~~~)/;

/** The body's pieces: any preamble, then one per top-level heading. */
function divide(body: string): string[] {
	const pieces: string[] = [];
	let current: string[] = [];
	let fenced = false;

	for (const line of body.split("\n")) {
		// A `# comment` inside a fenced block is shell, not a heading, and
		// splitting there would cut a script in half.
		if (FENCE.test(line)) fenced = !fenced;
		if (!fenced && HEADING.test(line) && current.length > 0) {
			pieces.push(current.join("\n").trim());
			current = [];
		}
		current.push(line);
	}
	pieces.push(current.join("\n").trim());

	return pieces.filter((piece) => piece.length > 0);
}

function fingerprint(text: string): string {
	return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 32);
}
