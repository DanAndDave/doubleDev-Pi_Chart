/**
 * The Gate: whether a change to pi-chart may be archived. It runs paired
 * Runs of the Gate Workload (`bench/workloads/gate/`), one of the base
 * commit and one of the candidate in each pair, started together, and gives
 * pass, fail or inconclusive on Cost per Run and Lapses per Run.
 *
 *     bun scripts/gate.ts --base <rev> [--candidate <rev>]   # a Gate; candidate defaults to HEAD
 *     bun scripts/gate.ts --aa [--commit <rev>]              # an A/A batch; commit defaults to HEAD
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
 * when the commits differ only outside `src/`, when the pool has no A/A
 * batch for the key, or when a tree does not build.
 *
 * Looks come at 5 and 10 complete pairs (`LOOKS`). Each tests the cost log
 * ratio and the Lapse difference for a rise, Holm-corrected, and passes
 * when nothing fails and Cost's upper ratio bound is below `MARGIN`. A pair
 * with an incomplete Run is void: its cost counts, and another replaces it.
 * No pair starts once spend reaches the look's cap; pairs in flight finish,
 * so spend can pass the cap by up to `--parallel` pairs (default 2).
 *
 * The pool, `bench/gate/pool.json` (`--pool` for a smoke run), keeps every
 * A/A and Gate batch's per-pair Costs per Run and Lapses per Run under its
 * key (Workload name and version, model, omp version). Variance is pooled
 * over every batch with the current key, so a new omp version needs a new
 * A/A batch (`--aa`, about $44 on the gate Workload). A batch is added once
 * a verdict is reached, or an A/A run ends, with at least 2 complete pairs.
 *
 * Each Run's record is in `<out>/runs/base-<i>/` or `candidate-<i>/`, and
 * `<out>/gate.json` holds the commits, key, pairs, spend, looks and verdict;
 * `--report <out>` re-prints from them with no Run and no pool write.
 */
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { readSavedUrl } from "../src/config.ts";
import { type AblateOptions, AblationStop, ablateRun, readAblation } from "./ablate.ts";
import { type AblationRecord, shareLabel, summarise } from "./ablation.ts";
import { aggregate, BANDS, bandLabel, int, measureRun, median, PULL_TOOLS, type RunMeasures, usd } from "./measures.ts";
import { buildTree, type Context, flagsOf, loadNamedWorkload, log, type Options, resolveCommit, runOne } from "./runs.ts";
import { holm, mean, pooledVariance, sampleVariance, studentCdf, studentQuantile } from "./stats.ts";
import { buildWorkspace, gradedSteps, installDependencies, REPO, run, turnsOf, type WorkloadId } from "./workload.ts";

/**
 * The two looks: the pairs each needs, its one-sided level (O'Brien–Fleming,
 * overall one-sided α = 0.05), and the spend after which no pair starts.
 */
export const LOOKS = [
	{ pairs: 5, alpha: 0.0088, cap: 45 },
	{ pairs: 10, alpha: 0.0467, cap: 90 },
] as const;
/** Cost is non-inferior when the upper bound of its geometric-mean ratio is below this. */
export const MARGIN = 1.1;
/** The complete pairs an A/A run gathers, under the first look's cap. */
export const AA_PAIRS = 5;

/** The model every Gate Run uses, and must record. */
export const REFERENCE_MODEL = "anthropic/claude-opus-5-5";

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

