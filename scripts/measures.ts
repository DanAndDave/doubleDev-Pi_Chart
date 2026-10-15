/**
 * Measures, computed after a Run has ended from its record folder alone: no
 * model Call, no workspace, no Thread Store. The benchmark calls the same
 * code when each Run ends, so a figure recomputed here on an old record is
 * the figure the benchmark reported.
 *
 *     bun scripts/measures.ts <run-dir>          # one Run's Measures
 *     bun scripts/measures.ts <run-dir> --json   # the same, as RunMeasures JSON
 *
 * A record folder, as `bench-tokens` writes it:
 *
 *     run.json            RunRecord: Arm, Workload, model, omp, prompts, checks
 *     journal.jsonl       the main Journal
 *     subagents/<n>.jsonl subagent Journals
 *     accounting.json     pi-chart Runs only: what each Call's window carried
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CallAccounting, TurnAccounting } from "../src/accounting.ts";
import { readBranch, readJournal, type Compaction, type JournalTurn, type MessageAddress } from "../src/journal.ts";
import { isToolCall, messageText, type HarnessMessage } from "../src/messages.ts";
import type { Plant, Turn, WorkloadId } from "./workload.ts";

export const READ_RATE = 0.1;
export const WRITE_RATE = 1.25;

/**
 * Turns before the verbatim tail starts sliding (the default tail is eight
 * Turns, so turn 9 is the first whose tail drops one). The cache figures
 * that judge Pack order are read over these, where nothing but order and
 * assembled-part churn moves the cached prefix.
 */
export const EARLY_TURNS = 7;

/** A Graded Task's outcome, as the benchmark recorded it. */
export interface CheckOutcome {
	step: string;
	pass: boolean;
	exitCode: number;
	durationMs: number;
	/** The last 2 KB of the check's stdout and stderr. */
	output: string;
}

/** `run.json`: everything about a Run the Journals do not say. */
export interface RunRecord {
	arm: string;
	index: number;
	workload: WorkloadId;
	/** From the Journal's `model_change` entry. */
	model?: string;
	/** `omp --version`. */
	omp: string;
	cwd: string;
	sessionId?: string;
	plants: Plant[];
	/** Every prompt the Run was to send, in Turn order. */
	prompts: Omit<Turn, "turn">[];
	checks: CheckOutcome[];
	/** The first Turn that did not complete; the Run sent nothing after it. */
	failedTurn?: number;
}

export interface Call {
	/** The Turn the Call answered; −1 for a subagent's. */
	turn: number;
	subagent: boolean;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	promptTokens: number;
	floor: number;
	/** What the Call's Context Window held; absent on a subagent's. */
	window?: Window;
}

/**
 * The Context Window one main Call sent, by the identity of each part, in
 * the same parts on both Arms; a part an Arm lacks is absent or empty. The
 * system prompt has no identity and is not here; the Floor covers its size.
 * "unknown" when the record cannot say, which is not the same as empty.
 */
export type Window =
	| "unknown"
	| {
			/** The Turn whose prompt the Opening carried. */
			opening?: number;
			/** Pins carried, by id. */
			pins: number[];
			/** The compaction whose summary was sent. */
			summary?: string;
			/**
			 * Turns carried verbatim. `from` is the first message carried when
			 * the tail began part-way through its Turn; `partial` when some of
			 * the tail was carried shortened or with messages dropped.
			 */
			tail: { turns: number[]; from?: MessageAddress; partial?: true };
			/** The Call's own Turn. */
			current: number;
	  };

