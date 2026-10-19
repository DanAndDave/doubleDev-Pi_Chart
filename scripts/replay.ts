/**
 * Replays a recorded Run through omp's own code path: every Turn's prompt is
 * sent again, and `scripts/replay-ext.ts` answers each Call with the reply
 * the Journal recorded, so omp and pi-chart rebuild every request the Run
 * sent. Nothing reaches the model; the token-counting endpoint counts each
 * rebuilt request, which is free.
 *
 *     bun scripts/replay.ts check <run-dir> [--commit <rev>] [--bodies]
 *
 * `check` prints, per main Call, the endpoint's count of the rebuilt request
 * minus the Call's `usage` input total (input + cache read + cache write),
 * and how many Calls fall in `OFFSET_BAND`, the offset byte-identical
 * requests show. `--bodies` keeps each rebuilt request in the output folder.
 *
 * Before the first Turn the Run's inputs are recreated: its workspace at its
 * recorded path from its Workload, a fresh copy of the bundle, and for a
 * pi-chart Run the pi-chart tree at the recorded commit (`piChart` in
 * `run.json`, or `--commit` for a record older than that field) with a fresh
 * Thread Store database migrated by that tree. The session id and the
 * original Run's local date are pinned into every request. Afterwards the
 * replay's own Journals move out of the session root, and its workspace,
 * bundle, tree and database are removed.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SESSION_ROOT } from "../src/journal.ts";
import { readRecord, type RunRecord } from "./measures.ts";
import { CALL_FILE, type CallFile, journalMessages, restoredJournal } from "./replay-ext.ts";
import {
	buildTree,
	createDatabase,
	dropDatabase,
	endProcessesIn,
	flagsOf,
	loadNamedWorkload,
	ompEnv,
	ompVersion,
	piChartExtensions,
	requireThreadStore,
	resolveCommit,
} from "./runs.ts";
import { buildWorkspace, installDependencies } from "./workload.ts";

const REPLAY_EXT = join(import.meta.dir, "replay-ext.ts");
/** Any value: omp then routes Anthropic Calls through fetch, which the extension wraps. */
const DEAD_PROXY = "http://127.0.0.1:9";
/** How long omp lets a request stay open: a planned Call's sends must finish within it. */
const HOLD_LIMIT_MS = 6 * 60 * 60 * 1000;
/** A Turn may hold several planned Calls; past the hold limit it is hung, and ends. */
const TURN_TIMEOUT_MS = HOLD_LIMIT_MS;

/**
 * The endpoint's count minus `usage`'s input total, on byte-identical
 * requests: measured on omp 18.10.4 (question 04) and again on 18.11.0
 * over the A/A records. A rebuilt Call inside it is faithful.
 */
export const OFFSET_BAND: [number, number] = [43, 46];

export interface ReplayOptions {
	runDir: string;
	/** The pi-chart commit, for a record that names none. */
	commit?: string;
	/** A built tree of that commit (`buildTree`) to load instead of building one; the caller removes it. */
	tree?: string;
	/** Where call-NNN.json and the replay's own Journals go; emptied first. */
	out: string;
	/** Replay Turns [0, turns); every completed Turn by default. */
	turns?: number;
	/** An Ablation plan (`Plan` in `replay-ext.ts`): its planned Calls are resent, and their results come back in `calls`. */
	plan?: string;
	bodies?: boolean;
}

export interface Replayed {
	/** One per Call the replay rebuilt, by index. */
	calls: CallFile[];
}

/** The session header of a Journal: its Conversation's id and when it started. */
async function sessionOf(journal: string): Promise<{ id: string; timestamp: string; cwd: string }> {
	for (const line of (await readFile(journal, "utf8")).split("\n")) {
		if (!line.trim()) continue;
		const entry = JSON.parse(line) as { type?: string; id?: string; timestamp?: string; cwd?: string };
		if (entry.type === "session" && entry.id && entry.timestamp && entry.cwd) {
			return { id: entry.id, timestamp: entry.timestamp, cwd: entry.cwd };
		}
	}
	throw new Error(`${journal} has no session header`);
}

/** The session directory omp keeps a Conversation started in `cwd` under. */
function sessionDir(cwd: string): string {
	return join(SESSION_ROOT, `-${cwd.replace(/^\//, "").replaceAll("/", "-")}`);
}

/**
 * Why a Run cannot be replayed, or undefined when it can. Checked before
 * anything is recreated.
 */
