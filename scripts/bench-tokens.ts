/**
 * Benchmarks what a Conversation costs in tokens with pi-chart against plain
 * oh-my-pi, on the same scripted workload.
 *
 * Two arms, each run in its own fresh copy of a Codebase:
 *
 * - **vanilla**: `omp --no-extensions` — the harness's accumulate-forward window.
 * - **pi-chart**: `omp --no-extensions -e src/extension.ts` — this extension
 *   alone, so the only difference between the arms is pi-chart.
 *
 * Every turn of the workload is one `omp -p` process, the second onwards with
 * `-c`, so a run is one multi-turn Conversation. Figures come from the
 * provider's own `usage` on each Call in the Journal — nothing is estimated.
 * The last prompt is a probe: it asks for a codeword given in the first
 * Turn and a build number given in the third, and the run scores each
 * separately. The codeword sits in Turn 0's prompt, which the Opening
 * carries; the build number sits only in a later Turn, so only recall can
 * bring it back. A cheaper arm that forgot what it was told is visible as
 * such. Probes are scored on the default workload only, never on a
 * `--workload` file.
 *
 *     bun scripts/bench-tokens.ts                       # 3 runs per arm
 *     bun scripts/bench-tokens.ts --runs 5 --parallel 4 --model sonnet
 *     bun scripts/bench-tokens.ts --turns 3 --runs 1    # smoke
 *     bun scripts/bench-tokens.ts --workload my.json    # ["prompt", …]
 *     bun scripts/bench-tokens.ts --report bench.json   # re-print a saved run
 *
 * Runs use the default session root on purpose: pi-chart finds a
 * Conversation's Journal only there, and `--session-dir` would leave it
 * assembling without the Thread Store. Benchmark Conversations are therefore
 * ingested into the Thread Store like any other; cross-Conversation recall is
 * an explicit query, so they reach no other Conversation's packs by default.
 *
 * Not counted: anything charged outside the provider's `usage` — the local
 * embedder, and the TypeSafe relevance judge (`PICHART_JUDGE`).
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SESSION_ROOT } from "../src/journal.ts";

const READ_RATE = 0.1;
const WRITE_RATE = 1.25;

const CODEWORD = "TANGERINE-42";
const BUILD_NUMBER = "7341";
const PROBE = `What codeword did I give you at the start of this conversation, and what build number did I give you later? Reply with just the codeword and the build number, using UNKNOWN for either you do not know. Do not use any tools.`;

/**
 * Read-only work over pi-chart's own source: each turn reads something new,
 * so an accumulating window grows, and there are more turns than the
 * default tail carries (`PICHART_TAIL_TURNS=8`), so the probe cannot be
 * answered from the tail: the codeword from the Opening, the build number
 * from recall.
 */
const DEFAULT_WORKLOAD = [
	`Remember this codeword for later: ${CODEWORD}. Then read src/pins.ts and say in two sentences what a Pin entry holds.`,
	"Read src/elision.ts. What does elision keep, and how is the shortened part marked? Three sentences at most.",
	`Where is PICHART_TAIL_TURNS read, and what is its default? Answer in one sentence. Also remember this build number for later: ${BUILD_NUMBER}.`,
	"Read src/tokens.ts and explain how token counts are estimated.",
	"Read src/sections.ts. What does it split, and on what boundaries?",
	"Read src/shares.ts and summarise what it computes.",
	"Read src/symbols.ts. How are symbols chosen for a pack?",
	"Read src/report.ts. List the sections of the report it renders.",
	"Read src/journal.ts. How is a Conversation's active branch found?",
	"Read src/turns.ts and src/thread-store.ts. How does a Turn get into the Thread Store?",
	"Read src/accounting.ts. What does a recorded part carry?",
	PROBE,
];

const NO_EDITS = " Do not modify any files and do not spawn subagents.";

const EXTENSION = resolve(import.meta.dir, "..", "src", "extension.ts");
const REPO = resolve(import.meta.dir, "..");

type Arm = "vanilla" | "pi-chart";
const ARMS: Arm[] = ["vanilla", "pi-chart"];

interface Call {
	turn: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	promptTokens: number;
	floor: number;
	subagent: boolean;
}

interface Run {
	arm: Arm;
	index: number;
	cwd: string;
	journal: string;
	turns: number;
	failedTurn?: number;
	/** `recalled`: the codeword, from Turn 0. `fact`: the build number, from turn 3. */
	probe?: { answer: string; recalled: boolean; fact?: boolean };
	calls: Call[];
}

