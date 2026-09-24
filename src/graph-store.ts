import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { readGraph } from "./graph.ts";
import { runProcess, type CommandResult, type RunCommand } from "./process.ts";
import { prepare, type PreparedGraph } from "./symbols.ts";

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

/**
 * How long each command behind this Store may take before it is stopped.
 *
 * Measured on this machine: `extract --code-only` takes 2.0 s over this
 * Codebase's 69 files, `--version` 0.1 s, `python3 -m venv` 2.1 s and a
 * cached `pip install` 0.7 s. Each deadline is set against the shape of
 * the command rather than this Codebase's size — extraction has to survive
 * a large repository, and an install downloads on a cold machine — so it
 * bounds hanging rather than setting a target.
 */
const EXTRACT_MS = 60_000;
const VERSION_MS = 10_000;
const INSTALL_MS = 300_000;

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
	/**
	 * What each Codebase's extraction parsed and indexed to, valid while
	 * the file is untouched. A failure is remembered too: re-parsing a
	 * broken graph on every Call would cost the same work and report the
	 * same complaint every time.
	 *
	 * The indexes ride with the parse rather than in a memo of their own:
	 * two caches over one file with no shared trigger is how a stale index
	 * outlives the graph it describes.
	 */
	private readonly parsed = new Map<
		string,
		{ changedAt: number; graph?: PreparedGraph; failure?: Error }
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

		const result = await this.run(
			this.executable,
			["extract", codebase, "--code-only"],
			undefined,
			EXTRACT_MS,
		);
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
			const installed = await this.run(
				this.executable,
				["--version"],
				undefined,
				VERSION_MS,
			);
			// As a whole version, not a substring: `0.9.6` appears inside
			// `0.9.63`, and a pin that matches the build it was meant to
			// replace binds on no machine at all.
			const reported = installed.output.split(/\s+/);
			if (installed.ok && reported.includes(PINNED_GRAPHIFY)) return;
		}

		await this.makeDirectory(this.home);
		const created = await this.run(
			"python3",
			["-m", "venv", this.home],
			undefined,
			INSTALL_MS,
		);
		if (!created.ok) {
			throw new Error(`could not create a python environment: ${created.output}`);
		}

		const installed = await this.run(
			join(this.home, "bin", "pip"),
			["install", "--quiet", `graphifyy==${PINNED_GRAPHIFY}`],
			undefined,
			INSTALL_MS,
		);
		if (!installed.ok) {
			throw new Error(`could not install graphify: ${installed.output}`);
		}
	}

	/**
	 * The Codebase's graph, indexed, or `undefined` when it has never been
	 * extracted.
	 *
	 * Parsed and indexed once, kept until the extraction changes: this runs
	 * on the request path, and a graph for a few thousand source files is
	 * tens of megabytes — hundreds of milliseconds no prompt should pay
	 * twice, plus indexes over every symbol and every edge.
	 */
	async graph(codebase: string): Promise<PreparedGraph | undefined> {
		const path = join(codebase, OUTPUT);
		const at = await this.changedAt(path);
		if (at === undefined) return undefined;

		const cached = this.parsed.get(codebase);
		if (cached && cached.changedAt === at) {
			if (cached.failure) throw cached.failure;
			return cached.graph;
		}

		try {
			const graph = prepare(readGraph(await this.read(path)), at);
			this.parsed.set(codebase, { changedAt: at, graph });
			return graph;
		} catch (error) {
			const failure = error instanceof Error ? error : new Error(String(error));
			this.parsed.set(codebase, { changedAt: at, failure });
			throw failure;
		}
	}

	/**
	 * Which of these files have changed since the extraction was written.
	 *
	 * Per file rather than per Codebase: a Turn that edited one file must
	 * still be able to trust the structure of the ones it did not touch,
	 * and a Codebase-wide probe is a recursive walk on the request path. A
	 * file whose age cannot be established counts as changed — an
	 * invariant that cannot be checked is not a verified invariant
	 * (ADR-0003).
	 */
	async changedSince(
		codebase: string,
		extractedAt: number,
		files: Iterable<string>,
	): Promise<Set<string>> {
		const older = new Set<string>();
		for (const file of new Set(files)) {
			const at = await this.changedAt(join(codebase, file));
			if (at === undefined || at > extractedAt) older.add(file);
		}
		return older;
	}
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
