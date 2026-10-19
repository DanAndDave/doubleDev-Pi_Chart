/**
 * The comparison with plain omp: paired Runs of both Arms in three batches,
 * Ablation on the first, and a report of paired differences with two-sided
 * 95% intervals.
 *
 *     bun scripts/compare.ts --out <dir> --batch reference|second|evocode [--parallel <pairs>] [--turn-timeout <s>]
 *     bun scripts/compare.ts --out <dir> --batch reference|second --workload <name> --pairs <n>   # a smoke run
 *     bun scripts/compare.ts --out <dir> --batch evocode --resume [--parallel <pairs>]
 *     bun scripts/compare.ts --out <dir> --ablate
 *     bun scripts/compare.ts --out <dir> --report [--date YYYY-MM-DD]
 *
 * Each pair is one plain-omp Run and one pi-chart Run of the same Workload or
 * task on the same model, started together, which goes first alternating by
 * pair. `reference` runs the Gate Workload on `REFERENCE_MODEL` and `second`
 * on `SECOND_MODEL`, each until 10 pairs are complete, a void pair replaced;
 * `evocode` runs 2 pairs of every admitted task of `bench/evocode/subset.json`,
 * every task's first pair before any second, a void pair kept. No pair starts
 * once a batch's spend reaches its cap (`BATCHES`); pairs in flight finish.
 * A Run that cannot be run, or that records another model, stops the batch.
 *
 * A batch refuses to start while `src/` differs from `HEAD`'s
 * (`srcIsCommitted`), and when its folder `<out>/<batch>/` exists, so a
 * batch is never run twice into one folder. pi-chart Runs of the Gate
 * Workload load a tree of `HEAD`
 * (`buildTree`); EvoCode Runs mount the checkout, which is `HEAD`'s. Each
 * batch leaves its Runs in `<out>/<batch>/runs/<label>/` and `batch.json`
 * beside them. `--resume` picks up an EvoCode batch a Run stopped: on the
 * omp, admitted tasks and `src/` it ran on, it runs only the pairs its record
 * lacks, under the same cap, and names the stop in `resumed`.
 *
 * `--ablate` ablates both Runs of the reference batch's 2 lowest-indexed
 * complete pairs, 20 units and at most $10 each, and keeps what each spent in
 * `<out>/ablation.json`; a Run already there is not ablated again.
 *
 * `--report` recomputes every Run's Measures from its record folder, with no
 * model Call, and writes `docs/benchmarks/<date>-plain-omp-comparison.md` and
 * `.json`. Neither holds prompt or Journal text: EvoCode's tasks are CC BY-NC.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { AblationStop, ablateRun, ppiByArm, readAblation } from "./ablate.ts";
import { type AblationRecord, percentLabel, type Summary, shareLabel, summarise } from "./ablation.ts";
import { readCalibration } from "./calibration.ts";
import {
	CACHE_ROOT,
	download,
	type EvoContext,
	fetchTasks,
	hostChecks,
	preconditions,
	runTask,
	SUBSET_FILE,
	type Subset,
} from "./evocode.ts";
import { gatherPairs, gateLapses, isComplete, offModel, PairStop, pairRunner, REFERENCE_MODEL, referenceOptions } from "./gate.ts";
import { BANDS, bandLabel, measureRun, type Outcome, type RunMeasures, type RunRecord, readRecord, type Score } from "./measures.ts";
import {
	type Arm,
	buildContext,
	buildTree,
	flagsOf,
	headerOf,
	loadNamedWorkload,
	log,
	ompVersion,
	requireThreadStore,
	resolveCommit,
	srcIsCommitted,
} from "./runs.ts";
import { mean, type PairedFigure, pairedWithinTasks } from "./stats.ts";
import { runCapped } from "./sweep.ts";
import { PULL_TOOLS } from "./units.ts";
import { CAVEATS as UTILISATION_CAVEATS, type RunUtilisation, share, utilisationLabel } from "./utilisation.ts";
import { REPO, run, turnsOf } from "./workload.ts";

/** What the report and its JSON keep of one Run: figures only, never prompt, reply or Journal text. */
export interface RunSummary {
	label: string;
	arm: Arm;
	index: number;
	/** The EvoCode task; absent on a Gate Workload Run. */
	task?: string;
	model?: string;
	/** The level the Run was given, else the Journal's: the harness default. */
	thinking?: string;
	/** Present when the Run was given its level rather than running at the default. */
	thinkingGiven?: true;
	complete: boolean;
	cost: number;
	steps: { id: string; outcome: Outcome }[];
	passes: number;
	firstFail?: string;
	/** As the Gate counts them (`gateLapses`). */
	lapses: number;
	plants: Score[];
	compactions?: number;
	pulls?: RunMeasures["pulls"];
	recall?: RunMeasures["recall"];
	utilisation?: RunUtilisation;
}

/** A Run's summary; `thinking` is its Journal's level, used when the Run was given none. */
export function summaryOf(run: { label: string; task?: string }, record: RunRecord, measures: RunMeasures, thinking?: string): RunSummary {
	const level = record.thinking ?? thinking;
	return {
		label: run.label,
		arm: record.arm as Arm,
		index: record.index,
		...(run.task === undefined ? {} : { task: run.task }),
		...(record.model === undefined ? {} : { model: record.model }),
		...(level === undefined ? {} : { thinking: level }),
		...(record.thinking === undefined ? {} : { thinkingGiven: true as const }),
		complete: measures.complete,
		cost: measures.cost,
		steps: measures.steps,
		passes: measures.passes,
		...(measures.firstFail === undefined ? {} : { firstFail: measures.firstFail }),
		lapses: gateLapses(measures),
		plants: measures.plants,
		...(measures.compactions === undefined ? {} : { compactions: measures.compactions }),
		...(measures.pulls === undefined ? {} : { pulls: measures.pulls }),
		...(measures.recall === undefined ? {} : { recall: measures.recall }),
		...(measures.utilisation === undefined ? {} : { utilisation: measures.utilisation }),
	};
}

// -------------------------------------------------------------- headline --

/** One pair as the headline reads it: the task it ran, or the Workload's name for a Gate Workload batch. */
export interface ComparedPair {
	task: string;
	vanilla: RunSummary;
	piChart: RunSummary;
}