interface Saved {
	options: { model?: string; thinking?: string; turns: number; workload: string[] };
	runs: Run[];
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

interface Entry {
	type?: string;
	cwd?: string;
	message?: {
		role?: string;
		usage?: {
			input?: number;
			output?: number;
			cacheRead?: number;
			cacheWrite?: number;
			cost?: { total?: number };
		};
		contextSnapshot?: { promptTokens?: number; nonMessageTokens?: number };
	};
}

function parse(text: string): Entry[] {
	const entries: Entry[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line) as Entry);
		} catch {
			// A partially flushed final line.
		}
	}
	return entries;
}

async function jsonlUnder(dir: string): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await jsonlUnder(path)));
		else if (entry.name.endsWith(".jsonl")) found.push(path);
	}
	return found;
}

/**
 * The Journal of the Conversation started in `cwd`, and any subagent Journals
 * beside it. The harness names a session directory after its working
 * directory, and every run has a unique one, so the directory is matched by
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
			const header = parse(await readFile(file, "utf8")).find((entry) => entry.type === "session");
			if (header?.cwd === cwd) main = file;
		}
		return { main, subagents: files.filter((file) => file !== main) };
	}
	return { subagents: [] };
}

function callsIn(entries: Entry[]): Omit<Call, "turn" | "subagent">[] {
	const calls: Omit<Call, "turn" | "subagent">[] = [];
	for (const entry of entries) {
		const usage = entry.message?.usage;
		if (entry.type !== "message" || entry.message?.role !== "assistant" || !usage) continue;
		const input = usage.input ?? 0;
		const cacheRead = usage.cacheRead ?? 0;
		const cacheWrite = usage.cacheWrite ?? 0;
		calls.push({
			input,
			output: usage.output ?? 0,
			cacheRead,
			cacheWrite,
			cost: usage.cost?.total ?? 0,
			promptTokens: entry.message.contextSnapshot?.promptTokens ?? input + cacheRead + cacheWrite,
			floor: entry.message.contextSnapshot?.nonMessageTokens ?? 0,
		});
	}
	return calls;
}

// ------------------------------------------------------------------- run --

async function copyCodebase(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), "pichart-bench-"));
	// Tracked files at HEAD only: both arms start from the same tree, and
	// nothing derived (graphify-out/, node_modules/) leaks in from this one.
	const archive = Bun.spawn(["git", "-C", REPO, "archive", "HEAD"], { stdout: "pipe" });
	const extract = Bun.spawn(["tar", "-x", "-C", cwd], { stdin: archive.stdout });
	if ((await archive.exited) !== 0 || (await extract.exited) !== 0) {
		throw new Error(`could not copy ${REPO} at HEAD into ${cwd}`);
	}
	const init = Bun.spawn(["git", "init", "-q"], { cwd });
	await init.exited;
	return cwd;
}

async function runOne(
	arm: Arm,
	index: number,
	workload: string[],
	options: Saved["options"],
	timeoutMs: number,
	scored: boolean,
): Promise<Run> {
	const cwd = await copyCodebase();
	const run: Run = { arm, index, cwd, journal: "", turns: 0, calls: [] };
	let seen = 0;
	for (const [turn, prompt] of workload.entries()) {
		const args = ["omp", "-p", "--no-title", "--no-extensions"];
		if (arm === "pi-chart") args.push("-e", EXTENSION);
		if (options.model) args.push("--model", options.model);
		if (options.thinking) args.push("--thinking", options.thinking);
		if (turn > 0) args.push("-c");
		args.push(prompt === PROBE ? prompt : prompt + NO_EDITS);

		const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
		const timer = setTimeout(() => proc.kill(), timeoutMs);
		const [stdout, , code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		clearTimeout(timer);

		const { main } = await journalsFor(cwd);
		if (main) {
			run.journal = main;
			const calls = callsIn(parse(await readFile(main, "utf8")));
			for (const call of calls.slice(seen)) run.calls.push({ ...call, turn, subagent: false });
			seen = calls.length;
		}
		if (code !== 0 || !main) {
			run.failedTurn = turn;
			log(`${arm}#${index} turn ${turn + 1} failed (exit ${code}${main ? "" : ", no journal"})`);
			break;
		}
		run.turns = turn + 1;
		if (scored && prompt === PROBE) {
			const answer = stdout.replace(/^Working\.\.\.\s*/m, "").trim();
			run.probe = {
				answer: answer.slice(0, 200),
				recalled: answer.includes(CODEWORD),
				fact: answer.includes(BUILD_NUMBER),
			};
		}
		log(`${arm}#${index} turn ${turn + 1}/${workload.length}`);
	}

	const { subagents } = await journalsFor(cwd);
	for (const file of subagents) {
		for (const call of callsIn(parse(await readFile(file, "utf8")))) {
			run.calls.push({ ...call, turn: -1, subagent: true });
		}
	}
	await rm(cwd, { recursive: true, force: true });
	return run;
}

