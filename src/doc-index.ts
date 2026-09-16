import type { Concept, TrustTier } from "./concept.ts";

/** A Concept found by meaning, with the signals that qualify it. */
export interface ConceptHit {
	conceptId: string;
	/** The section that matched, with the Concept's title prepended. */
	text: string;
	trust: TrustTier;
	stale: boolean;
}

/**
 * The Doc Store's index: kept in line with the bundle, and searched.
 *
 * Derived, like the Thread Store's: the bundle is the record, and dropping
 * the index loses nothing the bundle does not hold.
 */
export interface ConceptSearch {
	/** Brings the index in line with the bundle. Returns what it embedded. */
	indexConcepts(concepts: Concept[]): Promise<number>;
	searchConcepts(
		query: string,
		limit: number,
		maxDistance: number,
	): Promise<ConceptHit[]>;
}
