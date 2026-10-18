/**
 * A Budget sweep: a grid of pi-chart Budget settings screened on the Gate
 * Workload, the cell the Gate's objective prefers picked, and that cell
 * confirmed against the default on the held-out Workload.
 *
 *     bun scripts/bench-tokens.ts --sweep <grid.json> [--workload gate] [--holdout <name|path>] [--runs 3]
 *       [--parallel 3] [--pool bench/gate/pool.json] [--out <dir>] [--turn-timeout 600]
 *     bun scripts/bench-tokens.ts --report <out>    # re-print from <out>/sweep.json
 *
 * A grid (`{ "slug": "tail-mark", "budgets": { "PICHART_TAIL_TOKENS": [25000, 40000] } }`)
 * sweeps one or two tunable Budgets over at most 9 cells, each Budget's
 * values including its default. Before any spend the sweep stops on a bad
 * grid, a tunable Budget set in its own environment, uncommitted `src/`, a
 * held-out screen Workload, or a pool without an A/A batch for either key.
 *
 * The screen runs every cell `--runs` times on this checkout's `HEAD`, round
 * by round, `--parallel` Runs at once, until its $120 cap; each Run gets its
 * cell's Budgets and no other. `screen` picks the winner. A winner other
 * than the default is confirmed on `--holdout` (default `<workload>-holdout`)
 * by the Gate's looks at a margin of 1, `--parallel` / 2 pairs at once, and
 * its complete pairs join the pool as a confirm batch.
 *
 * Each Run's record is in `<out>/runs/<cell>-r<round>/` or
 * `confirm-<side>-<i>/`; `<out>/sweep.json` is written after the screen and
 * again after confirm. At the end, the report and `sweep.json` are copied to
 * `docs/benchmarks/<date>-<slug>.md` and `.json`, never over a file there.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { type Config, loadConfig, readSavedUrl } from "../src/config.ts";
import { readCalibration } from "./calibration.ts";
import {
	appendToPool,
	type Batch,
	completePairs,
	costDiff,
	type Decision,
	decide,
	describeKey,
	fixed,
	type Gathered,
	gatherPairs,
	type GateKey,
	gateLapses,
	keyOf,
	LOOKS,
	lapseDiff,
	lookTable,
	type MeasureTest,
	measureTest,
	offModel,
	type PairFigures,
	type PairRun,
	POOL,
	pairRunner,
	pooledBatches,
	pValue,
	REFERENCE_MODEL,
	readPool,
	referenceOptions,
} from "./gate.ts";
import { aggregate, int, measureRun, median, percent, type RunMeasures, usd } from "./measures.ts";
import {
	BUDGET_VARIABLES,
	type BudgetVariable,
	buildContext,
	flagsOf,
	loadNamedWorkload,
	log,
	type Options,
	resolveCommit,
	runOne,
	srcIsCommitted,
} from "./runs.ts";
import { mean, sampleVariance } from "./stats.ts";
import { CAVEATS, share, utilisationLabel } from "./utilisation.ts";
import { isHeldOut, REPO, run, turnsOf } from "./workload.ts";

// ------------------------------------------------------------------ grid --

/** `<grid.json>`: a slug, and each swept Budget's values. */
export interface Grid {
	slug: string;
	budgets: Record<string, number[]>;
}

/** One combination of the swept values. */
export interface Cell {
	/** `c0`…`c8`, in the order of the grid's combinations. */
	id: string;
	/** The swept Budgets' values, as a Run's env gets them. */
	budgets: Record<string, string>;
	/** Each swept Budget's value's rank in that Budget's ascending values, in the grid's Budget order. */
	ranks: number[];
	/** Whether every value is its Budget's default. */
	isDefault: boolean;
}

/** The most Budgets and cells a grid may have. */
export const MAX_BUDGETS = 2;
export const MAX_CELLS = 9;

/** Where `loadConfig` puts each tunable Budget. */
const FIELDS: Record<BudgetVariable, keyof Config> = {
	PICHART_TAIL_TOKENS: "tailTokens",
	PICHART_TAIL_TURNS: "tailTurns",
	PICHART_TAIL_LOW_WATER: "tailLowWater",
	PICHART_OPENING_TOKENS: "openingTokens",
	PICHART_PINS_TOKENS: "pinTokens",
	PICHART_RECALL_TOKENS: "recallTokens",
	PICHART_DOC_TOKENS: "docTokens",
	PICHART_GRAPH_TOKENS: "graphTokens",
	PICHART_PACK_TOKENS: "packTokens",
};

function isBudget(name: string): name is BudgetVariable {
	return (BUDGET_VARIABLES as readonly string[]).includes(name);
}

/** What pi-chart reads `variable` as when it is set to `raw`. */
function readAs(variable: BudgetVariable, raw: string | undefined): unknown {
	return loadConfig(raw === undefined ? {} : { [variable]: raw })[FIELDS[variable]];
}

