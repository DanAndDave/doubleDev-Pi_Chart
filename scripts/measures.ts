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
 *     accounting.json     pi-chart Runs only; read by later Measures
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { readJournal } from "../src/journal.ts";
import { messageText, type HarnessMessage } from "../src/messages.ts";
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
}

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
}

export async function readRecord(dir: string): Promise<RunRecord> {
	return JSON.parse(await readFile(join(dir, "run.json"), "utf8")) as RunRecord;
}

/** Every Measure of the Run recorded in `dir`. */
export async function measureRun(dir: string): Promise<RunMeasures> {
	const record = await readRecord(dir);
	const turns = await readJournal(join(dir, "journal.jsonl"));

	const calls: Call[] = [];
	for (const turn of turns) {
		for (const message of turn.messages) {
			const call = callOf(message, turn.turnIndex, false);
			if (call) calls.push(call);
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
	}
}
