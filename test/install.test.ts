import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";

import {
	defaultDatabaseUrl,
	loadConfig,
	readSavedUrl,
	SETTINGS,
	type Config,
} from "../src/config.ts";
import {
	candidates,
	type Check,
	describeChecks,
	Installation,
	type Prepared,
	prepareDatabase,
	projectRoot,
	saveUrl,
} from "../src/install.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { bunSql } from "../src/sql.ts";

function config(overrides: Partial<Config> = {}): Config {
	return { ...loadConfig({}), ...overrides };
}

const SAVED = "postgres://me@localhost:5432/pi_chart?host=/run/postgresql";
const EMBEDDED_STORE = join(homedir(), ".pi-chart", "store");

function installation(options: {
	bun?: string;
	reachable?: boolean;
	/** Whether the configured bundle exists; nothing else does. */
	bundle?: boolean;
	/** Paths that exist, where a test needs to tell them apart. */
	existing?: string[];
}): Installation {
	return new Installation({
		bun: async () => options.bun,
		reachable: async () => options.reachable === true,
		exists: async (path) =>
			options.existing === undefined
				? options.bundle === true && path === config().docBundle
				: options.existing.includes(path),
	});
}

/**
 * An installation on a Linux machine whose servers answer as `servers`
 * says, keyed by the url setup would try. Records what it was asked to do.
 */
function machine(options: {
	servers?: Record<string, Prepared>;
	/** Socket files that exist. */
	sockets?: string[];
	docker?: boolean;
	/** Whether `docker compose up` brings the compose server up. */
	composeStarts?: boolean;
	reachable?: string[];
	env?: Record<string, string>;
}) {
	const prepared: string[] = [];
	const ran: string[][] = [];
	const saved: string[] = [];
	let composeUp = false;
	const install = new Installation({
		bun: async () => "/usr/bin/bun",
		exists: async (path) =>
			path.endsWith("bundle") || (options.sockets ?? []).includes(path),
		reachable: async (url) => (options.reachable ?? []).includes(url),
		prepare: async (url) => {
			prepared.push(url);
			if (url === defaultDatabaseUrl() && composeUp) return { kind: "ready", url };
			return options.servers?.[url] ?? { kind: "absent" };
		},
		which: (command) => (command === "docker" && options.docker ? "/usr/bin/docker" : undefined),
		run: async (command, args) => {
			ran.push([command, ...args]);
			composeUp = options.composeStarts !== false;
			return { ok: composeUp, output: composeUp ? "" : "Cannot connect to the Docker daemon" };
		},
		save: async (url) => {
			saved.push(url);
		},
		env: options.env ?? {},
		platform: "linux",
		user: "me",
	});
	return { install, prepared, ran, saved };
}

function storeChecks(checks: Check[]): Check[] {
	return checks.filter((check) => check.name === "thread store");
}