export interface Totals {
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

export type Outcome = "Pass" | "Fail" | "not graded";

/** Re-fetch distance bands, in Turns; together they cover every distance. */
export const BANDS = [
	[1, 5],
	[6, 7],
	[8, 12],
	[13, 24],
	[25, Number.POSITIVE_INFINITY],
] as const;

/** A count, in total and per band: `bands[i]` counts `BANDS[i]`. */
export interface Banded {
	total: number;
	bands: number[];
}

/** Whether the window of the Call that re-fetched still held the earlier result. */
export type RefetchClass = "held" | "left" | "unknown";

/** A tool result whose text a tool result of an earlier Turn already had. */
export interface Refetch {
	turn: number;
	/** The Call that made the tool call, by its index in the Turn. */
	call: number;
	/** The Turn of the most recent earlier result with that text. */
	earlierTurn: number;
	distance: number;
	tool: string;
	class: RefetchClass;
}

export interface RunMeasures {
	arm: string;
	index: number;
	/** Whether every Turn the Run was to send completed. */
	complete: boolean;
	/** Turns completed. */
	turns: number;
	calls: Call[];
	totals: Totals;
	/** Cost per Run, USD: the provider's own `usage` over every Call. */
	cost: number;
	/** Every step the Run's prompts belong to, in order. */
	steps: { id: string; outcome: Outcome }[];
	passes: number;
	firstFail?: string;
	/** One score per Plant per Probe Turn the Run completed. */
	plants: { id: string; turn: number; right: boolean }[];
	/** Every Re-fetch of the main Journal, in order. */
	refetches: Refetch[];
	/** Re-fetches per class by distance band; Lapses are `left`. */
	refetch: Record<RefetchClass, Banded>;
	/** Compactions on the branch; absent on pi-chart, which suppresses compaction. */
	compactions?: number;
}

export async function readRecord(dir: string): Promise<RunRecord> {
	return JSON.parse(await readFile(join(dir, "run.json"), "utf8")) as RunRecord;
}

/** Every Measure of the Run recorded in `dir`. */
export async function measureRun(dir: string): Promise<RunMeasures> {
	const record = await readRecord(dir);
	const { turns, compactions } = await readBranch(join(dir, "journal.jsonl"));
	const windowAt = await windowReader(dir, record, compactions);

	const calls: Call[] = [];
	for (const turn of turns) {
		for (const [index, message] of turn.messages.entries()) {
			const call = callOf(message, turn.turnIndex, false);
			if (!call) continue;
			call.window = windowAt({ turn: turn.turnIndex, message: index }, turn.calls[index] ?? 0);
			calls.push(call);
		}
	}
	const subagentDir = join(dir, "subagents");
	const subagentFiles = (await readdir(subagentDir).catch(() => [] as string[]))
		.filter((name) => name.endsWith(".jsonl"))
		.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
	for (const name of subagentFiles) {
		for (const turn of await readJournal(join(subagentDir, name))) {
			for (const message of turn.messages) {
				const call = callOf(message, -1, true);
				if (call) calls.push(call);
			}
		}
	}

	const completed = record.failedTurn ?? record.prompts.length;

	const outcomes = new Map(record.checks.map((check) => [check.step, check.pass]));
	const steps: RunMeasures["steps"] = [];
	for (const prompt of record.prompts) {
		if (steps.some((step) => step.id === prompt.step)) continue;
		const pass = outcomes.get(prompt.step);
		steps.push({ id: prompt.step, outcome: pass === undefined ? "not graded" : pass ? "Pass" : "Fail" });
	}

	const plants: RunMeasures["plants"] = [];
	for (const [turn, prompt] of record.prompts.entries()) {
		if (turn >= completed || prompt.probes.length === 0) continue;
		const reply = turns[turn]?.messages.filter((message) => message.role === "assistant").at(-1);
		const text = reply ? messageText(reply) : "";
		for (const id of prompt.probes) {
			const value = record.plants.find((plant) => plant.id === id)?.value;
			plants.push({ id, turn, right: value !== undefined && text.includes(value) });
		}
	}

	const refetches = refetchesOf(turns, windowAt);
	const banded = (kind: RefetchClass): Banded => {
		const distances = refetches.filter((refetch) => refetch.class === kind).map((refetch) => refetch.distance);
		return {
			total: distances.length,
			bands: BANDS.map(([low, high]) => distances.filter((distance) => distance >= low && distance <= high).length),
		};
	};

	const total = totals(calls);
	return {
		arm: record.arm,
		index: record.index,
		complete: record.failedTurn === undefined,
		turns: completed,
		calls,
		totals: total,
		cost: total.cost,
		steps,
		passes: steps.filter((step) => step.outcome === "Pass").length,
		firstFail: steps.find((step) => step.outcome === "Fail")?.id,
		plants,
		refetches,
		refetch: { held: banded("held"), left: banded("left"), unknown: banded("unknown") },
		...(record.arm === "pi-chart" ? {} : { compactions: compactions.length }),
	};
}

function callOf(message: HarnessMessage, turn: number, subagent: boolean): Call | undefined {
	const usage = message.usage;
	if (message.role !== "assistant" || !usage) return undefined;
	const input = usage.input ?? 0;
	const cacheRead = usage.cacheRead ?? 0;
	const cacheWrite = usage.cacheWrite ?? 0;
	const output = typeof usage.output === "number" ? usage.output : 0;
	const cost = (usage.cost as { total?: number } | undefined)?.total ?? 0;
	return {
		turn,
		subagent,
		input,
		output,
		cacheRead,
		cacheWrite,
		cost,
		promptTokens: message.contextSnapshot?.promptTokens ?? input + cacheRead + cacheWrite,
		floor: message.contextSnapshot?.nonMessageTokens ?? 0,
	};
}

/**
 * Every tool result of the main Journal whose text the most recent earlier
 * result with that text, received in an earlier Turn, already had. Keyed by
 * text alone: the definition is the result, so content read by one tool and
 * printed by another is the same content fetched twice. Errors and empty
 * results are neither Re-fetches nor what one re-fetches.
 */
function refetchesOf(turns: JournalTurn[], windowAt: (at: MessageAddress, call: number) => Window): Refetch[] {
	const latest = new Map<string, MessageAddress>();
	const found: Refetch[] = [];
	for (const turn of turns) {
		for (const [index, message] of turn.messages.entries()) {
			if (message.role !== "toolResult" || message.isError) continue;
			const text = messageText(message);
			if (!text) continue;
			const earlier = latest.get(text);
			// Updated on every result, so a file fetched again after an edit is
			// a new text and a repeat within a Turn moves the copy into this Turn.
			latest.set(text, { turn: turn.turnIndex, message: index });
			if (!earlier || earlier.turn >= turn.turnIndex) continue;

			const caller = callerOf(turn, index);
			const call = turn.calls[caller ?? index] ?? 0;
			const window = caller === undefined ? "unknown" : windowAt({ turn: turn.turnIndex, message: caller }, call);
			found.push({
				turn: turn.turnIndex,
				call,
				earlierTurn: earlier.turn,
				distance: turn.turnIndex - earlier.turn,
				tool: message.toolName ?? "",
				class: classify(window, earlier),
			});
		}
	}
	return found;
}

/**
 * The assistant message, by index, whose tool call `turn.messages[result]`
 * answers; none when no message holds that call, and the window is unknown.
 */
function callerOf(turn: JournalTurn, result: number): number | undefined {
	const id = turn.messages[result]?.toolCallId;
	for (let index = result - 1; index >= 0; index--) {
		const message = turn.messages[index] as HarnessMessage;
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		if (message.content.some((block) => isToolCall(block) && block.id === id)) return index;
	}
	return undefined;
}

/** Whether `window` held the earlier result at `earlier`. */
function classify(window: Window, earlier: MessageAddress): RefetchClass {
	if (window === "unknown") return "unknown";
	const { tail } = window;
	const inTail =
		tail.turns.includes(earlier.turn) && (tail.from?.turn !== earlier.turn || earlier.message >= tail.from.message);
	if (inTail) return tail.partial ? "unknown" : "held";
	// The Opening carries its Turn's prompt and nothing after it.
	if (window.opening === earlier.turn && earlier.message === 0) return "held";
	return "left";
}

/** Which message comes first on the branch: negative when `a` does. */
const compareAddress = (a: MessageAddress, b: MessageAddress) => a.turn - b.turn || a.message - b.message;

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, at) => from + at);