export async function refusal(runDir: string, record: RunRecord, commit: string | undefined): Promise<string | undefined> {
	const omp = await ompVersion();
	if (omp !== record.omp) return `the record ran on ${record.omp}, and ${omp} is installed`;
	const workload = await loadNamedWorkload(record.workload.name);
	if (workload.version !== record.workload.version) {
		return `the record ran ${record.workload.name} v${record.workload.version}, and the Workload is now v${workload.version}`;
	}
	if (record.arm === "pi-chart" && !record.piChart && !commit) {
		return "the record names no pi-chart commit: give one with --commit <rev>";
	}
	const subagents = await readdir(join(runDir, "subagents")).catch(() => [] as string[]);
	if (subagents.some((name) => name.endsWith(".jsonl"))) return "the record holds subagent Journals";
	if (existsSync(record.cwd)) return `${record.cwd}, the recorded path, is in use`;
	return undefined;
}

/**
 * Replays the Run in `runDir`: recreates its inputs, sends its prompts
 * through omp answered from its Journal, and cleans up. Throws, naming the
 * reason, when the Run cannot be replayed.
 */
export async function replay(options: ReplayOptions): Promise<Replayed> {
	const runDir = resolve(options.runDir);
	const record = await readRecord(runDir);
	const reason = await refusal(runDir, record, options.commit);
	if (reason) throw new Error(`cannot replay ${runDir}: ${reason}`);
	const journal = join(runDir, "journal.jsonl");
	const session = await sessionOf(journal);
	const commit = record.piChart ?? options.commit;
	const out = resolve(options.out);
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });

	const cwd = record.cwd;
	const sessions = sessionDir(cwd);
	const before = new Set(await readdir(sessions).catch(() => [] as string[]));
	const workload = await loadNamedWorkload(record.workload.name);
	const completed = record.failedTurn ?? record.prompts.length;
	const prompts = record.prompts.slice(0, Math.min(options.turns ?? completed, completed));
	const temporary: string[] = [cwd];
	let server: string | undefined;
	let database: string | undefined;
	try {
		await mkdir(cwd, { recursive: true });
		await buildWorkspace(workload, cwd);
		await installDependencies(cwd);
		const bundle = await mkdtemp(join(tmpdir(), "pichart-bundle-"));
		temporary.push(bundle);
		if (existsSync(join(workload.dir, "bundle"))) await cp(join(workload.dir, "bundle"), bundle, { recursive: true });
		// A planned Call holds omp's request open for its sends, minutes at a
		// time. omp's stream watchdogs would abort it at 300 s, and the SDK at
		// 600 s unless the first-event watchdog is set (omp passes it on as the
		// request timeout; 0 falls back to the SDK's 600 s). Its cache warmer
		// would send a request of its own at 270 s, shifting every later Call's
		// ordinal. None of them touches a request body.
		const overlay = join(out, "omp.yml");
		await writeFile(overlay, 'providers:\n  cacheWarming: "off"\n');
		let env: Record<string, string | undefined> = ompEnv({
			...process.env,
			PI_PROXY_ANTHROPIC: DEAD_PROXY,
			PI_STREAM_FIRST_EVENT_TIMEOUT_MS: String(HOLD_LIMIT_MS),
			PI_STREAM_IDLE_TIMEOUT_MS: String(HOLD_LIMIT_MS),
			PICHART_DOC_BUNDLE: bundle,
			REPLAY_MODE: "stub",
			REPLAY_DIR: out,
			REPLAY_JOURNAL: journal,
			REPLAY_SESSION_ID: session.id,
			// omp's "Today:" line is the local date.
			REPLAY_TODAY: new Date(session.timestamp).toLocaleDateString("en-CA"),
			...(options.bodies ? { REPLAY_BODIES: "1" } : {}),
			...(options.plan ? { REPLAY_PLAN: resolve(options.plan) } : {}),
		});
		let extension: string | undefined;
		if (record.arm === "pi-chart") {
			const tree = options.tree ?? (await buildTree(commit as string));
			if (!options.tree) temporary.push(tree);
			server = requireThreadStore("pi-chart replays");
			database = `replay_${Date.now()}_${process.pid}`;
			env = ompEnv(env, await createDatabase(server, database, tree));
			extension = join(tree, "src", "extension.ts");
		}

		const original = journalMessages(journal);
		for (const [turn, prompt] of prompts.entries()) {
			const args = ["omp", "-p", "--no-title", "--no-extensions", "--config", overlay];
			if (extension) args.push(...piChartExtensions(extension));
			args.push("-e", REPLAY_EXT);
			if (record.model) args.push("--model", record.model);
			if (record.thinking) args.push("--thinking", record.thinking);
			if (turn > 0) args.push("-c");
			args.push(prompt.text);
			const proc = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
			const timer = setTimeout(() => proc.kill(), TURN_TIMEOUT_MS);
			const [stdout, stderr, code] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			clearTimeout(timer);
			// The reply is on stdout too; only harness and extension complaints matter.
			const errors = `${stdout}\n${stderr}`
				.split("\n")
				.filter((line) => /^(Extension error|Error|\[pi-chart\])|replay-ext/.test(line.trim()));
			if (code !== 0) {
				throw new Error(`replay Turn ${turn + 1} exited ${code}${errors.length ? `: ${errors.join(" | ").slice(0, 2000)}` : ""}`);
			}
			// A complaint from a Turn that completed is reported, not fatal: the
			// band judges every Call it could have changed, and an out-of-band
			// Call is unfaithful, never judged. The original Run went on past
			// such complaints as well (`runOne` fails a Turn only on its exit).
			if (errors.length > 0) process.stderr.write(`[replay] Turn ${turn + 1}: ${errors.join(" | ").slice(0, 2000)}\n`);
			// omp persisted this Turn's messages before the extension's handlers
			// set the original's values; the next Turn resumes from the file.
			const own = (await readdir(sessions)).filter((name) => name.endsWith(".jsonl") && !before.has(name));
			if (own.length !== 1) throw new Error(`replay Turn ${turn + 1}: expected one Journal of its own, found ${own.length}`);
			const file = join(sessions, own[0] as string);
			await writeFile(file, restoredJournal(await readFile(file, "utf8"), original));
			process.stderr.write(`[replay] Turn ${turn + 1}/${prompts.length}\n`);
		}
	} finally {
		// Every step runs whatever failed before it, so a replay never leaves a
		// Journal, database or workspace of its own behind.
		const failures: string[] = [];
		const attempt = async (what: string, step: () => Promise<unknown>) => {
			try {
				await step();
			} catch (error) {
				failures.push(`could not ${what}: ${error instanceof Error ? error.message : error}`);
			}
		};
		// The replay's own Journals sit beside the original's; they move into
		// `out`, so the session root holds only what the original Run wrote.
		await attempt("move its Journals", async () => {
			const made = (await readdir(sessions).catch(() => [] as string[])).filter((name) => !before.has(name));
			for (const name of made) {
				await cp(join(sessions, name), join(out, "sessions", name), { recursive: true });
				await rm(join(sessions, name), { recursive: true, force: true });
			}
		});
		if (server && database) {
			const [at, name] = [server, database];
			await attempt("drop its database", () => dropDatabase(at, name));
		}
		// pi-chart starts graph extraction detached, so it can outlive omp and
		// write into the workspace after it is removed; the next replay of this
		// Run would then find the recorded path in use.
		await attempt("end what still runs in its workspace", () => endProcessesIn(cwd));
		for (const dir of temporary) await attempt(`remove ${dir}`, () => rm(dir, { recursive: true, force: true }));
		if (failures.length > 0) process.stderr.write(`[replay] ${failures.join("\n[replay] ")}\n`);
	}
	return { calls: await callFiles(out) };
}

