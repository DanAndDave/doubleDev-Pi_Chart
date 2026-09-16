import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
	GraphStore,
	PINNED_GRAPHIFY,
	type CommandResult,
} from "../src/graph-store.ts";

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
}): { store: GraphStore; ran: Recorded[] } {
	const ran: Recorded[] = [];
	const present = new Set(options.present ?? []);
	const graphStore = new GraphStore({
		home: "/home/test/.context-manager/graphify",
		exists: async (path) =>
			[...present].some((each) => path.endsWith(each)),
		read: async () => options.graph ?? FIXTURE,
		makeDirectory: async () => {},
		run: async (command, args): Promise<CommandResult> => {
			ran.push({ command, args });
			const failing = options.fails;
			if (failing && `${command} ${args.join(" ")}`.includes(failing)) {
				return { ok: false, output: `${failing} exploded` };
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

	test("installs nothing when it is already there", async () => {
		const { store: graphStore, ran } = store({ present: ["bin/graphify"] });

		await graphStore.install();

		expect(ran).toEqual([]);
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

		expect(ran).toHaveLength(1);
		expect(ran[0]?.args).toEqual(["extract", "/work/project", "--code-only"]);
	});

	test("a codebase that already has one is refreshed, not rebuilt", async () => {
		const { store: graphStore, ran } = store({
			present: ["bin/graphify", "graphify-out/graph.json"],
		});

		await graphStore.refresh("/work/project");

		// Refreshing re-extracts only what changed; extracting again would
		// pay for the whole corpus.
		expect(ran[0]?.args).toEqual(["update", "/work/project"]);
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