describe("what an unconfigured install does", () => {
	test("with nothing configured and nothing saved, the store is not set up", () => {
		const config = loadConfig({});
		expect(config.storeOrigin).toBe("unset");
		expect(config.databaseUrl).toBeUndefined();
	});

	test("a url setup saved is used when nothing is configured", () => {
		const saved = "postgres://me@localhost:5432/pi_chart";
		const config = loadConfig({}, saved);
		expect(config.storeOrigin).toBe("saved");
		expect(config.databaseUrl).toBe(saved);
	});

	test("the settings list is what the code actually reads", async () => {
		const root = projectRoot();
		const read = new Set<string>();
		for (const directory of ["src", "test", "scripts"]) {
			const glob = new Bun.Glob("**/*.ts");
			for await (const file of glob.scan({ cwd: join(root, directory), absolute: true })) {
				const text = await Bun.file(file).text();
				// Reads, not mentions: a test that quotes a name it expects
				// nothing to read would otherwise look like a setting.
				for (const match of text.matchAll(/\benv\.(PICHART_[A-Z0-9_]+)/g)) {
					const name = match[1];
					if (name) read.add(name);
				}
				for (const match of text.matchAll(/\benv\["(PICHART_[A-Z0-9_]+)"\]/g)) {
					const name = match[1];
					if (name) read.add(name);
				}
			}
		}

		// The list is what tells a variable written for the old name
		// whether it still has a home, so a setting added without it would
		// be reported as a name nothing reads.
		expect([...read].sort()).toEqual([...SETTINGS].sort());
	});

	test("the default url and the compose file name the same store", async () => {
		const compose = await Bun.file(join(projectRoot(), "compose.yaml")).text();
		const url = new URL(defaultDatabaseUrl());

		// Two files, one Postgres: a role renamed in one of them and not the
		// other is a store that starts and cannot be reached.
		// To the end of the line, or a role shortened to a prefix of itself
		// passes the test that exists to catch exactly that.
		expect(compose).toContain(`POSTGRES_USER: ${url.username}\n`);
		expect(compose).toContain(`POSTGRES_PASSWORD: ${url.password}\n`);
		expect(compose).toContain(`POSTGRES_DB: ${url.pathname.slice(1)}\n`);
		// The port the compose file falls back to when PICHART_PG_PORT is unset.
		expect(compose).toContain(`PICHART_PG_PORT:-${url.port}}:5432`);
	});

	test("a configured store wins over the saved one", () => {
		const url = "postgres://elsewhere/db";

		const config = loadConfig(
			{ PICHART_DATABASE_URL: url },
			"postgres://me@localhost:5432/pi_chart",
		);
		expect(config.databaseUrl).toBe(url);
		expect(config.storeOrigin).toBe("supplied");
	});

	test("an empty setting declines the store, saved or not", () => {
		const config = loadConfig(
			{ PICHART_DATABASE_URL: "" },
			"postgres://me@localhost:5432/pi_chart",
		);
		expect(config.storeOrigin).toBe("declined");
		expect(config.databaseUrl).toBeUndefined();
	});

	test("the retired store directory setting is said to do nothing", () => {
		const config = loadConfig({ PICHART_STORE_DIR: "/tmp/elsewhere" });
		expect(config.problems).toHaveLength(1);
		expect(config.problems[0]).toContain("PICHART_STORE_DIR is not read");
		expect(config.problems[0]).toContain("pi-chart setup");
	});

	test("graph extraction is asked for, not assumed", () => {
		// It writes a directory into the user's repository.
		expect(loadConfig({}).graphExtract).toBe(false);
		expect(loadConfig({ PICHART_GRAPH: "on" }).graphExtract).toBe(true);
	});
});

