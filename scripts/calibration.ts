/**
 * Calibration of the Used rule against Needed (`openspec/changes/utilisation-calibration/design.md`
 * §3, §6): the grid of cells, agreement between Used and Needed, the chosen
 * cell, the rule a key's Runs are judged at, and the PPI Needed share. Pure,
 * apart from reading the calibration file.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { CalibrationFile, CalibrationSet, CalibrationUnit } from "./ablation.ts";
import { mean, sampleVariance } from "./stats.ts";
import { type CallUtilisation, DEFAULT_RULE, JUDGED_KINDS, type Rule } from "./utilisation.ts";
import { REPO } from "./workload.ts";

/** The cells a calibration judges, in order: *s* ∈ {6, 8, 12} × *k* ∈ {1, 2, 3}. An earlier cell wins a tie. */
export const GRID: readonly Rule[] = [6, 8, 12].flatMap((s) => [1, 2, 3].map((k) => ({ s, k })));

/** A cell's id, as a unit's `used` map keys it: `s6k1`. */
export const cellId = ({ s, k }: Rule) => `s${s}k${k}`;

/** How one cell's Used verdicts agree with Needed over the units compared. */
export interface Agreement {
	both: number;
	usedOnly: number;
	neededOnly: number;
	neither: number;
	n: number;
	/** Cohen's κ; NaN when chance agreement is 1, as when Used and Needed each hold one value. */
	kappa: number;
	/** Needed among Used; NaN with nothing Used. */
	precision: number;
	/** Used among Needed; NaN with nothing Needed. */
	recall: number;
}

/** Cohen's κ, precision and recall of Used against Needed, with the counts behind them. */
export function agreement(pairs: { used: boolean; needed: boolean }[]): Agreement {
	const count = (used: boolean, needed: boolean) => pairs.filter((pair) => pair.used === used && pair.needed === needed).length;
	const both = count(true, true);
	const usedOnly = count(true, false);
	const neededOnly = count(false, true);
	const neither = count(false, false);
	const n = pairs.length;
	const usedShare = (both + usedOnly) / n;
	const neededShare = (both + neededOnly) / n;
	const observed = (both + neither) / n;
	const chance = usedShare * neededShare + (1 - usedShare) * (1 - neededShare);
	return {
		both,
		usedOnly,
		neededOnly,
		neither,
		n,
		kappa: chance === 1 ? Number.NaN : (observed - chance) / (1 - chance),
		precision: both / (both + usedOnly),
		recall: both / (both + neededOnly),
	};
}

/** Whether a unit is compared: a tail or summary unit, as Utilisation judges them, judged Needed or not Needed; duplicated ones included. */
export function isCompared({ unit, verdict }: { unit: { kind: string }; verdict?: string }): boolean {
	const judged: readonly string[] = JUDGED_KINDS;
	return judged.includes(unit.kind) && (verdict === "needed" || verdict === "not-needed");
}

/** The units a calibration compares (`isCompared`). */
export function comparable(units: CalibrationUnit[]): CalibrationUnit[] {
	return units.filter(isCompared);
}

/** A compared unit's Used verdict at cell `id`; an error when the calibration stored none. */
function usedAt(each: CalibrationUnit, id: string): boolean {
	const used = each.used?.[id];
	if (used === undefined) throw new Error(`a compared ${each.unit.kind} unit of ${each.folder} has no Used verdict at ${id}`);
	return used;
}

/** The κ a set's chosen cell needs before Runs of its key are judged at it, and before a PPI share is given. */
export const KAPPA_FLOOR = 0.4;

/** The rule Runs of a set's key are judged at: its chosen cell, with its κ, when that κ reaches the floor; else the defaults, uncalibrated. */
export function ruleFor(set: CalibrationSet | undefined): { rule: Rule; kappa?: number } {
	const chosen = set?.rule;
	if (!chosen || chosen.kappa === null || !(chosen.kappa >= KAPPA_FLOOR)) return { rule: DEFAULT_RULE };
	return { rule: { s: chosen.s, k: chosen.k }, kappa: chosen.kappa };
}