/** Each tunable Budget's default, as the checkout's `src/config.ts` reads an unset one. */
export function budgetDefaults(): Record<BudgetVariable, number> {
	return Object.fromEntries(BUDGET_VARIABLES.map((name) => [name, readAs(name, undefined) as number])) as Record<
		BudgetVariable,
		number
	>;
}

/**
 * The cells of `grid`: every combination of its values, the first Budget's
 * changing slowest. Throws one error naming every problem when the grid
 * sweeps no Budget or more than two, names a variable that is not a tunable
 * Budget, gives more than 9 cells, repeats a value, leaves out a default, or
 * gives a value pi-chart would not read as given (`count` and `share` fall
 * back to the default silently, so such a cell would be the default's twin).
 */
export function cellsOf(grid: unknown, defaults: Record<BudgetVariable, number>): Cell[] {
	const problems: string[] = [];
	const { slug, budgets } = (grid ?? {}) as Partial<Grid>;
	if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
		problems.push("the grid needs a slug of lowercase letters, digits and hyphens");
	}
	const swept = typeof budgets === "object" && budgets !== null ? Object.entries(budgets) : [];
	if (swept.length === 0) problems.push("the grid sweeps no Budget; it sweeps one or two");
	if (swept.length > MAX_BUDGETS) problems.push(`the grid sweeps ${swept.length} Budgets; a grid sweeps at most two Budgets`);
	let count = 1;
	for (const [name, values] of swept) {
		if (!Array.isArray(values) || values.length === 0 || !values.every((value) => typeof value === "number" && Number.isFinite(value))) {
			problems.push(`${name} needs a list of numbers`);
			count = Number.NaN;
			continue;
		}
		count *= values.length;
		for (const value of new Set(values.filter((value, at) => values.indexOf(value) !== at))) problems.push(`${name} repeats ${value}`);
		if (!isBudget(name)) {
			problems.push(`${name} is not a tunable Budget (one of ${BUDGET_VARIABLES.join(", ")})`);
			continue;
		}
		if (!values.includes(defaults[name])) problems.push(`${name} leaves out ${defaults[name]}, the default`);
		for (const value of values) {
			const read = readAs(name, String(value));
			if (read !== value) problems.push(`pi-chart would not read ${name}=${value} as given: it reads ${String(read)}`);
		}
	}
	if (count > MAX_CELLS) problems.push(`the grid gives ${count} cells; a grid gives at most ${MAX_CELLS}`);
	if (problems.length > 0) throw new Error(`grid refused:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);

	const axes = (swept as [BudgetVariable, number[]][]).map(([name, values]) => ({
		name,
		values,
		ascending: [...values].sort((a, b) => a - b),
	}));
	let combinations: number[][] = [[]];
	for (const axis of axes) combinations = combinations.flatMap((prefix) => axis.values.map((value) => [...prefix, value]));
	return combinations.map((values, at) => ({
		id: `c${at}`,
		budgets: Object.fromEntries(axes.map((axis, i) => [axis.name, String(values[i])])),
		ranks: axes.map((axis, i) => axis.ascending.indexOf(values[i] as number)),
		isDefault: axes.every((axis, i) => values[i] === defaults[axis.name]),
	}));
}

/** The tunable Budget variables `env` sets: a sweep refuses to start with any. */
export function shellBudgets(env: Record<string, string | undefined>): BudgetVariable[] {
	return BUDGET_VARIABLES.filter((name) => env[name] !== undefined);
}

// ---------------------------------------------------------------- screen --

/**
 * The screen's Runs in start order, round-major: each round holds every
 * cell once, and round `r` is the cells rotated right by `r`, so the cell
 * first in one round is second in the next and start order falls on every
 * cell alike.
 */
export function roundRobin<T>(cells: T[], runs: number): { cell: T; round: number }[] {
	const n = cells.length;
	return Array.from({ length: runs }, (_, round) =>
		cells.map((_, at) => ({ cell: cells[(((at - round) % n) + n) % n] as T, round })),
	).flat();
}

/**
 * Runs `jobs` in order, up to `width` at once, starting one only while the
 * finished jobs' `cost`, summed, is below `cap`, and says whether the cap
 * left some unstarted. After a job throws, none starts, the ones in flight
 * finish, and the error is thrown.
 */
export async function runCapped(input: { jobs: (() => Promise<{ cost: number }>)[]; width: number; cap: number }): Promise<boolean> {
	const { jobs, width, cap } = input;
	let spent = 0;
	let next = 0;
	let inFlight = 0;
	let stopped: { error: unknown } | undefined;
	await new Promise<void>((resolve) => {
		const fill = () => {
			while (!stopped && inFlight < width && next < jobs.length && spent < cap) {
				const at = next++;
				inFlight++;
				(jobs[at] as () => Promise<{ cost: number }>)()
					.then(
						(result) => {
							spent += result.cost;
						},
						(error: unknown) => {
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
	if (stopped) throw stopped.error;
	return next < jobs.length;
}

/** One screen Run's figures, as `sweep.json` keeps them. */
export interface ScreenRun {
	cell: string;
	round: number;
	/** Its record folder under `<out>/runs/`. */
	label: string;
	/** Cost per Run, USD. */
	cost: number;
	/** Lapses per Run, as `gateLapses` counts them. */
	lapses: number;
	complete: boolean;
	/** Each graded step it reached: true for a Pass. */
	steps: Record<string, boolean>;
}

/** The level of the screen's Lapse test, and of each side of its tie interval. */
export const LAPSE_ALPHA = 0.05;
export const TIE_ALPHA = 0.025;
/** A cell collapses on a step when it passes on this many fewer complete Runs than the default. */
export const COLLAPSE = 2;

/** A measure test's figures, without the Gate's verdict on them. */
type TestFigures = Omit<MeasureTest, "rejected">;

/** How one cell fared in the screen. */
export interface CellScreen {
	cell: string;
	runs: number;
	complete: number;
	/** Geometric-mean Cost per Run over its complete Runs; NaN with none. */
	cost: number;
	/** Complete Runs that passed, per graded step. */
	passes: Record<string, number>;
	/** Against the default, candidate this cell: complete pairs, and the Lapse test with 2 or more. Absent on the default. */
	versusDefault?: { pairs: number; lapses?: TestFigures };
	eligible: boolean;
	/** Why it is ineligible; empty when eligible. */
	reasons: string[];
	/** Against the best, candidate this cell: the 95% interval of the cost ratio with 2 or more pairs. Eligible cells only. */
	versusBest?: { pairs: number; cost?: TestFigures & { ratio: number; ratioLower: number; ratioUpper: number }; tied: boolean };
}

export interface ScreenResult {
	cells: CellScreen[];
	best: string;
	/** The eligible cells tied with the best, the best included, in cell order. */
	tied: string[];
	winner: string;
}

/** The Runs of the cell `id`. */
function runsOf(runs: ScreenRun[], id: string): ScreenRun[] {
	return runs.filter((run) => run.cell === id);
}

function cellById(cells: Cell[], id: string): Cell {
	return cells.find((cell) => cell.id === id) as Cell;
}

/** `a` against `b` over the rounds in which both completed: `b` is base and `a` candidate. */
function pairsOf(a: ScreenRun[], b: ScreenRun[]): PairFigures[] {
	return a.flatMap((run) => {
		const other = b.find((candidate) => candidate.round === run.round);
		if (!run.complete || !other?.complete) return [];
		return [{ base: { cost: other.cost, lapses: other.lapses }, candidate: { cost: run.cost, lapses: run.lapses } }];
	});
}

/**
 * Eligibility, the best cell, its ties and the winner (design decision 6).
 * The default is always eligible. Another cell needs 2 or more complete pairs
 * with the default, a Lapse test against it that α 0.05 does not reject, and
 * no graded step on which it passes on 2 or more fewer complete Runs. The
 * best is the eligible cell of lowest geometric-mean cost; an eligible cell
 * is tied with it when the 95% interval of its cost log ratio contains 0, or
 * when they share fewer than 2 complete pairs. The default wins when tied;
 * otherwise the tied cell of lowest rank sum, then lowest first-Budget rank.
 * Variance is pooled over `history`'s batches under `key`.
 */
export function screen(input: { cells: Cell[]; runs: ScreenRun[]; history: Batch[]; key: GateKey }): ScreenResult {
	const { cells, runs, history, key } = input;
	const stored = pooledBatches(history, key);
	const storedCost = stored.map((batch) => batch.pairs.map(costDiff));
	const storedLapses = stored.map((batch) => batch.pairs.map(lapseDiff));
	const defaultCell = cells.find((cell) => cell.isDefault) as Cell;
	const steps = [...new Set(runs.flatMap((run) => Object.keys(run.steps)))].sort();
	const passesOf = (own: ScreenRun[]) =>
		Object.fromEntries(steps.map((step) => [step, own.filter((run) => run.complete && run.steps[step] === true).length]));
	const defaultRuns = runsOf(runs, defaultCell.id);
	const defaultPasses = passesOf(defaultRuns);
	const defaultComplete = defaultRuns.filter((run) => run.complete).length;

	const screened: CellScreen[] = cells.map((cell) => {
		const own = runsOf(runs, cell.id);
		const complete = own.filter((run) => run.complete);
		const passes = passesOf(own);
		const result: CellScreen = {
			cell: cell.id,
			runs: own.length,
			complete: complete.length,
			cost: complete.length > 0 ? Math.exp(mean(complete.map((run) => Math.log(run.cost)))) : Number.NaN,
			passes,
			eligible: true,
			reasons: [],
		};
		if (cell === defaultCell) return result;
		const pairs = pairsOf(own, defaultRuns);
		result.versusDefault = { pairs: pairs.length };
		if (pairs.length < 2) {
			result.reasons.push(`too few pairs (${pairs.length} complete)`);
		} else {
			const lapses = measureTest(pairs.map(lapseDiff), storedLapses, LAPSE_ALPHA);
			result.versusDefault.lapses = lapses;
			if (lapses.p <= LAPSE_ALPHA) result.reasons.push(`forgets more (p = ${lapses.p.toFixed(3)})`);
		}
		for (const step of steps) {
			const ownPasses = passes[step] as number;
			const basePasses = defaultPasses[step] as number;
			if (basePasses - ownPasses >= COLLAPSE) {
				result.reasons.push(`${step} collapsed (${ownPasses} of ${complete.length} against ${basePasses} of ${defaultComplete})`);
			}
		}
		result.eligible = result.reasons.length === 0;
		return result;
	});

	// Only the default can be eligible with no complete Run, and then it is the only eligible cell.
	const eligible = screened.filter((cell) => cell.eligible);
	const best = eligible.reduce((top, cell) => (cell.cost < top.cost ? cell : top));
	for (const cell of eligible) {
		if (cell === best) {
			cell.versusBest = { pairs: cell.complete, tied: true };
			continue;
		}
		const pairs = pairsOf(runsOf(runs, cell.cell), runsOf(runs, best.cell));
		if (pairs.length < 2) {
			cell.versusBest = { pairs: pairs.length, tied: true };
			continue;
		}
		const cost = measureTest(pairs.map(costDiff), storedCost, TIE_ALPHA);
		cell.versusBest = {
			pairs: pairs.length,
			cost: { ...cost, ratio: Math.exp(cost.mean), ratioLower: Math.exp(cost.lower), ratioUpper: Math.exp(cost.upper) },
			tied: cost.lower <= 0 && 0 <= cost.upper,
		};
	}
	const tied = eligible.filter((cell) => cell.versusBest?.tied).map((cell) => cellById(cells, cell.cell));
	const rankSum = (cell: Cell) => cell.ranks.reduce((sum, rank) => sum + rank, 0);
	const winner = tied.includes(defaultCell)
		? defaultCell
		: [...tied].sort((a, b) => rankSum(a) - rankSum(b) || (a.ranks[0] as number) - (b.ranks[0] as number))[0];
	return { cells: screened, best: best.cell, tied: tied.map((cell) => cell.id), winner: (winner as Cell).id };
}

// --------------------------------------------------------------- confirm --

/** Confirm's cost test: the winner must be shown cheaper than the default, not merely no costlier. */
export const CONFIRM_MARGIN = 1;

export type Outcome = "adopt" | "keep the default";

export interface ConfirmResult {
	/** Every finished pair, void ones included, by index: base the default cell, candidate the winner. */
	pairs: PairRun[];
	/** Each look's figures, as the Gate's at a margin of 1. */
	looks: Decision[];
	spent: number;
	/** The cap of the last look gathered; 0 when no pair ran. */
	cap: number;
	capped: boolean;
	outcome: Outcome;
	/** Why the default is kept; absent on adopt. */
	reason?: string;
	/** The first error a pair threw, which stops the sweep with no outcome to act on. */
	stopped?: unknown;
}

/** Why a look's verdict keeps the default, or nothing when it adopts. */
function reasonOf(decision: Decision): string | undefined {
	if (decision.verdict === "pass") return undefined;
	if (decision.verdict !== "fail") return "not shown cheaper";
	return [decision.cost.rejected ? "costlier" : "", decision.lapses.rejected ? "forgets more" : ""].filter(Boolean).join(" and ");
}

/**
 * The winner confirmed against the default on the held-out Workload, by the
 * Gate's looks, levels and Holm's correction at a margin of 1 and with
 * `CONFIRM_CAPS` (design decision 7). `runPair` runs one pair, base the
 * default, candidate the winner. A pass adopts; a fail, an inconclusive
 * second look or a cap keeps the default. A default winner starts no pair.
 */
export async function confirm(input: {
	winner: Cell;
	defaultCell: Cell;
	history: Batch[];
	key: GateKey;
	width: number;
	runPair: (index: number) => Promise<PairRun>;
}): Promise<ConfirmResult> {
	const { winner, defaultCell, history, key, width, runPair } = input;
	const result: ConfirmResult = { pairs: [], looks: [], spent: 0, cap: 0, capped: false, outcome: "keep the default" };
	if (winner.id === defaultCell.id) return { ...result, reason: "the screen's winner is the default" };
	let gathered: Gathered | undefined;
	for (const [look, { pairs }] of LOOKS.entries()) {
		const cap = CONFIRM_CAPS[look];
		if (cap === undefined) throw new Error(`no confirm cap for look ${look + 1}`);
		result.cap = cap;
		gathered = await gatherPairs({ want: pairs, cap, width, runPair, ...gathered });
		Object.assign(result, { pairs: gathered.pairs, spent: gathered.spent, capped: gathered.capped });
		if (gathered.stopped !== undefined) return { ...result, stopped: gathered.stopped };
		const current = completePairs(gathered.pairs);
		if (gathered.capped) {
			if (current.length > 0) {
				result.looks.push({ ...decide({ look, pairs: current, history, key, margin: CONFIRM_MARGIN }), verdict: "inconclusive" });
			}
			return { ...result, reason: "not shown cheaper" };
		}
		const decision = decide({ look, pairs: current, history, key, margin: CONFIRM_MARGIN });
		result.looks.push(decision);
		if (decision.verdict !== "continue") {
			const reason = reasonOf(decision);
			return reason === undefined ? { ...result, outcome: "adopt" } : { ...result, reason };
		}
	}
	throw new Error("unreachable: the last look is never continue");
}

// ---------------------------------------------------------------- record --

/** The screen's spend cap, USD. */
export const SCREEN_CAP = 120;
/**
 * Confirm's spend cap at each of the Gate's looks, USD: the Gate's own caps
 * ($45, $90) are sized for `gate` Runs, and a `gate-holdout` v1 Run costs
 * about $6.80 (design decision 11), so 10 and 20 Runs need these.
 */
export const CONFIRM_CAPS = [70, 140] as const;

/** `<out>/sweep.json`: everything the report needs besides the Runs' own records. */
export interface SweepRecord {
	/** The day the sweep started, `YYYY-MM-DD`: the report's name. */
	date: string;
	grid: Grid;
	/** The commit every Run loaded: this checkout's `HEAD`, with `src/` clean. */
	commit: string;
	keys: { screen: GateKey; heldOut: GateKey };
	options: { screen: Options; heldOut: Options; runs: number; parallel: number; pool: string; command: string };
	cells: Cell[];
	/** Every screen Run that finished, by round then cell. */
	runs: ScreenRun[];
	screen?: { spent: number; cap: number; capped: boolean; result: ScreenResult };
	confirm?: Omit<ConfirmResult, "stopped">;
	/** Why the sweep stopped with no outcome. */
	stopped?: string;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** A Run's graded steps: true for a Pass. */
function stepsOf(measures: RunMeasures): Record<string, boolean> {
	return Object.fromEntries(
		measures.steps.filter((step) => step.outcome !== "not graded").map((step) => [step.id, step.outcome === "Pass"]),
	);
}

function cellLabel(cell: Cell): string {
	return `${cell.id} (${Object.entries(cell.budgets)
		.map(([name, value]) => `${name}=${value}`)
		.join(", ")})`;
}

// ------------------------------------------------------------------- run --

/** `bench-tokens --sweep`: checks, screen, confirm, pool, record and report. */
export async function runSweep(argv: string[]): Promise<void> {
	const { flag, positive } = flagsOf(argv);
	const gridFile = flag("--sweep");
	if (!gridFile) throw new Error("--sweep needs a grid file");
	const grid = JSON.parse(await readFile(gridFile, "utf8")) as Grid;
	const cells = cellsOf(grid, budgetDefaults());
	const shell = shellBudgets(process.env);
	if (shell.length > 0) {
		throw new Error(`${shell.join(", ")} set in the environment: a sweep gives every Run its cell's Budgets, so unset it first`);
	}
	if (!srcIsCommitted()) {
		throw new Error("src/ has uncommitted changes: every sweep Run loads the committed src/ and records its commit");
	}
	const commit = await resolveCommit("HEAD");
	const named = flag("--workload") ?? "gate";
	const refuse = (name: string) => new Error(`${name} is a held-out Workload, and a held-out Workload is never screened`);
	// By the name given too, so the refusal does not wait on a folder that loads.
	if (isHeldOut(named)) throw refuse(named);
	const workload = await loadNamedWorkload(named);
	if (isHeldOut(workload.name)) throw refuse(workload.name);
	const heldOut = await loadNamedWorkload(flag("--holdout") ?? `${workload.name}-holdout`);
	if (heldOut.name === workload.name) throw new Error(`the held-out Workload is the screen's own, ${workload.name}`);
	const omp = (await run(["omp", "--version"])).trim();
	const options = { screen: referenceOptions(workload, omp), heldOut: referenceOptions(heldOut, omp) };
	const keys = { screen: keyOf(options.screen.workload, omp), heldOut: keyOf(options.heldOut.workload, omp) };
	const poolFile = resolve(flag("--pool") ?? POOL);
	const history = (await readPool(poolFile)).batches;
	pooledBatches(history, keys.screen);
	pooledBatches(history, keys.heldOut);
	const server = process.env.PICHART_DATABASE_URL ?? readSavedUrl();
	if (!server) throw new Error("sweep Runs need a Thread Store server: set PICHART_DATABASE_URL, or run setup to save one");

	const runs = positive("--runs", 3);
	const parallel = positive("--parallel", 3);
	const stamp = Date.now();
	const out = resolve(flag("--out") ?? join(tmpdir(), `pichart-sweep-${stamp}`));
	await mkdir(join(out, "runs"), { recursive: true });
	const defaultCell = cells.find((cell) => cell.isDefault) as Cell;
	const record: SweepRecord = {
		// The local day, as the other reports under docs/benchmarks/ are named.
		date: new Date(stamp - new Date(stamp).getTimezoneOffset() * 60_000).toISOString().slice(0, 10),
		grid,
		commit,
		keys,
		options: { ...options, runs, parallel, pool: poolFile, command: `bun scripts/bench-tokens.ts ${argv.join(" ")}` },
		cells,
		runs: [],
	};
	const save = () => writeFile(join(out, "sweep.json"), `${JSON.stringify(record, null, "\t")}\n`);
	const shared = { server, out, timeoutMs: positive("--turn-timeout", 600) * 1000, stamp };
	const templates: string[] = [];
	try {
		const screenCtx = await buildContext(workload, turnsOf(workload), { ...shared, options: options.screen });
		templates.push(screenCtx.template);
		const order = roundRobin(cells, runs);
		log(`screen: ${cells.length} cells × ${runs} rounds on ${workload.name}, ${parallel} at a time, $${SCREEN_CAP} cap`);
		const jobs = order.map(({ cell, round }) => async () => {
			const label = `${cell.id}-r${round + 1}`;
			const spec = { arm: "pi-chart" as const, index: round, label, source: REPO, commit, budgets: cell.budgets };
			const { record: runRecord, measures } = await runOne(spec, screenCtx);
			record.runs.push({
				cell: cell.id,
				round,
				label,
				cost: measures.cost,
				lapses: gateLapses(measures),
				complete: measures.complete,
				steps: stepsOf(measures),
			});
			const off = offModel(runRecord, measures, REFERENCE_MODEL);
			if (off) throw new Error(`${label} ${off}`);
			return { cost: measures.cost };
		});
		const byOrder = (a: ScreenRun, b: ScreenRun) => a.round - b.round || cells.findIndex((c) => c.id === a.cell) - cells.findIndex((c) => c.id === b.cell);
		let capped: boolean;
		try {
			capped = await runCapped({ jobs, width: parallel, cap: SCREEN_CAP });
		} catch (error) {
			record.runs.sort(byOrder);
			record.stopped = message(error);
			await save();
			throw error;
		}
		record.runs.sort(byOrder);
		const spent = record.runs.reduce((sum, run) => sum + run.cost, 0);
		const result = screen({ cells, runs: record.runs, history, key: keys.screen });
		record.screen = { spent, cap: SCREEN_CAP, capped, result };
		await save();
		log(`screen: winner ${result.winner}, best ${result.best}, tied ${result.tied.join(", ")}`);

		const winner = cellById(cells, result.winner);
		let runPair: (index: number) => Promise<PairRun> = () => Promise.reject(new Error("no confirm pair runs for a default winner"));
		if (winner !== defaultCell) {
			const heldCtx = await buildContext(heldOut, turnsOf(heldOut), { ...shared, options: options.heldOut });
			templates.push(heldCtx.template);
			runPair = pairRunner(heldCtx, (side, index) => ({
				arm: "pi-chart",
				index,
				label: `confirm-${side}-${index}`,
				source: REPO,
				commit,
				budgets: (side === "base" ? defaultCell : winner).budgets,
			}));
			log(`confirm: ${winner.id} against the default on ${heldOut.name}`);
		}
		const { stopped, ...confirmed } = await confirm({
			winner,
			defaultCell,
			history,
			key: keys.heldOut,
			width: Math.max(1, Math.floor(parallel / 2)),
			runPair,
		});
		record.confirm = confirmed;
		if (stopped !== undefined) record.stopped = message(stopped);
		await save();
		if (stopped !== undefined) throw stopped;

		const batch = completePairs(confirmed.pairs);
		if (batch.length >= 2) {
			await appendToPool(poolFile, {
				kind: "confirm",
				key: keys.heldOut,
				date: new Date().toISOString(),
				base: commit,
				candidate: commit,
				out,
				budgets: { base: defaultCell.budgets, candidate: winner.budgets },
				pairs: batch,
			});
			log(`added ${batch.length} confirm pairs to ${poolFile}`);
		}
	} finally {
		for (const dir of templates) await rm(dir, { recursive: true, force: true });
	}

	const text = report(record, await measureSweep(out, record));
	const base = join(REPO, "docs", "benchmarks", `${record.date}-${grid.slug}`);
	const files = [`${base}.md`, `${base}.json`];
	if (files.some((file) => existsSync(file))) {
		log(`not written, since one exists already: ${files.join(", ")}`);
	} else {
		await writeFile(files[0] as string, text);
		await copyFile(join(out, "sweep.json"), files[1] as string);
		log(`report: ${files.join(", ")}`);
	}
	log(`record: ${out}`);
	process.stdout.write(text);
}

