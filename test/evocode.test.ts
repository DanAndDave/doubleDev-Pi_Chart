import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	admissionOf,
	admit,
	cutTask,
	type EvoRunSpec,
	fetchTasks,
	type HostChecks,
	preconditions,
	recordOf,
	roundsOf,
	type Subset,
} from "../scripts/evocode.ts";
import type { Call, KnownWindow, RunRecord } from "../scripts/measures.ts";

let scratch: string;
beforeEach(async () => {
	scratch = await mkdtemp(join(tmpdir(), "evocode-test-"));
});
afterEach(async () => {
	await rm(scratch, { recursive: true, force: true });
});

/** A `.tar.zst` laid out as the dataset's: one top folder holding a task folder. */
async function archive(): Promise<{ file: string; sha256: string }> {
	const task = join(scratch, "src", "evocodebench_wotraj", "theme_x");
	await mkdir(join(task, "steps", "round-1"), { recursive: true });
	await writeFile(join(task, "task.toml"), '[[steps]]\nname = "round-1"\n');
	await writeFile(join(task, "steps", "round-1", "instruction.md"), "Build it.\n");
	const file = join(scratch, "tasks.tar.zst");
	const tar = Bun.spawnSync(["tar", "--zstd", "-cf", file, "-C", join(scratch, "src"), "evocodebench_wotraj"]);
	if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
	return { file, sha256: new Bun.CryptoHasher("sha256").update(await readFile(file)).digest("hex") };
}

const subset = (sha256: string): Subset => ({
	dataset: "UnipatAI/EvoCodeBench",
	revision: "abc123",
	archive: "archives/tasks.tar.zst",
	sha256,
	licence: { name: "CC BY-NC 4.0", url: "https://creativecommons.org/licenses/by-nc/4.0/" },
	paper: "https://arxiv.org/abs/2605.24110",
	candidates: [{ task: "theme_x" }],
});

describe("fetchTasks", () => {
	test("an archive whose hash matches is extracted, and its task folders returned", async () => {
		const { file, sha256 } = await archive();
		const urls: string[] = [];
		const cacheRoot = join(scratch, "cache");

		const tasks = await fetchTasks(subset(sha256), {
			cacheRoot,
			download: async (url, to) => {
				urls.push(url);
				await copyFile(file, to);
			},
		});

		expect(urls).toEqual(["https://huggingface.co/datasets/UnipatAI/EvoCodeBench/resolve/abc123/archives/tasks.tar.zst"]);
		expect(tasks).toBe(join(cacheRoot, "abc123"));
		expect(await readFile(join(tasks, "theme_x", "steps", "round-1", "instruction.md"), "utf8")).toBe("Build it.\n");
	});

	test("a cached revision is reused without downloading", async () => {
		const { file, sha256 } = await archive();
		const cacheRoot = join(scratch, "cache");
		await fetchTasks(subset(sha256), { cacheRoot, download: (_, to) => copyFile(file, to) });

		const tasks = await fetchTasks(subset(sha256), {
			cacheRoot,
			download: () => Promise.reject(new Error("downloaded again")),
		});

		expect(existsSync(join(tasks, "theme_x", "task.toml"))).toBe(true);
	});

	test("a changed archive is refused, naming both hashes, and leaves nothing in the cache", async () => {
		const { file, sha256 } = await archive();
		const expected = "0".repeat(64);
		const cacheRoot = join(scratch, "cache");

		const fetching = fetchTasks(subset(expected), { cacheRoot, download: (_, to) => copyFile(file, to) });

		await expect(fetching).rejects.toThrow(expected);
		await expect(fetching).rejects.toThrow(sha256);
		expect(await readdir(cacheRoot)).toEqual([]);
	});
});

const REVISION = "9fcae3e5539d1c0e85e2481fe06bd6af42cc4bc6";
const SPEC: EvoRunSpec = { arm: "pi-chart", index: 0, omp: "omp/18.11.0", harbor: "0.24.0", revision: REVISION, piChart: "90d9bc5" };

