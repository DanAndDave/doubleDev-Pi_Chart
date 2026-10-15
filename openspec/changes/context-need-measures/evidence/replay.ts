/**
 * Throwaway for ticket 04, "Can a Call be replayed". Rebuilds every Call of a
 * recorded Conversation through omp's own code path and checks each rebuilt
 * request against ground truth.
 *
 *   bun replay.ts record --arm vanilla|pi-chart --turns 3 --out runs/rec-vanilla
 *       A fresh bench-style Run (first N prompts of bench-tokens' Workload, one
 *       `omp -p` per Turn, `-c` after the first) whose Calls really go to
 *       Anthropic, with every request kept byte for byte. Costs model spend.
 *
 *   bun replay.ts replay --journal <main.jsonl> --arm <arm> --commit <sha> --out runs/rep-x
 *       Recreates the Run's Codebase copy at its original path from <sha>,
 *       then re-runs every Turn's prompt with omp answered by a stub that
 *       returns the Journal's recorded replies and tool results, keeping each
 *       request omp builds. pi-chart Runs get a fresh, empty Thread Store
 *       database, which the replay fills as the original filled its own.
 *       Free: nothing reaches the model; only the token-counting endpoint.
 *
 *   bun replay.ts check --journal <main.jsonl> --replay runs/rep-x [--record runs/rec-x]
 *       Per Call: the provider's input total from `usage` (input + cacheRead
 *       + cacheWrite) against the token-counting endpoint's count of the
 *       rebuilt request; with --record, also byte equality against the
 *       captured request and the JSON paths that differ.
 *
 * Flags: --omp <binary> (default: omp 18.10.4, the version the 2026-10-14
 * benches ran); --store <postgres url> (server for replay databases; default
 * the compose Thread Store). replay only: --new-session keeps the replay's
 * own session id (and so its own `cch`); --today-now keeps today's date in
 * the first message instead of the original Run's.
 */
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SQL } from "bun";
import { PostgresStore } from "../../../../src/postgres-store.ts";

const HERE = import.meta.dir;
const REPO = resolve(HERE, "../../../..");
const EXTENSION = join(REPO, "src", "extension.ts");
const REPLAY_EXT = join(HERE, "replay-ext.ts");
const SESSION_ROOT = join(process.env.HOME ?? "", ".omp", "agent", "sessions");
const OMP_18_10_4 = join(
	process.env.HOME ?? "",
	".local/share/mise/installs/github-can1357-oh-my-pi/18.10.4/omp",
);
/** Any value: omp then routes Anthropic Calls through fetch, which the extension wraps. */
const DEAD_PROXY = "http://127.0.0.1:9";

// The first prompts of scripts/bench-tokens.ts's DEFAULT_WORKLOAD, with its suffix.
const WORKLOAD = [
	"Remember this codeword for later: TANGERINE-42. Then read src/pins.ts and say in two sentences what a Pin entry holds.",
	"Read src/elision.ts. What does elision keep, and how is the shortened part marked? Three sentences at most.",
	"Where is PICHART_TAIL_TURNS read, and what is its default? Answer in one sentence. Also remember this build number for later: 7341.",
];
const NO_EDITS = " Do not modify any files and do not spawn subagents.";

type Arm = "vanilla" | "pi-chart";

interface Message {
	role: string;
	content: { type: string; text?: string }[] | string;
	usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost?: { total?: number } };
}

interface Entry {
	type?: string;
	id?: string;
	cwd?: string;
	timestamp?: string;
	message?: Message;
}

interface Captured {
	index: number;
	body: string;
	count: { input_tokens?: number; error?: string };
	status?: number;
}

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
	const at = argv.indexOf(name);
	return at === -1 ? undefined : argv[at + 1];
};
const required = (name: string): string => {
	const value = flag(name);
	if (!value) throw new Error(`${name} is required`);
	return value;
};

async function entries(path: string): Promise<Entry[]> {
	return (await readFile(path, "utf8"))
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as Entry);
}

const messages = (list: Entry[], role: string): Message[] =>
	list.filter((e) => e.type === "message" && e.message?.role === role).map((e) => e.message as Message);

