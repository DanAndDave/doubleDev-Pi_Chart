/**
 * One Run of a Workload, as the benchmark (`scripts/bench-tokens.ts`) and the
 * Gate (`scripts/gate.ts`) both start it.
 *
 * Every Run starts from the same bytes: a copy of the workspace template the
 * caller built (`buildWorkspace` plus `installDependencies`), its own copy of
 * the Workload's bundle, and, for a pi-chart Run, its own Thread Store
 * database, migrated before the first Turn and dropped once its Accounting
 * is exported. A pi-chart Run loads the extension of the pi-chart tree it is
 * given (`<source>/src/extension.ts`) between `scripts/run-url-set.ts` and
 * `scripts/run-url-unset.ts`, which keep the Run's database out of the
 * agent's reach, and migrates and exports that database with the tree's
 * `PostgresStore`, so a tree checked out at another commit runs that
 * commit's pi-chart against the schema it expects.
 *
 * Every Turn is one `omp -p` process, the second onwards with `-c`, so a Run
 * is one Conversation. After the last prompt of a graded step, its check is
 * copied into the workspace, run with `bun test`, and removed before the
 * next Turn. Each Run leaves its record in `<out>/runs/<label>/`, and its
 * Measures come from that record alone (`scripts/measures.ts`).
 *
 * Runs use the default session root on purpose: pi-chart finds a
 * Conversation's Journal only there (an EvoCode Run, `scripts/evocode.ts`,
 * moves the whole home instead).
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SQL } from "bun";

import type { TurnAccounting } from "../src/accounting.ts";
import { SESSION_ROOT } from "../src/journal.ts";
import { readCalibration } from "./calibration.ts";
import { type CheckOutcome, measureRun, type RunMeasures, type RunRecord } from "./measures.ts";
import {
	buildWorkspace,
	editedFiles,
	gradedSteps,
	installDependencies,
	loadWorkload,
	REPO,
	run,
	type Step,
	stepEndingAt,
	type Turn,
	type Workload,
	type WorkloadId,
	WORKLOADS,
} from "./workload.ts";

const CHECK_TIMEOUT_MS = 120_000;

/**
 * The `-e` arguments that load the pi-chart extension at `extension` for a
 * Run or replay: between `scripts/run-url-set.ts` and
 * `scripts/run-url-unset.ts`, so it reads the database `ompEnv` names and the
 * agent's tools never see it.
 */
export function piChartExtensions(extension: string): string[] {
	return ["-e", join(import.meta.dir, "run-url-set.ts"), "-e", extension, "-e", join(import.meta.dir, "run-url-unset.ts")];
}

/**
 * The environment omp starts with for a Run or replay: `base` without
 * `PICHART_DATABASE_URL`, which would reach the agent's shells and let a
 * store test it runs truncate whatever server it names, and with `database`,
 * for a pi-chart one, where `piChartExtensions` reads it.
 */
export function ompEnv(base: Record<string, string | undefined>, database?: string): Record<string, string | undefined> {
	const { PICHART_DATABASE_URL: _, ...env } = base;
	return database === undefined ? env : { ...env, BENCH_RUN_DATABASE_URL: database };
}

export type Arm = "vanilla" | "pi-chart";
export const ARMS: Arm[] = ["vanilla", "pi-chart"];

export interface Options {
	workload: WorkloadId;
	model?: string;
	thinking?: string;
	turns: number;
	omp: string;
}

/** What every Run of one benchmark or Gate shares. */
export interface Context {
	workload: Workload;
	turns: Turn[];
	/** Steps checked after their last prompt, by id. */
	graded: Map<string, Step>;
	/** The workspace every Run copies. */
	template: string;
	/** The Thread Store server; pi-chart Runs create their database on it. */
	server?: string;
	out: string;
	options: Options;
	timeoutMs: number;
	stamp: number;
}

/**
 * The Context for Runs of `turns` of `workload`, its workspace template built
 * and installed once in a new temporary folder that the caller removes: a
 * Workload whose dependencies do not install stops here, before any Run.
 */
