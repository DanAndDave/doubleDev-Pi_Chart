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

const HEADING = /^##\s+/m;
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

	const pieces = body
		.split(HEADING)
		.map((piece, index) => (index === 0 ? piece : `## ${piece}`))
		.map((piece) => piece.trim())
		.filter((piece) => piece.length > 0);

	const sections: Section[] = [];
	for (const piece of pieces) {
		const text = `${title}\n\n${piece}`;
		// Fragments shorter than a sentence carry no retrievable meaning and
		// would only dilute the index.
		if (piece.length < MINIMUM && sections.length > 0) continue;
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

function fingerprint(text: string): string {
	return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 32);
}
