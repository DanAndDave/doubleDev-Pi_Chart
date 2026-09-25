import { homedir } from "node:os";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Config } from "./config.ts";
import type { MemoryBackendState } from "./accounting.ts";
import { openPglite } from "./pglite-sql.ts";
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
	/** Whether a path exists. A seam, so the checks run without a filesystem. */
	exists?: (path: string) => Promise<boolean>;
	/** Whether the Thread Store answers. */
	reachable?: (url: string) => Promise<boolean>;
	/** Whether an embedded store opens at a data directory. */
	openable?: (dataDir: string) => Promise<boolean>;
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

/** Where a bundle sits if it was made before this was called pi-chart. */
const BUNDLE_BEFORE_THE_RENAME = join(homedir(), ".context-manager", "bundle");

export class Installation {
	private readonly exists: (path: string) => Promise<boolean>;
	private readonly reachable: (url: string) => Promise<boolean>;
	private readonly openable: (dataDir: string) => Promise<boolean>;
	private readonly bun: () => Promise<string | undefined>;
	private readonly root: string;

	constructor(options: InstallOptions = {}) {
		this.exists = options.exists ?? pathExists;
		this.reachable = options.reachable ?? storeAnswers;
		this.openable = options.openable ?? storeOpens;
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
		memoryBackend: MemoryBackendState,
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

		// Three states, three checks: an embedded store is asked to open, a
		// supplied one to answer, and a declined one is left alone — a
		// deliberate refusal is not a fault.
		const origin = config.storeOrigin;
		const url = config.databaseUrl;
		const answers =
			origin === "declined"
				? false
				: origin === "supplied"
					? url !== undefined && url !== "" && (await this.reachable(url))
					: await this.openable(config.storeDir);
		checks.push({
			name: "thread store",
			ok: answers || origin === "declined",
			detail:
				origin === "declined"
					? "declined; the tail falls back to the harness's own history"
					: answers
						? origin === "supplied"
							? (url as string)
							: `embedded at ${config.storeDir}`
						: origin === "supplied"
							? "not reachable; turns are not recorded and nothing is recalled"
							: "cannot open; turns are not recorded and nothing is recalled",
			fix:
				answers || origin === "declined"
					? undefined
					: origin === "supplied"
						? "start the Postgres PICHART_DATABASE_URL points at, with pgvector"
						: "check PICHART_STORE_DIR is a writable directory",
		});
		// The same three states the report at a Conversation's start
		// distinguishes, in the same words: a check that read "not reported"
		// where the report read "unconfirmed" would look like two different
		// findings with two different remedies.
		checks.push({
			name: "harness memory",
			ok: memoryBackend === "off",
			detail:
				memoryBackend === "off"
					? "off, as it must be"
					: memoryBackend === "active"
						? "active; it injects recall into the system prompt, which " +
							"the assembler cannot reach, so this window has two " +
							"injectors in it"
						: "not reported by this harness, so it cannot be confirmed " +
							"off; calls are recorded as unconfirmed, not as clean",
			fix:
				memoryBackend === "off"
					? undefined
					: "set `memory: {backend: off}` in ~/.omp/agent/config.yml",
		});

		// What the settings themselves say. One stderr line at session start
		// is easy to miss, and this is the surface an operator is told to
		// run when something is not working.
		for (const problem of config.problems) {
			checks.push({ name: "settings", ok: false, detail: problem });
		}

		const bundle = await this.exists(config.docBundle);
		// A bundle under the directory this project used to be named after
		// is the operator's own writing, so nothing moves it: it is named,
		// with the two ways to reach it, and left where they put it.
		const stranded = !bundle && (await this.exists(BUNDLE_BEFORE_THE_RENAME));
		checks.push({
			name: "doc bundle",
			ok: true,
			detail: bundle
				? config.docBundle
				: stranded
					? `none at ${config.docBundle}, but one at ` +
						`${BUNDLE_BEFORE_THE_RENAME} from before this was called pi-chart`
					: `none at ${config.docBundle}; curated knowledge is simply empty`,
			fix: stranded
				? `move it to ${config.docBundle}, or set PICHART_DOC_BUNDLE to where it is`
				: undefined,
		});

		checks.push({
			name: "codebase graph",
			// Unavailable is a fault; declined extraction is a choice.
			ok: structure,
			detail: !structure
				? "unavailable; no graph store in this session"
				: config.graphExtract
					? "extraction on; graphify-out/ is written into this codebase"
					: "extraction off; set PICHART_GRAPH=on to derive one",
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

		done.push(await this.provideStore(config));

		if (!(await this.exists(config.docBundle))) {
			// An empty bundle created here would make the check below read
			// "ok", and the Concepts at the old default would go unmentioned
			// for good. Setup is where an operator is looking, so this is
			// where it is said — and nothing is created over the top of it.
			if (await this.exists(BUNDLE_BEFORE_THE_RENAME)) {
				done.push({
					name: "doc bundle",
					ok: true,
					detail: `not created: there is one at ${BUNDLE_BEFORE_THE_RENAME} ` +
						`from before this was called pi-chart`,
					fix: `move it to ${config.docBundle}, or set PICHART_DOC_BUNDLE to where it is`,
				});
			} else {
				await mkdir(join(config.docBundle, "decisions"), { recursive: true });
				done.push({
					name: "doc bundle",
					ok: true,
					detail: `created ${config.docBundle}`,
				});
			}
		}

		return done;
	}

	/**
	 * Provides the Thread Store, or reports on one this project does not own.
	 * The default (`own`) store is embedded: setup opens it once at
	 * `config.storeDir`, which creates the data directory. The schema is
	 * applied later, on the first runtime connection. A
	 * supplied `PICHART_DATABASE_URL` is the operator's server — setup checks
	 * it answers but never starts it — and a declined store is left alone.
	 */
	private async provideStore(config: Config): Promise<Check> {
		if (config.storeOrigin === "declined") {
			return {
				name: "thread store",
				ok: true,
				detail: "declined; the tail falls back to the harness's own history",
			};
		}

		if (config.storeOrigin === "supplied") {
			const url = config.databaseUrl;
			const answers = url !== undefined && url !== "" && (await this.reachable(url));
			return {
				name: "thread store",
				ok: answers,
				detail: answers
					? (url as string)
					: "supplied store not reachable",
				fix: answers
					? undefined
					: "start the Postgres PICHART_DATABASE_URL points at, with pgvector",
			};
		}

		// `own`: the embedded store. Opening it at the data directory creates
		// the directory and loads pgvector; no server, daemon, or container.
		const opened = await this.openable(config.storeDir);
		return {
			name: "thread store",
			ok: opened,
			detail: opened
				? `embedded at ${config.storeDir}`
				: "embedded store could not be opened",
			fix: opened ? undefined : "check PICHART_STORE_DIR is a writable directory",
		};
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

/** Whether an embedded store opens and answers at a data directory. */
async function storeOpens(dataDir: string): Promise<boolean> {
	const sql = openPglite(dataDir);
	try {
		await sql`SELECT 1`;
		return true;
	} catch {
		return false;
	} finally {
		await sql.end().catch(() => undefined);
	}
}

async function defaultBun(): Promise<string | undefined> {
	const { findBun } = await import("./bun-runtime.ts");
	return findBun();
}