describe("checking an installation", () => {
	test("a missing embedder runtime is named, with what to do", async () => {
		const checks = await installation({ reachable: true }).check(
			config(),
			"off",
		);

		const runtime = checks.find((check) => check.name === "embedder runtime");
		expect(runtime?.ok).toBe(false);
		expect(runtime?.fix).toContain("bun.sh");
	});

	test("a store declined on purpose is not reported as a fault", async () => {
		const checks = await installation({ bun: "/usr/bin/bun" }).check(
			config({ databaseUrl: "", storeOrigin: "declined" }),
			"off",
		);

		const store = checks.find((check) => check.name === "thread store");
		expect(store?.ok).toBe(true);
		expect(store?.fix).toBeUndefined();
		expect(store?.detail).toContain("declined");
	});

	test("a store not yet set up is a fault, with the command that sets it up", async () => {
		const checks = await installation({ bun: "/usr/bin/bun" }).check(config(), "off");

		const store = checks.find((check) => check.name === "thread store");
		expect(store?.ok).toBe(false);
		expect(store?.detail).toContain("not set up");
		expect(store?.fix).toContain("pi-chart setup");
	});

	test("a saved store is checked as the one setup chose", async () => {
		const saved = config({ storeOrigin: "saved", databaseUrl: SAVED });
		const up = await installation({ bun: "/usr/bin/bun", reachable: true }).check(saved, "off");
		const down = await installation({ bun: "/usr/bin/bun" }).check(saved, "off");

		expect(up.find((check) => check.name === "thread store")).toMatchObject({
			ok: true,
			detail: expect.stringContaining("saved by setup"),
		});
		// Setup can find another; it is the operator's server to start only
		// when they pointed PICHART_DATABASE_URL at it themselves.
		expect(down.find((check) => check.name === "thread store")).toMatchObject({
			ok: false,
			fix: expect.stringContaining("pi-chart setup"),
		});
	});

	test("the former embedded store is named as removable and left in place", async () => {
		const checks = await installation({
			bun: "/usr/bin/bun",
			existing: [EMBEDDED_STORE],
		}).check(config(), "off");

		const former = checks.find((check) => check.name === "former embedded store");
		expect(former?.ok).toBe(true);
		expect(former?.detail).toContain(EMBEDDED_STORE);
		expect(former?.detail).toContain("no longer read");
		expect(former?.fix).toBe(`rm -rf ${EMBEDDED_STORE}`);
	});

	test("an unreachable store the operator supplied is theirs to bring up", async () => {
		const checks = await installation({ bun: "/usr/bin/bun" }).check(
			config({
				databaseUrl: "postgres://me@db.example/thread_store",
				storeOrigin: "supplied",
			}),
			"off",
		);

		const store = checks.find((check) => check.name === "thread store");
		expect(store?.ok).toBe(false);
		// Not told to run our setup: setup does not start a store we do not own.
		expect(store?.fix).not.toContain("setup");
		expect(store?.fix).toContain("PICHART_DATABASE_URL");
	});

	test("an active backend is a fault, with the setting that fixes it", async () => {
		const checks = await installation({
			bun: "/usr/bin/bun",
			reachable: true,
		}).check(config(), "active");

		const memory = checks.find((check) => check.name === "harness memory");
		expect(memory?.ok).toBe(false);
		expect(memory?.detail).toContain("active");
		expect(memory?.fix).toContain("memory: {backend: off}");
	});

	test("a harness that never reported its memory is not counted as off", async () => {
		const checks = await installation({
			bun: "/usr/bin/bun",
			reachable: true,
		}).check(config(), "unconfirmed");

		const memory = checks.find((check) => check.name === "harness memory");
		expect(memory?.ok).toBe(false);
		expect(memory?.detail).toContain("cannot be confirmed");
		// Not rounded to active either: a harness that says nothing has not
		// said there is a second injector, only that nobody checked.
		expect(memory?.detail).not.toContain("active");
	});

	test("structure is reported from the store that exists, not from configuration", async () => {
		const withNoStore = await installation({ bun: "/usr/bin/bun" }).check(
			config({ graphExtract: true }),
			"off",
			false,
		);

		// Printing "extraction on" for a Store that was never constructed
		// is the one report that cannot be true.
		const graph = withNoStore.find((check) => check.name === "codebase graph");
		expect(graph?.ok).toBe(false);
		expect(graph?.detail).toContain("unavailable");
		expect(graph?.detail).not.toContain("extraction on");
	});

	test("extraction declined is not extraction broken", async () => {
		const checks = await installation({ bun: "/usr/bin/bun" }).check(
			config({ graphExtract: false }),
			"off",
			true,
		);

		const graph = checks.find((check) => check.name === "codebase graph");
		expect(graph?.ok).toBe(true);
		expect(graph?.detail).toContain("extraction off");
		expect(graph?.fix).toBeUndefined();
	});

	test("a configured extraction with a store reads as on", async () => {
		const checks = await installation({ bun: "/usr/bin/bun" }).check(
			config({ graphExtract: true }),
			"off",
			true,
		);

		expect(
			checks.find((check) => check.name === "codebase graph")?.detail,
		).toContain("extraction on");
	});

	test("a working installation has nothing to fix", async () => {
		const checks = await installation({
			bun: "/usr/bin/bun",
			reachable: true,
			bundle: true,
		}).check(config({ storeOrigin: "saved", databaseUrl: SAVED }), "off");

		expect(checks.every((check) => check.ok)).toBe(true);
		expect(checks.every((check) => check.fix === undefined)).toBe(true);
	});

	test("a bundle left where the old name put it is named, not moved", async () => {
		const old = join(homedir(), ".context-manager", "bundle");
		const checks = await installation({
			bun: "/usr/bin/bun",
			reachable: true,
			existing: [old],
		}).check(config(), "off");
		const bundle = checks.find((check) => check.name === "doc bundle");

		// The operator's own Concepts: named where they are, with the two
		// ways to reach them, and left alone.
		expect(bundle?.detail).toContain(old);
		expect(bundle?.fix).toContain("PICHART_DOC_BUNDLE");
	});

	test("an absent bundle is reported without being a problem", async () => {
		const checks = await installation({
			bun: "/usr/bin/bun",
			reachable: true,
		}).check(config(), "off");

		// A machine with no curated knowledge yet is the ordinary case.
		const bundle = checks.find((check) => check.name === "doc bundle");
		expect(bundle?.ok).toBe(true);
		expect(bundle?.detail).toContain("simply empty");
	});
});