export async function buildContext(
	workload: Workload,
	turns: Turn[],
	rest: Omit<Context, "workload" | "turns" | "graded" | "template">,
): Promise<Context> {
	const template = await mkdtemp(join(tmpdir(), "pichart-template-"));
	try {
		log(`building ${workload.name} v${workload.version} at ${workload.commit.slice(0, 7)}`);
		await buildWorkspace(workload, template);
		await installDependencies(template);
	} catch (error) {
		await rm(template, { recursive: true, force: true });
		throw error;
	}
	const graded = new Map(gradedSteps(workload, turns.length).map((step) => [step.id, step]));
	return { ...rest, workload, turns, graded, template };
}

/** The tunable Budgets: what a Budget sweep may vary, and what a Run's record names when its env sets them. */
export const BUDGET_VARIABLES = [
	"PICHART_TAIL_TOKENS",
	"PICHART_TAIL_TURNS",
	"PICHART_TAIL_LOW_WATER",
	"PICHART_OPENING_TOKENS",
	"PICHART_PINS_TOKENS",
	"PICHART_RECALL_TOKENS",
	"PICHART_DOC_TOKENS",
	"PICHART_GRAPH_TOKENS",
	"PICHART_PACK_TOKENS",
] as const;
export type BudgetVariable = (typeof BUDGET_VARIABLES)[number];

/** One Run: its Arm, its index, its record folder's name, and the pi-chart tree a pi-chart Run loads. */
export interface RunSpec {
	arm: Arm;
	index: number;
	/** The record folder under `<out>/runs/`; unique within the benchmark or Gate. */
	label: string;
	/** The root of the pi-chart tree: its extension, and its `PostgresStore`. */
	source: string;
	/** The commit `source` holds under `src/`, when it holds one; a pi-chart Run records it as `piChart`. */
	commit?: string;
	/** Budget settings for this Run alone, over the shell's: a sweep cell's values. */
	budgets?: Record<string, string>;
}

// --------------------------------------------------------------- journal --

async function jsonlUnder(dir: string): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await jsonlUnder(path)));
		else if (entry.name.endsWith(".jsonl")) found.push(path);
	}
	return found;
}

/** The entries of a Journal that name its session and its model. */
export async function headerOf(file: string): Promise<{ cwd?: string; id?: string; model?: string }> {
	const header: { cwd?: string; id?: string; model?: string } = {};
	for (const line of (await readFile(file, "utf8")).split("\n")) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as { type?: string; cwd?: string; id?: string; model?: string };
			if (entry.type === "session") Object.assign(header, { cwd: entry.cwd, id: entry.id });
			if (entry.type === "model_change" && header.model === undefined) header.model = entry.model;
		} catch {
			// A partially flushed final line.
		}
	}
	return header;
}

/** A Conversation's main Journal, when found, and its subagent Journals. */
export interface Journals {
	main?: string;
	subagents: string[];
}

/**
 * The Journal of the Conversation started in `cwd` under the session root
 * `root`, and the subagent Journals beside it. The harness names a session
 * folder after its working directory, so folders are matched by that name
 * and the main Journal is confirmed by its session header: a folder whose
 * name only holds this one's (`-w-run-10-` for `/w/run-1`) has none.
 */
export async function journalsIn(root: string, cwd: string): Promise<Journals> {
	const token = cwd.split("/").pop() ?? cwd;
	for (const dir of await readdir(root).catch(() => [] as string[])) {
		if (!dir.includes(token)) continue;
		const sessionDir = join(root, dir);
		const files = await jsonlUnder(sessionDir);
		// Subagent Journals sit one folder deeper, beside the main one.
		const nested = (file: string) => file.slice(sessionDir.length + 1).includes("/");
		let main: string | undefined;
		for (const file of files) if (!nested(file) && (await headerOf(file)).cwd === cwd) main = file;
		if (main) return { main, subagents: files.filter(nested) };
	}
	return { subagents: [] };
}

/** Copies a Run's Journals into its record folder: `journal.jsonl`, and `subagents/<n>.jsonl`. */
export async function copyJournals(journals: Journals, recordDir: string): Promise<void> {
	if (journals.main) await copyFile(journals.main, join(recordDir, "journal.jsonl"));
	if (journals.subagents.length > 0) await mkdir(join(recordDir, "subagents"), { recursive: true });
	for (const [n, file] of journals.subagents.entries()) await copyFile(file, join(recordDir, "subagents", `${n}.jsonl`));
}

// ----------------------------------------------------------------- store --

