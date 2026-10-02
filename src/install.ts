import { homedir, userInfo } from "node:os";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { MemoryBackendState } from "./accounting.ts";
import {
	type Config,
	DEFAULT_PG_PORT,
	defaultDatabaseUrl,
	SAVED_URL_PATH,
} from "./config.ts";
import { type RunCommand, runProcess } from "./process.ts";
import { bunSql, socketFile, type Sql } from "./sql.ts";

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

/**
 * What preparing a candidate server came to. `absent` is nothing answering
 * there, which is the ordinary case and not reported; `unusable` is a
 * server that answered and cannot hold the store, with the command that
 * would let it.
 */
export type Prepared =
	| { kind: "ready"; url: string }
	| { kind: "absent" }
	| { kind: "unusable"; detail: string; fix: string };

export interface InstallOptions {
	/** Whether a path exists. A seam, so the checks run without a filesystem. */
	exists?: (path: string) => Promise<boolean>;
	/** Whether the Thread Store answers. */
	reachable?: (url: string) => Promise<boolean>;
	/**
	 * Makes a candidate server ready to hold the store: its database
	 * created and pgvector enabled in it.
	 */
	prepare?: (url: string) => Promise<Prepared>;
	/** Runs a program; `docker compose` when no server answers. */
	run?: RunCommand;
	/** Where a program is on `PATH`, if anywhere. */
	which?: (command: string) => string | undefined;
	/** Keeps the connection setup settled on for later sessions. */
	save?: (url: string) => Promise<void>;
	/** The environment discovery reads `PG*` and `PICHART_PG_PORT` from. */
	env?: Record<string, string | undefined>;
	platform?: NodeJS.Platform;
	/** The OS user, whom local Postgres authenticates by peer. */
	user?: string;
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

/** Where the embedded store kept its data before it was a server. */
const FORMER_EMBEDDED_STORE = join(homedir(), ".pi-chart", "store");

/**
 * How long `docker compose up --wait` may take: a first run pulls the image,
 * which on a slow link is most of it.
 */
const COMPOSE_MS = 120_000;

/** The database setup creates on a server it found rather than started. */
const DATABASE = "pi_chart";

/** Where each platform's packages put the Postgres socket. */
const SOCKET_DIRS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
	linux: ["/run/postgresql", "/var/run/postgresql", "/tmp"],
	darwin: ["/tmp"],
};

/**
 * The servers setup tries, in order, as connection strings: the libpq
 * environment the operator already set, the platform's local sockets that
 * exist, the default port, and then this project's compose server. The
 * first three target `pi_chart`, created if missing; compose's volume
 * already holds its own `thread_store`. A server named twice is tried once.
 *
 * `sockets` are the socket files that exist, so this stays pure.
 */
export function candidates(machine: {
	env: Record<string, string | undefined>;
	platform: NodeJS.Platform;
	user: string;
	sockets: readonly string[];
}): string[] {
	const { env, user } = machine;
	const found: string[] = [];
	if (env.PGHOST !== undefined || env.PGPORT !== undefined || env.PGUSER !== undefined) {
		found.push(
			serverUrl({
				host: env.PGHOST,
				port: env.PGPORT,
				user: env.PGUSER ?? user,
				password: env.PGPASSWORD,
			}),
		);
	}
	for (const directory of SOCKET_DIRS[machine.platform] ?? []) {
		if (machine.sockets.includes(socketFile(directory))) {
			found.push(serverUrl({ host: directory, user }));
		}
	}
	found.push(serverUrl({ user }));
	found.push(defaultDatabaseUrl(Number(env.PICHART_PG_PORT) || DEFAULT_PG_PORT));
	return [...new Set(found)];
}

/** A `pi_chart` connection string, a host naming a directory being a socket. */
function serverUrl(server: {
	host?: string;
	port?: string;
	user: string;
	password?: string;
}): string {
	const url = new URL(`postgres://localhost/${DATABASE}`);
	const socket = server.host?.startsWith("/") === true;
	if (server.host && !socket) url.hostname = server.host;
	url.port = server.port || "5432";
	url.username = server.user;
	if (server.password) url.password = server.password;
	if (socket) url.search = `?host=${server.host}`;
	return url.toString();
}