/** Main-session Journals directly under the session directory for `cwd`. */
async function journalsIn(cwd: string): Promise<string[]> {
	const dir = join(SESSION_ROOT, `-${cwd.replace(/^\//, "").replaceAll("/", "-")}`);
	const names = await readdir(dir).catch(() => [] as string[]);
	return names.filter((name) => name.endsWith(".jsonl")).map((name) => join(dir, name));
}

/** A Codebase copy as bench-tokens makes one: tracked files at `commit`, then an empty `git init`. */
async function copyCodebase(commit: string, cwd: string): Promise<void> {
	await rm(cwd, { recursive: true, force: true });
	await mkdir(cwd, { recursive: true });
	const archive = Bun.spawn(["git", "-C", REPO, "archive", commit], { stdout: "pipe" });
	const extract = Bun.spawn(["tar", "-x", "-C", cwd], { stdin: archive.stdout });
	if ((await archive.exited) !== 0 || (await extract.exited) !== 0) throw new Error(`git archive ${commit} failed`);
	await Bun.spawn(["git", "init", "-q"], { cwd }).exited;
}

async function runTurns(options: {
	arm: Arm;
	cwd: string;
	prompts: string[];
	omp: string;
	env: Record<string, string>;
}): Promise<void> {
	for (const [turn, prompt] of options.prompts.entries()) {
		const args = [options.omp, "-p", "--no-title", "--no-extensions"];
		if (options.arm === "pi-chart") args.push("-e", EXTENSION);
		args.push("-e", REPLAY_EXT);
		if (turn > 0) args.push("-c");
		args.push(prompt);
		const proc = Bun.spawn(args, {
			cwd: options.cwd,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, PI_PROXY_ANTHROPIC: DEAD_PROXY, ...options.env },
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		// The model's own reply is on stdout too; only harness and extension complaints matter.
		const errors = `${stdout}\n${stderr}`
			.split("\n")
			.filter((line) => /^(Extension error|Error|\[pi-chart\])|replay-ext/.test(line.trim()));
		console.error(`[replay] turn ${turn + 1}/${options.prompts.length} exit ${code}${errors.length ? `\n  ${errors.join("\n  ")}` : ""}`);
		if (code !== 0) throw new Error(`turn ${turn + 1} failed`);
	}
}

async function record(): Promise<void> {
	const arm = required("--arm") as Arm;
	const out = resolve(required("--out"));
	const turns = Number(flag("--turns") ?? WORKLOAD.length);
	const omp = flag("--omp") ?? OMP_18_10_4;
	const commit = (await new Response(Bun.spawn(["git", "-C", REPO, "rev-parse", "HEAD"]).stdout).text()).trim();
	const cwd = await mkdtemp(join(tmpdir(), "pichart-bench-"));
	await copyCodebase(commit, cwd);
	await rm(out, { recursive: true, force: true });
	await runTurns({
		arm,
		cwd,
		omp,
		prompts: WORKLOAD.slice(0, turns).map((prompt) => prompt + NO_EDITS),
		env: { REPLAY_MODE: "record", REPLAY_DIR: out },
	});
	const [journal] = await journalsIn(cwd);
	const list = await entries(journal);
	const spend = messages(list, "assistant").reduce((sum, m) => sum + (m.usage?.cost?.total ?? 0), 0);
	await writeFile(join(out, "manifest.json"), JSON.stringify({ arm, cwd, commit, omp, journal, spend }, null, 2));
	await rm(cwd, { recursive: true, force: true });
	console.log(JSON.stringify({ journal, spend }));
}

async function replay(): Promise<void> {
	const journal = resolve(required("--journal"));
	const arm = required("--arm") as Arm;
	const commit = required("--commit");
	const out = resolve(required("--out"));
	const omp = flag("--omp") ?? OMP_18_10_4;
	const list = await entries(journal);
	const header = list.find((e) => e.type === "session");
	const cwd = header?.cwd;
	if (!cwd || !header?.id) throw new Error("no session header");
	const prompts = messages(list, "user").map((m) =>
		typeof m.content === "string" ? m.content : m.content.map((b) => b.text ?? "").join(""),
	);
	const before = new Set(await journalsIn(cwd));
	await copyCodebase(commit, cwd);
	await rm(out, { recursive: true, force: true });

	const env: Record<string, string> = { REPLAY_MODE: "stub", REPLAY_DIR: out, REPLAY_JOURNAL: journal };
	// --new-session leaves the replay's own session id in the body, and with it a different `cch`.
	if (!argv.includes("--new-session")) env.REPLAY_SESSION_ID = header.id;
	// --today-now leaves the replay's own date in the first message. Else the
	// original's local date, which omp's "Today:" line uses.
	if (!argv.includes("--today-now")) env.REPLAY_TODAY = new Date(header.timestamp ?? "").toLocaleDateString("en-CA");
	let database: string | undefined;
	const server = flag("--store") ?? "postgres://pi_chart:pi_chart@localhost:55432/thread_store";
	if (arm === "pi-chart") {
		database = `replay_${Date.now()}`;
		const admin = new SQL(server);
		await admin.unsafe(`CREATE DATABASE ${database}`);
		await admin.end();
		const url = new URL(server);
		url.pathname = `/${database}`;
		env.PICHART_DATABASE_URL = String(url);
		// Migrated before the first Turn, as the original's store was: a fresh
		// database migrating inside the first Turn misses the Thread Store
		// deadline and that Turn goes out without its Opening.
		const store = PostgresStore.connect(String(url));
		await store.migrate();
		await store.close();
	}
	try {
		await runTurns({ arm, cwd, omp, prompts, env });
	} finally {
		// The replay's own Journal sits beside the original; it moves into `out`
		// so the session directory holds only what the original Run wrote.
		const made = (await journalsIn(cwd)).filter((path) => !before.has(path));
		const kept = made.map((path, i) => join(out, `replay-journal-${i}.jsonl`));
		for (const [i, path] of made.entries()) {
			await copyFile(path, kept[i]);
			await rm(path);
		}
		await writeFile(
			join(out, "manifest.json"),
			JSON.stringify({ arm, cwd, commit, omp, journal, replayJournals: kept, database }, null, 2),
		);
		await rm(cwd, { recursive: true, force: true });
		if (database) {
			const replayStore = new SQL(env.PICHART_DATABASE_URL);
			const tails = await tailsOf(replayStore);
			await replayStore.end();
			await writeFile(join(out, "accounting.json"), JSON.stringify(tails));
			const admin = new SQL(server);
			await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
			await admin.end();
		}
	}
}

interface Tail {
	turn: number;
	call: number;
	source: string | null;
	/** The Turns the Call's verbatim tail carried, from its Accounting. */
	tail: number[] | null;
}

/** Every recorded Call's tail, in Call order; one Conversation, or the only one there is. */
async function tailsOf(sql: SQL, conversationId?: string): Promise<Tail[]> {
	const rows = (await sql.unsafe(
		`SELECT turn_index, call_index, tail_source, parts FROM call_accounting
		 WHERE $1::text IS NULL OR conversation_id = $1 ORDER BY turn_index, call_index`,
		[conversationId ?? null],
	)) as { turn_index: number; call_index: number; tail_source: string | null; parts: unknown }[];
	return rows.map((row) => {
		const parts = (typeof row.parts === "string" ? JSON.parse(row.parts) : row.parts) as {
			source: string;
			turnIndices?: number[];
		}[];
		const tail = parts.find((part) => part.source === "verbatim-tail")?.turnIndices ?? null;
		return { turn: row.turn_index, call: row.call_index, source: row.tail_source, tail };
	});
}

async function captured(dir: string): Promise<Captured[]> {
	const names = (await readdir(dir)).filter((name) => /^call-\d+\.json$/.test(name)).sort();
	return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(dir, name), "utf8")) as Captured));
}

