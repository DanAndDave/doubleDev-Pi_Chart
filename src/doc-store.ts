import { randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";

import { isMap, parseDocument } from "yaml";

import {
	FRONTMATTER,
	IDENTITY_KEY,
	nonConformant,
	parseConcept,
	type Concept,
	type Exclusion,
	type Source,
} from "./concept.ts";

/** Filenames the format reserves; never Concepts. */
const LISTING = "index.md";
const RESERVED = [LISTING, "log.md"];

/** What an agent asks to be written, in the Concept's own vocabulary. */
export interface ConceptDraft {
	/** Bundle-relative, without the extension, as a listing names it. */
	id: string;
	/** Creating refuses an id the bundle holds; revising refuses one it lacks. */
	mode: "create" | "revise";
	type?: string;
	title?: string;
	/** The author's own statement of the subject; `description` in the file. */
	summary?: string;
	body?: string;
	exclusions?: Exclusion[];
	sources?: Source[];
	/**
	 * Never written. Present only so asking for human verification can be
	 * refused by name rather than stripped in silence: an agent told nothing
	 * believes it recorded a review.
	 */
	verified?: unknown;
}

/** A write that happened, or the reason it did not. */
export type WriteOutcome =
	| {
			written: Concept;
			refused?: undefined;
			/** Why the Level's listing could not be appended to, where it could not. */
			listing?: string;
	  }
	| { written?: undefined; refused: string; listing?: undefined };

/** The bundle as an agent writes to it. Narrow, like `DocWalk`. */
export interface ConceptWriter {
	write(draft: ConceptDraft): Promise<WriteOutcome>;
}

/** One entry in a Level's listing: enough to decide whether to open it. */
export interface LevelEntry {
	id: string;
	description?: string;
	/** True where the Level has a listing and this Concept is not in it. */
	unlisted?: boolean;
	/** Why the Concept cannot be read, where it cannot. */
	problem?: string;
}

/**
 * The bundle as an agent walks it: read a Level, decide what to open.
 *
 * Narrow on purpose — the tool depends on this, not on a filesystem — and
 * the reason `Level` exists as a word at all.
 */
export interface DocWalk {
	list(path: string): Promise<Level | undefined>;
	open(id: string): Promise<Concept | undefined>;
}

/** What one Level of the bundle holds, without reading beneath it. */
export interface Level {
	path: string;
	levels: string[];
	concepts: LevelEntry[];
	/** True when the Level's own listing file supplied these entries. */
	curated: boolean;
}

export interface DocStoreOptions {
	now?: () => Date;
	/** Notified of every file opened; used to prove reads stay lazy. */
	onRead?: (path: string) => void;
}

// The separator between a link and its description is the author's choice:
// the internal fixtures write `:`, the format's own bundle writes `-`.
const LISTING_LINK = /^\s*[-*]\s*\[[^\]]*\]\(([^)]+)\)\s*[-:\u2014]?\s*(.*)$/;

/**
 * The Doc Store: one machine-wide OKF bundle of curated knowledge.
 *
 * A missing bundle is an empty Doc Store, not an error — a machine with no
 * curated knowledge yet must behave normally. Anything else that goes wrong
 * is reported against the file it happened to, never swallowed.
 */
export class DocStore {
	private readonly now: () => Date;
	private readonly onRead: (path: string) => void;

	constructor(
		private readonly root: string,
		options: DocStoreOptions = {},
	) {
		this.now = options.now ?? (() => new Date());
		this.onRead = options.onRead ?? (() => {});
	}

	/** Reads a file. Absent is `undefined`; unreadable is an error to report. */
	private async read(
		relative: string,
	): Promise<{ text?: string; problem?: string }> {
		const path = join(this.root, relative);
		this.onRead(path);
		try {
			return { text: await readFile(path, "utf8") };
		} catch (error) {
			if (isMissing(error)) return {};
			return { problem: describe(error) };
		}
	}

	/** Every Concept file in the bundle, reserved files excluded. */
	private async conceptPaths(): Promise<string[]> {
		const glob = new Bun.Glob("**/*.md");
		const paths: string[] = [];
		try {
			for await (const path of glob.scan({ cwd: this.root })) {
				if (RESERVED.includes(path.split("/").pop() ?? path)) continue;
				paths.push(path);
			}
		} catch (error) {
			if (isMissing(error)) return [];
			throw error;
		}
		return paths.sort();
	}