function log(message: string): void {
	process.stderr.write(`[bench] ${message}\n`);
}

async function pool<T>(jobs: (() => Promise<T>)[], width: number): Promise<T[]> {
	const results: T[] = new Array(jobs.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(width, jobs.length) }, async () => {
			while (next < jobs.length) {
				const at = next++;
				results[at] = await (jobs[at] as () => Promise<T>)();
			}
		}),
	);
	return results;
}

// ---------------------------------------------------------------- report --

function median(values: number[]): number {
	if (values.length === 0) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

interface Totals {
	calls: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	prompt: number;
	effective: number;
	cost: number;
	peak: number;
	floor: number;
	prefixHeld: number;
	earlyWrite: number;
}

/**
 * Turns before the verbatim tail starts sliding (the default tail is eight
 * Turns, so turn 9 is the first whose tail drops one). The cache figures
 * that judge Pack order are read over these, where nothing but order and
 * assembled-part churn moves the cached prefix.
 */
const EARLY_TURNS = 7;

/**
 * The share of consecutive main-agent Call pairs on the early turns, in-Turn
 * and across a Turn boundary alike, where the next Call read back at least
 * everything the previous one read or wrote: its whole prompt stayed a
 * cached prefix. NaN when there is no pair.
 */
function prefixHeld(run: Run): number {
	const early = run.calls.filter((c) => !c.subagent && c.turn < EARLY_TURNS);
	let pairs = 0;
	let held = 0;
	for (let index = 1; index < early.length; index++) {
		const before = early[index - 1] as Call;
		const after = early[index] as Call;
		pairs++;
		if (after.cacheRead >= before.cacheRead + before.cacheWrite) held++;
	}
	return pairs === 0 ? Number.NaN : held / pairs;
}

function totals(run: Run): Totals {
	const sum = (pick: (call: Call) => number) => run.calls.reduce((acc, call) => acc + pick(call), 0);
	const input = sum((c) => c.input);
	const cacheRead = sum((c) => c.cacheRead);
	const cacheWrite = sum((c) => c.cacheWrite);
	const output = sum((c) => c.output);
	return {
		calls: run.calls.length,
		input,
		cacheRead,
		cacheWrite,
		output,
		prompt: input + cacheRead + cacheWrite,
		effective: input + cacheRead * READ_RATE + cacheWrite * WRITE_RATE,
		cost: sum((c) => c.cost),
		peak: Math.max(0, ...run.calls.filter((c) => !c.subagent).map((c) => c.promptTokens)),
		floor: median(run.calls.filter((c) => !c.subagent).map((c) => c.floor)),
		prefixHeld: prefixHeld(run),
		earlyWrite: run.calls
			.filter((c) => !c.subagent && c.turn < EARLY_TURNS)
			.reduce((acc, c) => acc + c.cacheWrite, 0),
	};
}

const int = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString("en-US") : "—");
const percent = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : "—");

