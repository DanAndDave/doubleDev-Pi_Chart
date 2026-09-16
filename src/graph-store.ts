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
	/** When the extraction last changed, for caching what was parsed. */
	changedAt?: (path: string) => Promise<number | undefined>;
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
	private readonly changedAt: (path: string) => Promise<number | undefined>;
	/** Parsed graphs, by Codebase, valid while the extraction is untouched. */
	private readonly parsed = new Map<
		string,
		{ changedAt: number; graph: CodeGraph }
	>();
	/** Refreshes in flight, so concurrent sessions do not collide. */
	private readonly refreshing = new Map<string, Promise<void>>();
	private installing?: Promise<void>;

	constructor(options: GraphStoreOptions = {}) {
		this.run = options.run ?? runProcess;
		this.home =
			options.home ?? join(homedir(), ".context-manager", "graphify");
		this.read = options.read ?? readText;
		this.exists = options.exists ?? pathExists;
		this.makeDirectory = options.makeDirectory ?? makeDirectory;
		this.changedAt = options.changedAt ?? changedAt;
	}

	/** The graphify executable inside the private environment. */
	get executable(): string {
		return join(this.home, "bin", "graphify");
	}

	/**
	 * Brings a Codebase's graph up to date, installing graphify first if the
	 * machine does not have it.
	 *
	 * Always the same command: `extract --code-only` is itself incremental,
	 * skipping files whose content hash is unchanged, so it costs the edit
	 * rather than the corpus. graphify's `update` is no cheaper and drops
	 * `--code-only`, which quietly widens the artifact in the user's
	 * repository to include their documentation.
	 */
	async refresh(codebase: string): Promise<void> {
		// One at a time per Codebase: two sessions opened together would
		// otherwise run two extractions over one `graphify-out/`, which
		// graphify does not lock.
		const running = this.refreshing.get(codebase);
		if (running) return running;

		const started = this.extract(codebase).finally(() => {
			this.refreshing.delete(codebase);
		});
		this.refreshing.set(codebase, started);
		return started;
	}

	private async extract(codebase: string): Promise<void> {
		await this.install();

		const result = await this.run(this.executable, [
			"extract",
			codebase,
			"--code-only",
		]);
		if (!result.ok) {
			throw new Error(
				`graphify extract failed for ${codebase}: ${result.output}`,
			);
		}
	}

	/** Installs graphify at the pinned version, unless that is already there. */
	async install(): Promise<void> {
		this.installing ??= this.installOnce().finally(() => {
			this.installing = undefined;
		});
		return this.installing;
	}

	private async installOnce(): Promise<void> {
		// The version, not merely the file: checking only that something is
		// installed makes moving the pin a no-op on every machine that ever
		// ran an older build, which is exactly when the pin has to bind.
		if (await this.exists(this.executable)) {
			const installed = await this.run(this.executable, ["--version"]);
			if (installed.ok && installed.output.includes(PINNED_GRAPHIFY)) return;
		}

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

	/**
	 * The Codebase's graph, or `undefined` when it has never been extracted.
	 *
	 * Parsed once and kept until the extraction changes: this runs on the
	 * request path, and a graph for a few thousand source files is tens of
	 * megabytes — hundreds of milliseconds no prompt should pay twice.
	 */
	async graph(codebase: string): Promise<CodeGraph | undefined> {
		const path = join(codebase, OUTPUT);
		const at = await this.changedAt(path);
		if (at === undefined) return undefined;

		const cached = this.parsed.get(codebase);
		if (cached && cached.changedAt === at) return cached.graph;

		const graph = readGraph(await this.read(path));
		this.parsed.set(codebase, { changedAt: at, graph });
		return graph;
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

async function changedAt(path: string): Promise<number | undefined> {
	try {
		return (await stat(path)).mtimeMs;
	} catch {
		return undefined;
	}
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