/** A Run's planted Probes scored right, of those scored. */
export interface PlantTally {
	right: number;
	of: number;
}

/**
 * One headline Measure. `cost`: each Arm's figure is a geometric mean in USD
 * and `diff` the mean log ratio, pi-chart over plain omp. `count`: means, and
 * pi-chart minus plain omp. `share`: each Arm's right of scored over the
 * pairs counted, and the mean of pi-chart's share minus plain omp's.
 */
export interface HeadlineRow {
	measure: string;
	scale: "cost" | "count" | "share";
	/** Absent when no pair counts. */
	vanilla?: number;
	piChart?: number;
	tallies?: { vanilla: PlantTally; piChart: PlantTally };
	diff: PairedFigure;
	/** Complete pairs left out of this row. */
	excluded: number;
	/** Why the row has no figure at all. */
	note?: string;
}

const geometricMean = (values: number[]) => Math.exp(mean(values.map(Math.log)));

/** The pairs' differences grouped by task, in the order tasks first appear. */
function byTask(pairs: ComparedPair[], diff: (pair: ComparedPair) => number): number[][] {
	const groups = new Map<string, number[]>();
	for (const pair of pairs) groups.set(pair.task, [...(groups.get(pair.task) ?? []), diff(pair)]);
	return [...groups.values()];
}

function figureRow(
	measure: string,
	scale: "cost" | "count",
	all: ComparedPair[],
	counts: (pair: ComparedPair) => boolean,
	value: (run: RunSummary) => number,
): HeadlineRow {
	const pairs = all.filter(counts);
	const average = scale === "cost" ? geometricMean : mean;
	const diff = scale === "cost" ? (pair: ComparedPair) => Math.log(value(pair.piChart)) - Math.log(value(pair.vanilla)) : (pair: ComparedPair) => value(pair.piChart) - value(pair.vanilla);
	return {
		measure,
		scale,
		...(pairs.length === 0
			? {}
			: { vanilla: average(pairs.map((pair) => value(pair.vanilla))), piChart: average(pairs.map((pair) => value(pair.piChart))) }),
		diff: pairedWithinTasks(byTask(pairs, diff)),
		excluded: all.length - pairs.length,
	};
}

/** A Run's scores of planted Plants in `band`: unplanted scores have no distance, so are in none. */
function inBand(run: RunSummary, [low, high]: (typeof BANDS)[number]): PlantTally {
	const scores = run.plants.filter((score) => score.distance !== undefined && score.distance >= low && score.distance <= high);
	return { right: scores.filter((score) => score.right).length, of: scores.length };
}

function retentionRow(band: (typeof BANDS)[number], all: ComparedPair[]): HeadlineRow {
	const pairs = all.filter((pair) => inBand(pair.vanilla, band).of > 0 && inBand(pair.piChart, band).of > 0);
	const pooled = (side: Side): PlantTally =>
		pairs.reduce((sum, pair) => {
			const tally = inBand(pair[side], band);
			return { right: sum.right + tally.right, of: sum.of + tally.of };
		}, { right: 0, of: 0 });
	const rightShare = ({ right, of }: PlantTally) => right / of;
	const tallies = { vanilla: pooled("vanilla"), piChart: pooled("piChart") };
	return {
		measure: `Retention, ${bandLabel(band)} Turns`,
		scale: "share",
		...(pairs.length === 0 ? {} : { vanilla: rightShare(tallies.vanilla), piChart: rightShare(tallies.piChart), tallies }),
		diff: pairedWithinTasks(byTask(pairs, (pair) => rightShare(inBand(pair.piChart, band)) - rightShare(inBand(pair.vanilla, band)))),
		excluded: all.length - pairs.length,
	};
}

/**
 * The headline Measures over the complete pairs of `pairs`, pooled within
 * tasks: Cost per Run, Cost per Pass, Lapses per Run, and Retention per
 * distance band, or one "n/a: no Plants" row when the Workload states none.
 */
export function headline(pairs: ComparedPair[], planted: boolean): HeadlineRow[] {
	const complete = pairs.filter((pair) => pair.vanilla.complete && pair.piChart.complete);
	const always = () => true;
	return [
		figureRow("Cost per Run", "cost", complete, always, (run) => run.cost),
		figureRow("Cost per Pass", "cost", complete, (pair) => pair.vanilla.passes > 0 && pair.piChart.passes > 0, (run) => run.cost / run.passes),
		figureRow("Lapses per Run", "count", complete, always, (run) => run.lapses),
		...(planted
			? BANDS.map((band) => retentionRow(band, complete))
			: [{ measure: "Retention", scale: "share" as const, diff: pairedWithinTasks([]), excluded: 0, note: "n/a: no Plants" }]),
	];
}

// ------------------------------------------------------- per-Run tables --

/** The key a per-Arm row holds an Arm's figure under. */
type Side = "vanilla" | "piChart";
const sideOf = (arm: Arm): Side => (arm === "vanilla" ? "vanilla" : "piChart");

/** Each graded step's Passes per Arm, of the complete Runs that graded it, in the order steps first appear. */
export function passCounts(runs: RunSummary[]): { step: string; vanilla: { pass: number; of: number }; piChart: { pass: number; of: number } }[] {
	const rows = new Map<string, { step: string; vanilla: { pass: number; of: number }; piChart: { pass: number; of: number } }>();
	for (const run of runs.filter((each) => each.complete)) {
		for (const { id, outcome } of run.steps) {
			if (outcome === "not graded") continue;
			const step = run.task === undefined ? id : `${run.task}: ${id}`;
			let row = rows.get(step);
			if (!row) rows.set(step, (row = { step, vanilla: { pass: 0, of: 0 }, piChart: { pass: 0, of: 0 } }));
			const cell = row[sideOf(run.arm)];
			cell.of++;
			if (outcome === "Pass") cell.pass++;
		}
	}
	return [...rows.values()];
}

