/**
 * The Gate: whether a change to pi-chart may be archived. It runs paired
 * Runs of the Gate Workload (`bench/workloads/gate/`), one of the base
 * commit and one of the candidate in each pair, started together, and gives
 * pass, fail or inconclusive on Cost per Run and Lapses per Run.
 *
 *     bun scripts/gate.ts --base <rev> [--candidate <rev>]   # a Gate; candidate defaults to HEAD
 *     bun scripts/gate.ts --aa [--commit <rev>]              # an A/A batch; commit defaults to HEAD
 *     bun scripts/gate.ts --resume <dir>                     # continue a Gate or A/A run that stopped
 *     bun scripts/gate.ts --report <dir>                     # re-print from gate.json
 *       [--out <dir>] [--parallel <pairs>] [--pool <file>] [--workload <name|path>] [--turn-timeout <s>]
 *       [--ablate]
 *
 * With `--ablate`, once the verdict and the pool are written, Ablation
 * (`scripts/ablate.ts`) draws 10 units per side across that side's complete
 * Runs, with a $10 cap per side, apart from the Gate's own spend and cap.
 * Each Run gets `ablation.json`; the report's Needed share row reads them.
 *
 * Each side loads pi-chart from a tree of its own commit (`git archive`,
 * then `bun install --frozen-lockfile`), so uncommitted edits reach neither,
 * and each Run migrates its database with its side's `PostgresStore`
 * (`scripts/runs.ts`). Every Run uses `REFERENCE_MODEL`; a Run that records
 * another stops the Gate without a verdict. Before any spend, the Gate stops
 * when the commits differ only outside `src/`, when the Workload is held out
 * (its name ends in `-holdout`; only `--aa` runs one), when the pool has no A/A
 * batch for the key, when the Thread Store server has fewer free connections
 * than `--parallel` pairs need (`CONNECTIONS_PER_RUN` per Run), or when a
 * tree does not build. Once the connections are checked, it drops every Run
 * database (`bench_<stamp>_<label>`) stamped more than 24 hours ago, and a
 * Gate that ends with an error drops its own Runs' databases still there.
 *
 * Looks come at 5 and 10 complete pairs (`LOOKS`). Each tests the cost log
 * ratio and the Lapse difference for a rise, Holm-corrected, and passes
 * when nothing fails and Cost's upper ratio bound is below `MARGIN`. A pair
 * with an incomplete Run is void: its cost counts, and another replaces it.
 * A pair starts only when spend plus it and the pairs in flight, each at the
 * median pair cost so far (the pool's under the key before the Gate has
 * one), stays within the look's cap; a pair dearer than that can still take
 * spend past it.
 *
 * The pool, `bench/gate/pool.json` (`--pool` for a smoke run), keeps every
 * A/A, Gate and Budget sweep confirm batch's per-pair Costs per Run and Lapses per Run under its
 * key (Workload name and version, model, omp version). Variance is pooled
 * over every batch with the current key, so a new omp version needs a new
 * A/A batch (`--aa`, about $44 on the gate Workload). A batch is added once
 * a verdict is reached, or an A/A run ends, with at least 2 complete pairs.
 *
 * Each Run's record is in `<out>/runs/base-<i>/` or `candidate-<i>/`, and
 * `<out>/gate.json` holds the commits, key, pairs, spend, next pair index,
 * looks and verdict, rewritten whole after every pair. `--resume <out>`
 * continues a run that stopped from it, under the same key, with
 * `--parallel` and `--turn-timeout` optionally given again; `--report <out>`
 * re-prints from it with no Run and no pool write.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { SQL } from "bun";

import { type AblateOptions, AblationStop, ablateRun, readAblation } from "./ablate.ts";
import { type AblationRecord, type CalibrationFile, estimateLabel, shareLabel, summarise } from "./ablation.ts";
import { ppiShare, readCalibration } from "./calibration.ts";
import { aggregate, BANDS, bandLabel, int, measureRun, median, percent, type RunMeasures, type RunRecord, usd } from "./measures.ts";
import {
	buildContext,
	buildTree,
	type Context,
	dropDatabase,
	flagsOf,
	loadNamedWorkload,
	log,
	ompVersion,
	type Options,
	requireThreadStore,
	resolveCommit,
	runOne,
	type RunSpec,
	workloadFolder,
} from "./runs.ts";
import { holm, mean, pooledVariance, sampleVariance, studentCdf, studentQuantile } from "./stats.ts";
import { PULL_TOOLS } from "./units.ts";
import { CAVEATS, share, utilisationLabel } from "./utilisation.ts";
import { isHeldOut, REPO, turnsOf, type Workload, type WorkloadId } from "./workload.ts";

/**
 * The two looks: the pairs each needs, its one-sided level (O'Brien–Fleming,
 * overall one-sided α = 0.05), and the cap a pair must start within.
 */
export const LOOKS = [
	{ pairs: 5, alpha: 0.0088, cap: 55 },
	{ pairs: 10, alpha: 0.0467, cap: 110 },
] as const;
/** Cost is non-inferior when the upper bound of its geometric-mean ratio is below this. */
export const MARGIN = 1.1;
/** The complete pairs an A/A run gathers, under the first look's cap. */
export const AA_PAIRS = 5;

/** The model every Gate Run uses, and must record. */
export const REFERENCE_MODEL = "anthropic/claude-opus-5-5";

/** The Options of a Run of `workload` with the reference model under `omp`: a Gate's Runs, and a Budget sweep's. */
export function referenceOptions(workload: Workload, omp: string): Options {
	return {
		workload: { name: workload.name, version: workload.version, commit: workload.commit },
		model: REFERENCE_MODEL,
		turns: turnsOf(workload).length,
		omp,
	};
}

/** The two commits a pair runs: the one before the change, and the change's. */
export type Side = "base" | "candidate";
const SIDES: readonly Side[] = ["base", "candidate"];

/** What a batch is pooled under: variance is only pooled within one key. */
export interface GateKey {
	workload: { name: string; version: number };
	model: string;
	omp: string;
}

/** One Run's figures the Gate tests. */
export interface RunFigures {
	/** Cost per Run, USD. */
	cost: number;
	/** Lapses per Run, as `gateLapses` counts them. */
	lapses: number;
}

/** A complete pair: one Run of each side, both of which completed every Turn. */
export interface PairFigures {
	base: RunFigures;
	candidate: RunFigures;
}