/** One cell's agreement, pooled and per Arm. */
export interface CellFigures {
	cell: Rule;
	pooled: Agreement;
	arms: Record<string, Agreement>;
}

/**
 * Every cell's agreement over the set's compared units, and the chosen cell:
 * the highest pooled κ, a tie to the earlier cell in `GRID`, an undefined κ
 * never over a defined one. `kappa` is NaN when no cell has one.
 */
export function chooseCell(units: CalibrationUnit[]): { cells: CellFigures[]; chosen: Rule; kappa: number } {
	const compared = comparable(units);
	const arms = [...new Set(compared.map((each) => each.arm))];
	const cells = GRID.map((cell): CellFigures => {
		const id = cellId(cell);
		const pairs = compared.map((each) => ({ arm: each.arm, used: usedAt(each, id), needed: each.verdict === "needed" }));
		return {
			cell,
			pooled: agreement(pairs),
			arms: Object.fromEntries(arms.map((arm) => [arm, agreement(pairs.filter((pair) => pair.arm === arm))])),
		};
	});
	let best = cells[0] as CellFigures;
	for (const each of cells) {
		const kappa = each.pooled.kappa;
		if (Number.isNaN(kappa)) continue;
		if (Number.isNaN(best.pooled.kappa) || kappa > best.pooled.kappa) best = each;
	}
	return { cells, chosen: best.cell, kappa: best.pooled.kappa };
}

/** A measured main Call as PPI reads it: its Used and judged tail-and-summary tokens, and the tokens of all its units. */
export interface PpiCall {
	used: number;
	judged: number;
	unitTokens: number;
}

/** Runs' Measures as PPI reads them: each Call's Utilisation, and whether it was a subagent's. */
export interface MeasuredRun {
	calls: { subagent: boolean; utilisation?: CallUtilisation | "empty" | "unknown" }[];
}

/**
 * The Calls PPI reads from Runs' Measures: main Calls with a known window and
 * a tail or summary unit. A Call holding only an Opening or Pins would add 0
 * to both sums of the prediction term, so leaving it out moves no estimate;
 * its interval moves only by the small-sample factor N/(N − 1).
 */
export function ppiCalls(runs: MeasuredRun[]): PpiCall[] {
	return runs.flatMap((run) =>
		run.calls.flatMap(({ subagent, utilisation }) =>
			!subagent && utilisation !== undefined && typeof utilisation !== "string" ? [utilisation] : [],
		),
	);
}

/** A PPI Needed share: the estimate and its 95% bounds, clamped to 0–1, and the two terms behind it. */
export interface PpiEstimate {
	share: number;
	lower: number;
	upper: number;
	/** The Used share of a unit drawn as Ablation draws, kept when tail or summary. */
	term: number;
	/** The mean of Used − Needed over the compared calibration units. */
	correction: number;
	calls: number;
	units: number;
}

const Z95 = 1.96;

/**
 * The PPI Needed share (design §6): the prediction term over `calls`, a ratio
 * of per-Call shares of all unit tokens, less the mean of `residuals`
 * (Used − Needed, each 1 or 0, at the chosen cell). Its variance adds the
 * term's delta-method ratio variance to the correction's. None with fewer
 * than 2 residuals or Calls, or when the Calls judged nothing.
 */
export function ppi(calls: PpiCall[], residuals: number[]): PpiEstimate | undefined {
	const drawn = calls.filter((call) => call.unitTokens > 0);
	if (residuals.length < 2 || drawn.length < 2) return undefined;
	const usedShares = drawn.map((call) => call.used / call.unitTokens);
	const judgedShares = drawn.map((call) => call.judged / call.unitTokens);
	const judgedMean = mean(judgedShares);
	if (judgedMean === 0) return undefined;
	const term = mean(usedShares) / judgedMean;
	const termVariance = sampleVariance(usedShares.map((used, at) => used - term * (judgedShares[at] as number))) / (drawn.length * judgedMean ** 2);
	const correction = mean(residuals);
	const variance = termVariance + sampleVariance(residuals) / residuals.length;
	const estimate = term - correction;
	const half = Z95 * Math.sqrt(variance);
	const clamp = (value: number) => Math.min(1, Math.max(0, value));
	return {
		share: clamp(estimate),
		lower: clamp(estimate - half),
		upper: clamp(estimate + half),
		term,
		correction,
		calls: drawn.length,
		units: residuals.length,
	};
}