/**
 * How to find the window of the main Call whose message sits at `at`, with
 * index `call` in its Turn. The Arm is the record's own word for it, not
 * whether `accounting.json` exists: a pi-chart Run whose export failed
 * would otherwise be measured as plain omp and look like it never evicted.
 */
async function windowReader(
	dir: string,
	record: RunRecord,
	compactions: Compaction[],
): Promise<(at: MessageAddress, call: number) => Window> {
	if (record.arm !== "pi-chart") return (at) => branchWindow(at, compactions);

	const exported = await readFile(join(dir, "accounting.json"), "utf8")
		.then((text) => JSON.parse(text) as Record<string, TurnAccounting[]>)
		.catch(() => ({}) as Record<string, TurnAccounting[]>);
	// The export holds every Conversation the Thread Store had; the Run's is
	// the one `run.json` names by `sessionId`. A record without that id names
	// none, and then only a lone Conversation can be the Run's.
	const conversations = Object.values(exported);
	const turns = record.sessionId ? exported[record.sessionId] : conversations.length === 1 ? conversations[0] : undefined;
	const rows = new Map<string, CallAccounting>();
	for (const turn of turns ?? []) {
		for (const call of turn.calls) rows.set(`${call.turnIndex}.${call.callIndex}`, call);
	}

	return (at, call) => {
		const row = rows.get(`${at.turn}.${call}`);
		if (!row) return "unknown";
		// Assembly failed and the harness's own history went; pi-chart
		// suppresses compaction, so that is the whole branch.
		if (row.unassembled) return branchWindow(at, compactions);
		const tail = row.parts.find((part) => part.source === "verbatim-tail");
		if (!tail?.turnIndices) return "unknown";
		const opening = row.parts.find((part) => part.source === "opening");
		const pinned = row.parts.find((part) => part.source === "pinned");
		return {
			...(opening && !opening.absent ? { opening: opening.turnIndices?.[0] ?? 0 } : {}),
			pins: pinned?.pinIds ?? [],
			tail: { turns: tail.turnIndices, ...(tail.shortened || tail.droppedMessages ? { partial: true as const } : {}) },
			current: at.turn,
		};
	};
}