/** Each Arm's complete Runs per first failing step, "none" last for Runs that failed none. */
export function firstFails(runs: RunSummary[]): { step: string; vanilla: number; piChart: number }[] {
	const rows = new Map<string, { step: string; vanilla: number; piChart: number }>();
	const none = { step: "none", vanilla: 0, piChart: 0 };
	for (const run of runs.filter((each) => each.complete)) {
		let row = none;
		if (run.firstFail !== undefined) {
			const step = run.task === undefined ? run.firstFail : `${run.task}: ${run.firstFail}`;
			row = rows.get(step) ?? { step, vanilla: 0, piChart: 0 };
			rows.set(step, row);
		}
		row[sideOf(run.arm)]++;
	}
	return [...rows.values(), none];
}

/** A Measure only one Arm can have: its mean per complete Run on that Arm, "n/a" on the other. */
export interface OneArmRow {
	measure: string;
	vanilla: number | "n/a";
	piChart: number | "n/a";
}

/** Compactions per Run (plain omp), and Pulls per tool and recall Pulls per band (pi-chart), per complete Run. */
export function oneArmRows(runs: RunSummary[]): OneArmRow[] {
	const complete = (arm: Arm) => runs.filter((run) => run.complete && run.arm === arm);
	const vanilla = complete("vanilla");
	const piChart = complete("pi-chart");
	return [
		{ measure: "Compactions per Run", vanilla: mean(vanilla.map((run) => run.compactions ?? 0)), piChart: "n/a" },
		...PULL_TOOLS.map((tool) => ({
			measure: `Pulls per Run: ${tool}`,
			vanilla: "n/a" as const,
			piChart: mean(piChart.map((run) => run.pulls?.[tool]?.calls ?? 0)),
		})),
		...BANDS.map((band, at) => ({
			measure: `Recall Pulls per Run, ${bandLabel(band)} Turns`,
			vanilla: "n/a" as const,
			piChart: mean(piChart.map((run) => run.recall?.recall.bands[at] ?? 0)),
		})),
	];
}

// --------------------------------------------------------------- batches --

export type BatchName = "reference" | "second" | "evocode";
export const BATCH_NAMES: readonly BatchName[] = ["reference", "second", "evocode"];

/** The second batch's model: the Gate Workload again, on a model other than the reference. */
export const SECOND_MODEL = "anthropic/claude-sonnet-5-5";

/** Each batch's model, its spend cap in USD, and how the report names it. */
export const BATCHES: Record<BatchName, { model: string; cap: number; title: string }> = {
	reference: { model: REFERENCE_MODEL, cap: 80, title: "Reference: the Gate Workload" },
	second: { model: SECOND_MODEL, cap: 45, title: "Second model: the Gate Workload" },
	evocode: { model: REFERENCE_MODEL, cap: 125, title: "EvoCode subset" },
};

/** The complete pairs a Gate Workload batch runs until, and the pairs per task of the EvoCode batch. */
export const GATE_PAIRS = 10;
export const EVOCODE_PER_TASK = 2;
/** The Workload the Gate Workload batches run, unless a smoke run names another. */
const GATE_WORKLOAD = "gate";

/** One finished pair, void or complete, by the labels of its two Runs' record folders. */
export interface BatchPair {
	index: number;
	/** The EvoCode task; absent on a Gate Workload batch. */
	task?: string;
	vanilla: string;
	piChart: string;
	complete: boolean;
}

/** `<out>/<batch>/batch.json`. */
export interface BatchRecord {
	batch: BatchName;
	model: string;
	workload: { name: string; version: number } | { tasks: string[]; revision: string };
	/** Complete pairs wanted (Gate Workload) or pairs per task (EvoCode). */
	want: number;
	omp: string;
	/** The `HEAD` the pi-chart Runs loaded. */
	commit: string;
	parallel: number;
	cap: number;
	/** Cost per Run summed over every finished Run, a stopping pair's included. */
	spent: number;
	/** Whether the cap stopped the batch short of its pairs. */
	capped: boolean;
	/** Why a Run stopped the batch. */
	stopped?: string;
	/** The stops an EvoCode batch was resumed past, oldest first; their pairs' Run folders are under `stopped/<n>/`. */
	resumed?: string[];
	pairs: BatchPair[];
}

/** One EvoCode pair to run: its place in the batch, its task, and which of the task's pairs it is. */
export interface EvoJob {
	index: number;
	task: string;
	replica: number;
}

/**
 * Runs `perTask` pairs of each task, `width` at once, every task's first pair
 * before any task's second, while the spend is below `cap`. A void pair is
 * kept and not run again. A `runPair` that throws stops the batch: the pairs
 * in flight finish, and a `PairStop`'s spend is counted. A resumed batch
 * passes its record's pairs and spend as `prior`: only the pairs it lacks
 * run, and the cap counts what it spent before.
 */
export async function evocodeBatch(input: {
	tasks: string[];
	perTask: number;
	cap: number;
	width: number;
	prior?: { pairs: BatchPair[]; spent: number };
	runPair: (job: EvoJob) => Promise<{ pair: BatchPair; cost: number }>;
}): Promise<{ pairs: BatchPair[]; spent: number; capped: boolean; stopped?: string }> {
	const { tasks, perTask, cap, width, runPair } = input;
	const pairs: BatchPair[] = [...(input.prior?.pairs ?? [])];
	let spent = input.prior?.spent ?? 0;
	const done = new Set(pairs.map((pair) => pair.index));
	const jobs = Array.from({ length: perTask }, (_, replica) => tasks.map((task, at) => ({ index: replica * tasks.length + at, task, replica })))
		.flat()
		.filter((job) => !done.has(job.index));
	try {
		const capped = await runCapped({
			width,
			cap: cap - spent,
			jobs: jobs.map((job) => async () => {
				try {
					const { pair, cost } = await runPair(job);
					pairs.push(pair);
					spent += cost;
					return { cost };
				} catch (error) {
					if (error instanceof PairStop) spent += error.spent;
					throw error;
				}
			}),
		});
		return { pairs: pairs.sort((a, b) => a.index - b.index), spent, capped };
	} catch (error) {
		const stopped = error instanceof Error ? error.message : String(error);
		return { pairs: pairs.sort((a, b) => a.index - b.index), spent, capped: false, stopped };
	}
}

/**
 * Runs one EvoCode pair: both Arms' Runs of the task together, plain omp
 * created first on even indices. A Run that throws, or one off `model`,
 * throws a `PairStop` carrying what the pair's finished Runs cost.
 */
