import type { Concept, Exclusion, TrustTier } from "./concept.ts";

/** A Concept found by meaning, with the signals that qualify it. */
export interface ConceptHit {
	conceptId: string;
	/** The section that matched, with the Concept's title prepended. */
	text: string;
	trust: TrustTier;
	stale: boolean;
	/**
	 * How far the matching section sat from the query, as cosine distance.
	 * Reported, never re-weighted: ordering is the Store's, and a distance
	 * mixed into it a second time would be the tie-break ADR-0003 refuses.
	 */
	distance: number;
	/** Which part of the Concept matched, from zero. */
	sectionIndex: number;
	/**
	 * How many parts the Concept has, so a fragment can say it is one.
	 * Required rather than optional: a count nobody supplied would read as
	 * a whole Concept, which is the one thing a fragment must not claim.
	 */
	sectionCount: number;
	/** What the Concept declares it is not. Absent where it declares nothing. */
	exclusions?: Exclusion[];
}

/** A Concept the relevance threshold refused, and how far it was. */
export interface ConceptMiss {
	conceptId: string;
	distance: number;
}

/** What a search found, and what it refused. */
export interface ConceptMatches {
	hits: ConceptHit[];
	/** How many Concepts fell outside the relevance threshold. */
	rejected: number;
	/**
	 * Which of those they were, nearest first. Named rather than counted,
	 * so a threshold set too tight can be answered for rather than guessed
	 * at from an empty part.
	 */
	misses: ConceptMiss[];
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
	/** Brings it in line with one Concept, costing about that one Concept. */
	indexConcept(concept: Concept): Promise<IndexResult>;
	searchConcepts(
		query: string,
		limit: number,
		maxDistance: number,
	): Promise<ConceptMatches>;
}