/** The call-NNN.json files a replay wrote to `dir`, in Call order. */
export async function callFiles(dir: string): Promise<CallFile[]> {
	const names = (await readdir(dir)).filter((name) => CALL_FILE.test(name)).sort();
	return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(dir, name), "utf8")) as CallFile));
}

async function check(argv: string[]): Promise<void> {
	const runDir = argv.find((arg, at) => at > 0 && !arg.startsWith("--") && !argv[at - 1]?.startsWith("--"));
	if (!runDir) throw new Error("usage: bun scripts/replay.ts check <run-dir> [--commit <rev>] [--bodies]");
	const { flag } = flagsOf(argv);
	const commitRev = flag("--commit");
	const commit = commitRev ? await resolveCommit(commitRev) : undefined;
	const out = await mkdtemp(join(tmpdir(), "pichart-replay-"));
	const { calls } = await replay({ runDir, commit, out, bodies: argv.includes("--bodies") });
	const [low, high] = OFFSET_BAND;
	const offsets = calls.map((call) => (call.count === undefined ? undefined : call.count - call.usage));
	for (const [at, call] of calls.entries()) {
		console.log(`call ${String(call.index).padStart(3)}  usage ${call.usage}  count ${call.count ?? call.error}  offset ${offsets[at] ?? "-"}`);
	}
	const counted = offsets.filter((offset): offset is number => offset !== undefined);
	const inside = counted.filter((offset) => offset >= low && offset <= high).length;
	const recorded = (await readFile(join(resolve(runDir), "journal.jsonl"), "utf8")).match(/"role":"assistant"/g)?.length ?? 0;
	const range = counted.length > 0 ? `offsets ${Math.min(...counted)}..${Math.max(...counted)}` : "no Call counted";
	console.log(`${calls.length} of ${recorded} Calls rebuilt; ${inside} in the band ${low}..${high}; ${range}; output ${out}`);
}

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const command = argv[0];
	const done = command === "check" ? check(argv) : Promise.reject(new Error("usage: bun scripts/replay.ts check <run-dir> [--commit <rev>] [--bodies]"));
	await done.catch((error: unknown) => {
		console.error(`replay: ${error instanceof Error ? error.message : error}`);
		process.exitCode = 1;
	});
}