/** The complete pairs of one A/A run, one Gate, or one Budget sweep's confirm (`scripts/sweep.ts`). */
export interface Batch {
	kind: "aa" | "gate" | "confirm";
	key: GateKey;
	/** ISO time the batch was added. */
	date: string;
	/** Full shas; the same on both sides of an A/A batch. */
	base: string;
	candidate: string;
	/** The output folder holding the batch's records. */
	out: string;
	/** A confirm batch's two cells: the default's Budgets as base, the winner's as candidate. */
	budgets?: { base: Record<string, string>; candidate: Record<string, string> };
	pairs: PairFigures[];
}

/** `bench/gate/pool.json`. */
export interface Pool {
	batches: Batch[];
}

export function keyOf(workload: WorkloadId, omp: string): GateKey {
	return { workload: { name: workload.name, version: workload.version }, model: REFERENCE_MODEL, omp };
}

function sameKey(a: GateKey, b: GateKey): boolean {
	return (
		a.workload.name === b.workload.name &&
		a.workload.version === b.workload.version &&
		a.model === b.model &&
		a.omp === b.omp
	);
}

export function describeKey(key: GateKey): string {
	return `${key.workload.name} v${key.workload.version}, ${key.model}, ${key.omp}`;
}

/**
 * The stored batches pooled under `key`. Throws, naming the command that
 * runs one, when none of them is an A/A batch.
 */
export function pooledBatches(batches: Batch[], key: GateKey): Batch[] {
	const pooled = batches.filter((batch) => sameKey(batch.key, key));
	if (!pooled.some((batch) => batch.kind === "aa")) {
		const workload = key.workload.name === "gate" ? "" : ` --workload ${key.workload.name}`;
		throw new Error(`no A/A batch for ${describeKey(key)}: run \`bun scripts/gate.ts --aa${workload}\` first`);
	}
	return pooled;
}

/** One gated Measure at one look: its differences tested against the pooled variance. */
export interface MeasureTest {
	/** Mean difference, candidate − base: a log ratio for Cost. */
	mean: number;
	/** Pooled standard deviation of the differences, and its degrees of freedom. */
	sd: number;
	df: number;
	/** This Gate's own sample standard deviation, beside the pooled one; NaN under 2 pairs. */
	ownSd: number;
	se: number;
	/** The t quantile at 1 − α of the look. */
	critical: number;
	/** One-sided bounds, mean ∓ critical · SE. */
	lower: number;
	upper: number;
	/** P(T ≥ mean / SE): the fail test's p-value. */
	p: number;
	/** Whether Holm's correction across both fail tests rejects it. */
	rejected: boolean;
}

export type Verdict = "pass" | "fail" | "continue" | "inconclusive";

export interface Decision {
	/** 0 for the first look, 1 for the second. */
	look: number;
	pairs: number;
	alpha: number;
	/** The ratio Cost's upper bound must stay below: `MARGIN` in a Gate, 1 in a sweep's confirm. */
	margin: number;
	/** Cost's test, with the geometric-mean ratio exp(mean) and its bounds. */
	cost: MeasureTest & { ratio: number; ratioLower: number; ratioUpper: number };
	lapses: MeasureTest;
	/** Whether Cost's upper ratio bound is below `margin`: at a margin of 1, whether the candidate is cheaper. */
	nonInferior: boolean;
	verdict: Verdict;
}

export function costDiff(pair: PairFigures): number {
	return Math.log(pair.candidate.cost) - Math.log(pair.base.cost);
}

export function lapseDiff(pair: PairFigures): number {
	return pair.candidate.lapses - pair.base.lapses;
}

/** A Measure's test at level `alpha`, before Holm's correction. */
export function measureTest(current: number[], stored: number[][], alpha: number): Omit<MeasureTest, "rejected"> {
	const { variance, df } = pooledVariance([...stored, current]);
	const sd = Math.sqrt(variance);
	const average = mean(current);
	const se = sd / Math.sqrt(current.length);
	const critical = studentQuantile(1 - alpha, df);
	const p = se === 0 ? (average > 0 ? 0 : 1) : 1 - studentCdf(average / se, df);
	return {
		mean: average,
		sd,
		df,
		ownSd: Math.sqrt(sampleVariance(current)),
		se,
		critical,
		lower: average - critical * se,
		upper: average + critical * se,
		p,
	};
}

/**
 * The verdict at `look` on the Gate's complete `pairs`, with the variance
 * pooled over every batch of `history` under `key` and the pairs themselves.
 * Fails when Holm's correction rejects either fail test; passes when it does
 * not fail and Cost is non-inferior at `margin`; otherwise continues to the second look,
 * or is inconclusive at it.
 */
export function decide(input: { look: number; pairs: PairFigures[]; history: Batch[]; key: GateKey; margin: number }): Decision {
	const { look, pairs, history, key, margin } = input;
	const { alpha } = LOOKS[look] as (typeof LOOKS)[number];
	const stored = pooledBatches(history, key);
	const cost = measureTest(pairs.map(costDiff), stored.map((batch) => batch.pairs.map(costDiff)), alpha);
	const lapses = measureTest(pairs.map(lapseDiff), stored.map((batch) => batch.pairs.map(lapseDiff)), alpha);
	const [costRejected, lapsesRejected] = holm([cost.p, lapses.p], alpha) as [boolean, boolean];
	const ratioUpper = Math.exp(cost.upper);
	const nonInferior = ratioUpper < margin;
	const verdict: Verdict =
		costRejected || lapsesRejected
			? "fail"
			: nonInferior
				? "pass"
				: look === LOOKS.length - 1
					? "inconclusive"
					: "continue";
	return {
		look,
		pairs: pairs.length,
		alpha,
		margin,
		cost: {
			...cost,
			rejected: costRejected,
			ratio: Math.exp(cost.mean),
			ratioLower: Math.exp(cost.lower),
			ratioUpper,
		},
		lapses: { ...lapses, rejected: lapsesRejected },
		nonInferior,
		verdict,
	};
}

/** One Run's figures and whether it completed every Turn. */
export interface RunOutcome extends RunFigures {
	complete: boolean;
}

/** A pair as it finished: void unless both Runs completed. */
export interface PairRun {
	index: number;
	base: RunOutcome;
	candidate: RunOutcome;
}

export function isComplete(pair: PairRun): boolean {
	return pair.base.complete && pair.candidate.complete;
}