function evoPairRunner(ctx: EvoContext, taskDir: (task: string) => string): (job: EvoJob) => Promise<{ pair: BatchPair; cost: number }> {
	return async ({ index, task, replica }) => {
		const labelOf = (arm: Arm) => `${task}-${arm}-${replica}`;
		const arms: Arm[] = index % 2 === 0 ? ["vanilla", "pi-chart"] : ["pi-chart", "vanilla"];
		const settled = await Promise.allSettled(
			arms.map((arm) => runTask({ task: { id: task, dir: taskDir(task) }, arm, index: replica, label: labelOf(arm) }, ctx)),
		);
		let cost = 0;
		let complete = true;
		let stop: { message: string; cause?: unknown } | undefined;
		for (const [at, result] of settled.entries()) {
			const label = labelOf(arms[at] as Arm);
			if (result.status === "rejected") {
				const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
				stop ??= { message: `${label}: ${reason}`, cause: result.reason };
				continue;
			}
			const { record, measures } = result.value;
			cost += measures.cost;
			complete &&= measures.complete;
			const off = offModel(record, measures, ctx.model);
			if (off) stop ??= { message: `${label} ${off}` };
		}
		if (stop) throw new PairStop(stop.message, cost, { cause: stop.cause });
		log(`${task} pair ${replica}: ${complete ? "complete" : "void"}`);
		return { pair: { index, task, vanilla: labelOf("vanilla"), piChart: labelOf("pi-chart"), complete }, cost };
	};
}

/** A Gate Workload batch: pairs on `model` until `want` are complete, void ones replaced, under the batch's cap. */
async function gateBatch(
	name: Exclude<BatchName, "evocode">,
	dir: string,
	settings: { workload: string; want: number; parallel: number; timeoutMs: number },
): Promise<BatchRecord> {
	const { model, cap } = BATCHES[name];
	const workload = await loadNamedWorkload(settings.workload);
	const omp = await ompVersion();
	const commit = await resolveCommit("HEAD");
	const server = requireThreadStore("pi-chart Runs");
	const record: BatchRecord = {
		batch: name,
		model,
		workload: { name: workload.name, version: workload.version },
		want: settings.want,
		omp,
		commit,
		parallel: settings.parallel,
		cap,
		spent: 0,
		capped: false,
		pairs: [],
	};
	const temporary: string[] = [];
	try {
		const ctx = await buildContext(workload, turnsOf(workload), {
			server,
			out: dir,
			options: { ...referenceOptions(workload, omp), model },
			timeoutMs: settings.timeoutMs,
			stamp: Date.now(),
		});
		temporary.push(ctx.template);
		log(`building pi-chart at ${commit.slice(0, 7)}`);
		const tree = await buildTree(commit);
		temporary.push(tree);
		// Side `base` is plain omp and `candidate` pi-chart, so plain omp's job is created first on even indices.
		const runPair = pairRunner(ctx, (side, index) => {
			const arm: Arm = side === "base" ? "vanilla" : "pi-chart";
			return { arm, index, label: `${arm}-${index}`, source: tree, commit };
		});
		const gathered = await gatherPairs({ want: settings.want, cap, width: settings.parallel, runPair });
		record.pairs = gathered.pairs.map((pair) => ({
			index: pair.index,
			vanilla: `vanilla-${pair.index}`,
			piChart: `pi-chart-${pair.index}`,
			complete: isComplete(pair),
		}));
		record.spent = gathered.spent;
		record.capped = gathered.capped;
		if (gathered.stopped !== undefined) {
			record.stopped = gathered.stopped instanceof Error ? gathered.stopped.message : String(gathered.stopped);
		}
		return record;
	} finally {
		for (const each of temporary) await rm(each, { recursive: true, force: true });
	}
}

/**
 * The EvoCode batch: `EVOCODE_PER_TASK` pairs of every admitted task on the
 * reference model, under the batch's cap. Given the record of a stopped
 * batch, it runs only the pairs that record lacks, on the same omp, tasks
 * and pi-chart source, and moves the stopping pairs' Run folders aside.
 */
async function evoBatch(dir: string, parallel: number, prior?: BatchRecord): Promise<BatchRecord> {
	const { model, cap } = BATCHES.evocode;
	const { harbor, server } = await preconditions(hostChecks);
	const subset = (await Bun.file(SUBSET_FILE).json()) as Subset;
	const tasks = subset.candidates.filter((candidate) => candidate.status === "admitted").map((candidate) => candidate.task);
	if (tasks.length === 0) throw new Error(`${SUBSET_FILE} admits no task`);
	const omp = await ompVersion();
	const commit = prior?.commit ?? (await resolveCommit("HEAD"));
	if (prior) {
		const workload = { tasks, revision: subset.revision };
		if (JSON.stringify(prior.workload) !== JSON.stringify(workload)) {
			throw new Error(`refusing: ${SUBSET_FILE} no longer admits the tasks the batch ran (${JSON.stringify(prior.workload)})`);
		}
		if (omp !== prior.omp) throw new Error(`refusing: omp is ${omp}, and the batch ran on ${prior.omp}; put that omp first on PATH`);
		const changed = (await run(["git", "-C", REPO, "diff", "--name-only", prior.commit, "HEAD", "--", "src/"])).trim();
		if (changed) throw new Error(`refusing: src/ has changed since ${prior.commit.slice(0, 7)}, which the batch's pi-chart Runs loaded (${changed.split("\n").join(", ")})`);
	}
	const root = await fetchTasks(subset, { download, cacheRoot: CACHE_ROOT });
	if (prior) {
		const kept = new Set(prior.pairs.map((pair) => pair.index));
		const aside = join(dir, "stopped", String(prior.resumed?.length ?? 0));
		for (const [index, task] of Array.from({ length: EVOCODE_PER_TASK }, () => tasks).flat().entries()) {
			if (kept.has(index)) continue;
			for (const arm of ["vanilla", "pi-chart"] as Arm[]) {
				const label = `${task}-${arm}-${Math.floor(index / tasks.length)}`;
				for (const kind of ["runs", "harbor"]) {
					if (!existsSync(join(dir, kind, label))) continue;
					await mkdir(join(aside, kind), { recursive: true });
					await rename(join(dir, kind, label), join(aside, kind, label));
				}
			}
		}
	}
	const ctx: EvoContext = { out: dir, stamp: Date.now(), server, harbor, omp, revision: subset.revision, commit, model };
	const batch = await evocodeBatch({
		tasks,
		perTask: EVOCODE_PER_TASK,
		cap,
		width: parallel,
		...(prior ? { prior: { pairs: prior.pairs, spent: prior.spent } } : {}),
		runPair: evoPairRunner(ctx, (task) => join(root, task)),
	});
	return {
		batch: "evocode",
		model,
		workload: { tasks, revision: subset.revision },
		want: EVOCODE_PER_TASK,
		omp,
		commit,
		parallel,
		cap,
		...batch,
		...(prior ? { resumed: [...(prior.resumed ?? []), prior.stopped as string] } : {}),
	};
}

