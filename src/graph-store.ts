import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { readGraph, type CodeGraph } from "./graph.ts";

/**
 * The graphify release this adapter was written against.
 *
 * Pinned because the project ships rapidly and its output schema is expected
 * to move: an unpinned dependency whose output we parse is a break waiting
 * for an unrelated day.
 */
export const PINNED_GRAPHIFY = "0.9.63";

/** Where graphify writes, relative to the Codebase it was pointed at. */
const OUTPUT = join("graphify-out", "graph.json");

/** Running a program: the seam a test replaces to avoid installing Python. */
export interface RunCommand {
	(command: string, args: string[], cwd?: string): Promise<CommandResult>;
}

export interface CommandResult {
	ok: boolean;
	/** Combined output, for reporting a failure precisely. */
	output: string;
}

export interface GraphStoreOptions {
	run?: RunCommand;
	/** Where the private interpreter lives. Machine-wide, not per Codebase. */
	home?: string;
	read?: (path: string) => Promise<string>;
	exists?: (path: string) => Promise<boolean>;
	makeDirectory?: (path: string) => Promise<void>;
}

/**
 * A Codebase's programmatic structure, derived with graphify.
 *
 * graphify is installed into a virtual environment this owns: `python3 -m
 * venv` is the one Python packaging tool always present, and a private
 * environment cannot collide with whatever else the machine has.
 */
export class GraphStore {
	private readonly run: RunCommand;
	private readonly home: string;
	private readonly read: (path: string) => Promise<string>;
	private readonly exists: (path: string) => Promise<boolean>;
	private readonly makeDirectory: (path: string) => Promise<void>;

	constructor(options: GraphStoreOptions = {}) {
		this.run = options.run ?? runProcess;
		this.home =
			options.home ?? join(homedir(), ".context-manager", "graphify");
		this.read = options.read ?? readText;
		this.exists = options.exists ?? pathExists;
		this.makeDirectory = options.makeDirectory ?? makeDirectory;
	}

	/** The graphify executable inside the private environment. */
	get executable(): string {
		return join(this.home, "bin", "graphify");
	}

	/**
	 * Brings a Codebase's graph up to date, installing graphify first if the
	 * machine does not have it.
	 *
	 * A Codebase that already has a graph is refreshed rather than rebuilt,
	 * so keeping it current costs about as much as the change that made it
	 * stale.
	 */
	async refresh(codebase: string): Promise<void> {
		await this.install();

		const extracted = await this.exists(join(codebase, OUTPUT));
		const [command, ...rest] = extracted
			? ["update", codebase]
			: ["extract", codebase, "--code-only"];

		const result = await this.run(this.executable, [command ?? "", ...rest]);
		if (!result.ok) {
			throw new Error(
				`graphify ${command} failed for ${codebase}: ${result.output}`,
			);
		}
	}

	/** Installs graphify at the pinned version, unless it is already there. */
	async install(): Promise<void> {
		if (await this.exists(this.executable)) return;

		await this.makeDirectory(this.home);
		const created = await this.run("python3", ["-m", "venv", this.home]);
		if (!created.ok) {
			throw new Error(`could not create a python environment: ${created.output}`);
		}

		const installed = await this.run(join(this.home, "bin", "pip"), [
			"install",
			"--quiet",
			`graphifyy==${PINNED_GRAPHIFY}`,
		]);
		if (!installed.ok) {
			throw new Error(`could not install graphify: ${installed.output}`);
		}
	}

	/** The Codebase's graph, or `undefined` when it has never been extracted. */
	async graph(codebase: string): Promise<CodeGraph | undefined> {
		const path = join(codebase, OUTPUT);
		if (!(await this.exists(path))) return undefined;
		return readGraph(await this.read(path));
	}
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

async function makeDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
}

async function readText(path: string): Promise<string> {
	return Bun.file(path).text();
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