/** A pair that cannot count and stops the Gate, with what its finished Runs cost. */
export class PairStop extends Error {
	constructor(
		message: string,
		readonly spent: number,
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}

/** Both Runs' Cost per Run: what a pair spent. */
function pairCost(pair: PairFigures): number {
	return pair.base.cost + pair.candidate.cost;
}

/**
 * Whether a pair may start under `cap`: with an `estimate` of a pair's cost,
 * when `spent` plus it and the `inFlight` pairs, each at the estimate, stays
 * within the cap; without one, while `spent` is below it.
 */
export function mayStart(input: { spent: number; inFlight: number; cap: number; estimate?: number }): boolean {
	const { spent, inFlight, cap, estimate } = input;
	return estimate === undefined ? spent < cap : spent + (inFlight + 1) * estimate <= cap;
}

/**
 * A pair's projected cost: the median over the Gate's own finished `pairs`,
 * void ones included, else over every pair of `history` under `key`, else
 * none.
 */
export function pairEstimate(pairs: PairRun[], history: Batch[], key: GateKey): number | undefined {
	const own = pairs.map(pairCost);
	const costs = own.length > 0 ? own : history.filter((batch) => sameKey(batch.key, key)).flatMap((batch) => batch.pairs.map(pairCost));
	return costs.length > 0 ? median(costs) : undefined;
}

/** Where a gathering stands each time a pair settles. */
export interface Settled {
	/** Every finished pair, void ones included, by index. */
	pairs: PairRun[];
	/** Cost per Run summed over every finished Run, a stopping pair's included. */
	spent: number;
	/** The index the next pair takes: past every pair started, a stopping one's included. */
	next: number;
	/** The first error a pair threw, which stops the Gate. */
	stopped?: unknown;
}

export interface Gathered extends Settled {
	/** Whether the cap stopped the look short of `want` complete pairs. */
	capped: boolean;
}

/**
 * Runs pairs, up to `width` at once, until `want` of them are complete. A
 * pair starts only while complete and in-flight pairs number fewer than
 * `want` and `mayStart` allows it under `cap`, at the `estimate` from the
 * pairs finished so far; each finished pair adds both Runs' cost to
 * `spent`, and a void one frees its slot for a replacement. `pairs`,
 * `spent` and `next` carry an earlier look's, or a stopped Gate's, pairs.
 * After `runPair` throws, no pair starts and the ones in flight finish; the
 * error comes back as `stopped` beside every pair that finished, and a
 * `PairStop`'s spend is counted. `settled` is awaited after each pair
 * settles, one at a time and before its slot refills; a throw from it stops
 * the gathering as a pair's would.
 */
export async function gatherPairs(input: {
	want: number;
	cap: number;
	width: number;
	runPair: (index: number) => Promise<PairRun>;
	pairs?: PairRun[];
	spent?: number;
	next?: number;
	estimate?: (pairs: PairRun[]) => number | undefined;
	settled?: (state: Settled) => Promise<void>;
}): Promise<Gathered> {
	const { want, cap, width, runPair, estimate, settled } = input;
	const pairs = [...(input.pairs ?? [])];
	let spent = input.spent ?? 0;
	let next = pairs.reduce((top, pair) => Math.max(top, pair.index + 1), input.next ?? 0);
	let inFlight = 0;
	let stopped: { error: unknown } | undefined;
	let reported = Promise.resolve();
	const complete = () => pairs.filter(isComplete).length;

	await new Promise<void>((resolve) => {
		const fill = () => {
			while (
				!stopped &&
				inFlight < width &&
				complete() + inFlight < want &&
				mayStart({ spent, inFlight, cap, estimate: estimate?.(pairs) })
			) {
				inFlight++;
				runPair(next++)
					.then(
						(pair) => {
							pairs.push(pair);
							spent += pairCost(pair);
						},
						(error: unknown) => {
							if (error instanceof PairStop) spent += error.spent;
							stopped ??= { error };
						},
					)
					.then(() => {
						if (!settled) return;
						const byIndex = [...pairs].sort((a, b) => a.index - b.index);
						const state: Settled = { pairs: byIndex, spent, next, ...(stopped ? { stopped: stopped.error } : {}) };
						reported = reported.then(() => settled(state));
						return reported;
					})
					.catch((error: unknown) => {
						stopped ??= { error };
					})
					.finally(() => {
						inFlight--;
						fill();
					});
			}
			if (inFlight === 0) resolve();
		};
		fill();
	});
	pairs.sort((a, b) => a.index - b.index);
	return { pairs, spent, next, capped: !stopped && complete() < want, ...(stopped ? { stopped: stopped.error } : {}) };
}

/**
 * Whether the trees of two revisions differ under `src/`: a change that
 * touches nothing there needs no Gate.
 */
export async function changesSource(base: string, candidate: string): Promise<boolean> {
	const proc = Bun.spawn(["git", "-C", REPO, "diff", "--quiet", base, candidate, "--", "src/"], {
		stdout: "ignore",
		stderr: "pipe",
	});
	const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	if (code === 0) return false;
	if (code === 1) return true;
	throw new Error(`git diff ${base} ${candidate} -- src/ exited ${code}: ${stderr.trim()}`);
}

/**
 * A Run's Lapses per Run in the Gate: Re-fetch Lapses, recall Pulls and
 * failed-Probe Lapses, in total. Left Revisits are not added, since the
 * fetch that makes one left can also be a Re-fetch; nothing unknown is.
 */
export function gateLapses(measures: RunMeasures): number {
	return measures.refetch.left.total + (measures.recall?.recall.total ?? 0) + measures.probe.lapse.total;
}

/**
 * Why a Run cannot count for not being on `model`, or nothing when it is. A
 * complete Run always left a Journal naming its model; a void one may have
 * left none.
 */
export function offModel(record: RunRecord, measures: RunMeasures, model: string): string | undefined {
	const off = record.model === undefined ? measures.complete : record.model !== model;
	return off ? `ran on ${record.model ?? "no recorded model"}, not ${model}` : undefined;
}

/**
 * Runs one pair per call: `specOf` gives each side's Run, both start
 * together, and which side's job is created first alternates by index so
 * start-order effects fall on both alike. A Run that throws, or one off the
 * reference model, throws a `PairStop` carrying what the pair's finished
 * Runs cost.
 */
export function pairRunner(ctx: Context, specOf: (side: Side, index: number) => RunSpec): (index: number) => Promise<PairRun> {
	return async (index) => {
		const sides = SIDES.map((side) => ({ side, spec: specOf(side, index) }));
		if (index % 2 === 1) sides.reverse();
		const settled = await Promise.allSettled(sides.map(({ spec }) => runOne(spec, ctx)));
		const outcome: Partial<Record<Side, RunOutcome>> = {};
		let spent = 0;
		let stop: { message: string; cause?: unknown } | undefined;
		for (const [at, result] of settled.entries()) {
			const { side, spec } = sides[at] as (typeof sides)[number];
			if (result.status === "rejected") {
				const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
				stop ??= { message: `${spec.label}: ${reason}`, cause: result.reason };
				continue;
			}
			const { record, measures } = result.value;
			spent += measures.cost;
			const off = offModel(record, measures, ctx.options.model ?? REFERENCE_MODEL);
			if (off) stop ??= { message: `${spec.label} ${off}` };
			outcome[side] = { cost: measures.cost, lapses: gateLapses(measures), complete: measures.complete };
		}
		if (stop) throw new PairStop(stop.message, spent, { cause: stop.cause });
		const pair = { index, base: outcome.base as RunOutcome, candidate: outcome.candidate as RunOutcome };
		log(`pair ${index}: ${isComplete(pair) ? "complete" : "void"}`);
		return pair;
	};
}

// ---------------------------------------------------------------- record --

/** `gate.json`: everything the report needs besides the Runs' own records. */
export interface GateRecord {
	kind: Exclude<Batch["kind"], "confirm">;
	/** Full shas; the same on both sides of an A/A run. */
	base: string;
	candidate: string;
	key: GateKey;
	options: Options;
	pool: string;
	parallel: number;
	/** The folder of the Workload `--workload` named (`workloadFolder`). Absent before resume existed. */
	workload?: string;
	/** Seconds a Turn may take. Absent before resume existed. */
	turnTimeout?: number;
	/** Every pair the Gate ran, void ones included, by index. */
	pairs: PairRun[];
	spent: number;
	/** The index the next pair takes, past a stopping pair's. Absent before resume existed. */
	next?: number;
	/** The cap of the last look gathered. */
	cap: number;
	/** Whether the cap stopped the last look short of its pairs. */
	capped: boolean;
	/** Each look's figures, in order; none for an A/A run. */
	looks: Decision[];
	/** Absent for an A/A run, and for a Gate that stopped without one. */
	verdict?: Verdict;
	/** Why the Gate stopped without a verdict. */
	stopped?: string;
	/** Set by the last write of a run that did not stop: there is nothing to resume. */
	ended?: boolean;
	/** Why each earlier attempt of a resumed run stopped, in order. */
	resumed?: string[];
}

export const POOL = join(REPO, "bench", "gate", "pool.json");

export async function readPool(file: string): Promise<Pool> {
	try {
		return JSON.parse(await readFile(file, "utf8")) as Pool;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { batches: [] };
		throw error;
	}
}

/** Writes `value` to `file` as JSON, replacing the file whole so a crash never leaves half of one. */
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, "\t")}\n`);
	await rename(temporary, file);
}

/** Adds `batch` to the pool at `file`. */
export async function appendToPool(file: string, batch: Batch): Promise<void> {
	const pool = await readPool(file);
	pool.batches.push(batch);
	await writeJsonAtomic(file, pool);
}

export function completePairs(pairs: PairRun[]): PairFigures[] {
	return pairs.filter(isComplete).map(({ base, candidate }) => ({
		base: { cost: base.cost, lapses: base.lapses },
		candidate: { cost: candidate.cost, lapses: candidate.lapses },
	}));
}

/** The first `want` complete pairs by index: what a look decides on. */
export function lookPairs(pairs: PairRun[], want: number): PairFigures[] {
	return completePairs([...pairs].sort((a, b) => a.index - b.index)).slice(0, want);
}

/** What a Gate's or A/A run's looks came to. */
export interface LooksOutcome extends Gathered {
	/** The cap of the last look gathered. */
	cap: number;
	looks: Decision[];
	/** Absent for an A/A run, and for a Gate that stopped. */
	verdict?: Verdict;
}

/**
 * Gathers and decides each look in turn: a Gate's, or with `aa` an A/A
 * run's `AA_PAIRS` complete pairs under the first look's cap, with no
 * decision. `carried` seeds a resumed run. Each look decides on its first
 * complete pairs by index, which in a fresh run are exactly the pairs it
 * has then, so a resumed Gate reaches the looks a fresh one would.
 * `settled` hears of each settled pair with the cap of its look.
 */
export async function runLooks(input: {
	aa: boolean;
	history: Batch[];
	key: GateKey;
	width: number;
	runPair: (index: number) => Promise<PairRun>;
	estimate?: (pairs: PairRun[]) => number | undefined;
	settled?: (state: Settled & { cap: number }) => Promise<void>;
	carried?: Omit<Settled, "stopped">;
}): Promise<LooksOutcome> {
	const { aa, history, key, width, runPair, estimate, settled } = input;
	const looks: Decision[] = [];
	let gathered: Gathered = { pairs: [], spent: 0, next: 0, capped: false, ...input.carried };
	for (const [look, { pairs, cap }] of LOOKS.entries()) {
		const want = aa ? AA_PAIRS : pairs;
		gathered = await gatherPairs({
			want,
			cap,
			width,
			runPair,
			estimate,
			pairs: gathered.pairs,
			spent: gathered.spent,
			next: gathered.next,
			settled: settled && ((state) => settled({ ...state, cap })),
		});
		if (gathered.stopped !== undefined || aa) return { ...gathered, cap, looks };
		const current = lookPairs(gathered.pairs, want);
		if (gathered.capped) {
			if (current.length > 0) looks.push({ ...decide({ look, pairs: current, history, key, margin: MARGIN }), verdict: "inconclusive" });
			return { ...gathered, cap, looks, verdict: "inconclusive" };
		}
		const decision = decide({ look, pairs: current, history, key, margin: MARGIN });
		looks.push(decision);
		if (decision.verdict !== "continue") return { ...gathered, cap, looks, verdict: decision.verdict };
	}
	throw new Error("the last look continued: it can only pass, fail or be inconclusive");
}

// ---------------------------------------------------------------- resume --

/** The first pair index a resumed run may use: past its recorded `next`, every recorded pair, and every pair with a folder under `runs/`. */
export function nextIndex(record: { pairs: PairRun[]; next?: number }, folders: string[]): number {
	const used = folders.flatMap((name) => {
		const match = /^(?:base|candidate)-(\d+)$/.exec(name);
		return match ? [Number(match[1]) + 1] : [];
	});
	return Math.max(record.next ?? 0, ...record.pairs.map((pair) => pair.index + 1), ...used);
}

/**
 * Why the run `record` describes cannot be resumed under the installed
 * `omp` and the Workload as now loaded, or nothing when it can. A run ended
 * when its last write says so; a record from before resume existed (no
 * `next`) was written once, at the end, so it ended unless it stopped.
 */
export function resumeRefusal(record: GateRecord, current: { omp: string; workload: WorkloadId }): string | undefined {
	const { key } = record;
	if (record.ended === true || (record.next === undefined && record.stopped === undefined)) {
		const verdict = record.verdict ? ` with a verdict of ${record.verdict}` : "";
		return `the ${record.kind === "aa" ? "A/A run" : "Gate"} already ended${verdict}: there is nothing to resume`;
	}
	if (current.omp !== key.omp) {
		return `it ran under ${key.omp} and the installed omp is ${current.omp}; its pairs pool only under their own key, so start a new run`;
	}
	if (current.workload.name !== key.workload.name || current.workload.version !== key.workload.version) {
		const was = `${key.workload.name} v${key.workload.version}`;
		return `it ran ${was} and the Workload is now ${current.workload.name} v${current.workload.version}; start a new run`;
	}
	return undefined;
}

// ---------------------------------------------------------------- server --

/**
 * A Run's connections at most: 10 for its omp process's pool on a tree from
 * before the extension bounded its pool (a base tree may predate that bound),
 * and 2 to create, export and drop its database.
 */
export const CONNECTIONS_PER_RUN = 12;

/** The Thread Store server's connection slots, and who holds them. */
export interface ConnectionState {
	max: number;
	superuserReserved: number;
	reserved: number;
	/** Client connections open now, other than the one that asked. */
	clients: number;
	/** The largest holders of client connections, most first. */
	holders: { application: string; user: string; database: string; count: number }[];
}

/** Why `parallel` pairs, 2 Runs each, cannot start on a server in `state`, or nothing when they can. */
export function connectionRefusal(state: ConnectionState, parallel: number): string | undefined {
	const free = state.max - state.superuserReserved - state.reserved - state.clients;
	const needed = parallel * 2 * CONNECTIONS_PER_RUN;
	if (free >= needed) return undefined;
	const holders = state.holders.map(
		({ application, user, database, count }) => `${count} by ${application || "no application name"} as ${user} on ${database}`,
	);
	const fits = Math.floor(free / (2 * CONNECTIONS_PER_RUN));
	return (
		`the Thread Store server has ${free} free connections against ${needed} needed for ${parallel} pair${parallel === 1 ? "" : "s"} at once ` +
		`(${CONNECTIONS_PER_RUN} per Run): ${state.max} allowed, ${state.superuserReserved + state.reserved} reserved, ${state.clients} in use` +
		(holders.length > 0 ? ` (${holders.join("; ")})` : "") +
		(fits > 0 ? `. Close some, or run with --parallel ${fits}` : ". Close some first")
	);
}

/** The connection slots and holders on `server`, read in one statement so the count and the holders agree; the asking connection is not counted. */
async function connectionState(server: string): Promise<ConnectionState> {
	const sql = new SQL(server);
	try {
		const [row] = (await sql`
			WITH clients AS (
				SELECT coalesce(application_name, '') AS application, coalesce(usename::text, '') AS "user", coalesce(datname::text, '') AS database
				FROM pg_stat_activity
				WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
			)
			SELECT current_setting('max_connections')::int AS max,
				current_setting('superuser_reserved_connections')::int AS superuser_reserved,
				coalesce(current_setting('reserved_connections', true), '0')::int AS reserved,
				(SELECT count(*)::int FROM clients) AS clients,
				(SELECT coalesce(json_agg(top), '[]')::text FROM (
					SELECT application, "user", database, count(*)::int AS count FROM clients
					GROUP BY 1, 2, 3 ORDER BY 4 DESC, 1, 2, 3 LIMIT 5
				) AS top) AS holders
		`) as { max: number; superuser_reserved: number; reserved: number; clients: number; holders: string }[];
		if (!row) throw new Error("the Thread Store server returned no connection settings");
		return {
			max: row.max,
			superuserReserved: row.superuser_reserved,
			reserved: row.reserved,
			clients: row.clients,
			holders: JSON.parse(row.holders) as ConnectionState["holders"],
		};
	} finally {
		await sql.end();
	}
}

/** A Run database's name: `bench_`, its Gate's or benchmark's 13-digit millisecond stamp, `_`, and its Run's label. */
const RUN_DATABASE = /^bench_(\d{13})_[a-z0-9_]+$/;
/** How long before a Run database's stamp is older than any Gate or benchmark still running. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** The Run databases among `names` stamped more than 24 hours before `now`. */
export function staleDatabases(names: string[], now: number): string[] {
	return names.filter((name) => {
		const stamp = RUN_DATABASE.exec(name)?.[1];
		return stamp !== undefined && Number(stamp) < now - STALE_AFTER_MS;
	});
}

/** The Run databases among `names` of the Gate stamped `stamp`. */
export function ownDatabases(names: string[], stamp: number): string[] {
	return names.filter((name) => RUN_DATABASE.exec(name)?.[1] === String(stamp));
}

/** Every database on `server`. */
async function databasesOn(server: string): Promise<string[]> {
	const sql = new SQL(server);
	try {
		return ((await sql`SELECT datname::text AS name FROM pg_database ORDER BY 1`) as { name: string }[]).map((row) => row.name);
	} finally {
		await sql.end();
	}
}

/** Drops each of `names` from `server`, logging each drop and each failure; a failed drop stops nothing. */
async function dropEach(server: string, names: string[], what: string): Promise<void> {
	for (const name of names) {
		try {
			await dropDatabase(server, name);
			log(`dropped ${what} ${name}`);
		} catch (error) {
			log(`could not drop ${what} ${name}: ${error instanceof Error ? error.message : error}`);
		}
	}
}

// ---------------------------------------------------------------- report --

type Sides = { base: RunMeasures[]; candidate: RunMeasures[] };

/** A figure, or "—" where there is none (JSON keeps NaN as null). */
export function fixed(value: number | null | undefined, digits: number): string {
	return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export function pValue(value: number): string {
	return Number.isFinite(value) ? (value < 0.0001 ? "<0.0001" : value.toFixed(4)) : "—";
}

/** The sample SDs of an A/A run's differences, and the cost difference's as a coefficient of variation. */
function aaSpread(pairs: PairFigures[]): { costSd: number; costCv: number; lapseSd: number } {
	const costSd = Math.sqrt(sampleVariance(pairs.map(costDiff)));
	return {
		costSd,
		costCv: Math.sqrt(Math.exp(costSd * costSd) - 1),
		lapseSd: Math.sqrt(sampleVariance(pairs.map(lapseDiff))),
	};
}

/** Each look's figures as a Markdown table, in the columns a Gate and a sweep's confirm both print. */
export function lookTable(looks: Decision[]): string {
	const lines = [
		"| Look | Pairs | α | Cost ratio | Lower | Upper | Cost p | Lapse Δ | Lapse lower | Lapse p | Holm rejects | " +
			"Cost SD pooled / own | Lapse SD pooled / own | df | Result |",
		"| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |",
	];
	for (const look of looks) {
		const { cost, lapses } = look;
		const rejects = [cost.rejected ? "Cost" : "", lapses.rejected ? "Lapses" : ""].filter(Boolean).join(", ") || "none";
		lines.push(
			`| ${look.look + 1} | ${look.pairs} | ${look.alpha} | ${fixed(cost.ratio, 3)} | ${fixed(cost.ratioLower, 3)} | ` +
				`${fixed(cost.ratioUpper, 3)} | ${pValue(cost.p)} | ${fixed(lapses.mean, 2)} | ${fixed(lapses.lower, 2)} | ` +
				`${pValue(lapses.p)} | ${rejects} | ${fixed(cost.sd, 4)} / ${fixed(cost.ownSd, 4)} | ` +
				`${fixed(lapses.sd, 2)} / ${fixed(lapses.ownSd, 2)} | ${cost.df} | ${look.verdict} |`,
		);
	}
	return lines.join("\n");
}

export function report(gate: GateRecord, sides: Sides, ablation: Record<Side, AblationRecord[]>, calibration: CalibrationFile): void {
	const { key } = gate;
	const complete = gate.pairs.filter(isComplete).length;
	const voids = gate.pairs.length - complete;
	const short = (sha: string) => sha.slice(0, 7);
	console.log(
		`\n${gate.kind === "aa" ? `A/A run of ${short(gate.base)}` : `Gate ${short(gate.base)} → ${short(gate.candidate)}`}; ` +
			`key ${describeKey(key)}; ${complete} complete pair${complete === 1 ? "" : "s"}` +
			(voids > 0 ? `, ${voids} void` : ""),
	);

	if (gate.stopped) {
		console.log(`\nStopped without a verdict: ${gate.stopped}. Nothing was added to the pool.`);
	} else if (gate.kind === "aa") {
		const spread = aaSpread(completePairs(gate.pairs));
		console.log(
			`\nNo verdict (A/A)${gate.capped ? `; the cap stopped it short of ${AA_PAIRS} complete pairs` : ""}. ` +
				`Cost log-ratio SD ${fixed(spread.costSd, 4)} (CV ${fixed(100 * spread.costCv, 1)}%); ` +
				`Lapse difference SD ${fixed(spread.lapseSd, 2)}.`,
		);
	} else {
		const last = gate.looks.at(-1);
		const at = last ? `at look ${last.look + 1} (${last.pairs} pairs)` : "before any look";
		console.log(`\nVerdict: ${gate.verdict} ${at}${gate.capped ? ", stopped by the cap" : ""}.`);
	}

	if (gate.looks.length > 0) {
		console.log(
			`\nPer look (one-sided bounds at the look's α; fail tests Holm-corrected; Cost non-inferior when the upper bound < ${MARGIN}):\n`,
		);
		console.log(lookTable(gate.looks));
	}

	console.log(
		`\nSpend ${usd(gate.spent)} of a ${usd(gate.cap)} cap, over ${gate.pairs.length * 2} Runs. ` +
			// A record without `next` ran before the projected rule: no pair started once spend reached the cap.
			(gate.next === undefined
				? `Spend may exceed the cap by the pairs already running when it was reached (up to ${gate.parallel} at once).`
				: "A pair started only when spend plus it and the pairs running, each at the median pair cost so far, stayed within the cap; " +
					"a pair dearer than that can take spend past it.") +
			(gate.resumed?.length ? ` Resumed after: ${gate.resumed.join("; ")}.` : ""),
	);

	// Reported, not gated: each side over its complete Runs.
	const aggregates = SIDES.map((side) => ({
		side,
		runs: sides[side].filter((run) => run.complete),
		aggregate: aggregate(sides[side]).get("pi-chart"),
	}));
	const middle = (runs: RunMeasures[], pick: (run: RunMeasures) => number | undefined) =>
		median(runs.map((run) => pick(run) ?? Number.NaN));
	const row = (label: string, cell: (side: (typeof aggregates)[number]) => string) =>
		console.log(`| ${label} | ${aggregates.map(cell).join(" | ")} |`);
	console.log("\nReported, not gated (complete Runs; medians unless stated):\n");
	console.log("| Measure | base | candidate |");
	console.log("| --- | ---: | ---: |");
	row("Complete Runs", ({ runs, side }) => `${runs.length}/${sides[side].length}`);
	row("Passes / Graded Tasks", ({ runs }) => {
		const graded = runs.flatMap((run) => run.steps.filter((step) => step.outcome !== "not graded"));
		return `${graded.filter((step) => step.outcome === "Pass").length}/${graded.length}`;
	});
	row("Cost per Pass", ({ aggregate: figures }) => {
		const value = figures?.costPerPass ?? "n/a";
		return typeof value === "string" ? value : usd(value.usd);
	});
	row("Cost per Run", ({ runs }) => usd(middle(runs, (run) => run.cost)));
	row("Lapses per Run (Gate count)", ({ runs }) => int(middle(runs, gateLapses)));
	for (const kind of ["held", "left", "unknown"] as const) {
		row(`Re-fetches ${kind}`, ({ runs }) => int(middle(runs, (run) => run.refetch[kind].total)));
	}
	for (const tool of PULL_TOOLS) {
		row(`Pulls: ${tool}`, ({ runs }) => int(middle(runs, (run) => run.pulls?.[tool].calls)));
	}
	row("Needed share", ({ side }) => neededCell(ablation[side]));
	// Both Gate sides are pi-chart, so each side's correction is the pi-chart units'.
	row("Needed share (PPI)", ({ runs }) => {
		const estimate = ppiShare(calibration, key, "pi-chart", runs);
		return typeof estimate === "string" ? estimate : estimateLabel(estimate);
	});
	row(`Utilisation (${utilisationLabel(aggregates.flatMap(({ runs }) => runs.map((run) => run.utilisation)))})`, ({ runs }) =>
		percent(middle(runs, (run) => (run.utilisation ? share(run.utilisation) : undefined))),
	);
	console.log(`\n${CAVEATS.join(" ")}`);

	const probes = new Map<string, { id: string; turn: number }>();
	for (const { aggregate: figures } of aggregates) {
		for (const probe of figures?.retention ?? []) probes.set(`${probe.id}@${probe.turn}`, probe);
	}
	if (probes.size > 0) {
		console.log("\nRetention per Probe (complete Runs right of scored):\n");
		console.log("| Plant | Probe Turn | base | candidate |");
		console.log("| --- | ---: | ---: | ---: |");
		for (const probe of [...probes.values()].sort((a, b) => a.turn - b.turn)) {
			const cells = aggregates.map(({ aggregate: figures }) => {
				const found = figures?.retention.find((r) => r.id === probe.id && r.turn === probe.turn);
				return found ? `${found.right}/${found.of}` : "—";
			});
			console.log(`| ${probe.id} | ${probe.turn + 1} | ${cells.join(" | ")} |`);
		}
		console.log("\nRetention by distance band:\n");
		console.log("| Distance, Turns | base | candidate |");
		console.log("| --- | ---: | ---: |");
		for (const [at, band] of BANDS.entries()) {
			const tallies = aggregates.map(({ aggregate: figures }) => figures?.byBand?.[at]);
			if (tallies.every((tally) => !tally || tally.of === 0)) continue;
			console.log(`| ${bandLabel(band)} | ${tallies.map((t) => (t ? `${t.right}/${t.of}` : "—")).join(" | ")} |`);
		}
	}
}

