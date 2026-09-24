import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Config } from "./config.ts";
import { runProcess, type RunCommand } from "./process.ts";

/**
 * How long `docker compose up -d --wait` may take. It pulls an image on a
 * machine that has never run it, which is the case the wait exists for;
 * beyond this the daemon is not coming.
 */
const COMPOSE_MS = 120_000;

/**
 * What a working installation needs, and how to get there.
 *
 * Installing the extension is one command; the parts it talks to — a
 * database, a Bun for the embedder, a bundle to read — are not installed
 * with it. Left implicit, a missing one shows up as a Store that quietly
 * contributes nothing, which is the failure this project has hit more than
 * any other. So it is stated, and the fixable parts are fixed on request.
 */

/** One thing the installation needs, and whether it is there. */
export interface Check {
	name: string;
	ok: boolean;
	detail: string;
	/** What the user would run, when this is not something we can fix. */
	fix?: string;
}

export interface InstallOptions {
	run?: RunCommand;
	/** Whether a path exists. A seam, so the checks run without a filesystem. */
	exists?: (path: string) => Promise<boolean>;
	/** Whether the Thread Store answers. */
	reachable?: (url: string) => Promise<boolean>;
	/** Where Bun is, if anywhere. */
	bun?: () => Promise<string | undefined>;
	/** This project's root, which holds `compose.yaml`. */
	root?: string;
}

/**
 * The project directory, from this file's own location.
 *
 * `import.meta.dir` rather than a URL's pathname: the latter is
 * percent-encoded, so a clone under `~/My Projects/` yielded a path that
 * does not exist — and `setup` spawns with it as the working directory.
 */
export function projectRoot(): string {
	return dirname(import.meta.dir);
}

export class Installation {
	private readonly run: RunCommand;
	private readonly exists: (path: string) => Promise<boolean>;
	private readonly reachable: (url: string) => Promise<boolean>;
	private readonly bun: () => Promise<string | undefined>;
	private readonly root: string;

	constructor(options: InstallOptions = {}) {
		this.run = options.run ?? runProcess;
		this.exists = options.exists ?? pathExists;
		this.reachable = options.reachable ?? storeAnswers;
		this.bun = options.bun ?? defaultBun;
		this.root = options.root ?? projectRoot();
	}

	/**
	 * Everything the installation needs, said plainly. Reads only.
	 *
	 * `structure` says whether a Graph Store was constructed at all:
	 * reporting extraction from configuration alone printed "extraction
	 * on" for a Store that did not exist.
	 */
	async check(
		config: Config,
		memoryOff: boolean | undefined,
		structure: boolean = true,
	): Promise<Check[]> {
		const checks: Check[] = [];

		const bun = await this.bun();
		checks.push({
			name: "embedder runtime",
			ok: bun !== undefined,
			detail: bun ?? "no Bun found; recall and curated knowledge stay empty",
			fix: bun ? undefined : "install Bun from https://bun.sh",
		});

		// An empty setting is how someone declines a store on purpose, and a
		// deliberate choice must not be reported as a fault.
		const url = config.databaseUrl;
		const declined = url === undefined || url === "";
		const answers = !declined && (await this.reachable(url));
		checks.push({
			name: "thread store",
			ok: answers || declined,
			detail: declined
				? "declined; the tail falls back to the harness's own history"
				: answers
					? url
					: "not reachable; turns are not recorded and nothing is recalled",
			fix: answers || declined ? undefined : "run `context-manager setup`",
		});
		checks.push({
			name: "harness memory",
			ok: memoryOff === true,
			detail:
				memoryOff === true
					? "off, as it must be"
					: memoryOff === false
						? "active; two systems will inject recall into one window"
						: "not reported by this harness, so it cannot be confirmed off",
			fix: memoryOff === true ? undefined : "set `memory: {backend: off}` in ~/.omp/agent/config.yml",
		});

		const bundle = await this.exists(config.docBundle);
		checks.push({
			name: "doc bundle",
			ok: true,
			detail: bundle
				? config.docBundle
				: `none at ${config.docBundle}; curated knowledge is simply empty`,
		});

		checks.push({
			name: "codebase graph",
			// Unavailable is a fault; declined extraction is a choice.
			ok: structure,
			detail: !structure
				? "unavailable; no graph store in this session"
				: config.graphExtract
					? "extraction on; graphify-out/ is written into this codebase"
					: "extraction off; set CM_GRAPH=on to derive one",
			fix: structure ? undefined : "report this: the graph store should always be available",
		});

		return checks;
	}

	/**
	 * Brings up what this project can bring up itself: the Thread Store, and
	 * a bundle directory to put Concepts in. Everything else is reported by
	 * `check` with the command to run, because installing a language runtime
	 * or editing a user's harness config is not ours to do unasked.
	 */
	async setup(config: Config): Promise<Check[]> {
		const done: Check[] = [];

		// `--wait` because `up -d` returns when the container starts, not
		// when Postgres accepts connections; the check below would
		// otherwise tell the user to run the command they just ran.
		// Caught because a missing `docker` throws rather than failing.
		const compose = await this.run(
			"docker",
			["compose", "up", "-d", "--wait"],
			this.root,
			COMPOSE_MS,
		).catch((error: unknown) => ({
			ok: false,
			output: error instanceof Error ? error.message : String(error),
		}));
		done.push({
			name: "thread store",
			ok: compose.ok,
			detail: compose.ok
				? "started; the schema applies itself on first use"
				: compose.output || "could not start docker compose",
			fix: compose.ok ? undefined : "is Docker installed and running?",
		});

		if (!(await this.exists(config.docBundle))) {
			await mkdir(join(config.docBundle, "decisions"), { recursive: true });
			done.push({
				name: "doc bundle",
				ok: true,
				detail: `created ${config.docBundle}`,
			});
		}

		return done;
	}
}

/** Checks as a person reads them. */
export function describeChecks(checks: Check[]): string {
	const lines = checks.map((check) => {
		const mark = check.ok ? "ok  " : "not ";
		const fix = check.fix ? `\n      ${check.fix}` : "";
		return `  ${mark} ${check.name.padEnd(17)} ${check.detail}${fix}`;
	});
	return lines.join("\n");
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** Whether the store answers, without caring what it says. */
async function storeAnswers(url: string): Promise<boolean> {
	const { SQL } = await import("bun");
	const sql = new SQL(url);
	try {
		await sql`SELECT 1`;
		return true;
	} catch {
		return false;
	} finally {
		await sql.close().catch(() => undefined);
	}
}

async function defaultBun(): Promise<string | undefined> {
	const { findBun } = await import("./bun-runtime.ts");
	return findBun();
}
