import { parse as parseYaml } from "yaml";

/** Lifecycle, as the format defines it. Absent means stable. */
export type ConceptStatus = "draft" | "stable" | "deprecated";

/** Derived from who has verified a Concept, never stored in the file. */
export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";

/** Who produced a Concept, and when it last meaningfully changed. */
export interface Provenance {
	by?: string;
	at?: string;
}

/**
 * What a Concept declares it is *not*, in the format's own shape: the term
 * that is confusable, why it is wrong here, and what to use instead. A
 * definition served without these invites the mistake they exist to prevent.
 */
export interface Exclusion {
	term: string;
	why?: string;
	instead?: string;
}

/** What a Concept says it was drawn from. */
export interface Source {
	id?: string;
	title?: string;
	resource?: string;
	author?: string;
}

export interface Concept {
	/** Bundle-relative path without the extension. */
	id: string;
	/** Stable across a move within the bundle; assigned by `ensureIdentities`. */
	identity?: string;
	type?: string;
	title?: string;
	description?: string;
	tags: string[];
	status: ConceptStatus;
	stale: boolean;
	trust: TrustTier;
	generated?: Provenance;
	/** What the Concept says it is not. Empty where it says nothing. */
	exclusions: Exclusion[];
	/** What it says it was drawn from. Empty where it names nothing. */
	sources: Source[];
	/** Everything the file declared, including keys with no meaning here. */
	frontmatter: Record<string, unknown>;
	body: string;
	conformant: boolean;
	/** Why the Concept is non-conformant, when it is. */
	problem?: string;
}

/** The frontmatter key carrying rename-stable identity. */
export const IDENTITY_KEY = "cm_identity";

/** The frontmatter block: everything between the opening and closing fences. */
export const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Reads one Concept.
 *
 * Every field is read defensively: OKF is a v0.2 draft with no releases, so a
 * missing or reshaped field yields an absent value rather than a throw. A
 * malformed Concept is described, never raised — one bad file must not cost
 * the rest of the bundle.
 */
export function parseConcept(id: string, source: string, now: Date): Concept {
	const match = FRONTMATTER.exec(source);
	const body = match ? source.slice(match[0].length) : source;

	if (!match) return nonConformant(id, body, "no frontmatter block");

	let parsed: unknown;
	try {
		parsed = parseYaml(match[1] ?? "");
	} catch (error) {
		return nonConformant(
			id,
			body,
			`frontmatter did not parse: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return nonConformant(id, body, "frontmatter is not a mapping");
	}

	const frontmatter = parsed as Record<string, unknown>;
	const type = readString(frontmatter.type);

	const generated = readProvenance(frontmatter.generated);
	const concept: Concept = {
		id,
		identity: readString(frontmatter[IDENTITY_KEY]),
		type,
		title: readString(frontmatter.title),
		description: readString(frontmatter.description),
		tags: Array.isArray(frontmatter.tags)
			? frontmatter.tags.filter((tag): tag is string => typeof tag === "string")
			: [],
		status: readStatus(frontmatter.status),
		stale: isStale(frontmatter.stale_after, now),
		trust: readTrust(frontmatter.verified, generated),
		generated,
		exclusions: readExclusions(frontmatter.not),
		sources: readSources(frontmatter.sources),
		frontmatter,
		body,
		conformant: type !== undefined && type.length > 0,
	};

	if (!concept.conformant) concept.problem = "frontmatter has no type";
	return concept;
}

/** A Concept that could not be read, described rather than thrown. */
export function nonConformant(
	id: string,
	body: string,
	problem: string,
): Concept {
	return {
		id,
		tags: [],
		status: "stable",
		stale: false,
		trust: "unverified",
		exclusions: [],
		sources: [],
		frontmatter: {},
		body,
		conformant: false,
		problem,
	};
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readStatus(value: unknown): ConceptStatus {
	return value === "draft" || value === "deprecated" ? value : "stable";
}

function readProvenance(value: unknown): Provenance | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	return { by: readString(record.by), at: readString(record.at) };
}

/** A Concept is stale once the moment it names has passed. */
function isStale(value: unknown, now: Date): boolean {
	const moment = readInstant(value);
	return moment !== undefined && now.getTime() >= moment.getTime();
}

function readInstant(value: unknown): Date | undefined {
	if (value instanceof Date) return value;
	if (typeof value !== "string") return undefined;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** The entries of a frontmatter list, mappings only. */
function mappings(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(entry): entry is Record<string, unknown> =>
			Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
	);
}

/**
 * What a Concept says it is not. An entry naming no term says nothing.
 *
 * Exported because a written Concept arrives as a model's JSON in the same
 * shape the frontmatter uses, and one narrowing rule for both is what keeps
 * what an agent may write identical to what a bundle may hold.
 */
export function readExclusions(value: unknown): Exclusion[] {
	const exclusions: Exclusion[] = [];
	for (const entry of mappings(value)) {
		const term = readString(entry.term);
		if (term === undefined || term.length === 0) continue;
		exclusions.push({
			term,
			why: readString(entry.why),
			instead: readString(entry.instead),
		});
	}
	return exclusions;
}

/** What a Concept says it was drawn from, from frontmatter or from JSON. */
export function readSources(value: unknown): Source[] {
	return mappings(value)
		.map((entry) => ({
			id: readString(entry.id),
			title: readString(entry.title),
			resource: readString(entry.resource),
			author: readString(entry.author),
		}))
		// A source naming nothing at all is not a source.
		.filter((source) => Object.values(source).some((field) => field !== undefined));
}

/**
 * Trust is derived, never stored: a human verifier outranks a machine one, and
 * no verifier at all means unverified. The format records signals, not verdicts.
 *
 * A verification older than the Concept's most recent machine-recorded change
 * stops counting. Without that, revising a reviewed Concept carries its review
 * onto text no human has read — and since retrieval ranks on trust, an agent
 * could promote its own edit to the top tier by editing beneath a signature.
 * The signature itself is left in the file for whoever re-reviews it.
 */
function readTrust(value: unknown, generated: Provenance | undefined): TrustTier {
	const entries: unknown[] = Array.isArray(value)
		? value
		: value && typeof value === "object"
			? [value]
			: [];

	const changed = readInstant(generated?.at);
	const counts: Record<string, unknown>[] = [];
	for (const entry of entries) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const record = entry as Record<string, unknown>;
		const at = readInstant(record.at);
		// Against a dated machine change, a verification must be shown to be
		// newer than it. An undated signature cannot be, and leaving it
		// counting would reopen the hole this closes: write beneath an
		// undated review and the agent's own text is served as reviewed.
		// With no machine change recorded there is nothing to be older than,
		// so an undated verification still counts — this discounts reviews
		// that cannot be shown to cover the text, it does not demand a date
		// the format never required.
		if (changed && !(at && at.getTime() >= changed.getTime())) continue;
		counts.push(record);
	}

	if (counts.length === 0) return "unverified";
	for (const entry of counts) {
		const by = entry.by;
		if (typeof by === "string" && by.startsWith("human:")) return "human-reviewed";
	}
	return "machine-confirmed";
}