/** Each side's Measures, recomputed from the record folders the Gate left, under the committed calibration. */
async function measureSides(out: string, pairs: PairRun[]): Promise<Sides> {
	const calibration = await readCalibration();
	const sides: Sides = { base: [], candidate: [] };
	for (const { index } of pairs) {
		for (const side of SIDES) {
			sides[side].push(await measureRun(join(out, "runs", `${side}-${index}`), calibration));
		}
	}
	return sides;
}

/** Units and cap per side with `--ablate` (design §12). */
const ABLATE_UNITS = 10;
const ABLATE_CAP = 10;

/**
 * Ablation on one side's complete Runs, one Run at a time: 10 units spread
 * across them, the earlier Runs taking any remainder, and the side's $10 cap
 * shared, each Run getting what the earlier ones left.
 */
async function ablateSide(out: string, pairs: PairRun[], side: Side, sha: string, tree: string): Promise<void> {
	const dirs = pairs.filter((pair) => pair[side].complete).map(({ index }) => join(out, "runs", `${side}-${index}`));
	let spent = 0;
	for (const [at, dir] of dirs.entries()) {
		const units = Math.floor(ABLATE_UNITS / dirs.length) + (at < ABLATE_UNITS % dirs.length ? 1 : 0);
		if (units === 0 || spent >= ABLATE_CAP) continue;
		const seed = Math.floor(Math.random() * 2 ** 32);
		const options: AblateOptions = { units, nulls: 0, controls: false, cap: ABLATE_CAP - spent, seed, commit: sha, tree, dryRun: false };
		// A Run whose replay fails gets no record; the others still count, and so does what it spent.
		const outcome = await ablateRun(dir, options).catch((error: unknown) => {
			if (!(error instanceof AblationStop)) throw error;
			spent += error.spent;
			log(`${side}: no Ablation for ${basename(dir)}: ${error.message}`);
			return undefined;
		});
		const record = outcome?.record;
		if (!record) continue;
		spent += record.spend;
		log(`${side}: ablated ${basename(dir)} with seed ${record.seed}, ${record.draws.length} draws, ${usd(record.spend)}`);
	}
}