export class Installation {
	private readonly exists: (path: string) => Promise<boolean>;
	private readonly reachable: (url: string) => Promise<boolean>;
	private readonly prepare: (url: string) => Promise<Prepared>;
	private readonly run: RunCommand;
	private readonly which: (command: string) => string | undefined;
	private readonly save: (url: string) => Promise<void>;
	private readonly env: Record<string, string | undefined>;
	private readonly platform: NodeJS.Platform;
	private readonly user: string;
	private readonly bun: () => Promise<string | undefined>;
	private readonly root: string;

	constructor(options: InstallOptions = {}) {
		this.exists = options.exists ?? pathExists;
		this.reachable = options.reachable ?? storeAnswers;
		this.prepare = options.prepare ?? ((url) => prepareDatabase(url, this.platform));
		this.run = options.run ?? runProcess;
		this.which = options.which ?? ((command) => Bun.which(command) ?? undefined);
		this.save = options.save ?? ((url) => saveUrl(url));
		this.env = options.env ?? process.env;
		this.platform = options.platform ?? process.platform;
		this.user = options.user ?? userInfo().username;
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

		checks.push(await this.storeCheck(config));
		const former = await this.formerStore();
		if (former) checks.push(former);
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
	 * Brings up what this project can bring up itself: a Thread Store, found
	 * on this machine or started from `compose.yaml`, and a bundle directory
	 * to put Concepts in. Everything else is reported by `check` with the
	 * command to run, because installing Postgres or a language runtime, or
	 * editing a user's harness config, is not ours to do unasked.
	 */
	async setup(config: Config): Promise<Check[]> {
		const done: Check[] = [];

		done.push(...(await this.provideStore(config)));
		const former = await this.formerStore();
		if (former) done.push(former);

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
	 * The Thread Store as `check` reports it, by where it comes from. A
	 * supplied store is the operator's to bring up; a saved one is setup's
	 * to find again.
	 */
	private async storeCheck(config: Config): Promise<Check> {
		const url = config.databaseUrl;
		switch (config.storeOrigin) {
			case "declined":
				return {
					name: "thread store",
					ok: true,
					detail: "declined; the tail falls back to the harness's own history",
				};
			case "unset":
				return {
					name: "thread store",
					ok: false,
					detail: "not set up; turns are not recorded and nothing is recalled",
					fix: "run `pi-chart setup`",
				};
			case "supplied":
				return (await this.reachable(url ?? ""))
					? { name: "thread store", ok: true, detail: `${shown(url ?? "")}, from PICHART_DATABASE_URL` }
					: {
							name: "thread store",
							ok: false,
							detail: "not reachable; turns are not recorded and nothing is recalled",
							fix: "start the Postgres PICHART_DATABASE_URL points at, with pgvector",
						};
			case "saved":
				return (await this.reachable(url ?? ""))
					? { name: "thread store", ok: true, detail: `${shown(url ?? "")}, saved by setup` }
					: {
							name: "thread store",
							ok: false,
							detail: `${shown(url ?? "")}, saved by setup, is not reachable; turns are not recorded and nothing is recalled`,
							fix: "run `pi-chart setup` to find a server again",
						};
		}
	}

	/**
	 * The embedded store's data directory, when it is still there. Named and
	 * left alone: it holds only what the Journals rebuild, so removing it is
	 * safe, but it is the operator's disk.
	 */
	private async formerStore(): Promise<Check | undefined> {
		if (!(await this.exists(FORMER_EMBEDDED_STORE))) return undefined;
		return {
			name: "former embedded store",
			ok: true,
			detail: `${FORMER_EMBEDDED_STORE} is no longer read; it holds only what the Journals rebuild`,
			fix: `rm -rf ${FORMER_EMBEDDED_STORE}`,
		};
	}

	/**
	 * Provides the Thread Store. A declined store is left alone; a supplied
	 * `PICHART_DATABASE_URL` is the operator's server — setup checks it
	 * answers and never prepares, starts, or saves anything for it. A saved
	 * connection that still answers is kept, so every session stays on one
	 * server; otherwise setup discovers one and saves it.
	 */
	private async provideStore(config: Config): Promise<Check[]> {
		if (config.storeOrigin === "unset") return this.discover();
		// One probe: a saved store reported reachable is the one kept.
		const current = await this.storeCheck(config);
		if (current.ok || config.storeOrigin !== "saved") return [current];
		return this.discover();
	}

	/**
	 * Tries each candidate server in order and settles on the first that is
	 * ready, reporting every one that answered and could not be used. With
	 * none, starts the compose server if Docker is here.
	 */
	private async discover(): Promise<Check[]> {
		const done: Check[] = [];
		const sockets: string[] = [];
		for (const directory of SOCKET_DIRS[this.platform] ?? []) {
			const socket = socketFile(directory);
			if (await this.exists(socket)) sockets.push(socket);
		}
		const found = candidates({
			env: this.env,
			platform: this.platform,
			user: this.user,
			sockets,
		});
		for (const url of found) {
			const prepared = await this.prepare(url);
			if (prepared.kind === "ready") return [...done, await this.settle(prepared.url)];
			if (prepared.kind === "unusable") {
				done.push({
					name: "thread store",
					ok: false,
					detail: `${shown(url)} ${prepared.detail}`,
					fix: prepared.fix,
				});
			}
		}

		if (this.which("docker") === undefined) {
			done.push({
				name: "thread store",
				ok: false,
				detail: "no pgvector Postgres found, and no Docker to start one",
				fix: "install Postgres with pgvector, or Docker, then run `pi-chart setup` again",
			});
			return done;
		}
		const started = await this.run(
			"docker",
			["compose", "up", "-d", "--wait"],
			this.root,
			COMPOSE_MS,
		);
		if (!started.ok) {
			done.push({
				name: "thread store",
				ok: false,
				detail: `no pgvector Postgres found, and docker compose up failed: ${started.output}`,
				fix: "start Docker, or install Postgres with pgvector, then run `pi-chart setup` again",
			});
			return done;
		}
		const compose = found.at(-1) as string;
		const prepared = await this.prepare(compose);
		if (prepared.kind === "ready") return [...done, await this.settle(prepared.url)];
		done.push(
			prepared.kind === "unusable"
				? {
						name: "thread store",
						ok: false,
						detail: `${shown(compose)} ${prepared.detail}`,
						fix: prepared.fix,
					}
				: {
						name: "thread store",
						ok: false,
						detail: `the compose server started but ${shown(compose)} does not answer`,
						fix: "check `docker compose ps` and `docker compose logs` in the project directory",
					},
		);
		return done;
	}

	/** Saves the connection setup settled on, for every later session. */
	private async settle(url: string): Promise<Check> {
		await this.save(url);
		return {
			name: "thread store",
			ok: true,
			detail: `${shown(url)}; used by sessions started from now on`,
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

/**
 * A connection string as a report shows it: the password masked, since
 * checks are printed and notified, and the saved file is `0600` for the
 * same reason.
 */
function shown(url: string): string {
	const parsed = new URL(url);
	if (parsed.password === "") return url;
	parsed.password = "***";
	return parsed.toString();
}

/** A probe's connection: one, and not waited on for long. */
const PROBE = { connectionTimeout: 5, max: 1 };

/** Whether the store answers, without caring what it says. */
async function storeAnswers(url: string): Promise<boolean> {
	if (url === "") return false;
	const sql = bunSql(url, PROBE);
	try {
		await sql`SELECT 1`;
		return true;
	} catch {
		return false;
	} finally {
		await sql.end().catch(() => undefined);
	}
}

/** The error a Bun `SQL` call rejects with, as far as it is read here. */
interface SqlError {
	code?: string;
	errno?: string;
	message?: string;
}

/** A server error's SQLSTATE, or nothing for any other failure. */
function sqlstate(error: unknown): string | undefined {
	const { code, errno } = error as SqlError;
	return code === "ERR_POSTGRES_SERVER_ERROR" ? errno : undefined;
}

/**
 * Makes the server `url` names ready to hold the store: its database
 * created if missing and pgvector enabled in it. Every other database on
 * that server is left alone. Idempotent, so setup run again on a ready
 * server changes nothing.
 */
export async function prepareDatabase(
	url: string,
	platform: NodeJS.Platform = process.platform,
): Promise<Prepared> {
	const target = new URL(url);
	const database = decodeURIComponent(target.pathname.slice(1));
	const user = decodeURIComponent(target.username);
	const socket = target.searchParams.has("host");
	const handles: Sql[] = [];
	const open = (name: string): Sql => {
		const at = new URL(url);
		at.pathname = `/${name}`;
		const sql = bunSql(at.toString(), PROBE);
		handles.push(sql);
		return sql;
	};
	try {
		// The maintenance database, from which another is created. A server
		// whose `postgres` was dropped still has `template1`.
		let maintenance = open("postgres");
		let facts: { version: number; vector: boolean; present: boolean } | undefined;
		for (const fallback of ["template1", undefined]) {
			try {
				[facts] = await maintenance`
					SELECT current_setting('server_version_num')::int AS version,
						EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS vector,
						EXISTS (SELECT 1 FROM pg_database WHERE datname = ${database}) AS present`;
				break;
			} catch (error) {
				// Nothing answering is the ordinary case, not a server refusing:
				// Bun reports a missing socket, an unknown host and a closed port
				// alike as connection errors.
				const { code } = error as SqlError;
				if (code?.startsWith("ERR_POSTGRES_CONNECTION_")) return { kind: "absent" };
				const state = sqlstate(error);
				if (state === "3D000" && fallback) {
					maintenance = open(fallback);
					continue;
				}
				if (state === "28P01" || state === "28000") {
					return {
						kind: "unusable",
						detail: `refused ${user || "this user"}: ${(error as SqlError).message}`,
						fix: socket
							? `sudo -u postgres createuser --createdb ${user}`
							: `check the password, or run \`sudo -u postgres createuser --createdb ${user}\``,
					};
				}
				throw error;
			}
		}
		if (!facts) return { kind: "absent" };
		if (!facts.vector) {
			return {
				kind: "unusable",
				detail: "has no pgvector",
				fix: pgvectorPackage(Math.floor(facts.version / 10_000), platform),
			};
		}
		if (!facts.present) {
			try {
				await maintenance.unsafe(`CREATE DATABASE ${identifier(database)}`);
			} catch (error) {
				const state = sqlstate(error);
				if (state === "42501") {
					return {
						kind: "unusable",
						detail: `does not let ${user} create a database`,
						fix: `sudo -u postgres createdb -O ${user} ${database}`,
					};
				}
				// Another setup created it in between, which is what was wanted.
				if (state !== "42P04") throw error;
			}
		}
		try {
			await open(database).unsafe("CREATE EXTENSION IF NOT EXISTS vector");
		} catch (error) {
			if (sqlstate(error) !== "42501") throw error;
			return {
				kind: "unusable",
				detail: `does not let ${user} enable pgvector in ${database}`,
				fix: `sudo -u postgres psql -d ${database} -c 'CREATE EXTENSION vector'`,
			};
		}
		return { kind: "ready", url };
	} catch (error) {
		return {
			kind: "unusable",
			detail: `failed: ${(error as SqlError).message ?? String(error)}`,
			fix: "check this server's log, or set PICHART_DATABASE_URL to another one",
		};
	} finally {
		await Promise.all(handles.map((sql) => sql.end().catch(() => undefined)));
	}
}

/** A database name quoted as an SQL identifier. */
function identifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

/** The command that installs pgvector for Postgres `major` on `platform`. */
function pgvectorPackage(major: number, platform: NodeJS.Platform): string {
	if (platform === "darwin") return "brew install pgvector";
	return `pacman -S pgvector (Arch), or apt install postgresql-${major}-pgvector (Debian, Ubuntu)`;
}

/**
 * Saves the connection setup settled on, readable only by the operator:
 * it can carry a password. `chmod` as well as the create mode, since a
 * file already there keeps whatever mode it had.
 */
export async function saveUrl(url: string, path: string = SAVED_URL_PATH): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${url}\n`, { mode: 0o600 });
	await chmod(path, 0o600);
}

async function defaultBun(): Promise<string | undefined> {
	const { findBun } = await import("./bun-runtime.ts");
	return findBun();
}