/** A three-round task: `round-N/instruction.md` is "Round N.\n", the last one with no trailing newline. */
async function task(): Promise<{ id: string; dir: string }> {
	const dir = join(scratch, "theme_x");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "task.toml"), ["round-1", "round-2", "round-3"].map((name) => `[[steps]]\nname = "${name}"\n`).join("\n"));
	for (const [at, text] of ["Round 1.\n", "Round 2.\n", "Round 3."].entries()) {
		await mkdir(join(dir, "steps", `round-${at + 1}`), { recursive: true });
		await writeFile(join(dir, "steps", `round-${at + 1}`, "instruction.md"), text);
	}
	return { id: "theme_x", dir };
}

/**
 * A trial folder as Harbor 0.24.0 leaves one: `result.json` with a reward per
 * round, each round's verifier output, and the last round's snapshot of the
 * agent folder holding the Conversation's Journal and the turn markers.
 */
async function trial(rewards: number[], done: number[]): Promise<string> {
	const dir = join(scratch, "trial");
	const last = join(dir, "steps", `round-${rewards.length}`, "agent");
	const steps = rewards.map((reward, at) => ({
		step_name: `round-${at + 1}`,
		verifier_result: { rewards: { reward } },
		exception_info: null,
		verifier: { started_at: "2026-10-18T16:59:40.000000Z", finished_at: `2026-10-18T16:59:4${at + 1}.500000Z` },
	}));
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "result.json"), JSON.stringify({ step_results: steps }));
	for (const at of rewards.keys()) {
		await mkdir(join(dir, "steps", `round-${at + 1}`, "verifier"), { recursive: true });
		await writeFile(join(dir, "steps", `round-${at + 1}`, "verifier", "test-stdout.txt"), `${"x".repeat(3000)}round ${at + 1} tail`);
	}
	const session = join(last, "sessions", "-app-");
	await mkdir(join(session, "2026_s1"), { recursive: true });
	const lines = [
		{ type: "session", id: "s1", cwd: "/app" },
		{ type: "model_change", model: "claude-opus-5-5" },
	];
	await writeFile(join(session, "2026_s1.jsonl"), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
	await writeFile(join(session, "2026_s1", "Sub.jsonl"), `${JSON.stringify({ type: "session", id: "sub", cwd: "/app" })}\n`);
	await mkdir(join(last, "turns"), { recursive: true });
	for (const round of rewards.keys()) await writeFile(join(last, "turns", `${round + 1}.started`), "");
	for (const round of done) await writeFile(join(last, "turns", `${round}.done`), "");
	return dir;
}

describe("recordOf", () => {
	test("each round's reward is its Graded Task: 1 a Pass, anything else a Fail", async () => {
		const { record } = await recordOf(await trial([1, 0, 1], [1, 2, 3]), await task(), SPEC);

		expect(record.checks.map((check) => [check.step, check.pass, check.exitCode])).toEqual([
			["round-1", true, 0],
			["round-2", false, 1],
			["round-3", true, 0],
		]);
		expect(record.checks[1]?.durationMs).toBe(2500);
		expect(record.checks[2]?.output.endsWith("round 3 tail")).toBe(true);
		expect(record.checks[2]?.output.length).toBe(2048);
		expect(record.failedTurn).toBeUndefined();
	});

	test("a round with no .done is the failed Turn, and neither it nor any later round has an outcome", async () => {
		const { record } = await recordOf(await trial([1, 1, 1], [1, 2]), await task(), SPEC);

		expect(record.failedTurn).toBe(2);
		expect(record.checks.map((check) => check.step)).toEqual(["round-1", "round-2"]);
	});

	test("the prompts are the rounds' instruction files, byte for byte, in task order", async () => {
		const { record } = await recordOf(await trial([1, 1, 1], [1, 2, 3]), await task(), SPEC);

		expect(record.prompts).toEqual([
			{ step: "round-1", text: "Round 1.\n", probes: [] },
			{ step: "round-2", text: "Round 2.\n", probes: [] },
			{ step: "round-3", text: "Round 3.", probes: [] },
		]);
	});

	test("the record names the task as its Workload at the dataset revision, with no Plants or Revisits, and the Conversation from its Journal", async () => {
		const { record, journals } = await recordOf(await trial([1, 1, 1], [1, 2, 3]), await task(), SPEC);

		expect(record).toMatchObject({
			workload: { name: "evocode-theme_x", version: 1, commit: REVISION },
			cwd: "/app",
			sessionId: "s1",
			model: "claude-opus-5-5",
			plants: [],
			revisits: [],
		});
		expect(journals.main?.endsWith(join("round-3", "agent", "sessions", "-app-", "2026_s1.jsonl"))).toBe(true);
		expect(journals.subagents).toHaveLength(1);
	});
});