/** Each side's ablation records, from the Runs that have one. */
async function ablationSides(out: string, pairs: PairRun[]): Promise<Record<Side, AblationRecord[]>> {
	const records: Record<Side, AblationRecord[]> = { base: [], candidate: [] };
	for (const { index } of pairs) {
		for (const side of SIDES) {
			const record = await readAblation(join(out, "runs", `${side}-${index}`));
			if (record) records[side].push(record);
		}
	}
	return records;
}

/** A side's Needed share with its interval and judged units, and what Ablation cost; "not measured" without records. */
function neededCell(records: AblationRecord[]): string {
	// Both sides of a Gate are pi-chart commits.
	const summary = summarise(records).get("pi-chart");
	if (!summary) return "not measured";
	return `${shareLabel(summary.needed)} judged, ${usd(summary.spend)}`;
}

// ------------------------------------------------------------------ main --

/** What a Gate or A/A run starts from, fresh or resumed: its record so far, its Workload, the pool's batches, and its output folder. */
interface Plan {
	record: GateRecord;
	workload: Workload;
	history: Batch[];
	out: string;
	turnTimeout: number;
}

/** A fresh Gate's or A/A run's plan from its flags, or nothing when the commits need no Gate. */
async function freshPlan(argv: string[], stamp: number): Promise<Plan | undefined> {
	const { flag, positive } = flagsOf(argv);
	const aa = argv.includes("--aa");
	let base: string;
	let candidate: string;
	if (aa) {
		base = candidate = await resolveCommit(flag("--commit") ?? "HEAD");
	} else {
		const baseRevision = flag("--base");
		if (!baseRevision) throw new Error("a Gate needs --base <the commit before the change>; or --aa, --resume <dir> or --report <dir>");
		base = await resolveCommit(baseRevision);
		candidate = await resolveCommit(flag("--candidate") ?? "HEAD");
		if (!(await changesSource(base, candidate))) {
			console.log(`${base.slice(0, 7)} → ${candidate.slice(0, 7)} does not touch src/: no Gate is needed.`);
			return undefined;
		}
	}

	const named = flag("--workload") ?? "gate";
	const workload = await loadNamedWorkload(named);
	if (!aa && isHeldOut(workload.name)) {
		throw new Error(`${workload.name} is a held-out Workload: it is run only by A/A (--aa) and a Budget sweep's confirm, never by a Gate`);
	}
	const options = referenceOptions(workload, await ompVersion());
	const key = keyOf(options.workload, options.omp);
	const pool = resolve(flag("--pool") ?? POOL);
	const history = (await readPool(pool)).batches;
	if (!aa) pooledBatches(history, key);
	const turnTimeout = positive("--turn-timeout", 600);
	return {
		workload,
		history,
		out: resolve(flag("--out") ?? join(tmpdir(), `pichart-gate-${stamp}`)),
		turnTimeout,
		record: {
			kind: aa ? "aa" : "gate",
			base,
			candidate,
			key,
			options,
			pool,
			parallel: positive("--parallel", 2),
			workload: workloadFolder(named),
			turnTimeout,
			pairs: [],
			spent: 0,
			next: 0,
			cap: 0,
			capped: false,
			looks: [],
		},
	};
}