describe("discovering a server", () => {
	const linux = { env: {}, platform: "linux" as const, user: "me" };

	test("tries the environment, then sockets, then the default port, then compose", () => {
		const found = candidates({
			...linux,
			env: { PGHOST: "db.local", PGPORT: "6543" },
			sockets: ["/run/postgresql/.s.PGSQL.5432", "/tmp/.s.PGSQL.5432"],
		});

		expect(found).toEqual([
			"postgres://me@db.local:6543/pi_chart",
			"postgres://me@localhost:5432/pi_chart?host=/run/postgresql",
			"postgres://me@localhost:5432/pi_chart?host=/tmp",
			"postgres://me@localhost:5432/pi_chart",
			defaultDatabaseUrl(),
		]);
	});

	test("the environment's socket directory, user and password are carried", () => {
		const [first] = candidates({
			...linux,
			env: { PGHOST: "/var/run/postgresql", PGUSER: "pg user", PGPASSWORD: "s3:cret" },
			sockets: [],
		});

		expect(first).toBe(
			"postgres://pg%20user:s3%3Acret@localhost:5432/pi_chart?host=/var/run/postgresql",
		);
	});

	test("a socket that does not exist is not tried", () => {
		expect(candidates({ ...linux, sockets: [] })).toEqual([
			"postgres://me@localhost:5432/pi_chart",
			defaultDatabaseUrl(),
		]);
	});

	test("each platform looks where its packages put the socket", () => {
		const everywhere = ["/run/postgresql", "/var/run/postgresql", "/tmp"].map(
			(directory) => `${directory}/.s.PGSQL.5432`,
		);
		expect(candidates({ ...linux, platform: "darwin", sockets: everywhere })).toEqual([
			"postgres://me@localhost:5432/pi_chart?host=/tmp",
			"postgres://me@localhost:5432/pi_chart",
			defaultDatabaseUrl(),
		]);
		expect(candidates({ ...linux, platform: "win32", sockets: everywhere })).toEqual([
			"postgres://me@localhost:5432/pi_chart",
			defaultDatabaseUrl(),
		]);
	});

	test("the same server named twice is tried once", () => {
		const found = candidates({
			...linux,
			env: { PGHOST: "localhost", PGPORT: "5432" },
			sockets: [],
		});
		expect(found).toEqual(["postgres://me@localhost:5432/pi_chart", defaultDatabaseUrl()]);
	});

	test("the compose server is tried on the port it was published on", () => {
		const found = candidates({ ...linux, env: { PICHART_PG_PORT: "55999" }, sockets: [] });
		expect(found.at(-1)).toBe(defaultDatabaseUrl(55999));
	});
});