describe("cutTask", () => {
	/** A task whose `task.toml` has a preamble, and a sub-table under each step. */
	async function tableTask(trailer = ""): Promise<{ id: string; dir: string }> {
		const dir = join(scratch, "tasks", "theme_y");
		await mkdir(dir, { recursive: true });
		const steps = [1, 2, 3].map((n) => `[[steps]]\nname = "round-${n}"\n\n[steps.agent]\ntimeout_sec = ${n}00.0\n`);
		await writeFile(join(dir, "task.toml"), `version = "1.0"\n\n${steps.join("\n")}${trailer}`);
		return { id: "theme_y", dir };
	}

	test("a copy keeps the first rounds' steps with their own settings, and leaves the task untouched", async () => {
		const original = await tableTask();
		const cut = await cutTask(original, 2, join(scratch, "cut"));

		expect(await roundsOf(cut.dir)).toEqual(["round-1", "round-2"]);
		const config = Bun.TOML.parse(await readFile(join(cut.dir, "task.toml"), "utf8")) as { version: string; steps: { agent: { timeout_sec: number } }[] };
		expect(config.version).toBe("1.0");
		expect(config.steps.map((step) => step.agent.timeout_sec)).toEqual([100, 200]);
		expect(await roundsOf(original.dir)).toEqual(["round-1", "round-2", "round-3"]);
	});

	test("no round limit, or a limit of all the task's rounds, runs the task itself", async () => {
		const original = await tableTask();

		expect(await cutTask(original, undefined, join(scratch, "cut"))).toBe(original);
		expect(await cutTask(original, 3, join(scratch, "cut"))).toBe(original);
	});

	test("a table after the steps refuses the cut rather than dropping it", async () => {
		const original = await tableTask('\n[verifier]\ntimeout_sec = 60.0\n');

		await expect(cutTask(original, 2, join(scratch, "cut"))).rejects.toThrow("could not cut theme_y to 2 rounds");
	});
});

/** A main Call of `turn` whose tail carried `tail`; "unknown" when the record cannot say. */
function call(turn: number, tail: number[] | "unknown"): Call {
	const window: KnownWindow | "unknown" = tail === "unknown" ? "unknown" : { pins: [], tail: { turns: tail }, current: turn };
	return { turn, subagent: false, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, promptTokens: 0, floor: 0, window };
}

const completed = { checks: [] } as unknown as RunRecord;

describe("admissionOf", () => {
	test("a Call of Turn 3 that carried Turn 2 but not Turn 1 admits the task", () => {
		expect(admissionOf(completed, [call(0, []), call(1, [0]), call(2, [1])])).toBe("admitted");
	});

	test("a task whose every main Call carried every earlier Turn is left out", () => {
		expect(admissionOf(completed, [call(0, []), call(1, [0]), call(2, [0, 1])])).toBe("no eviction");
	});

	test("a task with no Turn-2-or-later Call whose window the record can say is unknown", () => {
		expect(admissionOf(completed, [call(0, []), call(1, "unknown"), call(2, "unknown")])).toBe("unknown");
		expect(admissionOf(completed, [call(1, [0]), call(2, "unknown")])).toBe("unknown");
	});

	test("a Run that did not complete names its failed Turn, whatever its windows", () => {
		const failed = { checks: [], failedTurn: 3 } as unknown as RunRecord;

		expect(admissionOf(failed, [call(2, [1])])).toBe("failed Turn 4");
	});
});