/** The complete pairs of one A/A run or one Gate. */
export interface Batch {
	kind: "aa" | "gate";
	key: GateKey;
	/** ISO time the batch was added. */
	date: string;
	/** Full shas; the same on both sides of an A/A batch. */
	base: string;
	candidate: string;
	/** The output folder holding the batch's records. */
	out: string;
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

function describeKey(key: GateKey): string {
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
	/** Cost's test, with the geometric-mean ratio exp(mean) and its bounds. */
	cost: MeasureTest & { ratio: number; ratioLower: number; ratioUpper: number };
	lapses: MeasureTest;
	/** Whether Cost's upper ratio bound is below `MARGIN`. */
	nonInferior: boolean;
	verdict: Verdict;
}

function costDiff(pair: PairFigures): number {
	return Math.log(pair.candidate.cost) - Math.log(pair.base.cost);
}

function lapseDiff(pair: PairFigures): number {
	return pair.candidate.lapses - pair.base.lapses;
}

/** A Measure's test at level `alpha`, before Holm's correction. */
function measureTest(current: number[], stored: number[][], alpha: number): Omit<MeasureTest, "rejected"> {
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
 * not fail and Cost is non-inferior; otherwise continues to the second look,
 * or is inconclusive at it.
 */
export function decide(input: { look: number; pairs: PairFigures[]; history: Batch[]; key: GateKey }): Decision {
	const { look, pairs, history, key } = input;
	const { alpha } = LOOKS[look] as (typeof LOOKS)[number];
	const stored = pooledBatches(history, key);
	const cost = measureTest(pairs.map(costDiff), stored.map((batch) => batch.pairs.map(costDiff)), alpha);
	const lapses = measureTest(pairs.map(lapseDiff), stored.map((batch) => batch.pairs.map(lapseDiff)), alpha);
	const [costRejected, lapsesRejected] = holm([cost.p, lapses.p], alpha) as [boolean, boolean];
	const ratioUpper = Math.exp(cost.upper);
	const nonInferior = ratioUpper < MARGIN;
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

export interface Gathered {
	/** Every finished pair, void ones included, by index. */
	pairs: PairRun[];
	/** Cost per Run summed over every finished Run, a stopping pair's included. */
	spent: number;
	/** Whether the cap stopped the look short of `want` complete pairs. */
	capped: boolean;
	/** The first error a pair threw, which stops the Gate. */
	stopped?: unknown;
}

/**
 * Runs pairs, up to `width` at once, until `want` of them are complete. A
 * pair starts only while complete and in-flight pairs number fewer than
 * `want` and `spent` is below `cap`; each finished pair adds both Runs' cost
 * to `spent`, and a void one frees its slot for a replacement. `pairs` and
 * `spent` carry an earlier look's pairs. After `runPair` throws, no pair
 * starts and the ones in flight finish; the error comes back as `stopped`
 * beside every pair that finished, and a `PairStop`'s spend is counted.
 */
export async function gatherPairs(input: {
	want: number;
	cap: number;
	width: number;
	runPair: (index: number) => Promise<PairRun>;
	pairs?: PairRun[];
	spent?: number;
}): Promise<Gathered> {
	const { want, cap, width, runPair } = input;
	const pairs = [...(input.pairs ?? [])];
	let spent = input.spent ?? 0;
	let next = pairs.reduce((top, pair) => Math.max(top, pair.index + 1), 0);
	let inFlight = 0;
	let stopped: { error: unknown } | undefined;
	const complete = () => pairs.filter(isComplete).length;

	await new Promise<void>((resolve) => {
		const fill = () => {
			while (!stopped && inFlight < width && complete() + inFlight < want && spent < cap) {
				inFlight++;
				runPair(next++)
					.then(
						(pair) => {
							pairs.push(pair);
							spent += pair.base.cost + pair.candidate.cost;
						},
						(error: unknown) => {
							if (error instanceof PairStop) spent += error.spent;
							stopped ??= { error };
						},
					)
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
	return { pairs, spent, capped: !stopped && complete() < want, ...(stopped ? { stopped: stopped.error } : {}) };
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

// ---------------------------------------------------------------- record --

/** `gate.json`: everything the report needs besides the Runs' own records. */
export interface GateRecord {
	kind: Batch["kind"];
	/** Full shas; the same on both sides of an A/A run. */
	base: string;
	candidate: string;
	key: GateKey;
	options: Options;
	pool: string;
	parallel: number;
	/** Every pair the Gate ran, void ones included, by index. */
	pairs: PairRun[];
	spent: number;
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
}

const POOL = join(REPO, "bench", "gate", "pool.json");

async function readPool(file: string): Promise<Pool> {
	try {
		return JSON.parse(await readFile(file, "utf8")) as Pool;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { batches: [] };
		throw error;
	}
}

/** Adds `batch` to the pool at `file`, replacing the file whole so a crash never leaves half of one. */
async function appendToPool(file: string, batch: Batch): Promise<void> {
	const pool = await readPool(file);
	pool.batches.push(batch);
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(pool, null, "\t")}\n`);
	await rename(temporary, file);
}

function completePairs(pairs: PairRun[]): PairFigures[] {
	return pairs.filter(isComplete).map(({ base, candidate }) => ({
		base: { cost: base.cost, lapses: base.lapses },
		candidate: { cost: candidate.cost, lapses: candidate.lapses },
	}));
}

// ---------------------------------------------------------------- report --

type Sides = { base: RunMeasures[]; candidate: RunMeasures[] };

/** A figure, or "—" where there is none (JSON keeps NaN as null). */
function fixed(value: number | null | undefined, digits: number): string {
	return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function pValue(value: number): string {
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

export function report(gate: GateRecord, sides: Sides, ablation: Record<Side, AblationRecord[]>): void {
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
		console.log(
			"| Look | Pairs | α | Cost ratio | Lower | Upper | Cost p | Lapse Δ | Lapse lower | Lapse p | Holm rejects | " +
				"Cost SD pooled / own | Lapse SD pooled / own | df | Result |",
		);
		console.log("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |");
		for (const look of gate.looks) {
			const { cost, lapses } = look;
			const rejects = [cost.rejected ? "Cost" : "", lapses.rejected ? "Lapses" : ""].filter(Boolean).join(", ") || "none";
			console.log(
				`| ${look.look + 1} | ${look.pairs} | ${look.alpha} | ${fixed(cost.ratio, 3)} | ${fixed(cost.ratioLower, 3)} | ` +
					`${fixed(cost.ratioUpper, 3)} | ${pValue(cost.p)} | ${fixed(lapses.mean, 2)} | ${fixed(lapses.lower, 2)} | ` +
					`${pValue(lapses.p)} | ${rejects} | ${fixed(cost.sd, 4)} / ${fixed(cost.ownSd, 4)} | ` +
					`${fixed(lapses.sd, 2)} / ${fixed(lapses.ownSd, 2)} | ${cost.df} | ${look.verdict} |`,
			);
		}
	}

	console.log(
		`\nSpend ${usd(gate.spent)} of a ${usd(gate.cap)} cap, over ${gate.pairs.length * 2} Runs. ` +
			`Spend may exceed the cap by the pairs already running when it was reached (up to ${gate.parallel} at once).`,
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
	row("Utilisation", () => "not measured");

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

/** Each side's Measures, recomputed from the record folders the Gate left. */
async function measureSides(out: string, pairs: PairRun[]): Promise<Sides> {
	const sides: Sides = { base: [], candidate: [] };
	for (const { index } of pairs) {
		for (const side of SIDES) {
			sides[side].push(await measureRun(join(out, "runs", `${side}-${index}`)));
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

async function main(argv: string[]): Promise<void> {
	const { flag, positive } = flagsOf(argv);

	const reportFrom = flag("--report");
	if (reportFrom) {
		const gate = JSON.parse(await readFile(join(reportFrom, "gate.json"), "utf8")) as GateRecord;
		report(gate, await measureSides(reportFrom, gate.pairs), await ablationSides(reportFrom, gate.pairs));
		return;
	}

	const aa = argv.includes("--aa");
	let base: string;
	let candidate: string;
	if (aa) {
		base = candidate = await resolveCommit(flag("--commit") ?? "HEAD");
	} else {
		const baseRevision = flag("--base");
		if (!baseRevision) throw new Error("a Gate needs --base <the commit before the change>; or --aa, or --report <dir>");
		base = await resolveCommit(baseRevision);
		candidate = await resolveCommit(flag("--candidate") ?? "HEAD");
		if (!(await changesSource(base, candidate))) {
			console.log(`${base.slice(0, 7)} → ${candidate.slice(0, 7)} does not touch src/: no Gate is needed.`);
			return;
		}
	}

	const workload = await loadNamedWorkload(flag("--workload") ?? "gate");
	const turns = turnsOf(workload);
	const options: Options = {
		workload: { name: workload.name, version: workload.version, commit: workload.commit },
		model: REFERENCE_MODEL,
		turns: turns.length,
		omp: (await run(["omp", "--version"])).trim(),
	};
	const key = keyOf(options.workload, options.omp);
	const poolFile = resolve(flag("--pool") ?? POOL);
	const history = (await readPool(poolFile)).batches;
	if (!aa) pooledBatches(history, key);
	const server = process.env.PICHART_DATABASE_URL ?? readSavedUrl();
	if (!server) throw new Error("Gate Runs need a Thread Store server: set PICHART_DATABASE_URL, or run setup to save one");
	const parallel = positive("--parallel", 2);
	const stamp = Date.now();
	const out = resolve(flag("--out") ?? join(tmpdir(), `pichart-gate-${stamp}`));
	await mkdir(join(out, "runs"), { recursive: true });

	const temporary: string[] = [];
	try {
		// Every tree is built before any Run: a commit whose dependencies do not
		// install, or whose store lacks what a Run calls, stops here at no spend.
		const template = await mkdtemp(join(tmpdir(), "pichart-template-"));
		temporary.push(template);
		log(`building ${workload.name} v${workload.version} at ${workload.commit.slice(0, 7)}`);
		await buildWorkspace(workload, template);
		await installDependencies(template);
		const trees = new Map<string, string>();
		for (const sha of new Set([base, candidate])) {
			log(`building pi-chart at ${sha.slice(0, 7)}`);
			const tree = await buildTree(sha);
			temporary.push(tree);
			trees.set(sha, tree);
		}

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
		const runPair = async (index: number): Promise<PairRun> => {
			const sides = SIDES.map((side) => ({ side, sha: side === "base" ? base : candidate }));
			// Alternate which side's job is created first, so start-order effects fall on both alike.
			if (index % 2 === 1) sides.reverse();
			const settled = await Promise.allSettled(
				sides.map(({ side, sha }) =>
					runOne({ arm: "pi-chart", index, label: `${side}-${index}`, source: trees.get(sha) as string, commit: sha }, ctx),
				),
			);
			const outcome: Partial<Record<Side, RunOutcome>> = {};
			let spent = 0;
			let stop: { message: string; cause?: unknown } | undefined;
			for (const [at, result] of settled.entries()) {
				const { side } = sides[at] as (typeof sides)[number];
				if (result.status === "rejected") {
					const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
					stop ??= { message: `${side}-${index}: ${reason}`, cause: result.reason };
					continue;
				}
				const { record, measures } = result.value;
				spent += measures.cost;
				// A complete Run always left a Journal naming its model; a void one may have left none.
				if (record.model === undefined ? measures.complete : record.model !== REFERENCE_MODEL) {
					stop ??= { message: `${side}-${index} ran on ${record.model ?? "no recorded model"}, not ${REFERENCE_MODEL}` };
				}
				outcome[side] = { cost: measures.cost, lapses: gateLapses(measures), complete: measures.complete };
			}
			if (stop) throw new PairStop(stop.message, spent, { cause: stop.cause });
			const pair = { index, base: outcome.base as RunOutcome, candidate: outcome.candidate as RunOutcome };
			log(`pair ${index}: ${isComplete(pair) ? "complete" : "void"}`);
			return pair;
		};

		const gate: GateRecord = {
			kind: aa ? "aa" : "gate",
			base,
			candidate,
			key,
			options,
			pool: poolFile,
			parallel,
			pairs: [],
			spent: 0,
			cap: 0,
			capped: false,
			looks: [],
		};
		let stop: { error: unknown } | undefined;
		try {
			let gathered: Gathered | undefined;
			for (const [look, { pairs, cap }] of LOOKS.entries()) {
				const want = aa ? AA_PAIRS : pairs;
				gate.cap = cap;
				gathered = await gatherPairs({ want, cap, width: parallel, runPair, ...gathered });
				Object.assign(gate, { pairs: gathered.pairs, spent: gathered.spent, capped: gathered.capped });
				if (gathered.stopped !== undefined) throw gathered.stopped;
				if (aa) break;
				const current = completePairs(gathered.pairs);
				if (gathered.capped) {
					if (current.length > 0) gate.looks.push({ ...decide({ look, pairs: current, history, key }), verdict: "inconclusive" });
					gate.verdict = "inconclusive";
					break;
				}
				const decision = decide({ look, pairs: current, history, key });
				gate.looks.push(decision);
				if (decision.verdict !== "continue") {
					gate.verdict = decision.verdict;
					break;
				}
			}
		} catch (error) {
			gate.stopped = error instanceof Error ? error.message : String(error);
			stop = { error };
		}
		await writeFile(join(out, "gate.json"), JSON.stringify(gate, null, "\t"));
		if (stop) throw stop.error;

		const batch = completePairs(gate.pairs);
		if (batch.length >= 2) {
			await appendToPool(poolFile, {
				kind: gate.kind,
				key,
				date: new Date().toISOString(),
				base,
				candidate,
				out,
				pairs: batch,
			});
			log(`added ${batch.length} pairs to ${poolFile}`);
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
		report(gate, await measureSides(out, gate.pairs), await ablationSides(out, gate.pairs));
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