describe("setting an installation up", () => {
	const local = "postgres://me@localhost:5432/pi_chart";
	const socket = "postgres://me@localhost:5432/pi_chart?host=/run/postgresql";

	test("a running server is prepared and its connection saved", async () => {
		const { install, saved, ran } = machine({
			servers: { [local]: { kind: "ready", url: local } },
		});

		const [store] = storeChecks(await install.setup(config()));

		expect(store?.ok).toBe(true);
		expect(store?.detail).toContain(local);
		expect(saved).toEqual([local]);
		expect(ran).toEqual([]);
	});

	test("a password in the connection is not printed in the report", async () => {
		const secret = "postgres://me:hunter2@db.local:5432/pi_chart";
		const { install, saved } = machine({
			env: { PGHOST: "db.local", PGPASSWORD: "hunter2" },
			servers: { [secret]: { kind: "ready", url: secret } },
		});

		const [store] = storeChecks(await install.setup(config()));

		expect(saved).toEqual([secret]);
		expect(store?.ok).toBe(true);
		expect(store?.detail).not.toContain("hunter2");
		expect(store?.detail).toContain("me:***@db.local");
	});

	test("the earliest server that answers is the one used", async () => {
		const { install, saved, prepared } = machine({
			sockets: ["/run/postgresql/.s.PGSQL.5432"],
			servers: {
				[socket]: { kind: "ready", url: socket },
				[local]: { kind: "ready", url: local },
			},
		});

		await install.setup(config());

		expect(saved).toEqual([socket]);
		expect(prepared).toEqual([socket]);
	});

	test("a server that cannot be used is explained and passed over", async () => {
		const { install, saved } = machine({
			sockets: ["/run/postgresql/.s.PGSQL.5432"],
			servers: {
				[socket]: { kind: "unusable", detail: "has no pgvector", fix: "pacman -S pgvector" },
				[local]: { kind: "ready", url: local },
			},
		});

		const stores = storeChecks(await install.setup(config()));

		expect(stores).toEqual([
			{
				name: "thread store",
				ok: false,
				detail: `${socket} has no pgvector`,
				fix: "pacman -S pgvector",
			},
			expect.objectContaining({ ok: true, detail: expect.stringContaining(local) }),
		]);
		expect(saved).toEqual([local]);
	});

	test("with no server, the compose server is started and used", async () => {
		const { install, saved, ran } = machine({ docker: true });

		const stores = storeChecks(await install.setup(config()));

		expect(ran).toEqual([["docker", "compose", "up", "-d", "--wait"]]);
		expect(saved).toEqual([defaultDatabaseUrl()]);
		expect(stores.at(-1)?.ok).toBe(true);
	});

	test("a compose server that will not start says why, and nothing is saved", async () => {
		const { install, saved } = machine({ docker: true, composeStarts: false });

		const stores = storeChecks(await install.setup(config()));

		expect(saved).toEqual([]);
		expect(stores.at(-1)?.ok).toBe(false);
		expect(stores.at(-1)?.detail).toContain("Cannot connect to the Docker daemon");
	});

	test("with no server and no docker, a pgvector Postgres is named as required", async () => {
		const { install, saved, ran } = machine({});

		const stores = storeChecks(await install.setup(config()));

		expect(ran).toEqual([]);
		expect(saved).toEqual([]);
		expect(stores.at(-1)?.ok).toBe(false);
		expect(stores.at(-1)?.detail).toContain("no pgvector Postgres found");
		expect(stores.at(-1)?.fix).toContain("Postgres with pgvector");
	});

	test("a supplied store is only checked: nothing is found, started, or saved", async () => {
		const { install, saved, ran, prepared } = machine({
			docker: true,
			servers: { [local]: { kind: "ready", url: local } },
		});

		const stores = storeChecks(
			await install.setup(
				config({
					databaseUrl: "postgres://me@db.example/thread_store",
					storeOrigin: "supplied",
				}),
			),
		);

		expect(stores).toHaveLength(1);
		expect(stores[0]?.ok).toBe(false);
		expect(stores[0]?.fix).toContain("PICHART_DATABASE_URL");
		expect([saved, ran, prepared]).toEqual([[], [], []]);
	});

	test("a saved store that still answers is kept", async () => {
		const { install, saved, prepared } = machine({
			reachable: [SAVED],
			servers: { [local]: { kind: "ready", url: local } },
		});

		const [store] = storeChecks(
			await install.setup(config({ storeOrigin: "saved", databaseUrl: SAVED })),
		);

		expect(store?.ok).toBe(true);
		expect(store?.detail).toContain(SAVED);
		expect([saved, prepared]).toEqual([[], []]);
	});

	test("a saved store that no longer answers is found again", async () => {
		const { install, saved } = machine({
			servers: { [local]: { kind: "ready", url: local } },
		});

		await install.setup(config({ storeOrigin: "saved", databaseUrl: SAVED }));

		expect(saved).toEqual([local]);
	});

	test("a store declined on purpose is left alone", async () => {
		const { install, saved, prepared } = machine({ docker: true });

		const stores = storeChecks(
			await install.setup(config({ databaseUrl: undefined, storeOrigin: "declined" })),
		);

		expect(stores).toEqual([
			expect.objectContaining({ ok: true, detail: expect.stringContaining("declined") }),
		]);
		expect([saved, prepared]).toEqual([[], []]);
	});

	test("the former embedded store is named by setup too", async () => {
		const install = new Installation({
			bun: async () => "/usr/bin/bun",
			reachable: async () => true,
			exists: async (path) => path === EMBEDDED_STORE || path.endsWith("bundle"),
		});

		const done = await install.setup(config({ storeOrigin: "saved", databaseUrl: SAVED }));

		expect(done.find((check) => check.name === "former embedded store")?.fix).toBe(
			`rm -rf ${EMBEDDED_STORE}`,
		);
	});

	test("does not create a bundle over the top of one the rename left", async () => {
		const install = new Installation({
			bun: async () => "/usr/bin/bun",
			reachable: async () => true,
			exists: async (path) => path === join(homedir(), ".context-manager", "bundle"),
			root: "/work/project",
		});

		const done = await install.setup(config({ storeOrigin: "saved", databaseUrl: SAVED }));
		const bundle = done.find((check) => check.name === "doc bundle");

		// An empty bundle created here reads as "ok" ever after, and the
		// Concepts at the old default are never mentioned again.
		expect(bundle?.detail).toContain(join(homedir(), ".context-manager", "bundle"));
		expect(bundle?.fix).toContain("PICHART_DOC_BUNDLE");
		expect(bundle?.detail).toStartWith("not created");
	});
});