async function readBatch(out: string, name: BatchName): Promise<BatchRecord | undefined> {
	const file = join(out, name, "batch.json");
	return existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as BatchRecord) : undefined;
}

// -------------------------------------------------------------- ablation --

/** Runs ablated per Arm, and the units and cap of each. */
const ABLATE_PAIRS = 2;
const ABLATE_UNITS = 20;
const ABLATE_CAP = 10;

/** `<out>/ablation.json`: what each ablated Run spent, and why one has no Ablation record. */
export interface AblationLedger {
	runs: { label: string; arm: Arm; spent: number; stopped?: string }[];
}

async function readLedger(out: string): Promise<AblationLedger> {
	const file = join(out, "ablation.json");
	return existsSync(file) ? (JSON.parse(await readFile(file, "utf8")) as AblationLedger) : { runs: [] };
}

/** Ablates both Runs of the reference batch's lowest-indexed complete pairs, one Run at a time. */
async function ablate(out: string): Promise<void> {
	const batch = await readBatch(out, "reference");
	if (!batch) throw new Error(`${join(out, "reference", "batch.json")} does not exist: run --batch reference first`);
	const pairs = batch.pairs.filter((pair) => pair.complete).slice(0, ABLATE_PAIRS);
	if (pairs.length < ABLATE_PAIRS) log(`the reference batch has ${pairs.length} complete pair${pairs.length === 1 ? "" : "s"}; ablating those`);
	const ledger = await readLedger(out);
	const targets = pairs
		.flatMap((pair) => [
			{ label: pair.vanilla, arm: "vanilla" as Arm },
			{ label: pair.piChart, arm: "pi-chart" as Arm },
		])
		.filter(({ label }) => {
			const done = ledger.runs.some((each) => each.label === label);
			if (done) log(`${label}: already ablated, skipped`);
			return !done;
		});
	if (targets.length === 0) return;
	log(`building pi-chart at ${batch.commit.slice(0, 7)}`);
	const tree = await buildTree(batch.commit);
	try {
		for (const { label, arm } of targets) {
			const seed = Math.floor(Math.random() * 2 ** 32);
			const options = { units: ABLATE_UNITS, nulls: 0, controls: false, cap: ABLATE_CAP, seed, commit: batch.commit, tree, dryRun: false };
			const entry = await ablateRun(join(out, "reference", "runs", label), options).then(
				({ record }) => ({ label, arm, spent: record?.spend ?? 0 }),
				(error: unknown) => {
					// A Run whose replay fails gets no record; the others still count, and so does what it spent.
					if (!(error instanceof AblationStop)) throw error;
					log(`${label}: no Ablation: ${error.message}`);
					return { label, arm, spent: error.spent, stopped: error.message };
				},
			);
			ledger.runs.push(entry);
			await writeFile(join(out, "ablation.json"), `${JSON.stringify(ledger, null, "\t")}\n`);
			log(`${label}: Ablation spent ${usd2(entry.spent)}`);
		}
	} finally {
		await rm(tree, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------- report --

/** One batch as the report reads it: its record, every Run's summary, and its figures. */
export interface ReportedBatch extends BatchRecord {
	runs: RunSummary[];
	headline: HeadlineRow[];
	passes: ReturnType<typeof passCounts>;
	firstFails: ReturnType<typeof firstFails>;
	oneArm: OneArmRow[];
}

/** `docs/benchmarks/<date>-plain-omp-comparison.json`. */
export interface ComparisonFile {
	date: string;
	batches: (ReportedBatch | { batch: BatchName; notRun: true })[];
	ablation?: {
		arms: Record<string, Summary>;
		/** What every ablated Run spent, those whose replay failed included. */
		spent: number;
		runs: AblationLedger["runs"];
		utilisation: Record<string, number>;
		utilisationLabel: string;
		ppi: Record<string, string>;
	};
}

/** A batch's Runs summarised from their record folders, and its figures, with no model Call. */
async function reportBatch(out: string, record: BatchRecord): Promise<ReportedBatch> {
	const calibration = await readCalibration();
	const runs: RunSummary[] = [];
	const compared: ComparedPair[] = [];
	let planted = false;
	for (const pair of record.pairs) {
		const sides: RunSummary[] = [];
		for (const label of [pair.vanilla, pair.piChart]) {
			const dir = join(out, record.batch, "runs", label);
			const runRecord = await readRecord(dir);
			planted ||= runRecord.plants.length > 0;
			const journal = join(dir, "journal.jsonl");
			const { thinking } = existsSync(journal) ? await headerOf(journal) : {};
			sides.push(summaryOf({ label, ...(pair.task === undefined ? {} : { task: pair.task }) }, runRecord, await measureRun(dir, calibration), thinking));
		}
		const [vanilla, piChart] = sides as [RunSummary, RunSummary];
		runs.push(vanilla, piChart);
		const task = pair.task ?? ("name" in record.workload ? record.workload.name : record.batch);
		compared.push({ task, vanilla, piChart });
	}
	return {
		...record,
		runs,
		headline: headline(compared, planted),
		passes: passCounts(runs),
		firstFails: firstFails(runs),
		oneArm: oneArmRows(runs),
	};
}

const usd2 = (x: number) => (Number.isFinite(x) ? `$${x.toFixed(2)}` : "—");
const num = (x: number | undefined, digits: number) => (x !== undefined && Number.isFinite(x) ? x.toFixed(digits) : "—");
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A headline row's difference: ×ratio, signed count or percentage points, with its 95% bounds when it has df. */
function diffCell(row: HeadlineRow): string {
	const { diff } = row;
	if (diff.pairs === 0) return "—";
	const show = (x: number) =>
		row.scale === "cost" ? `${Math.exp(x).toFixed(3)}×` : row.scale === "share" ? `${(100 * x).toFixed(1)} pp` : `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
	const bounds = diff.lower === undefined || diff.upper === undefined ? "no interval (df 0)" : `[${show(diff.lower)}, ${show(diff.upper)}]`;
	return `${show(diff.mean)} ${bounds}`;
}

function armCell(row: HeadlineRow, side: Side): string {
	const value = row[side];
	if (value === undefined) return "—";
	if (row.scale === "share") {
		const tally = row.tallies?.[side];
		return `${percentLabel(value)}${tally ? ` (${tally.right}/${tally.of})` : ""}`;
	}
	return row.scale === "cost" ? usd2(value) : num(value, 2);
}

function headlineTable(rows: HeadlineRow[]): string[] {
	const lines = ["| Measure | plain omp | pi-chart | pi-chart vs plain omp [95%] | Pairs | df | Left out |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"];
	for (const row of rows) {
		if (row.note) {
			lines.push(`| ${row.measure} | ${row.note} | ${row.note} | — | — | — | — |`);
			continue;
		}
		lines.push(`| ${row.measure} | ${armCell(row, "vanilla")} | ${armCell(row, "piChart")} | ${diffCell(row)} | ${row.diff.pairs} | ${row.diff.df} | ${row.excluded} |`);
	}
	return lines;
}

/** The distinct values a batch's Runs record, such as model ids or thinking levels, with counts when they differ. */
function valuesWithCounts(values: (string | undefined)[], unrecorded: string): string {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value ?? unrecorded, (counts.get(value ?? unrecorded) ?? 0) + 1);
	if (counts.size === 1) return [...counts.keys()][0] as string;
	return [...counts].map(([value, n]) => `${value} (${plural(n, "Run")})`).join(", ");
}

function workloadLabel(record: BatchRecord): string {
	return "name" in record.workload
		? `${record.workload.name} v${record.workload.version}`
		: `EvoCode-Bench at ${record.workload.revision.slice(0, 7)}: ${record.workload.tasks.join(", ")}`;
}

/** Why a batch is not the real one: another Workload or another n than the comparison's. */
function offDesign(record: BatchRecord): string | undefined {
	if (record.batch === "evocode") return record.want === EVOCODE_PER_TASK ? undefined : `${plural(record.want, "pair")} per task, not ${EVOCODE_PER_TASK}`;
	const name = "name" in record.workload ? record.workload.name : "";
	const off = [name === GATE_WORKLOAD ? "" : `the ${name} Workload, not ${GATE_WORKLOAD}`, record.want === GATE_PAIRS ? "" : `${plural(record.want, "pair")}, not ${GATE_PAIRS}`];
	const reasons = off.filter(Boolean);
	return reasons.length === 0 ? undefined : reasons.join(" and ");
}

function pairCounts(record: BatchRecord): { complete: number; void: number } {
	const complete = record.pairs.filter((pair) => pair.complete).length;
	return { complete, void: record.pairs.length - complete };
}

function batchSection(batch: ReportedBatch): string[] {
	const { complete, void: voids } = pairCounts(batch);
	const lines = [`## ${BATCHES[batch.batch].title}`, ""];
	const off = offDesign(batch);
	if (off) lines.push(`**Not the comparison's batch: it ran ${off}.**`, "");
	lines.push(
		`${workloadLabel(batch)} on \`${batch.model}\`; ${plural(complete, "complete pair")}, ${voids} void; spent ${usd2(batch.spent)} of a ${usd2(batch.cap)} cap.` +
			(batch.capped ? ` **The cap stopped the batch** after ${plural(batch.pairs.length, "pair")}.` : "") +
			(batch.stopped ? ` **Stopped:** ${batch.stopped}.` : "") +
			(batch.resumed?.length ? ` Resumed, with the stopping pair run again, after: ${batch.resumed.join("; ")}.` : ""),
		"",
		...headlineTable(batch.headline),
		"",
		"Passes per graded step, complete Runs:",
		"",
		"| Step | plain omp | pi-chart |",
		"| --- | ---: | ---: |",
		...batch.passes.map((row) => `| ${row.step} | ${row.vanilla.pass}/${row.vanilla.of} | ${row.piChart.pass}/${row.piChart.of} |`),
		"",
		"First failing step, complete Runs:",
		"",
		"| Step | plain omp | pi-chart |",
		"| --- | ---: | ---: |",
		...batch.firstFails.map((row) => `| ${row.step} | ${row.vanilla} | ${row.piChart} |`),
		"",
		"One-Arm Measures, mean per complete Run:",
		"",
		"| Measure | plain omp | pi-chart |",
		"| --- | ---: | ---: |",
		...batch.oneArm.map((row) => `| ${row.measure} | ${typeof row.vanilla === "number" ? num(row.vanilla, 1) : row.vanilla} | ${typeof row.piChart === "number" ? num(row.piChart, 1) : row.piChart} |`),
		"",
	);
	return lines;
}

function ablationSection(ablation: ComparisonFile["ablation"]): string[] {
	const lines = ["## Ablation and Utilisation, reference batch", ""];
	if (!ablation) return [...lines, "Not run.", ""];
	lines.push(
		`${plural(ablation.runs.length, "Run")} of the reference batch's lowest-indexed complete pairs (${ablation.runs.map((each) => each.label).join(", ")}), ${ABLATE_UNITS} units and at most ${usd2(ABLATE_CAP)} each; ${usd2(ablation.spent)} spent in all.`,
		...ablation.runs.filter((each) => each.stopped).map((each) => `- ${each.label} has no Ablation: ${each.stopped}`),
		"",
		"| Arm | Needed share [95%] | Unclear | Unstable Calls | Spend | Utilisation | PPI Needed share |",
		"| --- | ---: | ---: | ---: | ---: | ---: | --- |",
	);
	for (const arm of ["vanilla", "pi-chart"]) {
		const summary = ablation.arms[arm];
		const needed = summary ? shareLabel(summary.needed) : "not measured";
		const unclear = summary ? percentLabel(summary.unclear) : "—";
		const unstable = summary ? `${summary.unstable.k}/${summary.unstable.n}` : "—";
		const spend = summary ? usd2(summary.spend) : "—";
		lines.push(`| ${arm === "vanilla" ? "plain omp" : arm} | ${needed} | ${unclear} | ${unstable} | ${spend} | ${percentLabel(ablation.utilisation[arm] ?? Number.NaN)} | ${ablation.ppi[arm] ?? "no Runs"} |`);
	}
	lines.push(
		"",
		`Utilisation is ${ablation.utilisationLabel}: Used tokens over judged tokens, pooled over each Arm's complete Runs. ${UTILISATION_CAVEATS.join(" ")}`,
		"",
	);
	return lines;
}

/** The six caveats; the sixth per batch run. */
function caveats(batches: ReportedBatch[]): string[] {
	const lines = [
		"## Caveats",
		"",
		"1. The Gate Workload was written knowing how pi-chart works; the EvoCode subset is the outside check.",
		"2. The Workloads were chosen to make pi-chart evict, so they show long sessions rather than typical short ones.",
		"3. The Arms recover Lapses by different routes: zero Pulls on plain omp is not zero Lapses.",
		"4. Plain omp runs at its default compaction settings, untuned.",
		"5. Each Run is isolated, which removes any benefit pi-chart draws from earlier Conversations.",
		"6. How each batch ran:",
	];
	for (const batch of batches) {
		const { complete, void: voids } = pairCounts(batch);
		const given = batch.runs.some((each) => each.thinkingGiven);
		const thinking = valuesWithCounts(batch.runs.map((each) => each.thinking), "unrecorded");
		const method =
			"tasks" in batch.workload
				? `two-sided 95% paired t pooled within the ${batch.workload.tasks.length} tasks (${batch.workload.tasks.join(", ")}), which describes these tasks, not EvoCode-Bench as a whole`
				: "two-sided 95% paired t over the batch's own pairs";
		lines.push(
			`   - ${BATCHES[batch.batch].title}: model ${valuesWithCounts(batch.runs.map((each) => each.model), "unrecorded")}; ` +
				`thinking ${thinking}${given ? "" : " (the harness default, from the Journals)"}; ${batch.omp}; ` +
				`${plural(complete, "complete pair")}, ${voids} void; interval: ${method}. No multiplicity correction applies.`,
		);
	}
	return [...lines, ""];
}

export function comparisonMarkdown(file: ComparisonFile, reproduce: string): string {
	const reported = file.batches.filter((each): each is ReportedBatch => !("notRun" in each));
	const reference = reported.find((each) => each.batch === "reference");
	const lead = (batch: ReportedBatch | undefined) => {
		const cost = batch?.headline.find((row) => row.measure === "Cost per Run");
		const lapses = batch?.headline.find((row) => row.measure === "Lapses per Run");
		if (!batch || !cost || cost.diff.pairs === 0 || !lapses) return undefined;
		return `${BATCHES[batch.batch].title}: pi-chart costs **${diffCell(cost)}** what plain omp costs per Run, with **${diffCell(lapses)}** Lapses per Run.`;
	};
	const lines = [`# pi-chart vs plain omp — ${file.date}`, ""];
	const headlineSentence = lead(reference) ?? lead(reported[0]);
	if (headlineSentence) lines.push(headlineSentence, "");
	const commits = [...new Set(reported.map((each) => each.commit.slice(0, 7)))];
	lines.push(
		`- Commit: ${commits.map((sha) => `\`${sha}\``).join(", ") || "—"}`,
		`- Harness: ${[...new Set(reported.map((each) => each.omp))].join(", ") || "—"}`,
		...BATCH_NAMES.map((name) => {
			const batch = reported.find((each) => each.batch === name);
			if (!batch) return `- ${BATCHES[name].title}: not run`;
			const { complete, void: voids } = pairCounts(batch);
			return `- ${BATCHES[name].title}: \`${batch.model}\`, ${workloadLabel(batch)}, ${complete} complete and ${voids} void pairs, ${usd2(batch.spent)} of ${usd2(batch.cap)}`;
		}),
		`- Instrument: \`scripts/compare.ts\`; figures in [\`${file.date}-plain-omp-comparison.json\`](${file.date}-plain-omp-comparison.json)`,
		`- Reproduce: ${reproduce}`,
		"",
		"Each pair is one plain-omp Run and one pi-chart Run, started together. An Arm's Cost figures are geometric means over the batch's complete pairs. A ratio is pi-chart over plain omp, exp of the mean log difference; counts and shares are pi-chart minus plain omp. On EvoCode, a difference is the mean of its task means, so each task weighs the same, and it can differ from what the Arm columns, pooled over pairs, suggest. Void pairs count toward spend and in no figure. This is descriptive: no margin, verdict or sequential look applies.",
		"",
	);
	for (const name of BATCH_NAMES) {
		const batch = reported.find((each) => each.batch === name);
		lines.push(...(batch ? batchSection(batch) : [`## ${BATCHES[name].title}`, "", "Not run.", ""]));
	}
	lines.push(...ablationSection(file.ablation), ...caveats(reported));
	return `${lines.join("\n").trimEnd()}\n`;
}