describe("admit", () => {
	const candidates = ["t1", "t2", "t3", "t4"];
	const admissionSubset = (): Subset => ({ ...subset("0".repeat(64)), candidates: candidates.map((task) => ({ task })) });

	/** A finished Run of `task`: 8 rounds, 6 Passes, every Call carrying every earlier Turn. */
	const finished = (task: string, cost: number) => ({
		record: {
			prompts: Array.from({ length: 8 }, (_, at) => ({ step: `round-${at + 1}`, text: "", probes: [] })),
			checks: Array.from({ length: 8 }, (_, at) => ({ step: `round-${at + 1}`, pass: at < 6 })),
		} as unknown as RunRecord,
		measures: { cost, passes: 6, calls: [call(1, [0])] },
		task,
	});

	test("the cap stops further admission Runs, and the subset file is rewritten after each one", async () => {
		// Runs 1 and 2 start together; Run 3 starts when Run 1 ends at $30, and Run 4
		// would start when Run 2 ends, but by then $61 is spent.
		const costs: Record<string, number> = { t1: 30, t2: 31, t3: 0 };
		const release: Record<string, () => void> = {};
		const started: string[] = [];
		const written: Subset[] = [];
		const admission = admit({
			subset: admissionSubset(),
			rounds: async () => 8,
			cap: 60,
			width: 2,
			write: async (file) => {
				written.push(structuredClone(file));
			},
			runTask: async (task) => {
				started.push(task);
				await new Promise<void>((resolve) => {
					release[task] = resolve;
				});
				return finished(task, costs[task] ?? 0);
			},
		});
		await Bun.sleep(0);
		release.t1?.();
		await Bun.sleep(0);
		release.t2?.();
		await Bun.sleep(0);
		release.t3?.();
		const result = await admission;

		expect(started).toEqual(["t1", "t2", "t3"]);
		expect(result.candidates).toEqual([
			{ task: "t1", status: "no eviction", rounds: 8, cost: 30, passes: 6 },
			{ task: "t2", status: "no eviction", rounds: 8, cost: 31, passes: 6 },
			{ task: "t3", status: "no eviction", rounds: 8, cost: 0, passes: 6 },
			{ task: "t4", status: "not run", rounds: 8 },
		]);
		expect(written.map((file) => file.candidates.filter((candidate) => candidate.status !== "not run").length)).toEqual([0, 1, 2, 3]);
	});

	test("a Run that throws is the failed Turn 1 of its candidate, and admission goes on", async () => {
		const result = await admit({
			subset: admissionSubset(),
			rounds: async () => 8,
			cap: 60,
			width: 2,
			write: async () => {},
			runTask: async (task) => {
				if (task === "t2") throw new Error("harbor run exited 1");
				return finished(task, 5);
			},
		});

		expect(result.candidates.map((candidate) => [candidate.task, candidate.status, candidate.cost])).toEqual([
			["t1", "no eviction", 5],
			["t2", "failed Turn 1", undefined],
			["t3", "no eviction", 5],
			["t4", "no eviction", 5],
		]);
	});
});

describe("preconditions", () => {
	const ready: HostChecks = {
		srcCommitted: () => true,
		harbor: async () => "0.24.0",
		docker: async () => undefined,
		server: () => "postgres://localhost:55432/postgres",
		zstd: () => true,
	};

	test.each([
		["a dirty tree", { srcCommitted: () => false }, "uncommitted changes under src/"],
		["no Harbor", { harbor: () => Promise.reject(new Error("uvx: not found")) }, "Harbor cannot run: uvx: not found"],
		["no Docker", { docker: () => Promise.reject(new Error("daemon down")) }, "Docker cannot run: daemon down"],
		["no server", { server: () => undefined }, "no Thread Store server"],
		["no zstd", { zstd: () => false }, "zstd is not on PATH"],
	] as [string, Partial<HostChecks>, string][])("%s is refused before any Run", async (_, broken, message) => {
		await expect(preconditions({ ...ready, ...broken })).rejects.toThrow(message);
	});
});
