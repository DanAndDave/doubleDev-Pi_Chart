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
	/** Everything the file declared, including keys with no meaning here. */
	frontmatter: Record<string, unknown>;
	body: string;
	conformant: boolean;
	/** Why the Concept is non-conformant, when it is. */
	problem?: string;
}

/** The frontmatter key carrying rename-stable identity. */
export const IDENTITY_KEY = "cm_identity";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

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
		trust: readTrust(frontmatter.verified),
		generated: readProvenance(frontmatter.generated),
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

/**
 * Trust is derived, never stored: a human verifier outranks a machine one, and
 * no verifier at all means unverified. The format records signals, not verdicts.
 */
function readTrust(value: unknown): TrustTier {
	const entries: unknown[] = Array.isArray(value)
		? value
		: value && typeof value === "object"
			? [value]
			: [];

	if (entries.length === 0) return "unverified";
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const by = (entry as Record<string, unknown>).by;
		if (typeof by === "string" && by.startsWith("human:")) return "human-reviewed";
	}
	return "machine-confirmed";
}