	/** One Concept, read and parsed. Written once, used by every caller. */
	private async concept(path: string, now: Date): Promise<Concept> {
		const id = path.replace(/\.md$/, "");
		const { text, problem } = await this.read(path);
		if (text === undefined) {
			return nonConformant(id, "", problem ?? "file disappeared while reading");
		}
		return parseConcept(id, text, now);
	}

	async concepts(): Promise<Concept[]> {
		// One clock reading per call, so a bundle read never straddles a
		// staleness boundary and returns a self-inconsistent snapshot.
		const now = this.now();
		const concepts: Concept[] = [];
		for (const path of await this.conceptPaths()) {
			concepts.push(await this.concept(path, now));
		}
		return concepts;
	}

	/**
	 * One Concept by the id a listing names it by, read on its own: walking
	 * a Level and then opening one thing is the point of a Level.
	 *
	 * The id comes from an agent, so it is confined to the bundle before it
	 * reaches the filesystem: `../../../README` is otherwise a readable
	 * path, and a documentation tool is not a file reader.
	 */
	async open(id: string): Promise<Concept | undefined> {
		const path = `${normalise(id)}.md`;
		if (!this.inBundle(path)) return undefined;
		// Reserved names are never Concepts, so serving `log` or
		// `metrics/index` would hand back a file no listing names.
		if (RESERVED.includes(path.split("/").pop() ?? path)) return undefined;

		const { text, problem } = await this.read(path);
		// Unreadable is reported against the file it happened to, as
		// everywhere else here; only absence is absence.
		if (problem !== undefined) return nonConformant(id, "", problem);
		if (text === undefined) return undefined;
		return parseConcept(id, text, this.now());
	}

	/** Whether a relative path stays inside the bundle once resolved. */
	private inBundle(path: string): boolean {
		const root = resolve(this.root);
		const target = resolve(root, path);
		return target === root || target.startsWith(`${root}/`);
	}

	/** The Concept carrying this identity, wherever it has since been moved to. */
	async byIdentity(identity: string): Promise<Concept | undefined> {
		for (const concept of await this.concepts()) {
			if (concept.identity === identity) return concept;
		}
		return undefined;
	}

	/**
	 * One Level of the bundle: the Concepts and sub-levels directly beneath it,
	 * each Concept with its description. Concepts deeper in the tree are not
	 * read — progressive disclosure is the format's own answer to reading a
	 * corpus without loading it whole, and it is this project's too.
	 *
	 * A Level's own listing supplies the order and the wording, because those
	 * are the author's judgement about what matters first. It does not supply
	 * the membership: a Concept the listing omits is appended, marked, rather
	 * than hidden — a file nothing names is invisible, which is worse than a
	 * listing that reads slightly longer than its author wrote it. Appended,
	 * never interleaved, so a fresh draft cannot displace the Level's
	 * headline Concept.
	 *
	 * The Level's own Concepts are read, which is how a broken one can be
	 * marked as broken; the cost is bounded by the Level, which is the unit
	 * the format discloses in.
	 *
	 * `undefined` when there is no such Level. A Level holding nothing and a
	 * Level that does not exist look identical in a listing and mean opposite
	 * things: "this part of the corpus is empty" and "you guessed a name".
	 */
	async list(asked: string): Promise<Level | undefined> {
		// The path comes from a model. A trailing slash turned a populated
		// Level into an empty one, which reads as "this part of the corpus
		// holds nothing" — the one answer it must not give by accident.
		const path = normalise(asked);
		if (!(await this.isLevel(path))) return undefined;

		const now = this.now();
		const prefix = path === "" ? "" : `${path}/`;
		const levels = await this.sublevels(path);
		const direct: string[] = [];

		for (const candidate of await this.conceptPaths()) {
			if (!candidate.startsWith(prefix)) continue;
			const rest = candidate.slice(prefix.length);
			if (!rest.includes("/")) direct.push(candidate);
		}

		const held = new Map<string, Concept>();
		for (const candidate of direct) {
			const concept = await this.concept(candidate, now);
			held.set(concept.id, concept);
		}

		const curated = await this.curatedListing(prefix, direct);
		const named = new Set(curated?.map((entry) => entry.id) ?? []);
		const entries: LevelEntry[] = (curated ?? []).map((entry) => ({
			...entry,
			problem: held.get(entry.id)?.problem,
		}));
		for (const [id, concept] of [...held].sort(([a], [b]) => (a < b ? -1 : 1))) {
			if (named.has(id)) continue;
			entries.push({
				id,
				description: concept.description,
				problem: concept.problem,
				// Only where a listing existed to omit it: with no listing
				// there is nothing for a Concept to be absent from.
				unlisted: curated !== undefined ? true : undefined,
			});
		}

		return { path, levels, concepts: entries, curated: curated !== undefined };
	}

