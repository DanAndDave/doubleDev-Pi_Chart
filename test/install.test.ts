import { describe, expect, test } from "bun:test";

import {
	defaultDatabaseUrl,
	loadConfig,
	type Config,
} from "../src/config.ts";
import { describeChecks, Installation, projectRoot } from "../src/install.ts";

function config(overrides: Partial<Config> = {}): Config {
	return { ...loadConfig({}), ...overrides };
}

function installation(options: {
	bun?: string;
	reachable?: boolean;
	bundle?: boolean;
	ran?: string[][];
}): Installation {
	return new Installation({
		bun: async () => options.bun,
		reachable: async () => options.reachable === true,
		exists: async () => options.bundle === true,
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

	test("the port compose was told to serve is the port the extension dials", () => {
		// `compose.yaml` honours `CM_PG_PORT`; until now the extension read
		// it nowhere and dialled 55432 while the container listened
		// elsewhere, so nothing was recorded and nothing recalled.
		expect(loadConfig({ CM_PG_PORT: "6543" }).databaseUrl).toContain(":6543/");
		expect(loadConfig({}).databaseUrl).toContain(":55432/");
		// A configured URL still outranks the port.
		expect(
			loadConfig({ CM_PG_PORT: "6543", CM_DATABASE_URL: "postgres://x/y" })
				.databaseUrl,
		).toBe("postgres://x/y");
	});

	test("a configured store still wins", () => {
		const url = "postgres://elsewhere/db";

		expect(loadConfig({ CM_DATABASE_URL: url }).databaseUrl).toBe(url);
	});

	test("graph extraction is asked for, not assumed", () => {
		// It writes a directory into the user's repository.
		expect(loadConfig({}).graphExtract).toBe(false);
		expect(loadConfig({ CM_GRAPH: "on" }).graphExtract).toBe(true);
	});
});

describe("checking an installation", () => {
	test("a missing embedder runtime is named, with what to do", async () => {
		const checks = await installation({ reachable: true }).check(
			config(),
			true,
		);

		const runtime = checks.find((check) => check.name === "embedder runtime");
		expect(runtime?.ok).toBe(false);
		expect(runtime?.fix).toContain("bun.sh");
	});

	test("a store declined on purpose is not reported as a fault", async () => {
		const checks = await installation({ bun: "/usr/bin/bun" }).check(
			config({ databaseUrl: "" }),
			true,
		);

		const store = checks.find((check) => check.name === "thread store");
		expect(store?.ok).toBe(true);
		expect(store?.fix).toBeUndefined();
		expect(store?.detail).toContain("declined");
	});

	test("an unreachable store is named, with the command that fixes it", async () => {
		const checks = await installation({ bun: "/usr/bin/bun" }).check(
			config(),
			true,
		);

		const store = checks.find((check) => check.name === "thread store");
		expect(store?.ok).toBe(false);
		expect(store?.fix).toContain("setup");
	});

	test("a harness that never reported its memory is not counted as off", async () => {
		const checks = await installation({
			bun: "/usr/bin/bun",
			reachable: true,
		}).check(config(), undefined);

		const memory = checks.find((check) => check.name === "harness memory");
		expect(memory?.ok).toBe(false);
		expect(memory?.detail).toContain("cannot be confirmed");
	});

	test("a working installation has nothing to fix", async () => {
		const checks = await installation({
			bun: "/usr/bin/bun",
			reachable: true,
			bundle: true,
		}).check(config(), true);

		expect(checks.every((check) => check.ok)).toBe(true);
		expect(checks.every((check) => check.fix === undefined)).toBe(true);
	});

	test("an absent bundle is reported without being a problem", async () => {
		const checks = await installation({
			bun: "/usr/bin/bun",
			reachable: true,
		}).check(config(), true);

		// A machine with no curated knowledge yet is the ordinary case.
		const bundle = checks.find((check) => check.name === "doc bundle");
		expect(bundle?.ok).toBe(true);
		expect(bundle?.detail).toContain("simply empty");
	});

	test("checking reads only", async () => {
		const ran: string[][] = [];
		await installation({ bun: "/usr/bin/bun", ran }).check(config(), true);

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
