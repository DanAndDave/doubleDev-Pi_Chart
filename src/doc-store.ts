import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { IDENTITY_KEY, parseConcept, type Concept } from "./concept.ts";

/** Filenames the format reserves; never Concepts. */
const RESERVED = ["index.md", "log.md"];

/** What one level of the bundle holds, without reading beneath it. */
export interface Level {
	path: string;
	levels: string[];
	concepts: { id: string; description?: string }[];
}

/**
 * The Doc Store: one machine-wide OKF bundle of curated knowledge.
 *
 * A missing bundle is an empty Doc Store, not an error — a machine with no
 * curated knowledge yet must behave normally.
 */
export class DocStore {
	constructor(
		private readonly root: string,
		private readonly now: () => Date = () => new Date(),
		/** Notified of every Concept file opened; used to prove laziness. */
		private readonly onRead: (path: string) => void = () => {},
	) {}

	private async read(relative: string): Promise<string | undefined> {
		const path = join(this.root, relative);
		this.onRead(path);
		try {
			return await readFile(path, "utf8");
		} catch {
			return undefined;
		}
	}

	/** Every Concept file in the bundle, reserved files excluded. */
	private async conceptPaths(): Promise<string[]> {
		const glob = new Bun.Glob("**/*.md");
		const paths: string[] = [];
		try {
			for await (const path of glob.scan({ cwd: this.root })) {
				const name = path.split("/").pop() ?? path;
				if (RESERVED.includes(name)) continue;
				paths.push(path);
			}
		} catch {
			return [];
		}
		return paths.sort();
	}

	async concepts(): Promise<Concept[]> {
		const concepts: Concept[] = [];
		for (const path of await this.conceptPaths()) {
			const source = await this.read(path);
			if (source === undefined) continue;
			concepts.push(parseConcept(path.replace(/\.md$/, ""), source, this.now()));
		}
		return concepts;
	}

	/**
	 * One level of the bundle: the Concepts and sub-levels directly beneath it,
	 * each Concept with its description. Concepts deeper in the tree are not
	 * read — progressive disclosure is the format's own answer to reading a
	 * corpus without loading it whole, and it is this project's too.
	 */
	async list(path: string): Promise<Level> {
		const prefix = path === "" ? "" : `${path}/`;
		const levels = new Set<string>();
		const direct: string[] = [];

		for (const candidate of await this.conceptPaths()) {
			if (!candidate.startsWith(prefix)) continue;
			const rest = candidate.slice(prefix.length);
			const slash = rest.indexOf("/");
			if (slash === -1) {
				direct.push(candidate);
				continue;
			}
			levels.add(rest.slice(0, slash));
		}

		const concepts: Level["concepts"] = [];
		for (const candidate of direct) {
			const source = await this.read(candidate);
			const id = candidate.replace(/\.md$/, "");
			concepts.push({
				id,
				description:
					source === undefined
						? undefined
						: parseConcept(id, source, this.now()).description,
			});
		}

		return { path, levels: [...levels].sort(), concepts };
	}

	/**
	 * Gives every Concept that lacks one a rename-stable identity, written back
	 * as a single extension key. OKF's identifier is the file path, so without
	 * this a move silently destroys a Concept and creates another — fatal once
	 * anything keys off identity. The format sanctions extra keys, so the
	 * bundle stays conformant and readable by any other OKF consumer.
	 */
	async ensureIdentities(): Promise<Concept[]> {
		const assigned: Concept[] = [];

		for (const path of await this.conceptPaths()) {
			const source = await this.read(path);
			if (source === undefined) continue;

			const id = path.replace(/\.md$/, "");
			const concept = parseConcept(id, source, this.now());
			if (!concept.conformant || concept.identity) continue;

			const identity = randomUUID();
			await writeFile(join(this.root, path), withIdentity(source, identity));
			assigned.push({ ...concept, identity });
		}

		return assigned;
	}
}

/**
 * Inserts the identity key as the first frontmatter line. Textual rather than
 * a YAML round-trip so that comments, key order, and formatting the author
 * chose survive untouched.
 */
function withIdentity(source: string, identity: string): string {
	const opening = source.indexOf("---");
	if (opening === -1) return source;
	const afterOpening = opening + 3;
	const newline = source.indexOf("\n", afterOpening);
	if (newline === -1) return source;

	return `${source.slice(0, newline + 1)}${IDENTITY_KEY}: ${identity}\n${source.slice(newline + 1)}`;
}