/** What a Run needs of a pi-chart tree's `PostgresStore`. */
interface Store {
	migrate(): Promise<void>;
	readAccounting(conversationId: string): Promise<TurnAccounting[]>;
	close(): Promise<void>;
}
interface StoreClass {
	connect(url: string): Store;
}

/**
 * The `PostgresStore` of the pi-chart tree at `source`. Throws, naming what
 * is missing, when that tree's store lacks a method a Run calls, so a commit
 * whose store API differs stops before any Run.
 */
export async function loadStore(source: string): Promise<StoreClass> {
	const file = join(source, "src", "postgres-store.ts");
	// Runtime-selected: each side of a Gate loads the store of its own checked-out tree.
	const { PostgresStore } = (await import(file)) as { PostgresStore?: StoreClass & { prototype: object } };
	if (typeof PostgresStore?.connect !== "function") throw new Error(`${file} has no PostgresStore.connect`);
	const missing = ["migrate", "readAccounting", "close"].filter(
		(method) => typeof (PostgresStore.prototype as Record<string, unknown>)[method] !== "function",
	);
	if (missing.length > 0) throw new Error(`${file}: PostgresStore lacks ${missing.join(", ")}`);
	return PostgresStore;
}

// ------------------------------------------------------------------- run --

/** Runs a graded step's check in the workspace, which holds it only meanwhile. */
async function runCheck(step: Step, cwd: string): Promise<CheckOutcome> {
	const name = `${step.id}.check.ts`;
	const target = join(cwd, name);
	await copyFile(step.check as string, target);
	const started = performance.now();
	try {
		const proc = Bun.spawn(["bun", "test", `./${name}`], { cwd, stdout: "pipe", stderr: "pipe" });
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill();
		}, CHECK_TIMEOUT_MS);
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		clearTimeout(timer);
		return {
			step: step.id,
			pass: code === 0 && !timedOut,
			exitCode: code,
			durationMs: Math.round(performance.now() - started),
			output: (stdout + stderr).slice(-2048),
		};
	} finally {
		await rm(target, { force: true });
	}
}

/** A pi-chart Run's own database on the server, migrated before any Turn by `source`'s store. */
export async function createDatabase(server: string, name: string, source: string): Promise<string> {
	const admin = new SQL(server);
	try {
		await admin.unsafe(`CREATE DATABASE ${name}`);
	} finally {
		await admin.end();
	}
	const url = new URL(server);
	url.pathname = `/${name}`;
	// Migrated here, as a real store is by the time a Conversation starts: a
	// fresh database migrating inside the first Turn misses the Thread Store
	// deadline and that Turn goes out without its Opening.
	const store = (await loadStore(source)).connect(String(url));
	try {
		await store.migrate();
	} finally {
		await store.close();
	}
	return String(url);
}

/** Every Conversation's Accounting in the Run's database, by Conversation id, read by `source`'s store. */
export async function exportAccounting(url: string, source: string): Promise<Record<string, TurnAccounting[]>> {
	const sql = new SQL(url);
	let ids: string[];
	try {
		const rows = (await sql`SELECT DISTINCT conversation_id FROM call_accounting ORDER BY conversation_id`) as {
			conversation_id: string;
		}[];
		ids = rows.map((row) => row.conversation_id);
	} finally {
		await sql.end();
	}
	const store = (await loadStore(source)).connect(url);
	try {
		const accounting: Record<string, TurnAccounting[]> = {};
		for (const id of ids) accounting[id] = await store.readAccounting(id);
		return accounting;
	} finally {
		await store.close();
	}
}

export async function dropDatabase(server: string, name: string): Promise<void> {
	const admin = new SQL(server);
	try {
		await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
	} finally {
		await admin.end();
	}
}

/** The full sha a revision names; throws when it names no commit. */
export async function resolveCommit(revision: string): Promise<string> {
	try {
		return (await run(["git", "-C", REPO, "rev-parse", "--verify", "--quiet", `${revision}^{commit}`])).trim();
	} catch {
		throw new Error(`${revision} does not name a commit`);
	}
}

/** Whether this checkout's `src/` is `HEAD`'s: only then does a Run that loads it run `HEAD`'s pi-chart. */
export function srcIsCommitted(): boolean {
	return Bun.spawnSync(["git", "-C", REPO, "diff", "--quiet", "HEAD", "--", "src/"]).exitCode === 0;
}