/**
 * The window the harness's own history gave the Call at `at`: the branch so
 * far, from what the latest compaction before it kept, under its summary.
 */
function branchWindow(at: MessageAddress, compactions: Compaction[]): Window {
	const applied = compactions.filter((compaction) => compareAddress(compaction.before, at) <= 0).at(-1);
	if (!applied) return { pins: [], tail: { turns: range(0, at.turn) }, current: at.turn };
	const kept = applied.firstKept;
	if (!kept) return "unknown";
	return {
		pins: [],
		summary: applied.id,
		tail: { turns: range(kept.turn, at.turn), ...(kept.message > 0 ? { from: kept } : {}) },
		current: at.turn,
	};
}

/** The median of the finite values; NaN when there are none. */
export function median(values: number[]): number {
	const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (finite.length === 0) return Number.NaN;
	const mid = finite.length >> 1;
	return finite.length % 2 ? (finite[mid] as number) : ((finite[mid - 1] as number) + (finite[mid] as number)) / 2;
}

/**
 * The share of consecutive main-agent Call pairs on the early turns, in-Turn
 * and across a Turn boundary alike, where the next Call read back at least
 * everything the previous one read or wrote: its whole prompt stayed a
 * cached prefix. NaN when there is no pair.
 */
function prefixHeld(calls: Call[]): number {
	const early = calls.filter((c) => !c.subagent && c.turn < EARLY_TURNS);
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

function totals(calls: Call[]): Totals {
	const sum = (pick: (call: Call) => number) => calls.reduce((acc, call) => acc + pick(call), 0);
	const main = calls.filter((c) => !c.subagent);
	const input = sum((c) => c.input);
	const cacheRead = sum((c) => c.cacheRead);
	const cacheWrite = sum((c) => c.cacheWrite);
	return {
		calls: calls.length,
		input,
		cacheRead,
		cacheWrite,
		output: sum((c) => c.output),
		prompt: input + cacheRead + cacheWrite,
		effective: input + cacheRead * READ_RATE + cacheWrite * WRITE_RATE,
		cost: sum((c) => c.cost),
		peak: Math.max(0, ...main.map((c) => c.promptTokens)),
		floor: median(main.map((c) => c.floor)),
		prefixHeld: prefixHeld(calls),
		earlyWrite: main.filter((c) => c.turn < EARLY_TURNS).reduce((acc, c) => acc + c.cacheWrite, 0),
	};
}

/** Cost per Pass: USD per Pass, or why there is no figure. */
export type CostPerPass = { usd: number } | "no Pass" | "n/a";

export interface ArmAggregate {
	arm: string;
	/** The Runs aggregated: those that completed every Turn. */
	complete: RunMeasures[];
	/** Runs left out because a Turn failed. */
	excluded: number;
	costPerPass: CostPerPass;
	/** Per Plant: how many complete Runs scored it right, of how many. */
	retention: { id: string; right: number; of: number }[];
}

/** The figures a report states per Arm, over complete Runs only. */
export function aggregate(runs: RunMeasures[]): Map<string, ArmAggregate> {
	const arms = new Map<string, RunMeasures[]>();
	for (const run of runs) arms.set(run.arm, [...(arms.get(run.arm) ?? []), run]);

	const result = new Map<string, ArmAggregate>();
	for (const [arm, all] of arms) {
		const complete = all.filter((run) => run.complete);

		const graded = complete.filter((run) => run.steps.some((step) => step.outcome !== "not graded"));
		const passes = graded.reduce((acc, run) => acc + run.passes, 0);
		const costPerPass: CostPerPass =
			graded.length === 0
				? "n/a"
				: passes === 0
					? "no Pass"
					: { usd: graded.reduce((acc, run) => acc + run.cost, 0) / passes };

		const ids = [...new Set(complete.flatMap((run) => run.plants.map((plant) => plant.id)))];
		const retention = ids.map((id) => ({
			id,
			right: complete.filter((run) => {
				const scores = run.plants.filter((plant) => plant.id === id);
				return scores.length > 0 && scores.every((plant) => plant.right);
			}).length,
			of: complete.length,
		}));

		result.set(arm, { arm, complete, excluded: all.length - complete.length, costPerPass, retention });
	}
	return result;
}

export const usd = (x: number) => (Number.isFinite(x) ? `$${x.toFixed(4)}` : "—");
export const int = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString("en-US") : "—");
export const percent = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : "—");
export const bandLabel = ([low, high]: (typeof BANDS)[number]) =>
	high === Number.POSITIVE_INFINITY ? `≥${low}` : `${low}–${high}`;

