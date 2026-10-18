/**
 * EvoCode-Bench Runs: one task of the pinned dataset on one Arm, through
 * Harbor, in the task's own container, leaving the same record a Workload
 * Run leaves (`scripts/runs.ts`), so `scripts/measures.ts` reads it unchanged.
 *
 * The dataset is CC BY-NC 4.0: its tasks are fetched at run time from the
 * revision `bench/evocode/subset.json` pins, checked against the hash it
 * names, and cached outside the repository. Nothing taken from it, task or
 * Run record, is committed.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { readSavedUrl } from "../src/config.ts";
import { readCalibration } from "./calibration.ts";
import { type Call, type CheckOutcome, measureRun, type RunMeasures, type RunRecord } from "./measures.ts";
import {
	type Arm,
	ARMS,
	copyJournals,
	createDatabase,
	dropDatabase,
	exportAccounting,
	flagsOf,
	headerOf,
	journalsIn,
	log,
	srcIsCommitted,
} from "./runs.ts";
import { runCapped } from "./sweep.ts";
import { REPO, run } from "./workload.ts";

/** `bench/evocode/subset.json`: the pinned dataset, and the candidates admission runs. */
export interface Subset {
	dataset: string;
	revision: string;
	/** The task archive's path in the dataset. */
	archive: string;
	sha256: string;
	licence: { name: string; url: string };
	paper: string;
	candidates: Candidate[];
}

/**
 * What admission found for a task: `admitted` when its Run completed every
 * round and some main Call's window left out an earlier Turn; `no eviction`
 * when every such window carried every earlier Turn; `unknown` when no Call
 * that could show an Eviction has a window the record can say; the failed
 * Turn, counted from 1, when the Run did not complete; `not run` when the
 * cap was reached first.
 */
export type Status = "admitted" | "no eviction" | "unknown" | "not run" | `failed Turn ${number}`;

export interface Candidate {
	task: string;
	status?: Status;
	/** The task's round count. */
	rounds?: number;
	/** The admission Run's cost, USD; absent when it did not run. */
	cost?: number;
	/** The admission Run's Passes; absent when it did not run. */
	passes?: number;
}

export const SUBSET_FILE = join(REPO, "bench", "evocode", "subset.json");
export const CACHE_ROOT = join(homedir(), ".cache", "pi-chart", "evocode");

/** Where the cache records the hash of the archive a revision's tasks came from. */
const HASH_FILE = ".sha256";

/** Saves the file at `url` to `to`. */
export type Download = (url: string, to: string) => Promise<void>;

export const download: Download = async (url, to) => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	await Bun.write(to, response);
};

/**
 * The folder holding the task folders of `subset`'s revision, fetched into
 * `<cacheRoot>/<revision>/` unless already there from the same archive. The
 * archive is hashed before it is extracted, and extracted through a temporary
 * folder renamed into place, so a refused or broken download leaves nothing.
 */