/** The flags `gate.json` decides for a resumed run. */
const RECORDED_FLAGS = ["--base", "--candidate", "--aa", "--commit", "--workload", "--pool", "--out"];

/**
 * The plan that continues the run recorded in `dir`: its kind, commits, key,
 * Options, Workload and pool from `gate.json`, its pairs and spend carried,
 * and its next pair past every index already used. `--parallel` and
 * `--turn-timeout` may override the record's.
 */
async function resumedPlan(dir: string, argv: string[]): Promise<Plan> {
	const { positive } = flagsOf(argv);
	const given = RECORDED_FLAGS.filter((name) => argv.includes(name));
	if (given.length > 0) {
		throw new Error(`--resume takes ${given.join(", ")} from ${join(dir, "gate.json")}; only --parallel, --turn-timeout and --ablate go beside it`);
	}
	let earlier: GateRecord;
	try {
		earlier = JSON.parse(await readFile(join(dir, "gate.json"), "utf8")) as GateRecord;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`refusing to resume: ${dir} holds no gate.json`);
		throw error;
	}
	const named = earlier.workload ?? earlier.key.workload.name;
	const workload = await loadNamedWorkload(named);
	const refusal = resumeRefusal(earlier, { omp: await ompVersion(), workload });
	if (refusal) throw new Error(`refusing to resume ${dir}: ${refusal}`);
	const history = (await readPool(earlier.pool)).batches;
	if (earlier.kind === "gate") pooledBatches(history, earlier.key);
	const folders = await readdir(join(dir, "runs")).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return [];
		throw error;
	});
	const turnTimeout = positive("--turn-timeout", earlier.turnTimeout ?? 600);
	return {
		workload,
		history,
		out: dir,
		turnTimeout,
		record: {
			kind: earlier.kind,
			base: earlier.base,
			candidate: earlier.candidate,
			key: earlier.key,
			options: earlier.options,
			pool: earlier.pool,
			parallel: positive("--parallel", earlier.parallel),
			workload: workloadFolder(named),
			turnTimeout,
			pairs: earlier.pairs,
			spent: earlier.spent,
			next: nextIndex(earlier, folders),
			cap: 0,
			capped: false,
			looks: [],
			resumed: [...(earlier.resumed ?? []), earlier.stopped ?? "interrupted before it recorded why"],
		},
	};
}

