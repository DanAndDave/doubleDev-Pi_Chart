import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { GraphStore, PINNED_GRAPHIFY } from "../src/graph-store.ts";
import type { CommandResult } from "../src/process.ts";

const FIXTURE = readFileSync(
	new URL("./fixtures/graph.json", import.meta.url).pathname,
	"utf8",
);

interface Recorded {
	command: string;
	args: string[];
}

/**
 * A Graph Store whose processes never run: what matters here is which
 * commands it decides to run, and in what order.
 */
function store(options: {
	present?: string[];
	fails?: string;
	graph?: string;
	/** What the installed graphify reports. Defaults to the pinned version. */
	version?: string;
	/** When the extraction last changed; a new value invalidates the cache. */
	changedAt?: () => number | undefined;
}): { store: GraphStore; ran: Recorded[] } {
	const ran: Recorded[] = [];
	const present = new Set(options.present ?? []);
	const extracted = [...present].some((each) => each.endsWith("graph.json"));
	const graphStore = new GraphStore({
		home: "/home/test/.context-manager/graphify",
		exists: async (path) => [...present].some((each) => path.endsWith(each)),
		changedAt: async () =>
			options.changedAt ? options.changedAt() : extracted ? 1 : undefined,
		read: async () => options.graph ?? FIXTURE,
		makeDirectory: async () => {},
		run: async (command, args): Promise<CommandResult> => {
			ran.push({ command, args });
			const failing = options.fails;
			if (failing && `${command} ${args.join(" ")}`.includes(failing)) {
				return { ok: false, output: `${failing} exploded` };
			}
			if (args[0] === "--version") {
				return {
					ok: true,
					output: `graphify ${options.version ?? PINNED_GRAPHIFY}`,
				};
			}
			return { ok: true, output: "" };
		},
	});
	return { store: graphStore, ran };
}

describe("obtaining graphify", () => {
	test("installs it at the pinned version when the machine lacks it", async () => {
		const { store: graphStore, ran } = store({});

		await graphStore.install();

		expect(ran[0]?.command).toBe("python3");
		expect(ran[0]?.args).toEqual([
			"-m",
			"venv",
			"/home/test/.context-manager/graphify",
		]);
		expect(ran[1]?.args).toContain(`graphifyy==${PINNED_GRAPHIFY}`);
	});

	test("installs nothing when the pinned version is already there", async () => {
		const { store: graphStore, ran } = store({ present: ["bin/graphify"] });

		await graphStore.install();

		expect(ran.map((each) => each.args[0])).toEqual(["--version"]);
	});

	test("reinstalls when the pinned version is a prefix of the installed one", async () => {
		// `0.9.6` appears inside `0.9.63`; a substring check would accept
		// the build the pin was moved away from.
		const { store: graphStore, ran } = store({
			present: ["bin/graphify"],
			version: `${PINNED_GRAPHIFY}9`,
		});

		await graphStore.install();

		expect(ran.map((each) => each.args[0])).toContain("install");
	});

	test("reinstalls when the installed version is not the pinned one", async () => {
		// Otherwise moving the pin after a schema change is a no-op on every
		// machine that ever ran an older build.
		const { store: graphStore, ran } = store({
			present: ["bin/graphify"],
			version: "0.9.1",
		});

		await graphStore.install();

		expect(ran.map((each) => each.args[0])).toEqual([
			"--version",
			"-m",
			"install",
		]);
	});

	test("installation comes before extraction", async () => {
		const { store: graphStore, ran } = store({});

		await graphStore.refresh("/work/project");

		expect(ran.map((each) => each.args[0])).toEqual([
			"-m",
			"install",
			"extract",
		]);
	});

	test("two sessions starting together extract once", async () => {
		const { store: graphStore, ran } = store({ present: ["bin/graphify"] });

		await Promise.all([
			graphStore.refresh("/work/project"),
			graphStore.refresh("/work/project"),
		]);

		// graphify does not lock `graphify-out/`, so two extractions would
		// write the same tree at the same time.
		const extractions = ran.filter((each) => each.args[0] === "extract");
		expect(extractions).toHaveLength(1);
	});

	test("a failure to install says why", async () => {
		const { store: graphStore } = store({ fails: "graphifyy" });

		await expect(graphStore.install()).rejects.toThrow(/could not install/);
	});

	test("a failure to create the environment says why", async () => {
		const { store: graphStore } = store({ fails: "venv" });

		await expect(graphStore.install()).rejects.toThrow(
			/could not create a python environment/,
		);
	});
});