export async function fetchTasks(subset: Subset, io: { download: Download; cacheRoot: string }): Promise<string> {
	const tasks = join(io.cacheRoot, subset.revision);
	const cached = Bun.file(join(tasks, HASH_FILE));
	if ((await cached.exists()) && (await cached.text()).trim() === subset.sha256) return tasks;

	await mkdir(io.cacheRoot, { recursive: true });
	const temp = await mkdtemp(join(io.cacheRoot, `.${subset.revision}-`));
	try {
		const file = join(temp, "archive.tar.zst");
		await io.download(`https://huggingface.co/datasets/${subset.dataset}/resolve/${subset.revision}/${subset.archive}`, file);
		const hasher = new Bun.CryptoHasher("sha256");
		for await (const chunk of Bun.file(file).stream()) hasher.update(chunk);
		const actual = hasher.digest("hex");
		if (actual !== subset.sha256) {
			throw new Error(`${subset.archive} at ${subset.revision} has SHA-256 ${actual}, but subset.json names ${subset.sha256}`);
		}
		const extracted = join(temp, "tasks");
		await mkdir(extracted);
		// The archive holds one top folder; its children are the task folders.
		const tar = Bun.spawn(["tar", "--zstd", "-xf", file, "-C", extracted, "--strip-components=1"], { stderr: "pipe" });
		if ((await tar.exited) !== 0) throw new Error(`could not extract ${subset.archive}: ${await new Response(tar.stderr).text()}`);
		await writeFile(join(extracted, HASH_FILE), `${actual}\n`);
		if (existsSync(tasks)) await rm(tasks, { recursive: true, force: true });
		await rename(extracted, tasks);
		return tasks;
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------- record --

/** A task folder Harbor runs: the cached one, or a copy cut to fewer rounds. */
export interface EvoTask {
	id: string;
	dir: string;
}

/** What a record says about its Run that the trial does not. */
export interface EvoRunSpec {
	arm: Arm;
	index: number;
	/** `omp --version`. */
	omp: string;
	/** `harbor --version`. */
	harbor: string;
	/** The dataset revision the task came from. */
	revision: string;
	thinking?: string;
	/** The pi-chart commit a pi-chart Run loaded. */
	piChart?: string;
}

/** The task's rounds, in `task.toml` order. */
export async function roundsOf(dir: string): Promise<string[]> {
	const config = Bun.TOML.parse(await readFile(join(dir, "task.toml"), "utf8")) as { steps?: { name: string }[] };
	return (config.steps ?? []).map((step) => step.name);
}

/** The parts of Harbor 0.24.0's trial `result.json` a record reads. */
interface TrialResult {
	step_results?: {
		step_name: string;
		verifier_result?: { rewards?: Record<string, number> } | null;
		verifier?: { started_at?: string; finished_at?: string } | null;
	}[];
}

/**
 * The Run record of the Harbor trial in `trialDir`, which ran `task`, and
 * where its Journals are. Each round is one prompt, its text the round's
 * `instruction.md` as published; each round before the failed Turn is one
 * check outcome, a Pass when its reward is 1. The failed Turn is the first
 * round the agent did not mark done (`scripts/harbor/omp_agent.py`), and the
 * Journals are in the last round's snapshot of the agent folder, which
 * Harbor kept across rounds.
 */
export async function recordOf(
	trialDir: string,
	task: EvoTask,
	spec: EvoRunSpec,
): Promise<{ record: RunRecord; journals: { main?: string; subagents: string[] } }> {
	const rounds = await roundsOf(task.dir);
	const result = JSON.parse(await readFile(join(trialDir, "result.json"), "utf8")) as TrialResult;
	const steps = result.step_results ?? [];
	const agent = join(trialDir, "steps", steps.at(-1)?.step_name ?? rounds[0] ?? "", "agent");

	const done = new Set(await readdir(join(agent, "turns")).catch(() => [] as string[]));
	const failed = rounds.findIndex((_, at) => !done.has(`${at + 1}.done`));

	const checks: CheckOutcome[] = [];
	for (const step of rounds.slice(0, failed === -1 ? rounds.length : failed)) {
		const outcome = steps.find((candidate) => candidate.step_name === step);
		const pass = outcome?.verifier_result?.rewards?.reward === 1;
		const { started_at, finished_at } = outcome?.verifier ?? {};
		const stdout = await readFile(join(trialDir, "steps", step, "verifier", "test-stdout.txt"), "utf8").catch(() => "");
		checks.push({
			step,
			pass,
			// Harbor reports a reward, not an exit code.
			exitCode: pass ? 0 : 1,
			durationMs: started_at && finished_at ? Date.parse(finished_at) - Date.parse(started_at) : 0,
			output: stdout.slice(-2048),
		});
	}

	// The container's working directory: only the Conversation's Journal names it.
	const sessions = join(agent, "sessions");
	let cwd = "";
	for (const folder of await readdir(sessions).catch(() => [] as string[])) {
		for (const file of await readdir(join(sessions, folder)).catch(() => [] as string[])) {
			if (file.endsWith(".jsonl")) cwd = (await headerOf(join(sessions, folder, file))).cwd ?? cwd;
		}
	}
	const journals = cwd ? await journalsIn(sessions, cwd) : { subagents: [] };
	const header = journals.main ? await headerOf(journals.main) : {};

	const record: RunRecord = {
		arm: spec.arm,
		index: spec.index,
		workload: { name: `evocode-${task.id}`, version: 1, commit: spec.revision },
		omp: spec.omp,
		harbor: spec.harbor,
		cwd,
		plants: [],
		revisits: [],
		...(spec.thinking ? { thinking: spec.thinking } : {}),
		...(spec.arm === "pi-chart" && spec.piChart ? { piChart: spec.piChart } : {}),
		...(header.id ? { sessionId: header.id } : {}),
		...(header.model ? { model: header.model } : {}),
		prompts: await Promise.all(
			rounds.map(async (step) => ({ step, text: await readFile(join(task.dir, "steps", step, "instruction.md"), "utf8"), probes: [] })),
		),
		checks,
		...(failed === -1 ? {} : { failedTurn: failed }),
	};
	return { record, journals };
}

// ------------------------------------------------------------- admission --

/**
 * What admission finds for a task from its Run's record and main Calls. A
 * Call evicted when its window left out a Turn before its own; only Calls of
 * Turn 2 and later can.
 */
export function admissionOf(record: RunRecord, calls: Call[]): Status {
	if (record.failedTurn !== undefined) return `failed Turn ${record.failedTurn + 1}`;
	const later = calls.filter((call) => !call.subagent && call.turn > 0);
	const known = later.flatMap(({ turn, window }) => (window === undefined || window === "unknown" ? [] : [{ turn, carried: new Set(window.tail.turns) }]));
	if (known.some(({ turn, carried }) => Array.from({ length: turn }, (_, earlier) => earlier).some((earlier) => !carried.has(earlier)))) {
		return "admitted";
	}
	return later.length > 0 && known.length === later.length ? "no eviction" : "unknown";
}

/** A finished admission Run, as `admit` reads it. */
export interface AdmissionRun {
	record: RunRecord;
	measures: Pick<RunMeasures, "cost" | "passes" | "calls">;
}

/**
 * Runs each candidate of `subset` once, in order, `width` at a time, until
 * `cap` USD is spent, and gives the subset with each candidate's status,
 * rounds, cost and Passes. `write` gets the subset after each Run, so an
 * admission that stops keeps what finished.
 */
export async function admit(input: {
	subset: Subset;
	rounds: (task: string) => Promise<number>;
	runTask: (task: string) => Promise<AdmissionRun>;
	write: (subset: Subset) => Promise<void>;
	cap: number;
	width: number;
}): Promise<Subset> {
	const { subset } = input;
	const candidates: Candidate[] = await Promise.all(
		subset.candidates.map(async ({ task }) => ({ task, status: "not run" as Status, rounds: await input.rounds(task) })),
	);
	const result: Subset = { ...subset, candidates };
	await input.write(result);
	// One write at a time, in the order Runs finish.
	let writing = Promise.resolve();
	await runCapped({
		width: input.width,
		cap: input.cap,
		jobs: candidates.map((candidate, at) => async () => {
			const { record, measures } = await input.runTask(candidate.task);
			candidates[at] = {
				task: candidate.task,
				status: admissionOf(record, measures.calls),
				rounds: candidate.rounds,
				cost: measures.cost,
				passes: measures.passes,
			};
			writing = writing.then(() => input.write(result));
			await writing;
			return { cost: measures.cost };
		}),
	});
	return result;
}

/** One line per candidate. */
export function admissionReport(subset: Subset): string {
	return subset.candidates
		.map(({ task, status, rounds, cost, passes }) => {
			const run = cost === undefined ? "" : `, $${cost.toFixed(2)}, ${passes} of ${rounds} rounds passed`;
			return `${task}: ${status ?? "not run"} (${rounds} rounds${run})\n`;
		})
		.join("");
}

// ------------------------------------------------------------------- run --

export const HARBOR = ["uvx", "--from", "harbor==0.24.0", "harbor"];
/** The reference model, as the Gate's (`REFERENCE_MODEL` in `scripts/gate.ts`). */
export const MODEL = "anthropic/claude-opus-5-5";

/** What the host must have before any Run: each throws its own message. */
export interface Probes {
	srcCommitted: () => boolean;
	/** `harbor --version`. */
	harbor: () => Promise<string>;
	docker: () => Promise<unknown>;
	server: () => string | undefined;
	zstd: () => boolean;
}

export const hostProbes: Probes = {
	srcCommitted: srcIsCommitted,
	harbor: async () => (await run([...HARBOR, "--version"], tmpdir())).trim(),
	docker: () => run(["docker", "info", "--format", "{{.ServerVersion}}"]),
	server: () => process.env.PICHART_DATABASE_URL ?? readSavedUrl(),
	zstd: () => Bun.which("zstd") !== null,
};

/** Refuses a host not ready for EvoCode Runs, before any spend; Harbor's version and the server when ready. */
export async function preconditions(probes: Probes): Promise<{ harbor: string; server: string }> {
	if (!probes.srcCommitted()) throw new Error("uncommitted changes under src/: a pi-chart Run could not name the commit it loaded");
	const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
	const harbor = await probes.harbor().catch((error: unknown) => {
		throw new Error(`Harbor cannot run: ${reason(error)}`);
	});
	await probes.docker().catch((error: unknown) => {
		throw new Error(`Docker cannot run: ${reason(error)}`);
	});
	const server = probes.server();
	if (!server) throw new Error("no Thread Store server: set PICHART_DATABASE_URL, or run setup to save one");
	if (!probes.zstd()) throw new Error("zstd is not on PATH: the dataset archive cannot be extracted");
	return { harbor, server };
}

/** What every Run of one invocation shares. */
export interface EvoContext {
	out: string;
	stamp: number;
	server: string;
	omp: string;
	harbor: string;
	revision: string;
	/** The checkout's commit, when its `src/` is `HEAD`'s. */
	commit?: string;
	thinking?: string;
}

/**
 * A copy of `task` in `dir` whose `task.toml` keeps only its first `rounds`
 * steps, for smoke Runs; the task itself when `rounds` is not given.
 */
export async function cutTask(task: EvoTask, rounds: number | undefined, dir: string): Promise<EvoTask> {
	const all = await roundsOf(task.dir);
	if (rounds === undefined || rounds >= all.length) return task;
	const copy = join(dir, task.id);
	await cp(task.dir, copy, { recursive: true });
	const config = await readFile(join(copy, "task.toml"), "utf8");
	// Each task's `[[steps]]` tables end its `task.toml`: cut at the first one past `rounds`.
	const headers = [...config.matchAll(/^\[\[steps\]\]\s*$/gm)];
	const cut = config.slice(0, headers[rounds]?.index ?? config.length);
	const expected = { ...(Bun.TOML.parse(config) as { steps: unknown[] }) };
	expected.steps = expected.steps.slice(0, rounds);
	if (JSON.stringify(Bun.TOML.parse(cut)) !== JSON.stringify(expected)) {
		throw new Error(`could not cut ${task.id} to ${rounds} rounds: its [[steps]] tables do not end its task.toml`);
	}
	await writeFile(join(copy, "task.toml"), cut);
	return { id: task.id, dir: copy };
}

/** The server's URL as the container reaches it, through the host gateway. */
export function containerUrl(url: string): string {
	const parsed = new URL(url);
	parsed.hostname = "host.docker.internal";
	return parsed.toString();
}

/**
 * One Run of `task` on `arm`: a Harbor job of one trial, its record in
 * `<out>/runs/<label>/` as a Workload Run's, and its Measures. Every step
 * after the job's start runs whatever an earlier one did, so a failed job
 * still drops its database; the first failure is thrown once all have run.
 */
export async function runTask(spec: { task: EvoTask; arm: Arm; index: number; label: string }, ctx: EvoContext): Promise<{ record: RunRecord; measures: RunMeasures }> {
	const { task, arm, index, label } = spec;
	const recordDir = join(ctx.out, "runs", label);
	const jobs = join(ctx.out, "harbor");
	await mkdir(recordDir, { recursive: true });
	await mkdir(jobs, { recursive: true });
	const database = arm === "pi-chart" ? `bench_${ctx.stamp}_${label.replaceAll("-", "_")}` : undefined;
	let url: string | undefined;
	let record: RunRecord | undefined;
	let failure: unknown;
	const attempt = async (what: string, step: () => Promise<unknown>) => {
		try {
			await step();
		} catch (error) {
			log(`${label} could not ${what}: ${error instanceof Error ? error.message : error}`);
			failure ??= error;
		}
	};

	await attempt("run its Harbor job", async () => {
		if (database) url = await createDatabase(ctx.server, database, REPO);
		const token = (await run(["omp", "token", "anthropic"])).trim();
		const overlay = join(ctx.out, "host-gateway.yaml");
		await writeFile(overlay, 'services:\n  main:\n    extra_hosts:\n      - "host.docker.internal:host-gateway"\n');
		const bind = (source: string, target: string) => ({ type: "bind", source, target, read_only: true });
		const mounts = [
			bind(await realpath(Bun.which("omp") ?? "omp"), "/opt/omp/omp"),
			bind(await realpath(process.execPath), "/opt/bun/bun"),
			...(arm === "pi-chart" ? [bind(REPO, "/opt/pi-chart")] : []),
		];
		const args = [
			...HARBOR,
			"run",
			"-p",
			task.dir,
			"-a",
			"omp_agent:OmpAgent",
			"-n",
			"1",
			"--n-attempts",
			"1",
			"--max-retries",
			"0",
			"--resume-trajectory",
			"--jobs-dir",
			jobs,
			"--job-name",
			label,
			"--mounts",
			JSON.stringify(mounts),
			"--extra-docker-compose",
			overlay,
			"--ak",
			`arm=${arm}`,
			"--ak",
			`omp_version=${ctx.omp}`,
			"--ak",
			`model=${MODEL}`,
			...(ctx.thinking ? ["--ak", `thinking=${ctx.thinking}`] : []),
			"-y",
			"-q",
		];
		// The token and the database reach Harbor's process alone: `--ae` would write them into the job's config.
		const env: Record<string, string> = {
			PATH: process.env.PATH ?? "",
			HOME: process.env.HOME ?? homedir(),
			PYTHONPATH: join(import.meta.dir, "harbor"),
			OMP_AGENT_TOKEN: token,
			...(url ? { OMP_AGENT_DATABASE_URL: containerUrl(url) } : {}),
		};
		const harbor = Bun.spawn(args, { cwd: ctx.out, env, stdout: "pipe", stderr: "pipe" });
		const [stdout, stderr, code] = await Promise.all([new Response(harbor.stdout).text(), new Response(harbor.stderr).text(), harbor.exited]);
		await writeFile(join(recordDir, "harbor.log"), stdout + stderr);
		if (code !== 0) throw new Error(`harbor run exited ${code}: ${(stdout + stderr).slice(-1000)}`);
	});
	await attempt("read its trial", async () => {
		const job = join(jobs, label);
		const trial = (await readdir(job, { withFileTypes: true })).find((entry) => entry.isDirectory());
		if (!trial) throw new Error(`${job} holds no trial`);
		const read = await recordOf(join(job, trial.name), task, {
			arm,
			index,
			omp: ctx.omp,
			harbor: ctx.harbor,
			revision: ctx.revision,
			...(ctx.thinking ? { thinking: ctx.thinking } : {}),
			...(ctx.commit ? { piChart: ctx.commit } : {}),
		});
		record = read.record;
		await copyJournals(read.journals, recordDir);
		if (!read.journals.main) throw new Error("the trial holds no main Journal");
	});
	if (url) {
		const migrated = url;
		await attempt("export its Accounting", async () => {
			const accounting = await exportAccounting(migrated, REPO);
			await writeFile(join(recordDir, "accounting.json"), JSON.stringify(accounting, null, "\t"));
		});
	}
	if (database) await attempt("drop its database", () => dropDatabase(ctx.server, database));
	if (record) await writeFile(join(recordDir, "run.json"), JSON.stringify(record, null, "\t"));
	if (failure !== undefined) throw failure;
	return { record: record as RunRecord, measures: await measureRun(recordDir, await readCalibration()) };
}

// ------------------------------------------------------------------- CLI --

async function main(argv: string[]): Promise<void> {
	const { flag, positive } = flagsOf(argv);
	const admitting = argv.includes("--admit");
	const taskId = flag("--task");
	if (admitting === (taskId !== undefined)) {
		throw new Error(
			"usage: bun scripts/evocode.ts --admit [--out <dir>]\n" +
				"       bun scripts/evocode.ts --task <id> --arm <vanilla|pi-chart> [--runs n] [--rounds n] [--out <dir>]",
		);
	}
	const { harbor, server } = await preconditions(hostProbes);
	const subset = (await Bun.file(SUBSET_FILE).json()) as Subset;
	const tasks = await fetchTasks(subset, { download, cacheRoot: CACHE_ROOT });
	const stamp = Date.now();
	const out = resolve(flag("--out") ?? join(tmpdir(), `pichart-evocode-${stamp}`));
	await mkdir(out, { recursive: true });
	const ctx: EvoContext = {
		out,
		stamp,
		server,
		harbor,
		omp: (await run(["omp", "--version"])).trim(),
		revision: subset.revision,
		commit: (await run(["git", "-C", REPO, "rev-parse", "HEAD"])).trim(),
	};
	log(`EvoCode Runs: ${out}`);
	const taskOf = (id: string): EvoTask => {
		const dir = join(tasks, id);
		if (!existsSync(join(dir, "task.toml"))) throw new Error(`no task ${id} at revision ${subset.revision}`);
		return { id, dir };
	};

	if (admitting) {
		const admitted = await admit({
			subset,
			cap: 60,
			width: 2,
			rounds: async (id) => (await roundsOf(taskOf(id).dir)).length,
			runTask: (id) => runTask({ task: taskOf(id), arm: "pi-chart", index: 0, label: `${id}-pi-chart-0` }, ctx),
			write: (file) => writeFile(SUBSET_FILE, `${JSON.stringify(file, null, "\t")}\n`),
		});
		process.stdout.write(admissionReport(admitted));
		return;
	}

	const arm = flag("--arm") as Arm;
	if (!ARMS.includes(arm)) throw new Error(`--arm must be one of ${ARMS.join(", ")}`);
	const runs = positive("--runs", 1);
	const rounds = flag("--rounds") === undefined ? undefined : positive("--rounds", 1);
	const task = await cutTask(taskOf(taskId as string), rounds, out);
	for (let index = 0; index < runs; index++) {
		const { measures } = await runTask({ task, arm, index, label: `${task.id}-${arm}-${index}` }, ctx);
		log(`${task.id} ${arm} ${index}: $${measures.cost.toFixed(2)}, ${measures.passes} of ${measures.steps.length} rounds passed`);
	}
}

if (import.meta.main) await main(process.argv.slice(2));