async function main(argv: string[]): Promise<void> {
	const { flag } = flagsOf(argv);

	const reportFrom = flag("--report");
	if (reportFrom) {
		const gate = JSON.parse(await readFile(join(reportFrom, "gate.json"), "utf8")) as GateRecord;
		report(gate, await measureSides(reportFrom, gate.pairs), await ablationSides(reportFrom, gate.pairs), await readCalibration());
		return;
	}

	// Names this run's Run databases; a resumed run takes a new one.
	const stamp = Date.now();
	const resumeFrom = flag("--resume");
	const plan = resumeFrom ? await resumedPlan(resolve(resumeFrom), argv) : await freshPlan(argv, stamp);
	if (!plan) return;
	const { record: gate, workload, history, out, turnTimeout } = plan;
	const { base, candidate, key } = gate;
	const server = requireThreadStore("Gate Runs");
	const refusal = connectionRefusal(await connectionState(server), gate.parallel);
	if (refusal) throw new Error(`refusing to start: ${refusal}`);
	await dropEach(server, staleDatabases(await databasesOn(server), Date.now()), "stale Run database");
	await mkdir(join(out, "runs"), { recursive: true });
	/** Takes `state` into the record, a stop as its message, and rewrites `gate.json` whole. */
	const record = async ({ stopped, ...state }: Partial<Omit<GateRecord, "stopped">> & { stopped?: unknown }) => {
		Object.assign(gate, state);
		if (stopped !== undefined) gate.stopped = stopped instanceof Error ? stopped.message : String(stopped);
		await writeJsonAtomic(join(out, "gate.json"), gate);
	};

	const temporary: string[] = [];
	try {
		// Every tree is built before any Run: a commit whose dependencies do not
		// install, or whose store lacks what a Run calls, stops here at no spend.
		const ctx = await buildContext(workload, turnsOf(workload), {
			server,
			out,
			options: gate.options,
			timeoutMs: turnTimeout * 1000,
			stamp,
		});
		temporary.push(ctx.template);
		const trees = new Map<string, string>();
		for (const sha of new Set([base, candidate])) {
			log(`building pi-chart at ${sha.slice(0, 7)}`);
			const tree = await buildTree(sha);
			temporary.push(tree);
			trees.set(sha, tree);
		}

		const runPair = pairRunner(ctx, (side, index) => {
			const sha = side === "base" ? base : candidate;
			return { arm: "pi-chart", index, label: `${side}-${index}`, source: trees.get(sha) as string, commit: sha };
		});

		await record({});
		const outcome = await runLooks({
			aa: gate.kind === "aa",
			history,
			key,
			width: gate.parallel,
			runPair,
			estimate: (pairs) => pairEstimate(pairs, history, key),
			carried: { pairs: gate.pairs, spent: gate.spent, next: gate.next ?? 0 },
			settled: record,
		});
		const { verdict, stopped, ...gathered } = outcome;
		await record({ ...gathered, ...(verdict ? { verdict } : {}), ...(stopped === undefined ? { ended: true } : { stopped }) });
		if (stopped !== undefined) {
			log(`record: ${out}; continue it with \`bun scripts/gate.ts --resume ${out}\``);
			throw stopped;
		}

		const batch = completePairs(gate.pairs);
		if (batch.length >= 2) {
			await appendToPool(gate.pool, {
				kind: gate.kind,
				key,
				date: new Date().toISOString(),
				base,
				candidate,
				out,
				pairs: batch,
			});
			log(`added ${batch.length} pairs to ${gate.pool}`);
		} else {
			log(`${batch.length} complete pair${batch.length === 1 ? "" : "s"}: nothing added to the pool`);
		}
		if (argv.includes("--ablate")) {
			// After the verdict and the pool write, so Needed share can change neither.
			const sides = SIDES.map((side) => ({ side, sha: side === "base" ? base : candidate }));
			// Both sides settle before either error surfaces: the trees go only after every replay has ended.
			const settled = await Promise.allSettled(sides.map(({ side, sha }) => ablateSide(out, gate.pairs, side, sha, trees.get(sha) as string)));
			for (const result of settled) if (result.status === "rejected") throw result.reason;
		}
		log(`record: ${out}`);
		report(gate, await measureSides(out, gate.pairs), await ablationSides(out, gate.pairs), await readCalibration());
	} catch (error) {
		// Every pair in flight has finished by now, so no Run of this Gate still uses its database.
		await databasesOn(server).then(
			(names) => dropEach(server, ownDatabases(names, stamp), "this Gate's Run database"),
			(listing: unknown) => log(`could not list databases to drop this Gate's: ${listing instanceof Error ? listing.message : listing}`),
		);
		throw error;
	} finally {
		for (const dir of temporary) await rm(dir, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	await main(process.argv.slice(2)).catch((error: unknown) => {
		console.error(`gate: ${error instanceof Error ? error.message : error}`);
		process.exitCode = 1;
	});
}
