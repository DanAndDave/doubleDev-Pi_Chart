import type { Concept } from "./concept.ts";

/** A slice of a Concept, small enough to match one subject. */
export interface Section {
	/** Rename-stable identity of the Concept this came from. */
	identity: string;
	/** The Concept's path-derived id, for display. */
	conceptId: string;
	index: number;
	/** What is embedded: the Concept's title, then the section's own text. */
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
 * carries the Concept's title so it keeps what it is about.
 */
export function splitConcept(concept: Concept): Section[] {
	if (!concept.conformant || !concept.identity) return [];

	const title = concept.title ?? concept.id;
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
		const text = `${title}\n\n${piece}`;
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

/** The body's pieces: any preamble, then one per top-level heading. */
function divide(body: string): string[] {
	const pieces: string[] = [];
	let current: string[] = [];

	for (const line of body.split("\n")) {
		if (HEADING.test(line) && current.length > 0) {
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
