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
/** What an indexing pass did, and what it could not do. */
export interface IndexResult {
	/** How many sections it embedded. Zero when nothing changed. */
	embedded: number;
	/**
	 * Concepts skipped because another file already claimed their identity.
	 * Named rather than counted: the fix is to edit that file.
	 */
	contested: string[];
}

export interface ConceptSearch {
	/** Brings the index in line with the bundle. Returns what it did. */
	indexConcepts(concepts: Concept[]): Promise<IndexResult>;
	searchConcepts(
		query: string,
		limit: number,
		maxDistance: number,
	): Promise<ConceptHit[]>;
}
