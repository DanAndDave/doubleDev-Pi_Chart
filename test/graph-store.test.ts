import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { readExtraction, type Loaded } from "../src/graph-load.ts";
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
			if (path.endsWith("outcome.json") && options.outcome) {
				return JSON.stringify(options.outcome);
			}
			throw new Error("ENOENT");
		},
		load: async (_path, skip) => readExtraction(options.graph ?? FIXTURE, skip),
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

/**
 * A Graph Store whose reads of the extraction are held until the test
 * finishes them, so what a Call is served while a read runs is visible.
 */
function loading() {
	const clock: { at: number | undefined } = { at: 1 };
	interface Held {
		finish: (text: string) => void;
		crash: (error: Error) => void;
	}
	const loads: Held[] = [];
	const waiting: { index: number; resolve: (held: Held) => void }[] = [];
	const graphStore = new GraphStore({
		home: "/home/test/.pi-chart/graphify",
		exists: async () => true,
		changedAt: async () => clock.at,
		load: (_path, skip) => {
			const { promise, resolve, reject } = Promise.withResolvers<Loaded>();
			const held = {
				finish: (text: string) => resolve(readExtraction(text, skip)),
				crash: reject,
			};
			loads.push(held);
			for (const each of waiting.filter((one) => one.index === loads.length - 1)) {
				each.resolve(held);
			}
			return promise;
		},
		makeDirectory: async () => {},
		run: async () => ({ ok: true, output: "" }),
	});
	/** The read at this index, once the Store has asked for it. */
	function started(index: number): Promise<Held> {
		const held = loads[index];
		if (held) return Promise.resolve(held);
		const { promise, resolve } = Promise.withResolvers<Held>();
		waiting.push({ index, resolve });
		return promise;
	}
	return { graphStore, loads, started, clock };
}

/** Lets a finished read be taken in before the next Call. */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The same graph with different text, so it hashes as a newer extraction. */
const REWRITTEN = `${FIXTURE}\n`;

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

	test("the indexes are built with the read, not per call", async () => {
		const { store: graphStore } = store({
			present: ["bin/graphify", "graphify-out/graph.json"],
			changedAt: () => 42,
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

	test("a call before any graph is read waits for the first read", async () => {
		const { graphStore, loads, started } = loading();

		let answered = false;
		const first = graphStore.graph("/work/project").finally(() => {
			answered = true;
		});
		const second = graphStore.graph("/work/project");
		const read = await started(0);
		await settled();

		expect(answered).toBe(false);
		read.finish(FIXTURE);
		expect((await first)?.extractedAt).toBe(1);
		expect(await second).toBe(await first);
		// Two Calls arriving together still read the file once.
		expect(loads.length).toBe(1);
	});

	/** A Store that has read the fixture once, as at time 1. */
	async function readOnce() {
		const held = loading();
		const reading = held.graphStore.graph("/work/project");
		(await held.started(0)).finish(FIXTURE);
		return { ...held, older: await reading };
	}

	test("an unchanged extraction is read once", async () => {
		const { graphStore, loads } = await readOnce();

		await graphStore.graph("/work/project");
		await graphStore.graph("/work/project");

		expect(loads.length).toBe(1);
	});

	test("a call while a newer extraction is read is served the graph already read", async () => {
		const { graphStore, loads, started, clock, older } = await readOnce();

		clock.at = 2;
		// Answered while the newer read is still held: nothing waits on it.
		expect(await graphStore.graph("/work/project")).toBe(older);
		expect(loads.length).toBe(2);

		(await started(1)).finish(REWRITTEN);
		await settled();
		const newer = await graphStore.graph("/work/project");

		expect(newer).not.toBe(older);
		expect(newer?.extractedAt).toBe(2);
	});

	test("calls that find the same change share one read of it", async () => {
		const { graphStore, loads, clock } = await readOnce();

		clock.at = 2;
		await Promise.all([
			graphStore.graph("/work/project"),
			graphStore.graph("/work/project"),
			graphStore.graph("/work/project"),
		]);

		expect(loads.length).toBe(2);
	});

	test("a change made during a read is read by the next call, after it", async () => {
		const { graphStore, loads, started, clock } = await readOnce();

		clock.at = 2;
		await graphStore.graph("/work/project");
		clock.at = 3;
		await graphStore.graph("/work/project");
		// One read at a time: the second change waits for the first read.
		expect(loads.length).toBe(2);

		(await started(1)).finish(REWRITTEN);
		await settled();
		await graphStore.graph("/work/project");
		expect(loads.length).toBe(3);

		(await started(2)).finish(`${REWRITTEN}\n`);
		await settled();
		expect((await graphStore.graph("/work/project"))?.extractedAt).toBe(3);
	});

	test("a rewrite with the same content keeps the graph, as recent as the rewrite", async () => {
		const { graphStore, started, clock, older } = await readOnce();

		clock.at = 5;
		await graphStore.graph("/work/project");
		(await started(1)).finish(FIXTURE);
		await settled();
		const again = await graphStore.graph("/work/project");

		// Not indexed again: the indexes are the ones already built.
		expect(again?.byName).toBe(older?.byName);
		expect(again?.incident).toBe(older?.incident);
		// Files edited before the rewrite are no longer outgrown by it.
		expect(again?.extractedAt).toBe(5);
	});

	test("an unreadable graph with none read before is reported, and not read again", async () => {
		const { graphStore, loads, started } = loading();
		const reading = graphStore.graph("/work/project");
		(await started(0)).finish("{ not json");

		await expect(reading).rejects.toThrow(/not JSON/);
		await expect(graphStore.graph("/work/project")).rejects.toThrow(/not JSON/);
		expect(loads.length).toBe(1);
	});

	test("a reader that crashed is a failure, and the next change reads again", async () => {
		const { graphStore, loads, started, clock } = loading();
		const reading = graphStore.graph("/work/project");
		(await started(0)).crash(new Error("graph reader exited (code 1) without answering"));

		await expect(reading).rejects.toThrow(/without answering/);
		await expect(graphStore.graph("/work/project")).rejects.toThrow(/without answering/);
		expect(loads.length).toBe(1);

		clock.at = 2;
		const retried = graphStore.graph("/work/project");
		(await started(1)).finish(FIXTURE);
		expect((await retried)?.extractedAt).toBe(2);
	});

	test("a newer extraction that cannot be read leaves the graph in use, reported once", async () => {
		const { graphStore, loads, started, clock, older } = await readOnce();
		expect(graphStore.takeLoadFailure("/work/project")).toBeUndefined();

		clock.at = 2;
		await graphStore.graph("/work/project");
		(await started(1)).finish("{ not json");
		await settled();

		expect(await graphStore.graph("/work/project")).toBe(older);
		expect(graphStore.takeLoadFailure("/work/project")?.message).toMatch(/not JSON/);
		expect(graphStore.takeLoadFailure("/work/project")).toBeUndefined();
		// Not read again while it is unchanged.
		await graphStore.graph("/work/project");
		expect(loads.length).toBe(2);

		// Rewritten with the same broken content: not reported a second time.
		clock.at = 3;
		await graphStore.graph("/work/project");
		(await started(2)).finish("{ not json");
		await settled();
		expect(await graphStore.graph("/work/project")).toBe(older);
		expect(graphStore.takeLoadFailure("/work/project")).toBeUndefined();

		// Changed again, and readable this time.
		clock.at = 4;
		await graphStore.graph("/work/project");
		(await started(3)).finish(REWRITTEN);
		await settled();
		const newer = await graphStore.graph("/work/project");
		expect(newer).not.toBe(older);
		expect(newer?.extractedAt).toBe(4);
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
