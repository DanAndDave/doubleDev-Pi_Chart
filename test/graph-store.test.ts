import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
	GraphStore,
	type Outcome,
	PINNED_GRAPHIFY,
	RUNNER,
	type Spawned,
} from "../src/graph-store.ts";
import type { CommandResult } from "../src/process.ts";

const FIXTURE = readFileSync(
	new URL("./fixtures/graph.json", import.meta.url).pathname,
	"utf8",
);

interface Recorded {
	command: string;
	args: string[];
	timeoutMs?: number;
	/** Launched detached rather than run and waited on. */
	launched?: boolean;
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
	/** When each launched runner exits; by default, at once. */
	exited?: Promise<unknown>;
	extractDeadlineMs?: number;
	/** The last run's outcome, as the runner would have left it. */
	outcome?: Outcome;
	/** What successive status checks say about the lock; then, not held. */
	held?: boolean[];
	/** Whether the Codebase's run state exists yet. */
	stateExists?: boolean;
	/** When graphify's installation finishes; by default, at once. */
	installed?: Promise<void>;
}): { store: GraphStore; ran: Recorded[]; paused: number[] } {
	const ran: Recorded[] = [];
	const paused: number[] = [];
	const held = [...(options.held ?? [])];
	const claimed = new Set<string>();
	const present = new Set(options.present ?? []);
	const extracted = [...present].some((each) => each.endsWith("graph.json"));
	const graphStore = new GraphStore({
		home: "/home/test/.pi-chart/graphify",
		exists: async (path) =>
			path.includes("/runs/")
				? (options.stateExists ?? true)
				: [...present].some((each) => path.endsWith(each)),
		changedAt: async () =>
			options.changedAt ? options.changedAt() : extracted ? 1 : undefined,
		read: async (path) => {
			if (path.endsWith("outcome.json")) {
				if (!options.outcome) throw new Error("ENOENT");
				return JSON.stringify(options.outcome);
			}
			return options.graph ?? FIXTURE;
		},
		makeDirectory: async () => {},
		write: async () => {},
		claim: async (path) => {
			if (claimed.has(path)) return false;
			claimed.add(path);
			return true;
		},
		launch: async (command, args): Promise<Spawned> => {
			ran.push({ command, args, launched: true });
			return { exited: options.exited ?? Promise.resolve(0) };
		},
		pause: async (ms) => {
			paused.push(ms);
		},
		extractDeadlineMs: options.extractDeadlineMs,
		run: async (command, args, _cwd, timeoutMs): Promise<CommandResult> => {
			ran.push({ command, args, timeoutMs });
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
			if (args[1] === "status") {
				const running = held.shift() ? { since: 5 } : null;
				return { ok: true, output: JSON.stringify({ running, last: options.outcome ?? null }) };
			}
			if (args.includes("install")) await options.installed;
			return { ok: true, output: "" };
		},
	});
	return { store: graphStore, ran, paused };
}

/** What a launched runner was told to do, by argument name. */
function runnerArgs(each: Recorded | undefined): Record<string, string | undefined> {
	const args = each?.args ?? [];
	const after = (flag: string) => args[args.indexOf(flag) + 1];
	return {
		script: args[0],
		command: args[1],
		codebase: after("--codebase"),
		graphify: after("--graphify"),
		deadline: after("--deadline-ms"),
	};
}