async function ablationOf(out: string, reference: ReportedBatch | undefined): Promise<ComparisonFile["ablation"]> {
	const ledger = await readLedger(out);
	if (!reference || ledger.runs.length === 0) return undefined;
	const dir = (label: string) => join(out, "reference", "runs", label);
	const records: AblationRecord[] = [];
	for (const { label } of ledger.runs) {
		const record = await readAblation(dir(label));
		if (record) records.push(record);
	}
	const complete = reference.runs.filter((each) => each.complete);
	const utilisation: Record<string, number> = {};
	for (const arm of ["vanilla", "pi-chart"]) {
		const tallies = complete.filter((each) => each.arm === arm).flatMap((each) => (each.utilisation ? [each.utilisation] : []));
		utilisation[arm] = share({ used: tallies.reduce((sum, t) => sum + t.used, 0), judged: tallies.reduce((sum, t) => sum + t.judged, 0) });
	}
	const ppi = await ppiByArm(complete.map((each) => dir(each.label)));
	const arms = Object.fromEntries(summarise(records));
	// A failed replay's spend is in the ledger, not in any record.
	return {
		arms,
		spent: ledger.runs.reduce((sum, each) => sum + each.spent, 0),
		runs: ledger.runs,
		utilisation,
		utilisationLabel: utilisationLabel(complete.map((each) => each.utilisation)),
		ppi: Object.fromEntries([...ppi].map(([arm, line]) => [arm, line.replace(/^PPI:? /, "")])),
	};
}