function report(saved: Saved): void {
	const complete = saved.runs.filter((run) => run.failedTurn === undefined);
	const rows: [string, (t: Totals) => number, (x: number) => string][] = [
		["Calls", (t) => t.calls, int],
		["Prompt tokens sent (input + cache read + cache write)", (t) => t.prompt, int],
		["Uncached input", (t) => t.input, int],
		["Cache read", (t) => t.cacheRead, int],
		["Cache write", (t) => t.cacheWrite, int],
		["Output", (t) => t.output, int],
		[`Effective input (read ×${READ_RATE}, write ×${WRITE_RATE})`, (t) => t.effective, int],
		["Cost, USD (harness pricing)", (t) => t.cost, (x) => (Number.isFinite(x) ? `$${x.toFixed(4)}` : "—")],
		["Peak window, tokens", (t) => t.peak, int],
		["Floor, tokens", (t) => t.floor, int],
		[`Cache write, turns 1–${EARLY_TURNS}`, (t) => t.earlyWrite, int],
		[`Prefix held, turns 1–${EARLY_TURNS} (next Call read all the last read or wrote)`, (t) => t.prefixHeld, percent],
	];
	const byArm = Object.fromEntries(
		ARMS.map((arm) => [arm, complete.filter((run) => run.arm === arm).map(totals)]),
	) as Record<Arm, Totals[]>;

	console.log(
		`\nmodel ${saved.options.model ?? "(omp default)"}, thinking ${saved.options.thinking ?? "(default)"}, ` +
			`${saved.options.turns} turns; complete runs: vanilla ${byArm.vanilla.length}, pi-chart ${byArm["pi-chart"].length}` +
			(complete.length < saved.runs.length ? ` (${saved.runs.length - complete.length} failed, excluded)` : ""),
	);
	console.log("\nPer Conversation, median over runs:\n");
	console.log("| Metric | vanilla | pi-chart | pi-chart / vanilla |");
	console.log("| --- | ---: | ---: | ---: |");
	for (const [label, pick, show] of rows) {
		const v = median(byArm.vanilla.map(pick));
		const p = median(byArm["pi-chart"].map(pick));
		const ratio = v > 0 && Number.isFinite(p) ? `${(p / v).toFixed(2)}×` : "—";
		console.log(`| ${label} | ${show(v)} | ${show(p)} | ${ratio} |`);
	}

	// Gated on what the runs recorded, not on the probe's wording, so a run
	// saved before the wording changed still reports what it scored.
	const scoredRuns = complete.filter((run) => run.probe);
	const tally = (hit: (run: Run) => boolean | undefined) =>
		ARMS.map((arm) => {
			const probed = scoredRuns.filter((run) => run.arm === arm);
			return `${arm} ${probed.filter(hit).length}/${probed.length}`;
		}).join(", ");
	if (scoredRuns.length > 0) {
		console.log(`\nCodeword recalled at the probe: ${tally((run) => run.probe?.recalled)}`);
	}
	if (scoredRuns.some((run) => run.probe?.fact !== undefined)) {
		console.log(`Build number recalled at the probe: ${tally((run) => run.probe?.fact)}`);
	}

	console.log("\nWindow size per turn (median prompt tokens of the turn's last Call):\n");
	console.log("| Turn | vanilla | pi-chart |");
	console.log("| ---: | ---: | ---: |");
	for (let turn = 0; turn < saved.options.turns; turn++) {
		const cell = (arm: Arm) =>
			int(
				median(
					complete
						.filter((run) => run.arm === arm)
						.map((run) => run.calls.filter((c) => c.turn === turn).at(-1)?.promptTokens)
						.filter((x): x is number => x !== undefined),
				),
			);
		console.log(`| ${turn + 1} | ${cell("vanilla")} | ${cell("pi-chart")} |`);
	}
	const sub = complete.flatMap((run) => run.calls.filter((c) => c.subagent));
	if (sub.length > 0) console.log(`\nIncludes ${sub.length} subagent Calls (counted in the totals above).`);
}

// ------------------------------------------------------------------ main --

const reportFrom = flag("--report");
if (reportFrom) {
	report(JSON.parse(await readFile(reportFrom, "utf8")) as Saved);
} else {
	const workloadFile = flag("--workload");
	const full = workloadFile
		? (JSON.parse(await readFile(workloadFile, "utf8")) as string[])
		: DEFAULT_WORKLOAD;
	if (!Array.isArray(full) || full.some((p) => typeof p !== "string") || full.length === 0) {
		throw new Error("a workload is a non-empty JSON array of prompt strings");
	}
	const turns = Math.min(positive("--turns", full.length), full.length);
	const workload = full.slice(0, turns);
	const runs = positive("--runs", 3);
	const options: Saved["options"] = {
		model: flag("--model"),
		thinking: flag("--thinking"),
		turns,
		workload,
	};
	const out = flag("--out") ?? join(tmpdir(), `pichart-bench-${Date.now()}.json`);
	const timeoutMs = positive("--turn-timeout", 600) * 1000;

	// Interleave the arms so drift over the session (provider load, cache
	// state) falls on both alike.
	const jobs = Array.from({ length: runs }, (_, index) =>
		ARMS.map((arm) => () => runOne(arm, index, workload, options, timeoutMs, !workloadFile)),
	).flat();
	log(`${jobs.length} Conversations × ${turns} turns, ${positive("--parallel", 2)} at a time`);
	const saved: Saved = { options, runs: await pool(jobs, positive("--parallel", 2)) };
	await Bun.write(out, JSON.stringify(saved, null, "\t"));
	log(`raw figures: ${out}`);
	report(saved);
}