describe("obtaining graphify", () => {
	test("installs it at the pinned version when the machine lacks it", async () => {
		const { store: graphStore, ran } = store({});

		await graphStore.install();

		expect(ran[0]?.command).toBe("python3");
		expect(ran[0]?.args).toEqual([
			"-m",
			"venv",
			"/home/test/.pi-chart/graphify",
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

		expect(
			ran.map((each) => (each.launched ? "launch" : each.args[0])).slice(0, 3),
		).toEqual(["-m", "install", "launch"]);
	});

	test("two refreshes asked for together launch one runner", async () => {
		const { store: graphStore, ran } = store({ present: ["bin/graphify"] });

		await Promise.all([
			graphStore.refresh("/work/project"),
			graphStore.refresh("/work/project"),
		]);

		expect(ran.filter((each) => each.launched)).toHaveLength(1);
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
	test("a refresh returns once its runner is launched, not when the run ends", async () => {
		const { promise: never } = Promise.withResolvers<unknown>();
		const { store: graphStore } = store({ present: ["bin/graphify"], exited: never });

		// An extraction may take longer than the session that asked for it.
		const launch = await graphStore.refresh("/work/project");
		const settled = await Promise.race([
			launch.finished.then(() => "finished"),
			Promise.resolve("pending"),
		]);

		expect(settled).toBe("pending");
	});

	test("the request is written before the runner is launched", async () => {
		const order: string[] = [];
		const graphStore = new GraphStore({
			home: "/home/test/.pi-chart/graphify",
			exists: async () => true,
			makeDirectory: async () => {},
			run: async () => ({ ok: true, output: `graphify ${PINNED_GRAPHIFY}` }),
			write: async (path) => {
				order.push(path.split("/").pop() ?? "");
			},
			launch: async () => {
				order.push("launch");
				return { exited: Promise.resolve(0) };
			},
		});

		await graphStore.refresh("/work/project");

		// A runner already holding the Codebase sees the request and runs
		// once more, which is how an edit made mid-run reaches the graph.
		expect(order).toEqual(["requested", "launch"]);
	});

	test("the runner is told the codebase, the pinned graphify and the deadline", async () => {
		const { store: graphStore, ran } = store({
			present: ["bin/graphify"],
			extractDeadlineMs: 90_000,
		});

		await graphStore.refresh("/work/project");

		const launched = ran.find((each) => each.launched);
		expect(launched?.command).toBe("/home/test/.pi-chart/graphify/bin/python");
		expect(runnerArgs(launched)).toEqual({
			script: RUNNER,
			command: "run",
			codebase: "/work/project",
			graphify: "/home/test/.pi-chart/graphify/bin/graphify",
			deadline: "90000",
		});
	});

	test("a refresh served by another runner's run finishes when that run does", async () => {
		// This refresh's runner found the Codebase held and exited at once;
		// the holder picks the request up, and its end is what was asked for.
		const { store: graphStore, paused } = store({
			present: ["bin/graphify"],
			held: [true, true, false],
		});

		const launch = await graphStore.refresh("/work/project");
		await launch.finished;

		expect(paused).toHaveLength(2);
	});

	test("a refresh still installing graphify counts as an extraction running", async () => {
		const installed = Promise.withResolvers<void>();
		const { store: graphStore } = store({
			stateExists: false,
			installed: installed.promise,
		});

		const refreshing = graphStore.refresh("/work/project");
		const during = await graphStore.extraction("/work/project");
		installed.resolve();
		await refreshing;
		const after = await graphStore.extraction("/work/project");

		// Otherwise the first session on a fresh machine is told to switch
		// on an extraction that is minutes into its install.
		expect(during.running).toBeDefined();
		expect(after.running).toBeUndefined();
	});

	test("a refresh that cannot install graphify fails, and launches nothing", async () => {
		const { store: graphStore, ran } = store({ fails: "graphifyy" });

		await expect(graphStore.refresh("/work/project")).rejects.toThrow(/could not install/);
		expect(ran.some((each) => each.launched)).toBe(false);
	});

	test("every program it waits on is bounded", async () => {
		const { store: graphStore, ran } = store({});

		await (await graphStore.refresh("/work/project")).finished;

		// Installing, and asking the runner whether its run is over, are
		// waited on, so a hang there would hang the session; the runner is
		// not, and holds the extraction to its own deadline.
		const waited = ran.filter((each) => !each.launched);
		expect(waited.map((each) => each.args[1] ?? each.args[0])).toEqual([
			"venv",
			"--quiet",
			"status",
		]);
		for (const each of waited) expect(each.timeoutMs).toBeGreaterThan(0);
	});
});

describe("how the last extraction ended", () => {
	const base: Outcome = {
		runId: "r1",
		startedAt: 1,
		endedAt: 2,
		exitCode: 0,
		output: "",
	};

	test("a run graphify refused for size names the size, the cap and both ways out", async () => {
		const { store: graphStore } = store({
			outcome: {
				...base,
				exitCode: 1,
				output:
					"Traceback ...\nValueError: graph file /x/graphify-out/graph.json is " +
					"544_123_456 bytes, exceeds 536_870_912-byte cap\n(set GRAPHIFY_MAX_GRAPH_BYTES=...)",
			},
		});

		const failure = await graphStore.takeFailure("/work/project");

		expect(failure?.kind).toBe("size-cap");
		expect(failure?.message).toContain("544 MB");
		expect(failure?.message).toContain("537 MB");
		expect(failure?.message).toContain("GRAPHIFY_MAX_GRAPH_BYTES");
		expect(failure?.message).toContain(".graphifyignore");
	});

	test("a run stopped at the deadline names the deadline, its setting and what it printed", async () => {
		const { store: graphStore } = store({
			outcome: {
				...base,
				exitCode: -15,
				stopped: "deadline",
				deadlineMs: 3_600_000,
				output: "[graphify] AST extraction: 12000/15543 files",
			},
		});

		const failure = await graphStore.takeFailure("/work/project");

		expect(failure?.kind).toBe("deadline");
		expect(failure?.message).toContain("60 min");
		expect(failure?.message).toContain("PICHART_GRAPH_EXTRACT_DEADLINE_MS");
		expect(failure?.message).toContain("12000/15543 files");
	});

	test("a deadline under a minute is named in seconds, not as 0 min", async () => {
		const { store: graphStore } = store({
			outcome: { ...base, exitCode: -15, stopped: "deadline", deadlineMs: 20_000 },
		});

		expect((await graphStore.takeFailure("/work/project"))?.message).toContain("20 s");
	});

	test("any other failed run says which codebase and what graphify printed", async () => {
		const { store: graphStore } = store({
			outcome: { ...base, exitCode: 2, output: "tree-sitter exploded" },
		});

		const failure = await graphStore.takeFailure("/work/project");

		expect(failure?.kind).toBe("failed");
		expect(failure?.message).toMatch(/graphify extract failed for \/work\/project/);
		expect(failure?.message).toContain("tree-sitter exploded");
	});

	test("a failure is handed out once, however many sessions ask", async () => {
		const { store: graphStore } = store({
			outcome: { ...base, exitCode: 2, output: "tree-sitter exploded" },
		});

		const first = await graphStore.takeFailure("/work/project");
		const again = await graphStore.takeFailure("/work/project");

		expect(first).toBeDefined();
		expect(again).toBeUndefined();
	});

	test("a run that succeeded, or none at all, is no failure", async () => {
		expect(await store({ outcome: base }).store.takeFailure("/work/project")).toBeUndefined();
		expect(await store({}).store.takeFailure("/work/project")).toBeUndefined();
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
			home: "/home/test/.pi-chart/graphify",
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
			home: "/home/test/.pi-chart/graphify",
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
			home: "/home/test/.pi-chart/graphify",
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
	test("the indexes are built with the parse, not per call", async () => {
		const graphStore = new GraphStore({
			home: "/home/test/.pi-chart/graphify",
			exists: async () => true,
			changedAt: async () => 42,
			read: async () => FIXTURE,
			makeDirectory: async () => {},
			run: async () => ({ ok: true, output: "" }),
		});

		const first = await graphStore.graph("/work/project");
		const again = await graphStore.graph("/work/project");

		// The same prepared graph, indexes and all: `symbolsInPlay` and
		// `neighbourhoods` walked every symbol and every edge per Call
		// while the parse they read was already cached.
		expect(again).toBe(first);
		expect(first?.byName.size).toBeGreaterThan(0);
		expect(first?.incident.size).toBeGreaterThan(0);
		expect(first?.extractedAt).toBe(42);
	});

	test("a changed extraction invalidates the indexes with the parse", async () => {
		let at = 1;
		const graphStore = new GraphStore({
			home: "/home/test/.pi-chart/graphify",
			exists: async () => true,
			changedAt: async () => at,
			read: async () => FIXTURE,
			makeDirectory: async () => {},
			run: async () => ({ ok: true, output: "" }),
		});

		const first = await graphStore.graph("/work/project");
		at = 2;
		const again = await graphStore.graph("/work/project");

		expect(again).not.toBe(first);
		expect(again?.extractedAt).toBe(2);
	});
});

describe("how old the structure is", () => {
	/** A Store whose files have the ages a test gives them. */
	function aged(ages: Record<string, number | undefined>): GraphStore {
		return new GraphStore({
			home: "/home/test/.pi-chart/graphify",
			exists: async () => true,
			changedAt: async (path) => {
				for (const [file, at] of Object.entries(ages)) {
					if (path.endsWith(file)) return at;
				}
				return undefined;
			},
			read: async () => FIXTURE,
			makeDirectory: async () => {},
			run: async () => ({ ok: true, output: "" }),
		});
	}

	test("a file edited since the extraction is older than the codebase", async () => {
		const store = aged({ "src/assembler.ts": 20, "src/extension.ts": 5 });

		const older = await store.changedSince("/work/project", 10, [
			"src/assembler.ts",
			"src/extension.ts",
		]);

		expect([...older]).toEqual(["src/assembler.ts"]);
	});

	test("a file that cannot be examined counts as older, not as current", async () => {
		// An invariant that cannot be checked is not a verified invariant.
		const store = aged({ "src/extension.ts": 5 });

		const older = await store.changedSince("/work/project", 10, [
			"src/vanished.ts",
		]);

		expect([...older]).toEqual(["src/vanished.ts"]);
	});

	test("each file is examined once however many symbols name it", async () => {
		let examined = 0;
		const store = new GraphStore({
			home: "/home/test/.pi-chart/graphify",
			exists: async () => true,
			changedAt: async () => {
				examined++;
				return 5;
			},
			read: async () => FIXTURE,
			makeDirectory: async () => {},
			run: async () => ({ ok: true, output: "" }),
		});

		await store.changedSince("/work/project", 10, [
			"src/assembler.ts",
			"src/assembler.ts",
			"src/assembler.ts",
		]);

		expect(examined).toBe(1);
	});
});
