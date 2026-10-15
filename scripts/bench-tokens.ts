/**
 * Benchmarks a Conversation with pi-chart against plain oh-my-pi, on a frozen
 * Workload (`bench/workloads/<name>/`, see `scripts/workload.ts`).
 *
 * Two Arms:
 *
 * - **vanilla**: `omp --no-extensions`, the harness's accumulate-forward window.
 * - **pi-chart**: `omp --no-extensions -e src/extension.ts`, this checkout's
 *   extension alone, so the only difference between the Arms is pi-chart.
 *
 * Every Run starts from the same bytes: the Workload's pinned commit without
 * `bench/`, its overlay, its frozen `graphify-out/`, and dependencies
 * installed from the workspace's own lockfile. That tree is built once per
 * benchmark and copied into each Run's workspace (about 1 GB under $TMPDIR
 * per Run in flight). Each Run gets its own copy of the Workload's bundle,
 * and a pi-chart Run its own Thread Store database, migrated before the
 * first Turn and dropped once its Accounting is exported. The user's own
 * database and bundle are never touched; every other `PICHART_*` setting in
 * the environment reaches both Arms, which is how a Budget sweep sets its
 * cells.
 *
 * Every Turn is one `omp -p` process, the second onwards with `-c`, so a Run
 * is one Conversation. Prompts are sent exactly as the Workload states them.
 * After the last prompt of a graded step, its check is copied into the
 * workspace, run with `bun test`, and removed before the next Turn.
 *
 * Each Run leaves a record in `<out>/runs/<arm>-<index>/`, and its Measures
 * come from that record alone (`scripts/measures.ts`), so they can be
 * recomputed later at no model cost. `<out>/bench.json` holds the options and
 * every Run's record and Measures.
 *
 *     bun scripts/bench-tokens.ts                          # read-only-40, 3 Runs per Arm
 *     bun scripts/bench-tokens.ts --workload smoke --runs 1
 *     bun scripts/bench-tokens.ts --runs 5 --parallel 4 --model sonnet
 *     bun scripts/bench-tokens.ts --workload ./my-workload --arm pi-chart
 *     bun scripts/bench-tokens.ts --report /tmp/pichart-bench-1789…   # re-print
 *
 * `--workload` takes a name under `bench/workloads/`, or a path (anything
 * with a `/`). `--turns N` sends the first N prompts; a step cut short is not
 * checked. `--out` names the output directory. `--arm` runs one Arm alone.
 * pi-chart Runs need the Thread Store server: `PICHART_DATABASE_URL`, else
 * the URL setup saved.
 *
 * Runs use the default session root on purpose: pi-chart finds a
 * Conversation's Journal only there. Not counted: anything charged outside
 * the provider's `usage`, such as the local embedder.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SQL } from "bun";

import type { TurnAccounting } from "../src/accounting.ts";
import { readSavedUrl } from "../src/config.ts";
import { SESSION_ROOT } from "../src/journal.ts";
import { PostgresStore } from "../src/postgres-store.ts";
import {
	aggregate,
	BANDS,
	bandLabel,
	EARLY_TURNS,
	int,
	measureRun,
	median,
	percent,
	READ_RATE,
	type Banded,
	type CheckOutcome,
	type RefetchClass,
	type RunMeasures,
	type RunRecord,
	usd,
	WRITE_RATE,
} from "./measures.ts";
import {
	buildWorkspace,
	gradedSteps,
	installDependencies,
	loadWorkload,
	run,
	stepEndingAt,
	turnsOf,
	WORKLOADS,
	type Step,
	type Turn,
	type Workload,
	type WorkloadId,
} from "./workload.ts";

const EXTENSION = resolve(import.meta.dir, "..", "src", "extension.ts");
const CHECK_TIMEOUT_MS = 120_000;

type Arm = "vanilla" | "pi-chart";
const ARMS: Arm[] = ["vanilla", "pi-chart"];

interface Options {
	workload: WorkloadId;
	model?: string;
	thinking?: string;
	turns: number;
	omp: string;
}

/** `bench.json`. */
interface Bench {
	options: Options;
	runs: { record: RunRecord; measures: RunMeasures }[];
}

/** What every Run of one benchmark shares. */
interface Context {
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

// ------------------------------------------------------------------ args --

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
	const at = argv.indexOf(name);
	return at === -1 ? undefined : argv[at + 1];
}

