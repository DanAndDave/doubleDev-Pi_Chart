import { describe, expect, test } from "bun:test";

import {
	defaultDatabaseUrl,
	loadConfig,
	SETTINGS,
	type Config,
} from "../src/config.ts";
import { describeChecks, Installation, projectRoot } from "../src/install.ts";
import { homedir } from "node:os";
import { join } from "node:path";

function config(overrides: Partial<Config> = {}): Config {
	return { ...loadConfig({}), ...overrides };
}

function installation(options: {
	bun?: string;
	reachable?: boolean;
	bundle?: boolean;
	/** Paths that exist, where a test needs to tell them apart. */
	existing?: string[];
	ran?: string[][];
}): Installation {
	return new Installation({
		bun: async () => options.bun,
		reachable: async () => options.reachable === true,
		exists: async (path) =>
			options.existing === undefined
				? options.bundle === true
				: options.existing.includes(path),
		root: "/work/project",
		// The cwd is recorded too: it is what makes `docker compose` find
		// this project's compose file, and nothing else would notice it go.
		run: async (command, args, cwd) => {
			options.ran?.push([command, ...args, cwd ?? ""]);
			return { ok: true, output: "" };
		},
	});
}

describe("what an unconfigured install does", () => {
	test("the thread store points at what this project serves", () => {
		// The setting existed only to repeat the compose file back at us.
		expect(loadConfig({}).databaseUrl).toBe(defaultDatabaseUrl());
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

	test("the port compose was told to serve is the port the extension dials", () => {
		// `compose.yaml` honours `PICHART_PG_PORT`; until now the extension read
		// it nowhere and dialled 55432 while the container listened
		// elsewhere, so nothing was recorded and nothing recalled.
		expect(loadConfig({ PICHART_PG_PORT: "6543" }).databaseUrl).toContain(":6543/");
		expect(loadConfig({}).databaseUrl).toContain(":55432/");
		// A configured URL still outranks the port.
		expect(
			loadConfig({ PICHART_PG_PORT: "6543", PICHART_DATABASE_URL: "postgres://x/y" })
				.databaseUrl,
		).toBe("postgres://x/y");
	});

	test("a configured store still wins", () => {
		const url = "postgres://elsewhere/db";

		expect(loadConfig({ PICHART_DATABASE_URL: url }).databaseUrl).toBe(url);
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
			config({ databaseUrl: "" }),
			"off",
		);

		const store = checks.find((check) => check.name === "thread store");
		expect(store?.ok).toBe(true);
		expect(store?.fix).toBeUndefined();
		expect(store?.detail).toContain("declined");
	});

	test("an unreachable store is named, with the command that fixes it", async () => {
		const checks = await installation({ bun: "/usr/bin/bun" }).check(
			config(),
			"off",
		);

		const store = checks.find((check) => check.name === "thread store");
		expect(store?.ok).toBe(false);
		expect(store?.fix).toContain("setup");
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
		}).check(config(), "off");

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

	test("checking reads only", async () => {
		const ran: string[][] = [];
		await installation({ bun: "/usr/bin/bun", ran }).check(config(), "off");

		// A status check that starts containers is a trap.
		expect(ran).toEqual([]);
	});
});

describe("setting an installation up", () => {
	test("starts the thread store where this project's compose file is", async () => {
		const ran: string[][] = [];
		await installation({ ran, bundle: true }).setup(config());

		expect(ran).toEqual([
			["docker", "compose", "up", "-d", "--wait", "/work/project"],
		]);
	});

	test("does not create a bundle over the top of one the rename left", async () => {
		const install = new Installation({
			bun: async () => "/usr/bin/bun",
			reachable: async () => true,
			exists: async (path) => path === join(homedir(), ".context-manager", "bundle"),
			root: "/work/project",
			run: async () => ({ ok: true, output: "" }),
		});

		const done = await install.setup(config());
		const bundle = done.find((check) => check.name === "doc bundle");

		// An empty bundle created here reads as "ok" ever after, and the
		// Concepts at the old default are never mentioned again.
		expect(bundle?.detail).toContain(join(homedir(), ".context-manager", "bundle"));
		expect(bundle?.fix).toContain("PICHART_DOC_BUNDLE");
		expect(bundle?.detail).toStartWith("not created");
	});

	test("a docker that never returns is bounded", async () => {
		const bounds: (number | undefined)[] = [];
		const install = new Installation({
			bun: async () => "/usr/bin/bun",
			reachable: async () => true,
			exists: async () => true,
			root: "/work/project",
			run: async (_command, _args, _cwd, timeoutMs) => {
				bounds.push(timeoutMs);
				return { ok: true, output: "" };
			},
		});

		await install.setup(config());

		// `--wait` waits for a healthy container, and a daemon that never
		// answers would otherwise hold setup open with no output at all.
		expect(bounds).toEqual([expect.any(Number)]);
		expect(bounds[0]).toBeGreaterThan(0);
	});

	test("the project root holds the compose file", async () => {
		expect(await Bun.file(`${projectRoot()}/compose.yaml`).exists()).toBe(true);
	});

	test("a missing docker is a failed check, not a thrown error", async () => {
		const install = new Installation({
			bun: async () => "/usr/bin/bun",
			reachable: async () => false,
			exists: async () => true,
			run: async () => {
				// What Bun.spawn does for an executable that is not there.
				throw new Error('Executable not found in $PATH: "docker"');
			},
		});

		const done = await install.setup(config());

		const store = done.find((check) => check.name === "thread store");
		expect(store?.ok).toBe(false);
		expect(store?.detail).toContain("not found");
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