describe("the connection setup saves", () => {
	test("is written for the operator alone and read back by a later session", async () => {
		const base = mkdtempSync(join(tmpdir(), "pi-saved-"));
		try {
			const path = join(base, "nested", "database.url");
			await saveUrl(SAVED, path);

			// A compose or PGPASSWORD candidate carries a password.
			expect(statSync(path).mode & 0o777).toBe(0o600);
			expect(readSavedUrl(path)).toBe(SAVED);
			expect(loadConfig({}, readSavedUrl(path)).databaseUrl).toBe(SAVED);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	test("an absent file is no connection at all", () => {
		expect(readSavedUrl(join(tmpdir(), "pi-no-such-dir", "database.url"))).toBeUndefined();
	});

	test("a server that is not there is absent, not unusable", async () => {
		// No server needed: a closed port and a missing socket are both nothing.
		expect(await prepareDatabase("postgres://me@127.0.0.1:1/pi_chart")).toEqual({
			kind: "absent",
		});
		expect(
			await prepareDatabase("postgres://me@localhost:5432/pi_chart?host=/nonexistent-pi-chart"),
		).toEqual({ kind: "absent" });
	});
});

// Against the server PICHART_DATABASE_URL names: preparing a database is a
// claim about real privileges and a real extension, not about our arithmetic.
const server = process.env.PICHART_DATABASE_URL;
const describeServer = server ? describe : describe.skip;

describeServer("preparing a real server", () => {
	test("creates the project's database with pgvector in it, and is idempotent", async () => {
		const scratch = `pi_chart_scratch_${process.pid}`;
		const target = new URL(server as string);
		target.pathname = `/${scratch}`;
		const admin = bunSql(server as string);
		try {
			const first = await prepareDatabase(target.toString());
			const again = await prepareDatabase(target.toString());

			expect(first).toEqual({ kind: "ready", url: target.toString() });
			expect(again).toEqual(first);
			const inside = bunSql(target.toString());
			try {
				const [row] = await inside`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
				expect(row?.extname).toBe("vector");
			} finally {
				await inside.end();
			}
		} finally {
			await admin.unsafe(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
			await admin.end();
		}
	});

	test("a user who may not create a database is told who can", async () => {
		// A role with LOGIN and nothing else, which is what a distribution's
		// package gives an OS user that was never granted CREATEDB.
		const role = `pi_chart_bare_${process.pid}`;
		const admin = bunSql(server as string);
		try {
			await admin.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD 'bare'`);
			const target = new URL(server as string);
			target.username = role;
			target.password = "bare";
			target.pathname = `/pi_chart_never_${process.pid}`;

			const prepared = await prepareDatabase(target.toString());

			expect(prepared.kind).toBe("unusable");
			if (prepared.kind !== "unusable") return;
			expect(prepared.detail).toContain("create a database");
			expect(prepared.fix).toBe(
				`sudo -u postgres createdb -O ${role} pi_chart_never_${process.pid}`,
			);
		} finally {
			await admin.unsafe(`DROP ROLE IF EXISTS ${role}`);
			await admin.end();
		}
	});
});

describe("reading the checks", () => {
	test("says what is wrong and what to run", () => {
		const text = describeChecks([
			{ name: "thread store", ok: false, detail: "not reachable", fix: "run x" },
			{ name: "doc bundle", ok: true, detail: "/home/a/bundle" },
		]);

		expect(text).toContain("not  thread store");
		expect(text).toContain("run x");
		expect(text).toContain("ok   doc bundle");
	});
});