describe("keeping a codebase's graph current", () => {
	test("a codebase with no extraction is extracted, code only", async () => {
		const { store: graphStore, ran } = store({ present: ["bin/graphify"] });

		await graphStore.refresh("/work/project");

		// The version check, then the extraction: nothing else.
		expect(ran.map((each) => each.args[0])).toEqual(["--version", "extract"]);
		expect(ran[1]?.args).toEqual(["extract", "/work/project", "--code-only"]);
	});

	test("a codebase that already has one is extracted the same way", async () => {
		const { store: graphStore, ran } = store({
			present: ["bin/graphify", "graphify-out/graph.json"],
		});

		await graphStore.refresh("/work/project");

		// The same command either way: extraction is incremental, and
		// graphify's `update` drops --code-only, which would widen the
		// artifact in the user's repository to their documentation.
		expect(ran.at(-1)?.args).toEqual([
			"extract",
			"/work/project",
			"--code-only",
		]);
	});

	test("a failed extraction says which codebase and why", async () => {
		const { store: graphStore } = store({
			present: ["bin/graphify"],
			fails: "extract",
		});

		await expect(graphStore.refresh("/work/project")).rejects.toThrow(
			/graphify extract failed for \/work\/project/,
		);
	});
});

describe("reading a codebase's graph", () => {
	test("a codebase that has never been extracted has no graph", async () => {
		const { store: graphStore } = store({ present: ["bin/graphify"] });

		expect(await graphStore.graph("/work/project")).toBeUndefined();
	});

	test("an unchanged extraction is parsed once", async () => {
		let reads = 0;
		const graphStore = new GraphStore({
			home: "/home/test/.context-manager/graphify",
			exists: async () => true,
			changedAt: async () => 42,
			read: async () => {
				reads++;
				return FIXTURE;
			},
			makeDirectory: async () => {},
			run: async () => ({ ok: true, output: "" }),
		});

		await graphStore.graph("/work/project");
		await graphStore.graph("/work/project");

		// Parsing runs on the request path, and a real graph is tens of
		// megabytes.
		expect(reads).toBe(1);
	});

	test("a changed extraction is parsed again", async () => {
		let reads = 0;
		let at = 1;
		const graphStore = new GraphStore({
			home: "/home/test/.context-manager/graphify",
			exists: async () => true,
			changedAt: async () => at,
			read: async () => {
				reads++;
				return FIXTURE;
			},
			makeDirectory: async () => {},
			run: async () => ({ ok: true, output: "" }),
		});

		await graphStore.graph("/work/project");
		at = 2;
		await graphStore.graph("/work/project");

		expect(reads).toBe(2);
	});

	test("an extracted codebase yields its programmatic connections", async () => {
		const { store: graphStore } = store({
			present: ["bin/graphify", "graphify-out/graph.json"],
		});

		const graph = await graphStore.graph("/work/project");

		expect(graph?.edges.map((edge) => edge.relation)).toEqual([
			"calls",
			"calls",
		]);
	});

	test("an unreadable graph is reported once, not re-parsed every call", async () => {
		let reads = 0;
		const graphStore = new GraphStore({
			home: "/home/test/.context-manager/graphify",
			exists: async () => true,
			changedAt: async () => 7,
			read: async () => {
				reads++;
				return "{ not json";
			},
			makeDirectory: async () => {},
			run: async () => ({ ok: true, output: "" }),
		});

		await expect(graphStore.graph("/work/project")).rejects.toThrow(/not JSON/);
		await expect(graphStore.graph("/work/project")).rejects.toThrow(/not JSON/);

		expect(reads).toBe(1);
	});

	test("an unreadable graph is reported, not guessed at", async () => {
		const { store: graphStore } = store({
			present: ["bin/graphify", "graphify-out/graph.json"],
			graph: "{ not json",
		});

		await expect(graphStore.graph("/work/project")).rejects.toThrow(
			/not JSON/,
		);
	});
});