function positive(name: string, fallback: number): number {
	const raw = flag(name);
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer, got ${raw}`);
	}
	return value;
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

/** A pi-chart Run's own database on the server, migrated before any Turn. */
async function createDatabase(server: string, name: string): Promise<string> {
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
	const store = PostgresStore.connect(String(url));
	try {
		await store.migrate();
	} finally {
		await store.close();
	}
	return String(url);
}

/** Every Conversation's Accounting in the Run's database, by Conversation id. */
async function exportAccounting(url: string): Promise<Record<string, TurnAccounting[]>> {
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
	const store = PostgresStore.connect(url);
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

async function runOne(arm: Arm, index: number, ctx: Context): Promise<{ record: RunRecord; measures: RunMeasures }> {
	const { workload, turns, options } = ctx;
	const recordDir = join(ctx.out, "runs", `${arm}-${index}`);
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
		prompts: turns.map(({ step, text, probes }) => ({ step, text, probes })),
		checks: [],
	};
	// Named before it is created, so a migration that fails still drops it.
	const database = arm === "pi-chart" ? `bench_${ctx.stamp}_${arm.replace("-", "_")}_${index}` : undefined;
	let url: string | undefined;
	let failure: unknown;
	try {
		await run(["cp", "-a", `${ctx.template}/.`, `${cwd}/`]);
		const source = join(workload.dir, "bundle");
		if (existsSync(source)) await run(["cp", "-a", `${source}/.`, `${bundle}/`]);
		const env: Record<string, string | undefined> = { ...process.env, PICHART_DOC_BUNDLE: bundle };
		if (database) {
			url = await createDatabase(ctx.server as string, database);
			env.PICHART_DATABASE_URL = url;
		}

		for (const { turn, text } of turns) {
			const args = ["omp", "-p", "--no-title", "--no-extensions"];
			if (arm === "pi-chart") args.push("-e", EXTENSION);
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
				log(`${arm}#${index} Turn ${turn + 1} failed (exit ${code}${main ? "" : ", no Journal"}) ${stderr.slice(-500)}`);
				break;
			}
			log(`${arm}#${index} Turn ${turn + 1}/${turns.length}`);

			const ending = stepEndingAt(workload, turn);
			const graded = ending && ctx.graded.get(ending.id);
			if (graded) {
				const outcome = await runCheck(graded, cwd);
				record.checks.push(outcome);
				log(`${arm}#${index} check ${graded.id}: ${outcome.pass ? "Pass" : "Fail"}`);
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
			log(`${arm}#${index} could not ${what}: ${error instanceof Error ? error.message : error}`);
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
			const accounting = await exportAccounting(migrated);
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

function log(message: string): void {
	process.stderr.write(`[bench] ${message}\n`);
}

/**
 * Runs `jobs`, `width` at a time. After a job throws, no new job starts, but
 * the ones in flight finish, so each still cleans up after itself before the
 * error reaches the caller.
 */
async function pool<T>(jobs: (() => Promise<T>)[], width: number): Promise<T[]> {
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

// ---------------------------------------------------------------- report --

function report(bench: Bench): void {
	const all = bench.runs.map((run) => run.measures);
	const arms = aggregate(all);
	const present = ARMS.filter((arm) => arms.has(arm));
	const both = present.length === ARMS.length;
	const complete = (arm: Arm) => arms.get(arm)?.complete ?? [];
	const { workload, turns } = bench.options;
	const distinct = (values: (string | undefined)[]) =>
		[...new Set(values.map((value) => value ?? "(unknown)"))].join(", ");
	const excluded = present.reduce((acc, arm) => acc + (arms.get(arm)?.excluded ?? 0), 0);

	console.log(
		`\nWorkload ${workload.name} v${workload.version} (${workload.commit.slice(0, 7)}), ` +
			`model ${distinct(bench.runs.map((run) => run.record.model))}, ${bench.options.omp}, ` +
			`thinking ${bench.options.thinking ?? "(default)"}, ${turns} Turns; ` +
			`complete Runs: ${present.map((arm) => `${arm} ${complete(arm).length}`).join(", ")}` +
			(excluded > 0 ? ` (${excluded} failed, excluded)` : ""),
	);

	const header = (first: string) => {
		console.log(`| ${first} | ${present.join(" | ")} |${both ? " pi-chart / vanilla |" : ""}`);
		console.log(`| --- | ${present.map(() => "---:").join(" | ")} |${both ? " ---: |" : ""}`);
	};

	// A pick gives `undefined` for a Measure the Run's Arm does not have:
	// that Arm reads "n/a", and the row has no ratio. NaN is a figure
	// the record lacks, as in a `bench.json` older than the Measure.
	const rows: [string, (run: RunMeasures) => number | undefined, (x: number) => string][] = [
		["Calls", (r) => r.totals.calls, int],
		["Prompt tokens sent (input + cache read + cache write)", (r) => r.totals.prompt, int],
		["Uncached input", (r) => r.totals.input, int],
		["Cache read", (r) => r.totals.cacheRead, int],
		["Cache write", (r) => r.totals.cacheWrite, int],
		["Output", (r) => r.totals.output, int],
		[`Effective input (read ×${READ_RATE}, write ×${WRITE_RATE})`, (r) => r.totals.effective, int],
		["Cost per Run, USD (harness pricing)", (r) => r.totals.cost, usd],
		["Peak window, tokens", (r) => r.totals.peak, int],
		["Floor, tokens", (r) => r.totals.floor, int],
		[`Cache write, Turns 1–${EARLY_TURNS}`, (r) => r.totals.earlyWrite, int],
		[`Prefix held, Turns 1–${EARLY_TURNS} (next Call read all the last read or wrote)`, (r) => r.totals.prefixHeld, percent],
		// Absent on pi-chart and in an older `bench.json` alike; `refetch`,
		// which came with it on every Arm, tells the older record apart.
		["Compactions", (r) => (r.refetch === undefined ? Number.NaN : r.compactions), int],
	];
	console.log("\nPer Conversation, median over complete Runs:\n");
	header("Measure");
	for (const [label, pick, show] of rows) {
		const values = present.map((arm) => {
			const picked = complete(arm).map(pick);
			return picked.length > 0 && picked.every((value) => value === undefined)
				? "n/a"
				: median(picked.map((value) => value ?? Number.NaN));
		});
		const cells = values.map((value) => (value === "n/a" ? value : show(value))).join(" | ");
		if (!both) {
			console.log(`| ${label} | ${cells} |`);
			continue;
		}
		const [v, p] = values;
		const ratio =
			v === "n/a" || p === "n/a"
				? "n/a"
				: v !== undefined && p !== undefined && v > 0 && Number.isFinite(p)
					? `${(p / v).toFixed(2)}×`
					: "—";
		console.log(`| ${label} | ${cells} | ${ratio} |`);
	}

	const classes: [RefetchClass, string][] = [
		["held", "held"],
		["left", "Lapses"],
		["unknown", "unknown"],
	];
	console.log("\nRe-fetches per Run by distance band, median over complete Runs:\n");
	const columns = present.flatMap((arm) => classes.map(([kind, name]) => ({ arm, kind, name })));
	console.log(`| Distance, Turns | ${columns.map(({ arm, name }) => `${arm} ${name}`).join(" | ")} |`);
	console.log(`| --- | ${columns.map(() => "---:").join(" | ")} |`);
	// `refetch` is absent from a `bench.json` older than the Measure: "—".
	const bandRow = (label: string, count: (banded: Banded) => number | undefined) => {
		const cell = ({ arm, kind }: (typeof columns)[number]) =>
			int(median(complete(arm).map((run) => (run.refetch ? (count(run.refetch[kind]) ?? Number.NaN) : Number.NaN))));
		console.log(`| ${label} | ${columns.map(cell).join(" | ")} |`);
	};
	for (const [at, band] of BANDS.entries()) bandRow(bandLabel(band), (banded) => banded.bands[at]);
	bandRow("Total", (banded) => banded.total);
	console.log("\nEach row is its own median, so the bands need not sum to the Total row.");

	const stepIds = [
		...new Set(
			present.flatMap((arm) =>
				complete(arm).flatMap((run) => run.steps.filter((s) => s.outcome !== "not graded").map((s) => s.id)),
			),
		),
	];
	console.log("\nGraded Tasks (Passes over complete Runs):\n");
	if (stepIds.length === 0) {
		console.log("No graded step within the Turns sent.");
	} else {
		console.log(`| Step | ${present.join(" | ")} |`);
		console.log(`| --- | ${present.map(() => "---:").join(" | ")} |`);
		for (const id of stepIds) {
			const cell = (arm: Arm) => {
				const runs = complete(arm);
				const passed = runs.filter((run) => run.steps.some((s) => s.id === id && s.outcome === "Pass"));
				return `${passed.length}/${runs.length}`;
			};
			console.log(`| ${id} | ${present.map(cell).join(" | ")} |`);
		}
	}

	console.log("\nCost per Pass:\n");
	for (const arm of present) {
		const value = arms.get(arm)?.costPerPass ?? "n/a";
		console.log(`- ${arm}: ${typeof value === "string" ? value : usd(value.usd)}`);
	}

	const plantIds = [...new Set(present.flatMap((arm) => arms.get(arm)?.retention.map((r) => r.id) ?? []))];
	console.log("\nRetention per Plant (complete Runs whose Probe answered it correctly):\n");
	if (plantIds.length === 0) {
		console.log("No Probe within the Turns sent.");
	} else {
		console.log(`| Plant | ${present.join(" | ")} |`);
		console.log(`| --- | ${present.map(() => "---:").join(" | ")} |`);
		for (const id of plantIds) {
			const cell = (arm: Arm) => {
				const retention = arms.get(arm)?.retention.find((r) => r.id === id);
				return retention ? `${retention.right}/${retention.of}` : "—";
			};
			console.log(`| ${id} | ${present.map(cell).join(" | ")} |`);
		}
	}

	console.log("\nWindow size per Turn (median prompt tokens of the Turn's last Call):\n");
	console.log(`| Turn | ${present.join(" | ")} |`);
	console.log(`| ---: | ${present.map(() => "---:").join(" | ")} |`);
	for (let turn = 0; turn < turns; turn++) {
		const cell = (arm: Arm) =>
			int(
				median(
					complete(arm)
						.map((run) => run.calls.filter((c) => !c.subagent && c.turn === turn).at(-1)?.promptTokens)
						.filter((x): x is number => x !== undefined),
				),
			);
		console.log(`| ${turn + 1} | ${present.map(cell).join(" | ")} |`);
	}
	const sub = present.flatMap((arm) => complete(arm).flatMap((run) => run.calls.filter((c) => c.subagent)));
	if (sub.length > 0) console.log(`\nIncludes ${sub.length} subagent Calls (counted in the totals above).`);
}

// ------------------------------------------------------------------ main --

const reportFrom = flag("--report");
if (reportFrom) {
	report(JSON.parse(await readFile(join(reportFrom, "bench.json"), "utf8")) as Bench);
} else {
	const named = flag("--workload") ?? "read-only-40";
	const workload = await loadWorkload(named.includes("/") ? resolve(named) : join(WORKLOADS, named));
	const all = turnsOf(workload);
	const turns = all.slice(0, Math.min(positive("--turns", all.length), all.length));
	const runs = positive("--runs", 3);
	const parallel = positive("--parallel", 2);
	const only = flag("--arm");
	if (only !== undefined && !ARMS.includes(only as Arm)) {
		throw new Error(`--arm is "${only}"; expected ${ARMS.join(" or ")}`);
	}
	const arms = only === undefined ? ARMS : [only as Arm];
	const server = process.env.PICHART_DATABASE_URL ?? readSavedUrl();
	if (arms.includes("pi-chart") && !server) {
		throw new Error("pi-chart Runs need a Thread Store server: set PICHART_DATABASE_URL, or run setup to save one");
	}
	const stamp = Date.now();
	const out = resolve(flag("--out") ?? join(tmpdir(), `pichart-bench-${stamp}`));
	await mkdir(join(out, "runs"), { recursive: true });

	const options: Options = {
		workload: { name: workload.name, version: workload.version, commit: workload.commit },
		model: flag("--model"),
		thinking: flag("--thinking"),
		turns: turns.length,
		omp: (await run(["omp", "--version"])).trim(),
	};

	// Built and installed once, before any Run: a Workload whose dependencies
	// do not install stops the benchmark here, and every Run copies the same tree.
	const template = await mkdtemp(join(tmpdir(), "pichart-template-"));
	try {
		log(`building ${workload.name} v${workload.version} at ${workload.commit.slice(0, 7)}`);
		await buildWorkspace(workload, template);
		await installDependencies(template);

		const ctx: Context = {
			workload,
			turns,
			graded: new Map(gradedSteps(workload, turns.length).map((step) => [step.id, step])),
			template,
			server,
			out,
			options,
			timeoutMs: positive("--turn-timeout", 600) * 1000,
			stamp,
		};
		// Interleave the Arms so drift over the session (provider load, cache
		// state) falls on both alike.
		const jobs = Array.from({ length: runs }, (_, index) => arms.map((arm) => () => runOne(arm, index, ctx))).flat();
		log(`${jobs.length} Conversations × ${turns.length} Turns, ${parallel} at a time`);
		const bench: Bench = { options, runs: await pool(jobs, parallel) };
		await writeFile(join(out, "bench.json"), JSON.stringify(bench, null, "\t"));
		log(`record: ${out}`);
		report(bench);
	} finally {
		await rm(template, { recursive: true, force: true });
	}
}
