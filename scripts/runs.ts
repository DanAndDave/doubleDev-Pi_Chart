/**
 * One Run of a Workload, as the benchmark (`scripts/bench-tokens.ts`) and the
 * Gate (`scripts/gate.ts`) both start it.
 *
 * Every Run starts from the same bytes: a copy of the workspace template the
 * caller built (`buildWorkspace` plus `installDependencies`), its own copy of
 * the Workload's bundle, and, for a pi-chart Run, its own Thread Store
 * database, migrated before the first Turn and dropped once its Accounting
 * is exported. A pi-chart Run loads the extension of the pi-chart tree it is
 * given (`<source>/src/extension.ts`) and migrates and exports its database
 * with that tree's `PostgresStore`, so a tree checked out at another commit
 * runs that commit's pi-chart against the schema it expects.
 *
 * Every Turn is one `omp -p` process, the second onwards with `-c`, so a Run
 * is one Conversation. After the last prompt of a graded step, its check is
 * copied into the workspace, run with `bun test`, and removed before the
 * next Turn. Each Run leaves its record in `<out>/runs/<label>/`, and its
 * Measures come from that record alone (`scripts/measures.ts`).
 *
 * Runs use the default session root on purpose: pi-chart finds a
 * Conversation's Journal only there.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";

import type { TurnAccounting } from "../src/accounting.ts";
import { SESSION_ROOT } from "../src/journal.ts";
import { type CheckOutcome, measureRun, type RunMeasures, type RunRecord } from "./measures.ts";
import { editedFiles, run, type Step, stepEndingAt, type Turn, type Workload, type WorkloadId } from "./workload.ts";

const CHECK_TIMEOUT_MS = 120_000;

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

/** One Run: its Arm, its index, its record folder's name, and the pi-chart tree a pi-chart Run loads. */
export interface RunSpec {
	arm: Arm;
	index: number;
	/** The record folder under `<out>/runs/`; unique within the benchmark or Gate. */
	label: string;
	/** The root of the pi-chart tree: its extension, and its `PostgresStore`. */
	source: string;
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
async function headerOf(file: string): Promise<{ cwd?: string; id?: string; model?: string }> {
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

/**
 * The Journal of the Conversation started in `cwd`, and any subagent Journals
 * beside it. The harness names a session directory after its working
 * directory, and every Run has a unique one, so the directory is matched by
 * that name and confirmed by the session header.
 */
async function journalsFor(cwd: string): Promise<{ main?: string; subagents: string[] }> {
	const token = cwd.split("/").pop() ?? cwd;
	for (const dir of await readdir(SESSION_ROOT).catch(() => [] as string[])) {
		if (!dir.includes(token)) continue;
		const sessionDir = join(SESSION_ROOT, dir);
		const files = await jsonlUnder(sessionDir);
		let main: string | undefined;
		for (const file of files) {
			// Subagent Journals sit one directory deeper, beside the main one.
			if (file.slice(sessionDir.length + 1).includes("/")) continue;
			if ((await headerOf(file)).cwd === cwd) main = file;
		}
		return { main, subagents: files.filter((file) => file !== main) };
	}
	return { subagents: [] };
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
async function createDatabase(server: string, name: string, source: string): Promise<string> {
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
async function exportAccounting(url: string, source: string): Promise<Record<string, TurnAccounting[]>> {
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

async function dropDatabase(server: string, name: string): Promise<void> {
	const admin = new SQL(server);
	try {
		await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
	} finally {
		await admin.end();
	}
}

export async function runOne(spec: RunSpec, ctx: Context): Promise<{ record: RunRecord; measures: RunMeasures }> {
	const { arm, index, label, source } = spec;
	const { workload, turns, options } = ctx;
	const recordDir = join(ctx.out, "runs", label);
	await mkdir(recordDir, { recursive: true });
	const cwd = await mkdtemp(join(tmpdir(), "pichart-bench-"));
	const bundle = await mkdtemp(join(tmpdir(), "pichart-bundle-"));
	const record: RunRecord = {
		arm,
		index,
		workload: { name: workload.name, version: workload.version, commit: workload.commit },
		omp: options.omp,
		cwd,
		plants: workload.plants,
		revisits: workload.revisits,
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
		const env: Record<string, string | undefined> = { ...process.env, PICHART_DOC_BUNDLE: bundle };
		if (database) {
			url = await createDatabase(ctx.server as string, database, source);
			env.PICHART_DATABASE_URL = url;
		}

		for (const { turn, text } of turns) {
			const args = ["omp", "-p", "--no-title", "--no-extensions"];
			if (arm === "pi-chart") args.push("-e", join(source, "src", "extension.ts"));
			if (options.model) args.push("--model", options.model);
			if (options.thinking) args.push("--thinking", options.thinking);
			if (turn > 0) args.push("-c");
			args.push(text);

			const proc = Bun.spawn(args, { cwd, env, stdout: "ignore", stderr: "pipe" });
			const timer = setTimeout(() => proc.kill(), ctx.timeoutMs);
			const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
			clearTimeout(timer);

			const { main } = await journalsFor(cwd);
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
		const { main, subagents } = await journalsFor(cwd);
		if (main) {
			await copyFile(main, join(recordDir, "journal.jsonl"));
			const header = await headerOf(main);
			record.sessionId = header.id;
			record.model = header.model;
		}
		if (subagents.length > 0) await mkdir(join(recordDir, "subagents"), { recursive: true });
		for (const [n, file] of subagents.entries()) await copyFile(file, join(recordDir, "subagents", `${n}.jsonl`));
	});
	if (url) {
		const migrated = url;
		await attempt("export its Accounting", async () => {
			const accounting = await exportAccounting(migrated, source);
			await writeFile(join(recordDir, "accounting.json"), JSON.stringify(accounting, null, "\t"));
		});
	}
	if (database) await attempt("drop its database", () => dropDatabase(ctx.server as string, database));
	await attempt("remove its workspace", () => rm(cwd, { recursive: true, force: true }));
	await attempt("remove its bundle", () => rm(bundle, { recursive: true, force: true }));
	await writeFile(join(recordDir, "run.json"), JSON.stringify(record, null, "\t"));
	if (failure !== undefined) throw failure;
	return { record, measures: await measureRun(recordDir) };
}

export function log(message: string): void {
	process.stderr.write(`[bench] ${message}\n`);
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