/** An Arm's PPI Needed share over `calls`, from `set`'s compared units of that Arm at its chosen cell; none below the κ floor. */
export function ppiFor(set: CalibrationSet | undefined, arm: string, calls: PpiCall[]): PpiEstimate | undefined {
	const { rule, kappa } = ruleFor(set);
	if (!set || kappa === undefined) return undefined;
	const id = cellId(rule);
	const residuals = comparable(set.units)
		.filter((each) => each.arm === arm)
		.map((each) => Number(usedAt(each, id)) - Number(each.verdict === "needed"));
	return ppi(calls, residuals);
}

/**
 * The key all `records` share; else why not: "a Run names no model" or
 * "Runs of more than one key".
 */
export function oneKey(records: KeyedRecord[]): CalibrationKey | string {
	const keys = records.map(recordKey);
	const [key] = keys;
	if (!key || keys.some((each) => !each)) return "a Run names no model";
	return keys.every((each) => sameKey(each as CalibrationKey, key)) ? key : "Runs of more than one key";
}

/**
 * An Arm's PPI Needed share over Runs of `key`, measured under `file`; else
 * why there is none: `uncalibrated (<keyLabel>)`, or too few units or Calls.
 */
export function ppiShare(file: CalibrationFile, key: CalibrationKey, arm: string, runs: MeasuredRun[]): PpiEstimate | string {
	const set = setFor(file, key);
	if (ruleFor(set).kappa === undefined) return `uncalibrated (${keyLabel(key)})`;
	return ppiFor(set, arm, ppiCalls(runs)) ?? `fewer than 2 ${arm} calibration units or measured Calls`;
}

/** What a calibration set is frozen under: the Workload's name and version, the model, the omp version. */
export interface CalibrationKey {
	workload: { name: string; version: number };
	model: string;
	omp: string;
}

/** The committed calibration file, and the Run folders its sets draw from, beside it. */
export const CALIBRATION_FILE = join(REPO, "bench", "ablation", "calibration.json");

/** Where a key's set keeps its Runs, relative to the repository: `bench/ablation/runs/gate-v1--anthropic-claude-opus-5-5--omp-18.11.0`. */
export function runsFolder(key: CalibrationKey): string {
	const slug = [`${key.workload.name}-v${key.workload.version}`, key.model, key.omp].map((part) => part.replaceAll("/", "-")).join("--");
	return join("bench", "ablation", "runs", slug);
}

/** The committed calibration file; no sets when it does not exist yet. */
export async function readCalibration(): Promise<CalibrationFile> {
	const text = await readFile(CALIBRATION_FILE, "utf8").catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return undefined;
		throw error;
	});
	return text === undefined ? { sets: [] } : (JSON.parse(text) as CalibrationFile);
}

/** How a report names a key: `gate v3, claude-opus-4-5, omp/18.11.0`. */
export function keyLabel(key: CalibrationKey): string {
	return `${key.workload.name} v${key.workload.version}, ${key.model}, ${key.omp}`;
}

/** What a Run's `run.json` says of its key. */
export interface KeyedRecord {
	workload: { name: string; version: number };
	model?: string;
	omp: string;
}

/** A Run's key from its `run.json`; none when the record names no model. */
export function recordKey(record: KeyedRecord): CalibrationKey | undefined {
	if (!record.model) return undefined;
	return { workload: { name: record.workload.name, version: record.workload.version }, model: record.model, omp: record.omp };
}

/** Whether two keys are one: every field equal, never a near one. */
export function sameKey(a: CalibrationKey, b: CalibrationKey): boolean {
	return a.workload.name === b.workload.name && a.workload.version === b.workload.version && a.model === b.model && a.omp === b.omp;
}

/** The set frozen under `key`, if any. */
export function setFor(file: CalibrationFile, key: CalibrationKey): CalibrationSet | undefined {
	return file.sets.find((set) => sameKey(set.key, key));
}