/** Builds the report and its JSON from `out` and writes them under `docs/benchmarks/`; returns the Markdown's path. */
async function writeReport(out: string, date: string, into: string): Promise<string> {
	const batches: ComparisonFile["batches"] = [];
	for (const name of BATCH_NAMES) {
		const record = await readBatch(out, name);
		batches.push(record ? await reportBatch(out, record) : { batch: name, notRun: true });
	}
	const reference = batches.find((each): each is ReportedBatch => each.batch === "reference" && !("notRun" in each));
	const ablation = await ablationOf(out, reference);
	const file: ComparisonFile = { date, batches, ...(ablation ? { ablation } : {}) };
	const stem = join(into, `${date}-plain-omp-comparison`);
	await mkdir(into, { recursive: true });
	await writeFile(`${stem}.json`, `${JSON.stringify(file, null, "\t")}\n`);
	const reproduce =
		"`bun scripts/compare.ts --out <dir> --batch reference`, then `--ablate`, `--batch second` and `--batch evocode` into the same `<dir>`, a stopped EvoCode batch taking `--batch evocode --resume` on the omp it ran on, then `--report`; the Run folders are not committed.";
	await writeFile(`${stem}.md`, comparisonMarkdown(file, reproduce));
	return `${stem}.md`;
}

// ------------------------------------------------------------------ main --

