import { stat } from "node:fs/promises";
import { join } from "node:path";

import type { CommandResult, RunCommand } from "./graph-store.ts";

/** A part of the tree this project's work assumes, and whether it is there. */
export interface TreePart {
	/** Relative to the Codebase, as a person would type it. */
	path: string;
	kind: "directory" | "file";
	/** What is actually there: absent, the right kind, or the wrong kind. */
	state: "present" | "absent" | "wrong-kind";
}

/** Whether a Codebase is set up the way this project's work assumes. */
export interface TreeReport {
	conforming: boolean;
	/** True when there is no OpenSpec tree at all, as opposed to a partial one. */
	absent: boolean;
	parts: TreePart[];
}

/** What OpenSpec itself says about the content of a Codebase's specs. */
export interface ContentReport {
	/** Absent when OpenSpec could not be run: unknown is not conformance. */
	valid?: boolean;
	/** OpenSpec's own words, not a paraphrase of them. */
	detail: string;
}

/**
 * What `openspec init` creates, and therefore what this project's work can
 * assume. Anchored to the tool's own output rather than to a document about
 * it: everything here was observed after running it on a bare directory.
 */
const EXPECTED: { path: string; kind: TreePart["kind"] }[] = [
	{ path: "openspec", kind: "directory" },
	{ path: join("openspec", "specs"), kind: "directory" },
	{ path: join("openspec", "changes"), kind: "directory" },
	{ path: join("openspec", "changes", "archive"), kind: "directory" },
	{ path: join("openspec", "config.yaml"), kind: "file" },
];

export interface SpecStoreOptions {
	run?: RunCommand;
	/** The OpenSpec executable. Overridable for tests and odd installs. */
	openspec?: string;
	inspect?: (path: string) => Promise<TreePart["kind"] | undefined>;
}

/**
 * The one Store this project does not own.
 *
 * It answers whether a Codebase is set up for spec-driven work and, when
 * asked, makes it so. It never reads intent into a Context Pack: a
 * Codebase's specs reach the agent through the workflow that reads them.
 */
export class SpecStore {
	private readonly run: RunCommand;
	private readonly openspec: string;
	private readonly inspect: (path: string) => Promise<TreePart["kind"] | undefined>;

	constructor(options: SpecStoreOptions = {}) {
		this.run = options.run ?? runProcess;
		this.openspec = options.openspec ?? "openspec";
		this.inspect = options.inspect ?? inspectPath;
	}

	/**
	 * Whether the Codebase's tree is as expected. Reads only.
	 *
	 * The shape is checked here rather than by OpenSpec because OpenSpec
	 * does not check it: measured, `list` and `validate --all --strict`
	 * both succeed on a tree missing `specs/`, missing `changes/archive/`,
	 * or missing `config.yaml`.
	 */
	async verify(codebase: string): Promise<TreeReport> {
		const parts: TreePart[] = [];
		for (const expected of EXPECTED) {
			const found = await this.inspect(join(codebase, expected.path));
			parts.push({
				path: expected.path,
				kind: expected.kind,
				state:
					found === undefined
						? "absent"
						: found === expected.kind
							? "present"
							: "wrong-kind",
			});
		}

		const root = parts[0];
		return {
			parts,
			// A Codebase that has never been set up is a different fact from
			// one that was set up wrongly, and deserves a different answer.
			absent: root?.state === "absent",
			conforming: parts.every((part) => part.state === "present"),
		};
	}

	/**
	 * What OpenSpec says about the Codebase's specs and changes.
	 *
	 * Its words, not ours: it defines what valid content is, and a
	 * paraphrase would drift from it.
	 */
	async diagnose(codebase: string): Promise<ContentReport> {
		let result: CommandResult;
		try {
			result = await this.run(
				this.openspec,
				["validate", "--all", "--strict"],
				codebase,
			);
		} catch (error) {
			return {
				detail: `openspec could not be run: ${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}

		return { valid: result.ok, detail: result.output };
	}

	/**
	 * Brings the Codebase up to a conforming tree, through OpenSpec's own
	 * command: it fills exactly the gaps and leaves everything else, which
	 * hand-built directories and a hand-written `config.yaml` would not.
	 */
	async initialize(codebase: string): Promise<void> {
		const result = await this.run(
			this.openspec,
			["init", ".", "--tools", "none"],
			codebase,
		);
		if (!result.ok) {
			throw new Error(`openspec init failed for ${codebase}: ${result.output}`);
		}
	}
}

/** The absent parts, as a person would want them listed. */
export function describeTree(report: TreeReport): string {
	if (report.conforming) return "OpenSpec tree is as expected.";
	if (report.absent) return "No OpenSpec tree in this codebase.";

	const missing = report.parts
		.filter((part) => part.state !== "present")
		.map((part) =>
			part.state === "wrong-kind"
				? `${part.path} is not a ${part.kind}`
				: `${part.path} is missing`,
		);
	return `OpenSpec tree is incomplete: ${missing.join(", ")}.`;
}

async function runProcess(
	command: string,
	args: string[],
	cwd?: string,
): Promise<CommandResult> {
	const spawned = Bun.spawn([command, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(spawned.stdout).text(),
		new Response(spawned.stderr).text(),
		spawned.exited,
	]);
	return { ok: code === 0, output: `${stdout}${stderr}`.trim() };
}

async function inspectPath(
	path: string,
): Promise<TreePart["kind"] | undefined> {
	try {
		return (await stat(path)).isDirectory() ? "directory" : "file";
	} catch {
		return undefined;
	}
}