// ---------------------------------------------------------------- report --

/** Every screen Run's Measures, by label, re-measured from its record under the committed calibration. */
async function measureSweep(out: string, record: SweepRecord): Promise<Map<string, RunMeasures>> {
	const calibration = await readCalibration();
	const measures = new Map<string, RunMeasures>();
	for (const run of record.runs) measures.set(run.label, await measureRun(join(out, "runs", run.label), calibration));
	return measures;
}

/** The report of the sweep whose output folder is `out`, from its records alone. */
export async function sweepReport(out: string): Promise<string> {
	const record = JSON.parse(await readFile(join(out, "sweep.json"), "utf8")) as SweepRecord;
	return report(record, await measureSweep(out, record));
}

/** The sweep's report, in Markdown: outcome, cells, the rule as applied, noise, confirm, spend and method. */
export function report(record: SweepRecord, measures: Map<string, RunMeasures>): string {
	const lines: string[] = [];
	const say = (...text: string[]) => lines.push(...text);
	const { cells, grid, keys } = record;
	const result = record.screen?.result;
	const confirmed = record.confirm;
	const budgets = Object.keys(grid.budgets);

	say(`# Budget sweep \`${grid.slug}\` — ${record.date}`, "");
	if (record.stopped) {
		say(`Stopped without an outcome: ${record.stopped}. Nothing was added to the pool.`);
	} else if (result && confirmed) {
		const winner = cellById(cells, result.winner);
		if (winner.isDefault) {
			say(`**Outcome: keep the default.** The screen on ${describeKey(keys.screen)} picked the default, ${cellLabel(winner)}; no confirm ran.`);
		} else {
			const last = confirmed.looks.at(-1);
			const at = last ? ` at look ${last.look + 1} (${last.pairs} pairs)` : "";
			say(
				`**Outcome: ${confirmed.outcome}${confirmed.reason ? ` (${confirmed.reason})` : ""}.** ` +
					`The screen on ${describeKey(keys.screen)} picked ${cellLabel(winner)}; ` +
					`confirm on ${describeKey(keys.heldOut)} ${confirmed.outcome === "adopt" ? "showed it cheaper with no more Lapses" : "kept the default"}${at}` +
					`${confirmed.capped ? ", stopped by the cap" : ""}.`,
			);
		}
	}
	if (!result) return `${lines.join("\n")}\n`;

	// Per cell, over its complete Runs.
	const runsOfCell = (cell: Cell) => runsOf(record.runs, cell.id);
	const measured = (cell: Cell) =>
		runsOfCell(cell)
			.map((run) => measures.get(run.label))
			.filter((run): run is RunMeasures => run !== undefined);
	const steps = Object.keys(result.cells[0]?.passes ?? {});
	const label = utilisationLabel(cells.flatMap((cell) => measured(cell).filter((run) => run.complete).map((run) => run.utilisation)));
	say("", "## All cells", "", "Over each cell's complete Runs; medians unless stated.", "");
	say(
		`| Cell | ${budgets.join(" | ")} | Complete | Cost per Run (geometric mean) | Lapses per Run | ${steps.map((step) => `Pass ${step}`).join(" | ")}${steps.length > 0 ? " | " : ""}Retention | Utilisation (${label}) | Re-fetches held / left / unknown |`,
		`| --- | ${budgets.map(() => "---:").join(" | ")} | ---: | ---: | ---: | ${steps.map(() => "---:").join(" | ")}${steps.length > 0 ? " | " : ""}---: | ---: | ---: |`,
	);
	for (const screened of result.cells) {
		const cell = cellById(cells, screened.cell);
		const complete = measured(cell).filter((run) => run.complete);
		const figures = aggregate(complete).get("pi-chart");
		const retention = (figures?.retention ?? []).reduce((sum, probe) => ({ right: sum.right + probe.right, of: sum.of + probe.of }), { right: 0, of: 0 });
		const middle = (pick: (run: RunMeasures) => number | undefined) => median(complete.map((run) => pick(run) ?? Number.NaN));
		const lapses = median(runsOfCell(cell).filter((run) => run.complete).map((run) => run.lapses));
		const refetches = (["held", "left", "unknown"] as const).map((kind) => int(middle((run) => run.refetch[kind].total))).join(" / ");
		const passes = steps.map((step) => `${screened.passes[step]}/${screened.complete}`);
		say(
			`| ${cell.id}${cell.isDefault ? " (default)" : ""} | ${budgets.map((name) => cell.budgets[name]).join(" | ")} | ` +
				`${screened.complete}/${screened.runs} | ${Number.isFinite(screened.cost) ? usd(screened.cost) : "—"} | ${int(lapses)} | ` +
				`${passes.join(" | ")}${passes.length > 0 ? " | " : ""}${retention.of > 0 ? `${retention.right}/${retention.of}` : "—"} | ` +
				`${percent(middle((run) => (run.utilisation ? share(run.utilisation) : undefined)))} | ${refetches} |`,
		);
	}
	say("", CAVEATS.join(" "));

	say("", "## The rule, as applied", "");
	say(
		"The default is always eligible. Another cell needs at least 2 complete pairs with the default, " +
			`a one-sided Lapse test against it not rejected at α ${LAPSE_ALPHA} on the variance pooled under ${describeKey(keys.screen)}, ` +
			`and no graded step on which it passes on ${COLLAPSE} or more fewer complete Runs. ` +
			"The best is the eligible cell of lowest geometric-mean cost; an eligible cell is tied with it when the 95% interval " +
			"of its paired cost ratio contains 1, or when they share fewer than 2 complete pairs. The default wins when tied; " +
			"otherwise the tied cell of lowest rank sum, then lowest rank on the first Budget.",
		"",
	);
	say(
		"| Cell | Eligible | Reasons | Pairs with default | Lapse Δ | Lapse p | Pairs with best | Cost ratio to best | 95% interval | Tied |",
		"| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
	);
	for (const screened of result.cells) {
		const { versusDefault, versusBest } = screened;
		const lapses = versusDefault?.lapses;
		const cost = versusBest?.cost;
		say(
			`| ${screened.cell} | ${screened.eligible ? "yes" : "no"} | ${screened.reasons.join("; ") || "—"} | ` +
				`${versusDefault?.pairs ?? "—"} | ${fixed(lapses?.mean, 2)} | ${lapses ? pValue(lapses.p) : "—"} | ` +
				`${versusBest?.pairs ?? "—"} | ${fixed(cost?.ratio, 3)} | ${cost ? `[${fixed(cost.ratioLower, 3)}, ${fixed(cost.ratioUpper, 3)}]` : "—"} | ` +
				`${versusBest ? (versusBest.tied ? "yes" : "no") : "—"} |`,
		);
	}
	say("", `Best: ${result.best}. Tied: ${result.tied.join(", ")}. Winner: ${cellLabel(cellById(cells, result.winner))}.`);

	say("", "## Noise", "", "Each Run's Cost per Run by round; † marks a void Run, whose cost counts as spend but which pairs with nothing.", "");
	say(`| Cell | ${Array.from({ length: record.options.runs }, (_, at) => `Round ${at + 1}`).join(" | ")} | SD of log cost (own) |`);
	say(`| --- | ${Array.from({ length: record.options.runs }, () => "---:").join(" | ")} | ---: |`);
	for (const cell of cells) {
		const own = runsOfCell(cell);
		const rounds = Array.from({ length: record.options.runs }, (_, round) => {
			const run = own.find((r) => r.round === round);
			return run ? `${usd(run.cost)}${run.complete ? "" : " †"}` : "—";
		});
		const logs = own.filter((run) => run.complete).map((run) => Math.log(run.cost));
		say(`| ${cell.id} | ${rounds.join(" | ")} | ${fixed(Math.sqrt(sampleVariance(logs)), 4)} |`);
	}

	if (confirmed && confirmed.looks.length > 0) {
		say(
			"",
			"## Confirm",
			"",
			`${cellLabel(cellById(cells, result.winner))} against the default on ${describeKey(keys.heldOut)}: one-sided bounds at the look's α, ` +
				"fail tests Holm-corrected, and the winner cheaper when the upper bound of its cost ratio is below 1.",
			"",
			lookTable(confirmed.looks),
		);
	}

	const screenRuns = record.runs.length;
	say("", "## Spend", "");
	say(`- Screen: ${usd(record.screen?.spent ?? 0)} of a ${usd(SCREEN_CAP)} cap over ${screenRuns} Runs${record.screen?.capped ? "; the cap stopped it" : ""}.`);
	if (confirmed && confirmed.pairs.length > 0) {
		say(`- Confirm: ${usd(confirmed.spent)} of a ${usd(confirmed.cap)} cap over ${confirmed.pairs.length * 2} Runs${confirmed.capped ? "; the cap stopped it" : ""}.`);
	}
	say(
		`- Total: ${usd((record.screen?.spent ?? 0) + (confirmed?.spent ?? 0))}. A stage may pass its cap by the Runs already running when it was reached ` +
			`(up to ${record.options.parallel} at once).`,
	);

	say("", "## Method", "");
	say(
		`- Commit: \`${record.commit.slice(0, 7)}\`, model ${REFERENCE_MODEL}, ${record.keys.screen.omp}`,
		`- Screen: ${describeKey(keys.screen)}, ${record.options.runs} Runs per cell, round-robin`,
		`- Held out: ${describeKey(keys.heldOut)}`,
		`- Pool: \`${record.options.pool}\``,
		`- Command: \`${record.options.command}\``,
		"- Grid:",
		"",
		"```json",
		JSON.stringify(grid),
		"```",
	);
	return `${lines.join("\n")}\n`;
}