const USAGE =
	"usage: bun scripts/compare.ts --out <dir> --batch reference|second|evocode [--parallel n] [--turn-timeout s] [--workload <name> --pairs n]\n" +
	"       bun scripts/compare.ts --out <dir> --batch evocode --resume [--parallel n]\n" +
	"       bun scripts/compare.ts --out <dir> --ablate\n" +
	"       bun scripts/compare.ts --out <dir> --report [--date YYYY-MM-DD]";

async function main(argv: string[]): Promise<void> {
	const { flag, positive } = flagsOf(argv);
	const outFlag = flag("--out");
	const name = flag("--batch") as BatchName | undefined;
	const steps = [name !== undefined, argv.includes("--ablate"), argv.includes("--report")].filter(Boolean).length;
	if (!outFlag || steps !== 1) throw new Error(USAGE);
	const out = resolve(outFlag);

	if (argv.includes("--report")) {
		const date = flag("--date") ?? new Date().toISOString().slice(0, 10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date must be YYYY-MM-DD, got ${date}`);
		console.log(await writeReport(out, date, join(REPO, "docs", "benchmarks")));
		return;
	}
	if (argv.includes("--ablate")) {
		await ablate(out);
		return;
	}

	if (!BATCH_NAMES.includes(name as BatchName)) throw new Error(`--batch must be one of ${BATCH_NAMES.join(", ")}`);
	const batch = name as BatchName;
	if (!srcIsCommitted()) throw new Error("refusing: uncommitted changes under src/; a pi-chart Run could not name the commit it loaded");
	const dir = join(out, batch);
	const resume = argv.includes("--resume");
	let prior: BatchRecord | undefined;
	if (resume) {
		if (batch !== "evocode") throw new Error("--resume is for the EvoCode batch only: a Gate Workload batch replaces void pairs, and cannot pick up where it stopped");
		prior = await readBatch(out, batch);
		if (!prior) throw new Error(`refusing: ${dir} holds no batch.json, so there is no batch to resume`);
		if (prior.stopped === undefined) {
			throw new Error(`refusing: the batch at ${dir} was not stopped by a Run${prior.capped ? "; its cap stopped it" : ""}, so there is nothing to resume`);
		}
	} else if (existsSync(dir)) {
		throw new Error(`refusing: ${dir} exists, so this batch has already run into ${out}; a batch started again goes into a new --out, a stopped EvoCode batch takes --resume`);
	}
	const smoke = flag("--workload") !== undefined || flag("--pairs") !== undefined;
	if (batch === "evocode" && smoke) throw new Error("--workload and --pairs are for the Gate Workload batches only");

	let record: BatchRecord;
	await mkdir(dir, { recursive: true });
	try {
		record =
			batch === "evocode"
				? await evoBatch(dir, positive("--parallel", 1), prior)
				: await gateBatch(batch, dir, {
						workload: flag("--workload") ?? GATE_WORKLOAD,
						want: positive("--pairs", GATE_PAIRS),
						parallel: positive("--parallel", 2),
						timeoutMs: positive("--turn-timeout", 600) * 1000,
					});
	} catch (error) {
		// Stopped before any Run: nothing spent, so the folder goes and the batch can start again here.
		if (!existsSync(join(dir, "runs"))) await rm(dir, { recursive: true, force: true });
		throw error;
	}
	await writeFile(join(dir, "batch.json"), `${JSON.stringify(record, null, "\t")}\n`);
	const { complete, void: voids } = pairCounts(record);
	console.log(
		`${batch}: ${plural(complete, "complete pair")}, ${voids} void, ${usd2(record.spent)} of ${usd2(record.cap)}` +
			(record.capped ? "; the cap stopped it" : "") +
			(record.stopped ? `; stopped: ${record.stopped}` : "") +
			`\nrecord: ${dir}`,
	);
	if (record.stopped) process.exitCode = 1;
}

if (import.meta.main) {
	await main(process.argv.slice(2)).catch((error: unknown) => {
		console.error(`compare: ${error instanceof Error ? error.message : error}`);
		process.exitCode = 1;
	});
}
