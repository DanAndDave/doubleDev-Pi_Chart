import { createHash } from "node:crypto";
import { mkdir, open, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { DEFAULT_GRAPH_EXTRACT_DEADLINE_MS } from "./config.ts";
import { loadInWorker, type Load, type Loaded } from "./graph-load.ts";
import { GraphFormatError } from "./graph.ts";
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
 * The runner that owns each extraction, run by the private environment's
 * Python. Resolved beside this file, as the embedder resolves its worker:
 * omp loads `src/` directly, so there is no build to copy it into.
 */
export const RUNNER = new URL("./graphify-runner.py", import.meta.url).pathname;

/**
 * How long each command this Store waits on may take before it is stopped.
 *
 * Measured on this machine: `--version` takes 0.1 s, `python3 -m venv`
 * 2.1 s and a cached `pip install` 0.7 s. Each deadline is set against the
 * shape of the command, since an install downloads on a cold machine, so
 * it bounds hanging rather than setting a target. Extraction is not among
 * them: nothing waits on it, and the runner holds it to its own deadline.
 */
const VERSION_MS = 10_000;
const INSTALL_MS = 300_000;

/**
 * How often a refresh whose runner found the Codebase held asks whether
 * the holder's run has ended: often enough that its failure is reported
 * within seconds of it, and one cheap subprocess each time.
 */
const STATUS_POLL_MS = 5_000;

/** What a spawned runner gives back: when its process ends. */
export interface Spawned {
	exited: Promise<unknown>;
}

/**
 * One Codebase's extraction as this session has read it: the graph in
 * use, the newer extraction that could not be read, and the read running.
 */
interface Loading {
	/** The modified time the latest read started from. */
	seenAt: number;
	current?: { graph: PreparedGraph; hash: string };
	/** No hash when the reader died before saying what it read. */
	broken?: { hash?: string; error: Error; reported: boolean };
	inFlight?: Promise<void>;
}

/** A refresh, once its runner is on its way. */
export interface Launch {
	/**
	 * Settles when the run that serves this refresh has ended: the one
	 * its runner did, or, when another runner already held the Codebase,
	 * that runner's. Never rejects: how the run ended is read from its
	 * outcome, by whichever session gets there first.
	 */
	finished: Promise<void>;
}

/** How the last completed extraction of a Codebase ended, as the runner wrote it. */
export interface Outcome {
	runId: string;
	startedAt: number;
	endedAt: number;
	/** The process's exit code; negative for a signal. */
	exitCode: number;
	/** Present when the run was stopped rather than ending by itself. */
	stopped?: "deadline";
	/** The deadline it was held to, when it was stopped at it. */
	deadlineMs?: number;
	/** What graphify printed last. */
	output: string;
}

/** A Codebase's extraction state, as far as the kernel and the runner can say. */
export interface Extraction {
	running?: { since: number };
	/** The last completed run, with what kind of failure it was if it failed. */
	last?: Outcome & { failure?: ExtractionFailureKind };
}

export type ExtractionFailureKind = "size-cap" | "deadline" | "failed";

/** An extraction that did not land, with what it means. */
export class ExtractionFailure extends Error {
	constructor(
		readonly kind: ExtractionFailureKind,
		message: string,
	) {
		super(message);
		this.name = "ExtractionFailure";
	}
}

export interface GraphStoreOptions {
	run?: RunCommand;
	/** Where the private interpreter lives. Machine-wide, not per Codebase. */
	home?: string;
	/** Reads files other than the extraction: the runner's outcome. */
	read?: (path: string) => Promise<string>;
	/** Reads the extraction itself, off the session's thread. */
	load?: Load;
	exists?: (path: string) => Promise<boolean>;
	makeDirectory?: (path: string) => Promise<void>;
	/** When the extraction last changed, for caching what was parsed. */
	changedAt?: (path: string) => Promise<number | undefined>;
	/** Writes a whole file. */
	write?: (path: string, content: string) => Promise<void>;
	/** Creates a file only if it does not exist yet; whether this call made it. */
	claim?: (path: string) => Promise<boolean>;
	/** Starts a program that outlives this process. */
	launch?: (command: string, args: string[]) => Promise<Spawned>;
	/** Waits between asking whether another runner's run has ended. */
	pause?: (ms: number) => Promise<void>;
	/** How long one extraction may run, in milliseconds; zero is no deadline. */
	extractDeadlineMs?: number;
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
	private readonly write: (path: string, content: string) => Promise<void>;
	private readonly claim: (path: string) => Promise<boolean>;
	private readonly launch: (command: string, args: string[]) => Promise<Spawned>;
	private readonly pause: (ms: number) => Promise<void>;
	private readonly extractDeadlineMs: number;
	private readonly load: Load;
	/**
	 * What each Codebase's extraction was read to. A failure is remembered
	 * by the hash of what failed, so a broken file is not read again until
	 * it changes.
	 *
	 * The indexes ride with the parse rather than in a memo of their own:
	 * two caches over one file with no shared trigger is how a stale index
	 * outlives the graph it describes.
	 */
	private readonly loaded = new Map<string, Loading>();
	/**
	 * Launches in flight, so two refreshes asked for together start one
	 * runner, and since when. Across processes the runner's lock does the
	 * same job.
	 */
	private readonly refreshing = new Map<string, { since: number; launch: Promise<Launch> }>();
	private installing?: Promise<void>;

	constructor(options: GraphStoreOptions = {}) {
		this.run = options.run ?? runProcess;
		this.home =
			options.home ?? join(homedir(), ".pi-chart", "graphify");
		this.read = options.read ?? readText;
		this.load = options.load ?? loadInWorker;
		this.exists = options.exists ?? pathExists;
		this.makeDirectory = options.makeDirectory ?? makeDirectory;
		this.changedAt = options.changedAt ?? changedAt;
		this.write = options.write ?? ((path, content) => writeFile(path, content));
		this.claim = options.claim ?? claimFile;
		this.launch = options.launch ?? launchDetached;
		this.pause = options.pause ?? pause;
		this.extractDeadlineMs = options.extractDeadlineMs ?? DEFAULT_GRAPH_EXTRACT_DEADLINE_MS;
	}

	/** The graphify executable inside the private environment. */
	get executable(): string {
		return join(this.home, "bin", "graphify");
	}

	/** The private environment's interpreter, which the runner runs under. */
	private get python(): string {
		return join(this.home, "bin", "python");
	}

	/**
	 * Asks for a Codebase's graph to be brought up to date, installing
	 * graphify first if the machine does not have it. Resolves once the
	 * runner is launched, not when it finishes: an extraction may outlive
	 * the session that asked for it.
	 *
	 * The request is written before the runner starts, so a runner already
	 * holding the Codebase sees it and extracts once more when it is done:
	 * an edit made during a long extraction still reaches the graph.
	 *
	 * Always the same command (the runner's): `extract --code-only` is
	 * itself incremental, skipping files whose content hash is unchanged,
	 * so it costs the edit rather than the corpus. graphify's `update` is no
	 * cheaper and drops `--code-only`, which quietly widens the artifact in
	 * the user's repository to include their documentation.
	 */
	async refresh(codebase: string): Promise<Launch> {
		const launching = this.refreshing.get(codebase);
		if (launching) return launching.launch;

		const launch = this.launchRun(codebase).finally(() => {
			this.refreshing.delete(codebase);
		});
		this.refreshing.set(codebase, { since: Date.now(), launch });
		return launch;
	}

	private async launchRun(codebase: string): Promise<Launch> {
		await this.install();
		const state = await this.stateDirectory(codebase);
		await this.makeDirectory(state);
		await this.write(join(state, "requested"), "");
		const spawned = await this.launch(this.python, [
			RUNNER,
			"run",
			state,
			"--codebase",
			codebase,
			"--graphify",
			this.executable,
			"--deadline-ms",
			String(this.extractDeadlineMs),
		]);
		return { finished: this.served(state, spawned) };
	}

	/**
	 * Waits out the run that serves a request. A runner that finds the
	 * Codebase held exits at once, leaving the holder to pick the request
	 * up, so its exit says nothing; the lock says when that run is over.
	 */
	private async served(state: string, spawned: Spawned): Promise<void> {
		try {
			await spawned.exited;
			while ((await this.status(state)).running) await this.pause(STATUS_POLL_MS);
		} catch {
			// An unreadable status ends the wait; the outcome is read anyway.
		}
	}

	/**
	 * The last run's failure, if it failed and no session has reported it
	 * yet. Claimed as it is returned, so two sessions open in one Codebase
	 * do not both report the same run.
	 */
	async takeFailure(codebase: string): Promise<ExtractionFailure | undefined> {
		const state = await this.stateDirectory(codebase);
		const outcome = await this.outcome(state);
		if (!outcome || !failed(outcome)) return undefined;
		if (!(await this.claim(join(state, `reported.${outcome.runId}`)))) return undefined;
		return classify(codebase, outcome);
	}

	/**
	 * Whether an extraction of the Codebase is running, and how the last one
	 * ended. Running is what the runner's lock says, so a killed runner is
	 * never mistaken for a live one.
	 */
	async extraction(codebase: string): Promise<Extraction> {
		// Installing graphify comes before any runner, and can take minutes.
		const launching = this.refreshing.get(codebase);
		const state = await this.stateDirectory(codebase);
		// Nothing was ever launched here, so there is no runner to ask.
		if (!(await this.exists(state))) {
			return launching ? { running: { since: launching.since } } : {};
		}
		const status = await this.status(state);
		const last = status.last ?? undefined;
		const running = status.running ?? (launching ? { since: launching.since } : undefined);
		return {
			running: running ? { since: running.since } : undefined,
			last: last && failed(last) ? { ...last, failure: classify(codebase, last).kind } : last,
		};
	}

	private async status(
		state: string,
	): Promise<{ running: { since: number } | null; last: Outcome | null }> {
		const result = await this.run(this.python, [RUNNER, "status", state], undefined, VERSION_MS);
		if (!result.ok) throw new Error(`could not read extraction status: ${result.output}`);
		return JSON.parse(result.output) as {
			running: { since: number } | null;
			last: Outcome | null;
		};
	}

	private async outcome(state: string): Promise<Outcome | undefined> {
		try {
			return JSON.parse(await this.read(join(state, "outcome.json"))) as Outcome;
		} catch {
			// No run has completed yet, which is not a failure.
			return undefined;
		}
	}

	/**
	 * Where a Codebase's runs keep their lock, request and outcome: beside
	 * the private environment rather than in the Codebase, keyed by its real
	 * path so a symlinked checkout shares its lock with the checkout itself.
	 */
	private async stateDirectory(codebase: string): Promise<string> {
		// A path that cannot be resolved still needs a stable key; it is its own.
		const real = await realpath(codebase).catch(() => resolve(codebase));
		const key = createHash("sha256").update(real).digest("hex").slice(0, 16);
		return join(this.home, "runs", key);
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
	 * Read once and kept until the extraction changes, and then read again
	 * in the background: a Call is served the graph already read rather
	 * than waiting on a newer one, one read at a time. Only a Call that
	 * finds no graph read yet waits, and its caller bounds the wait.
	 */
	async graph(codebase: string): Promise<PreparedGraph | undefined> {
		const path = join(codebase, OUTPUT);
		const at = await this.changedAt(path);
		if (at === undefined) return undefined;

		let entry = this.loaded.get(codebase);
		if (!entry) {
			entry = { seenAt: at };
			this.loaded.set(codebase, entry);
			this.startLoad(entry, path, at);
		} else if (entry.seenAt !== at && !entry.inFlight) {
			this.startLoad(entry, path, at);
		}

		if (entry.current) return entry.current.graph;
		await entry.inFlight;
		const read: Loading = entry;
		if (read.current) return read.current.graph;
		throw read.broken?.error ?? new Error("graph was not read");
	}

	/**
	 * Why the newest extraction could not be read while an older graph is
	 * still served, if no one has been told yet. Claimed as it is returned.
	 */
	takeLoadFailure(codebase: string): Error | undefined {
		const entry = this.loaded.get(codebase);
		if (!entry?.current || !entry.broken || entry.broken.reported) return undefined;
		entry.broken.reported = true;
		return entry.broken.error;
	}

	private startLoad(entry: Loading, path: string, at: number): void {
		entry.seenAt = at;
		entry.inFlight = this.reload(entry, path, at).finally(() => {
			entry.inFlight = undefined;
		});
	}

	/**
	 * Reads the extraction and takes in what it came to. Never rejects: a
	 * failure is kept on the entry, beside whatever graph is still in use.
	 *
	 * Dated by the modified time seen before the read, so a file written
	 * again during it makes the graph look older than it is, never newer.
	 */
	private async reload(entry: Loading, path: string, at: number): Promise<void> {
		const skip = [entry.current?.hash, entry.broken?.hash].filter(
			(hash): hash is string => hash !== undefined,
		);
		let loaded: Loaded;
		try {
			loaded = await this.load(path, skip);
		} catch (error) {
			// No hash: whatever the file holds, the next change of it is read.
			entry.broken = { error: asError(error), reported: false };
			return;
		}
		if ("skipped" in loaded) {
			// The same content as the graph in use: as recent as the rewrite.
			if (entry.current?.hash === loaded.hash) {
				entry.current = {
					hash: loaded.hash,
					graph: { ...entry.current.graph, extractedAt: at },
				};
			}
			return;
		}
		if ("failure" in loaded) {
			entry.broken = {
				hash: loaded.hash,
				error: new GraphFormatError(loaded.failure),
				reported: false,
			};
			return;
		}
		entry.current = { hash: loaded.hash, graph: prepare(loaded.graph, at) };
		entry.broken = undefined;
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

function failed(outcome: Outcome): boolean {
	return outcome.exitCode !== 0 || outcome.stopped !== undefined;
}

/** graphify's refusal of a graph over its size cap, as 0.9.63 words it. */
const SIZE_CAP = /is ([\d_]+) bytes, exceeds ([\d_]+)-byte cap/;

/** What a failed outcome means, in words that say what to do about it. */
function classify(codebase: string, outcome: Outcome): ExtractionFailure {
	const output = outcome.output.trim();
	if (outcome.stopped === "deadline") {
		return new ExtractionFailure(
			"deadline",
			`graphify extract for ${codebase} was stopped after ` +
				`${duration(outcome.deadlineMs ?? 0)}, the deadline ` +
				"PICHART_GRAPH_EXTRACT_DEADLINE_MS sets; raise it if this " +
				`Codebase needs longer. It had printed: ${output}`,
		);
	}
	const capped = SIZE_CAP.exec(output);
	if (capped?.[1] && capped[2]) {
		const size = Number(capped[1].replaceAll("_", ""));
		const cap = Number(capped[2].replaceAll("_", ""));
		// Measured on VS Code: reading its 544 MB graph took 4.0 s and
		// 2.6 GiB, which is what raising the cap buys into every session.
		return new ExtractionFailure(
			"size-cap",
			`This codebase's graph is ${megabytes(size)}, over graphify's ` +
				`${megabytes(cap)} cap, so graphify will not refresh it; structure ` +
				"comes from the existing graph, marked older where files changed. " +
				"Set GRAPHIFY_MAX_GRAPH_BYTES to raise the cap, or list generated " +
				"and vendored paths in .graphifyignore to shrink the graph. A larger " +
				"graph is slower to read and larger in memory: a 544 MB graph " +
				"measured 4.0 s and 2.6 GiB.",
		);
	}
	return new ExtractionFailure(
		"failed",
		`graphify extract failed for ${codebase} (exit ${outcome.exitCode}): ${output}`,
	);
}

function megabytes(bytes: number): string {
	return `${Math.round(bytes / 1_000_000)} MB`;
}

/** A deadline as an operator would set it: minutes, or seconds under one. */
function duration(ms: number): string {
	return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

/** A wait that never keeps this process alive on its own. */
function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/** `O_EXCL`: of two sessions claiming one run, exactly one succeeds. */
async function claimFile(path: string): Promise<boolean> {
	try {
		await (await open(path, "wx")).close();
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
}

/**
 * A process in its own group with nothing attached, so ending this session
 * neither waits for it nor takes it down.
 */
async function launchDetached(command: string, args: string[]): Promise<Spawned> {
	const spawned = Bun.spawn([command, ...args], {
		detached: true,
		stdio: ["ignore", "ignore", "ignore"],
		// The environment as it is now, not as Bun captured it at start:
		// GRAPHIFY_MAX_GRAPH_BYTES reaches graphify only through this.
		env: process.env,
	});
	spawned.unref();
	return { exited: spawned.exited };
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