/** JSON paths at which two values differ, deepest first-found, at most `limit`. */
function differences(a: unknown, b: unknown, path = "$", found: string[] = [], limit = 12): string[] {
	if (found.length >= limit) return found;
	if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || a === null || b === null || typeof a !== "object") {
		if (!Bun.deepEquals(a, b)) found.push(`${path}: ${JSON.stringify(a)?.slice(0, 120)} ≠ ${JSON.stringify(b)?.slice(0, 120)}`);
		return found;
	}
	if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) {
		found.push(`${path}: length ${a.length} ≠ ${b.length}`);
	}
	const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
	for (const key of keys) {
		differences((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`, found, limit);
	}
	return found;
}

async function check(): Promise<void> {
	const journal = resolve(required("--journal"));
	const replayDir = resolve(required("--replay"));
	const rebuilt = await captured(replayDir);
	const recordDir = flag("--record");
	const recorded = recordDir ? await captured(resolve(recordDir)) : [];
	const list = await entries(journal);
	const calls = messages(list, "assistant");
	// The token-counting endpoint's offset from `usage` on byte-identical
	// requests, as the fresh recorded Runs measured it.
	const [low, high] = (flag("--band") ?? "43,46").split(",").map(Number);
	// pi-chart Runs: the original Accounting from the Thread Store, against
	// what the replay's own database recorded.
	const replayTails = await readFile(join(replayDir, "accounting.json"), "utf8")
		.then((text) => JSON.parse(text) as Tail[])
		.catch(() => undefined);
	let originalTails: Tail[] | undefined;
	if (replayTails) {
		const store = new SQL(flag("--store") ?? "postgres://pi_chart:pi_chart@localhost:55432/thread_store");
		originalTails = await tailsOf(store, list.find((e) => e.type === "session")?.id);
		await store.end();
	}
	const rows = calls.map((call, k) => {
		const usage = call.usage ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
		const truth = usage.input + usage.cacheRead + usage.cacheWrite;
		const mine = rebuilt[k];
		const theirs = recorded[k];
		const row: Record<string, unknown> = {
			call: k,
			truth,
			rebuilt: mine?.count.input_tokens ?? mine?.count.error ?? "missing",
			delta: mine?.count.input_tokens === undefined ? undefined : mine.count.input_tokens - truth,
		};
		if (theirs) {
			row.recorded = theirs.count.input_tokens ?? theirs.count.error;
			row.oracle = theirs.count.input_tokens === undefined ? undefined : theirs.count.input_tokens - truth;
			row.bytesEqual = mine?.body === theirs.body;
			if (mine?.count.input_tokens !== undefined && theirs.count.input_tokens !== undefined) {
				row.countVsRecorded = mine.count.input_tokens - theirs.count.input_tokens;
			}
			if (mine && !row.bytesEqual) row.differs = differences(JSON.parse(theirs.body), JSON.parse(mine.body));
		}
		const before = originalTails?.[k];
		const after = replayTails?.[k];
		if (before && after && !Bun.deepEquals(before.tail, after.tail)) {
			row.tail = { turn: before.turn, original: before.tail, replay: after.tail };
		}
		return row;
	});
	const counted = rows.filter((row) => typeof row.delta === "number");
	const exactTokens = counted.filter((row) => row.delta === 0).length;
	const summary: Record<string, unknown> = {
		journal,
		calls: calls.length,
		rebuilt: rebuilt.length,
		tokenMatches: `${exactTokens}/${calls.length}`,
		withinOracleBand: `${counted.filter((row) => Number(row.delta) >= low && Number(row.delta) <= high).length}/${calls.length} (band ${low}..${high})`,
		deltas: [...new Set(counted.map((row) => row.delta))].sort((x, y) => Number(x) - Number(y)),
	};
	if (replayTails && originalTails) {
		summary.accounting = `${originalTails.length} original, ${replayTails.length} replayed`;
		summary.tailMismatches = rows.filter((row) => row.tail).length;
	}
	if (recordDir) {
		const oracle = rows.filter((row) => typeof row.oracle === "number");
		summary.oracleMatches = `${oracle.filter((row) => row.oracle === 0).length}/${oracle.length}`;
		summary.oracleOffsets = [...new Set(oracle.map((row) => row.oracle))];
		summary.bytesEqual = `${rows.filter((row) => row.bytesEqual).length}/${calls.length}`;
		summary.countVsRecorded = [...new Set(rows.map((row) => row.countVsRecorded))];
	}
	console.log(JSON.stringify({ summary, rows }, null, 1));
}

const command = argv[0];
if (command === "record") await record();
else if (command === "replay") await replay();
else if (command === "check") await check();
else throw new Error("usage: bun replay.ts record|replay|check …");