	/** Whether the bundle has this Level at all. */
	private async isLevel(path: string): Promise<boolean> {
		if (!this.inBundle(path)) return false;
		try {
			return (await stat(join(this.root, path))).isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * Sub-levels come from the directory itself, not from the Concepts inside
	 * it: a level holding only a listing file, or only deeper directories, is
	 * still somewhere the reader must be able to walk into.
	 */
	private async sublevels(path: string): Promise<string[]> {
		try {
			const entries = await readdir(join(this.root, path), {
				withFileTypes: true,
			});
			return entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.sort();
		} catch {
			return [];
		}
	}

	/**
	 * A Level's own listing, where the Level has one: the entries it names
	 * that the Level actually holds, in the author's order.
	 *
	 * An empty result is not the same as no listing. A listing whose every
	 * entry has since been deleted still exists, so what the Level holds is
	 * still absent from it — and saying so is the point.
	 */
	private async curatedListing(
		prefix: string,
		direct: string[],
	): Promise<LevelEntry[] | undefined> {
		const { text } = await this.read(`${prefix}${LISTING}`);
		if (text === undefined) return undefined;

		const known = new Set(direct.map((path) => path.replace(/\.md$/, "")));
		const entries: LevelEntry[] = [];
		for (const line of text.split("\n")) {
			const match = LISTING_LINK.exec(line);
			if (!match) continue;
			const link = (match[1] ?? "").replace(/^\//, "").replace(/\.md$/, "");
			// A listing links to its neighbours the way an author writes
			// them — `gross-margin.md`, not `metrics/gross-margin.md` — so
			// the link is resolved against the Level holding the listing.
			// Matching bare ids against bundle-relative ones made every
			// curated listing below the root fall back to alphabetical.
			const id = known.has(link) ? link : `${prefix}${link}`;
			if (!known.has(id)) continue;
			entries.push({ id, description: (match[2] ?? "").trim() || undefined });
		}
		return entries;
	}

	/**
	 * Gives every Concept that lacks one a rename-stable identity, written back
	 * as a single extension key. OKF's identifier is the file path, so without
	 * this a move silently destroys a Concept and creates another — fatal once
	 * anything keys off identity. The format sanctions extra keys, so the
	 * bundle stays conformant and readable by any other OKF consumer.
	 */
	async ensureIdentities(): Promise<Concept[]> {
		const now = this.now();
		const assigned: Concept[] = [];

		for (const path of await this.conceptPaths()) {
			const { text } = await this.read(path);
			if (text === undefined) continue;

			const concept = parseConcept(path.replace(/\.md$/, ""), text, now);
			if (!concept.conformant || concept.identity) continue;

			const identity = randomUUID();
			const rewritten = withIdentity(text, identity);
			if (!rewritten) continue;

			// Through a temporary file: the bundle is the user's own curated
			// prose, and two sessions starting together must not be able to
			// leave a half-written Concept behind.
			const destination = join(this.root, path);
			const temporary = `${destination}.${randomUUID()}.tmp`;
			await writeFile(temporary, rewritten);
			await rename(temporary, destination);
			assigned.push({ ...concept, identity });
		}

		return assigned;
	}

	/**
	 * Creates or revises one Concept, whole.
	 *
	 * Whole rather than patched: a patch against curated prose needs the
	 * Concept read first — which walking already does — and a whole document
	 * is what makes the rename atomic. Creation refuses an id the bundle
	 * holds and revision refuses one it does not, because a single upsert
	 * makes "I thought this was new" indistinguishable from overwriting
	 * someone's work.
	 *
	 * Identity is assigned here rather than left to the next
	 * `ensureIdentities` pass: the index is keyed by it, and a Concept must
	 * be indexable in the Turn that wrote it.
	 */
	async write(draft: ConceptDraft): Promise<WriteOutcome> {
		if (draft.verified !== undefined) {
			// Refused by name, not stripped: trust is what retrieval ranks
			// on, and an agent that believed it had recorded a review would
			// stop asking for one (ADR-0003).
			return {
				refused:
					"Human verification cannot be recorded by an agent. Trust is " +
					"derived from who verified a concept, and retrieval ranks on " +
					"it; a concept you write enters unverified, as a draft, and a " +
					"person reviews it.",
			};
		}

		const id = normalise(draft.id);
		const path = `${id}.md`;
		if (id === "" || !this.inBundle(path)) {
			return { refused: `${draft.id} is outside the documentation bundle.` };
		}
		if (RESERVED.includes(path.split("/").pop() ?? path)) {
			return { refused: `${id} is a name the format reserves.` };
		}

		const { text: existing, problem } = await this.read(path);
		if (problem !== undefined) {
			return { refused: `${id} could not be read: ${problem}` };
		}
		if (draft.mode === "create" && existing !== undefined) {
			return {
				refused: `${id} already exists; revise it instead of creating it.`,
			};
		}
		if (draft.mode === "revise" && existing === undefined) {
			return { refused: `${id} does not exist; create it instead.` };
		}

		const now = this.now();
		const before =
			existing === undefined
				? undefined
				: { concept: parseConcept(id, existing, now), source: existing };
		if (draft.mode === "revise" && before && !before.concept.conformant) {
			return {
				refused: `${id} is not a readable concept: ${before.concept.problem}`,
			};
		}

		const source = this.compose(id, draft, before, now);
		if (source === undefined) {
			return { refused: `${id} needs a type and a body to be a concept.` };
		}

		const destination = join(this.root, path);
		// Through a temporary file, as identity assignment already writes:
		// the bundle is the user's curated prose, usually under version
		// control, and a crash must not leave half a Concept behind. The
		// rename is the only step that changes what a reader sees, so a
		// failure anywhere before it leaves the Concept exactly as it was.
		const temporary = `${destination}.${randomUUID()}.tmp`;
		try {
			await mkdir(dirname(destination), { recursive: true });
			await writeFile(temporary, source);
			await rename(temporary, destination);
		} catch (error) {
			return { refused: `${id} could not be written: ${describe(error)}` };
		}

		const written = parseConcept(id, source, now);
		// The listing is a courtesy on top of a write that has already
		// happened: failing to append to it must not report the Concept as
		// unwritten, which would leave it in the bundle, unindexed, and
		// refuse the obvious retry as "already exists".
		const listing = await this.addToListing(id, written);
		return listing === undefined ? { written } : { written, listing };
	}

	/**
	 * The file a draft becomes: the Concept's frontmatter with what the draft
	 * named replaced, and what it did not left as the author wrote it.
	 *
	 * Edited as a YAML document rather than rebuilt from a plain object, so a
	 * revision keeps the comments, key order and flow style the author chose
	 * — the same care `ensureIdentities` takes when it inserts one key.
	 *
	 * `id` is the normalised identifier, not the one the model wrote: a title
	 * falling back to `./decisions/x/` would carry the model's punctuation
	 * into the bundle.
	 */
	private compose(
		id: string,
		draft: ConceptDraft,
		before: { concept: Concept; source: string } | undefined,
		now: Date,
	): string | undefined {
		const type = draft.type ?? before?.concept.type;
		const body = draft.body ?? before?.concept.body;
		if (!type || !body || body.trim() === "") return undefined;

		const existing = before ? FRONTMATTER.exec(before.source) : undefined;
		// A document with no mapping to set keys on — a new Concept, or one
		// whose frontmatter was not a mapping — starts from an empty one.
		const parsed = parseDocument(existing?.[1] ?? "");
		const document = isMap(parsed.contents) ? parsed : parseDocument("{}");

		document.set("type", type);
		document.set("title", draft.title ?? before?.concept.title ?? id);
		const summary = draft.summary ?? before?.concept.description;
		if (summary !== undefined) document.set("description", summary);
		document.set(IDENTITY_KEY, before?.concept.identity ?? randomUUID());
		// A deprecated Concept stays deprecated: a revision corrects what a
		// superseded Concept says, it does not put it back in service.
		// Everything else an agent touched is a draft, whatever the file
		// claimed before — the text is no longer the text a human reviewed.
		document.set(
			"status",
			before?.concept.status === "deprecated" ? "deprecated" : "draft",
		);
		document.set("generated", {
			by: `context-manager@${hostname()}`,
			at: now.toISOString(),
		});
		if (draft.exclusions) document.set("not", draft.exclusions);
		if (draft.sources) document.set("sources", draft.sources);

		return `---\n${document.toString().trimEnd()}\n---\n\n${body.trim()}\n`;
	}

	/**
	 * Appends the new Concept to its Level's listing, where the Level has
	 * one. A listing is the author's judgement about what matters first, so
	 * a new entry goes last rather than into the middle of it.
	 *
	 * Returns why it could not, where it could not: the Concept is already
	 * written by then, and an unwritable listing is a smaller problem than
	 * reporting a written Concept as unwritten.
	 */
	private async addToListing(
		id: string,
		concept: Concept,
	): Promise<string | undefined> {
		const slash = id.lastIndexOf("/");
		const prefix = slash === -1 ? "" : `${id.slice(0, slash)}/`;
		const name = id.slice(slash + 1);
		const { text } = await this.read(`${prefix}${LISTING}`);
		if (text === undefined) return undefined;
		// Already named — a revision, or a listing written ahead of the file.
		for (const line of text.split("\n")) {
			const match = LISTING_LINK.exec(line);
			if (!match) continue;
			const link = (match[1] ?? "").replace(/^\//, "").replace(/\.md$/, "");
			if (link === name || link === id) return undefined;
		}

		const description = concept.description ? ` — ${concept.description}` : "";
		const entry = `- [${concept.title ?? name}](${name}.md)${description}\n`;
		const destination = join(this.root, `${prefix}${LISTING}`);
		const temporary = `${destination}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, `${text.trimEnd()}\n${entry}`);
			await rename(temporary, destination);
		} catch (error) {
			return `${prefix}${LISTING} could not be updated: ${describe(error)}`;
		}
		return undefined;
	}
}

function isMissing(error: unknown): boolean {
	if (!error || typeof error !== "object" || !("code" in error)) return false;
	return error.code === "ENOENT";
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Inserts the identity key as the first frontmatter line, or reports that it
 * could not. Textual rather than a YAML round-trip so that comments, key
 * order, and the formatting the author chose survive untouched.
 */
function withIdentity(source: string, identity: string): string | undefined {
	const match = /^---\r?\n/.exec(source);
	if (!match) return undefined;
	return `${match[0]}${IDENTITY_KEY}: ${identity}\n${source.slice(match[0].length)}`;
}

/**
 * The bundle at `root`, ready to index, or `undefined` when there is no
 * bundle there.
 *
 * The distinction matters: indexing an empty corpus prunes every Concept the
 * index holds, so a mistyped path or an unmounted drive would quietly
 * discard the whole index. A machine with no curated knowledge yet is not an
 * error, though, so absence is reported as nothing to do rather than as a
 * failure.
 */
export async function readBundle(root: string): Promise<Concept[] | undefined> {
	try {
		await stat(root);
	} catch {
		return undefined;
	}

	const store = new DocStore(root);
	// Identity first: the index keys on it, and a Concept that has never
	// been given one is not indexable.
	await store.ensureIdentities();
	return store.concepts();
}

/** A path as a model wrote it, reduced to the form the bundle uses. */
function normalise(path: string): string {
	return path
		.trim()
		.replace(/^(?:\.\/|\/)+/, "")
		.replace(/\/+$/, "")
		.replace(/^\.$/, "");
}