if (import.meta.main) {
	const [dir, ...rest] = process.argv.slice(2);
	if (!dir) {
		console.error("usage: bun scripts/measures.ts <run-dir> [--json]");
		process.exit(2);
	}
	const measures = await measureRun(dir);
	if (rest.includes("--json")) {
		console.log(JSON.stringify(measures, null, "\t"));
	} else {
		const record = await readRecord(dir);
		const t = measures.totals;
		console.log(
			`${record.workload.name} v${record.workload.version}, ${record.arm} #${record.index}, ` +
				`model ${record.model ?? "(unknown)"}, ${record.omp}`,
		);
		console.log(
			measures.complete
				? `Complete: ${measures.turns} Turns`
				: `Incomplete: Turn ${(record.failedTurn ?? 0) + 1} of ${record.prompts.length} failed`,
		);
		console.log(
			`Cost per Run: ${usd(measures.cost)} (${t.calls} Calls; uncached input ${int(t.input)}, ` +
				`cache read ${int(t.cacheRead)}, cache write ${int(t.cacheWrite)}, output ${int(t.output)})`,
		);
		console.log(
			`Graded Tasks: ${measures.steps.map((step) => `${step.id} ${step.outcome}`).join(", ")}; ` +
				`${measures.passes} Pass${measures.passes === 1 ? "" : "es"}` +
				(measures.firstFail ? `, first failing step ${measures.firstFail}` : ""),
		);
		console.log(
			measures.plants.length === 0
				? "Retention: no Probe reached"
				: `Retention: ${measures.plants
						.map((plant) => `${plant.id} ${plant.right ? "right" : "wrong"} (Turn ${plant.turn + 1})`)
						.join(", ")}`,
		);
		const banded = (name: string, count: Banded) =>
			console.log(
				`${name}: ${count.total} (${BANDS.map((band, at) => `${bandLabel(band)} ${count.bands[at]}`).join(", ")})`,
			);
		banded("Re-fetches held", measures.refetch.held);
		banded("Lapses", measures.refetch.left);
		banded("Re-fetches unknown", measures.refetch.unknown);
		console.log(`Compactions per Run: ${measures.compactions ?? "n/a"}`);
	}
}
