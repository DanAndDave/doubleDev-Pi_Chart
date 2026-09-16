import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
	IDENTITY_KEY,
	nonConformant,
	parseConcept,
	type Concept,
} from "./concept.ts";

/** Filenames the format reserves; never Concepts. */
const LISTING = "index.md";
const RESERVED = [LISTING, "log.md"];

/** One entry in a Level's listing: enough to decide whether to open it. */
export interface LevelEntry {
	id: string;
	description?: string;
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

const LISTING_LINK = /^\s*[-*]\s*\[[^\]]*\]\(([^)]+)\)\s*:?\s*(.*)$/;

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
	 * A Level's own listing file wins when it has one, because its ordering and
	 * wording are curated; otherwise the listing is synthesised.
	 */
	async list(path: string): Promise<Level> {
		const now = this.now();
		const prefix = path === "" ? "" : `${path}/`;
		const levels = await this.sublevels(path);
		const direct: string[] = [];

		for (const candidate of await this.conceptPaths()) {
			if (!candidate.startsWith(prefix)) continue;
			const rest = candidate.slice(prefix.length);
			if (!rest.includes("/")) direct.push(candidate);
		}

		const curated = await this.curatedListing(prefix, direct);
		if (curated) return { path, levels, concepts: curated, curated: true };

		const concepts: LevelEntry[] = [];
		for (const candidate of direct) {
			const concept = await this.concept(candidate, now);
			concepts.push({ id: concept.id, description: concept.description });
		}
		return { path, levels, concepts, curated: false };
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

	/** A Level's own listing, when it has one and it names Concepts we hold. */
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
			const id = (match[1] ?? "").replace(/^\//, "").replace(/\.md$/, "");
			if (!known.has(id)) continue;
			entries.push({ id, description: (match[2] ?? "").trim() || undefined });
		}
		return entries.length > 0 ? entries : undefined;
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