/**
 * A pi-chart tree of `sha` in a temporary folder: its tracked files without
 * `bench/`, dependencies from its own lockfile, and a store a Run can use.
 */
export async function buildTree(sha: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `pichart-tree-${sha.slice(0, 7)}-`));
	const archive = Bun.spawn(["git", "-C", REPO, "archive", sha, "--", ".", ":(exclude)bench"], { stdout: "pipe" });
	const extract = Bun.spawn(["tar", "-x", "-C", dir], { stdin: archive.stdout });
	if ((await archive.exited) !== 0 || (await extract.exited) !== 0) throw new Error(`could not extract ${sha} into ${dir}`);
	await installDependencies(dir);
	await loadStore(dir);
	return dir;
}

/**
 * Ends every process whose working directory is `dir` or under it, by
 * process group: what a Run or a replay left running there, such as the
 * graph extraction pi-chart starts detached. Linux only (`/proc`).
 */
export async function endProcessesIn(dir: string): Promise<void> {
	const groups = new Set<number>();
	for (const pid of await readdir("/proc").catch(() => [] as string[])) {
		if (!/^\d+$/.test(pid)) continue;
		const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => undefined);
		if (cwd !== dir && !cwd?.startsWith(`${dir}/`)) continue;
		const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => undefined);
		// Field 5 of `stat`, counted after the parenthesised command name.
		const group = Number(stat?.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
		if (Number.isInteger(group) && group > 1) groups.add(group);
	}
	// Never this process's own group: a child still running in the workspace would take the replay down with it.
	const own = await readFile("/proc/self/stat", "utf8");
	groups.delete(Number(own.slice(own.lastIndexOf(")") + 2).split(" ")[2]));
	for (const group of groups) {
		try {
			process.kill(-group, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
}

export async function runOne(spec: RunSpec, ctx: Context): Promise<{ record: RunRecord; measures: RunMeasures }> {
	const { arm, index, label, source, commit, budgets } = spec;
	const { workload, turns, options } = ctx;
	const recordDir = join(ctx.out, "runs", label);
	await mkdir(recordDir, { recursive: true });
	const cwd = await mkdtemp(join(tmpdir(), "pichart-bench-"));
	const bundle = await mkdtemp(join(tmpdir(), "pichart-bundle-"));
	// The spec's Budgets over the shell's, so a sweep cell's values win.
	let env: Record<string, string | undefined> = ompEnv({ ...process.env, ...budgets, PICHART_DOC_BUNDLE: bundle });
	const set = BUDGET_VARIABLES.filter((name) => env[name] !== undefined).map((name) => [name, env[name] as string]);
	const record: RunRecord = {
		arm,
		index,
		workload: { name: workload.name, version: workload.version, commit: workload.commit },
		omp: options.omp,
		cwd,
		plants: workload.plants,
		revisits: workload.revisits,
		...(options.thinking ? { thinking: options.thinking } : {}),
		...(arm === "pi-chart" && commit ? { piChart: commit } : {}),
		...(arm === "pi-chart" && set.length > 0 ? { budgets: Object.fromEntries(set) } : {}),
		prompts: turns.map(({ step, text, probes, tools }) => ({ step, text, probes, ...(tools === false ? { tools } : {}) })),
		checks: [],
	};
	const unedited = new Set(workload.revisits.map((revisit) => revisit.file));
	// Named before it is created, so a migration that fails still drops it.
	const database = arm === "pi-chart" ? `bench_${ctx.stamp}_${label.replaceAll("-", "_")}` : undefined;
	let url: string | undefined;
	let failure: unknown;
	try {
		await run(["cp", "-a", `${ctx.template}/.`, `${cwd}/`]);
		const bundled = join(workload.dir, "bundle");
		if (existsSync(bundled)) await run(["cp", "-a", `${bundled}/.`, `${bundle}/`]);
		if (database) {
			url = await createDatabase(ctx.server as string, database, source);
			env = ompEnv(env, url);
		}

		for (const { turn, text } of turns) {
			const args = ["omp", "-p", "--no-title", "--no-extensions"];
			if (arm === "pi-chart") args.push(...piChartExtensions(join(source, "src", "extension.ts")));
			if (options.model) args.push("--model", options.model);
			if (options.thinking) args.push("--thinking", options.thinking);
			if (turn > 0) args.push("-c");
			args.push(text);

			const proc = Bun.spawn(args, { cwd, env, stdout: "ignore", stderr: "pipe" });
			const timer = setTimeout(() => proc.kill(), ctx.timeoutMs);
			const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
			clearTimeout(timer);

			const { main } = await journalsIn(SESSION_ROOT, cwd);
			if (code !== 0 || !main) {
				record.failedTurn = turn;
				log(`${label} Turn ${turn + 1} failed (exit ${code}${main ? "" : ", no Journal"}) ${stderr.slice(-500)}`);
				break;
			}
			log(`${label} Turn ${turn + 1}/${turns.length}`);

			// Before the check, which may touch the workspace.
			for (const file of await editedFiles(cwd, join(workload.dir, "overlay"), [...unedited])) {
				(record.edited ??= {})[file] = turn;
				unedited.delete(file);
			}

			const ending = stepEndingAt(workload, turn);
			const graded = ending && ctx.graded.get(ending.id);
			if (graded) {
				const outcome = await runCheck(graded, cwd);
				record.checks.push(outcome);
				log(`${label} check ${graded.id}: ${outcome.pass ? "Pass" : "Fail"}`);
			}
		}
	} catch (error) {
		failure = error;
	}

	// Every step runs whatever failed before it, so a Run never leaves a
	// database or a workspace behind, and its record is always written.
	const attempt = async (what: string, step: () => Promise<unknown>) => {
		try {
			await step();
		} catch (error) {
			log(`${label} could not ${what}: ${error instanceof Error ? error.message : error}`);
			failure ??= error;
		}
	};
	await attempt("copy its Journals", async () => {
		const journals = await journalsIn(SESSION_ROOT, cwd);
		await copyJournals(journals, recordDir);
		if (journals.main) {
			const header = await headerOf(journals.main);
			record.sessionId = header.id;
			record.model = header.model;
		}
	});
	if (url) {
		const migrated = url;
		await attempt("export its Accounting", async () => {
			const accounting = await exportAccounting(migrated, source);
			await writeFile(join(recordDir, "accounting.json"), JSON.stringify(accounting, null, "\t"));
		});
	}
	if (database) await attempt("drop its database", () => dropDatabase(ctx.server as string, database));
	await attempt("end what still runs in its workspace", () => endProcessesIn(cwd));
	await attempt("remove its workspace", () => rm(cwd, { recursive: true, force: true }));
	await attempt("remove its bundle", () => rm(bundle, { recursive: true, force: true }));
	await writeFile(join(recordDir, "run.json"), JSON.stringify(record, null, "\t"));
	if (failure !== undefined) throw failure;
	return { record, measures: await measureRun(recordDir, await readCalibration()) };
}

export function log(message: string): void {
	process.stderr.write(`[bench] ${message}\n`);
}

/** A script's `--name value` flags, and its positive-integer ones checked. */
export function flagsOf(argv: string[]): {
	flag: (name: string) => string | undefined;
	positive: (name: string, fallback: number) => number;
} {
	const flag = (name: string) => {
		const at = argv.indexOf(name);
		return at === -1 ? undefined : argv[at + 1];
	};
	const positive = (name: string, fallback: number) => {
		const raw = flag(name);
		if (raw === undefined) return fallback;
		const value = Number(raw);
		if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer, got ${raw}`);
		return value;
	};
	return { flag, positive };
}

/** The Workload `--workload` names: a folder path when it holds a slash, else one under `bench/workloads/`. */
export function loadNamedWorkload(name: string): Promise<Workload> {
	return loadWorkload(name.includes("/") ? resolve(name) : join(WORKLOADS, name));
}

/**
 * Runs `jobs`, `width` at a time. After a job throws, no new job starts, but
 * the ones in flight finish, so each still cleans up after itself before the
 * error reaches the caller.
 */
export async function pool<T>(jobs: (() => Promise<T>)[], width: number): Promise<T[]> {
	const results: T[] = new Array(jobs.length);
	let next = 0;
	let failure: { error: unknown } | undefined;
	await Promise.all(
		Array.from({ length: Math.min(width, jobs.length) }, async () => {
			while (next < jobs.length && !failure) {
				const at = next++;
				try {
					results[at] = await (jobs[at] as () => Promise<T>)();
				} catch (error) {
					failure ??= { error };
				}
			}
		}),
	);
	if (failure) throw failure.error;
	return results;
}
