/**
 * Ablation of recorded Runs (`openspec/changes/ablation/design.md` §7, §11):
 * draws Calls and one unit each, replays the Run through omp with a plan
 * naming them, and lets `scripts/replay-ext.ts` cut and resend each at its
 * Call. Verdicts are derived here from the resends it reports, with the
 * rules in `scripts/ablation.ts`, and written to `<run-dir>/ablation.json`.
 *
 *     bun scripts/ablate.ts <run-dir>... [--units 20] [--null 0] [--controls] [--cap 10]
 *                           [--seed <n>] [--commit <rev>] [--parallel <n>] [--dry-run]
 *     bun scripts/ablate.ts --calibrate <run-dir>... [--commit <rev>]
 *     bun scripts/ablate.ts --report <run-dir>...
 *
 * `--units` ordinary units and `--null` null units are drawn per Run;
 * `--controls` adds the positive control on every eligible Probe Call.
 * A drawn Call that ends unstable, unfaithful, unlocated or miscounted is
 * replaced by a fresh draw, and another replay pass runs, until the sample
 * is full, no Call is left, or the Run's `--cap` (USD) is spent.
 * `--parallel` replays that many Runs at once. `--dry-run` sends nothing:
 * each draw stops after the count check, only unfaithful and unlocated
 * draws are replaced, the counts and the miscounted share are printed, no
 * `ablation.json` is written, and each pass's results stay in its folder.
 * `--report` re-prints the records, with no replay and no send.
 * `--calibrate` ablates Runs of one key (Workload name and version, model,
 * omp version), of either Arm or both: 50 units and 10 null units per Arm,
 * spread evenly over that Arm's Runs, and the positive control on every
 * eligible Probe Call. The set goes into `bench/ablation/calibration.json`
 * only when the control holds and the key has no set yet; otherwise it says why.
 * Each Run draws with its own seed, derived from `--seed` (`runSeed`).
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
	actionOf,
	addSet,
	calibrationSet,
	controlUnit,
	keyLabel,
	matches,
	percentLabel,
	priceOf,
	probeMatches,
	ratesOf,
	sample,
	setFor,
	shareLabel,
	summarise,
	unitsOf,
	verdict,
	type AblationRecord,
	type CalibrationFile,
	type CalibrationKey,
	type CallUnits,
	type Condition,
	type Draw,
	type Fate,
	type Rates,
	type Resend,
	type Unit,
} from "./ablation.ts";
import { measureRun, readRecord, type RunRecord, usd } from "./measures.ts";
import { callFiles, OFFSET_BAND, replay } from "./replay.ts";
import { journalMessages, type CallFile, type DrawResult, type Plan, type PlannedDraw } from "./replay-ext.ts";
import { flagsOf, pool, resolveCommit } from "./runs.ts";
import { REPO } from "./workload.ts";
import { readBranch } from "../src/journal.ts";
import { isToolCall, type HarnessMessage } from "../src/messages.ts";
import { pinTexts } from "../src/pins.ts";

const USAGE =
	"usage: bun scripts/ablate.ts <run-dir>... [--units 20] [--null 0] [--controls] [--cap 10] [--seed <n>] " +
	"[--commit <rev>] [--parallel <n>] [--dry-run]\n       bun scripts/ablate.ts --calibrate <run-dir>... [--commit <rev>]" +
	"\n       bun scripts/ablate.ts --report <run-dir>...";
const RECORD = "ablation.json";
const CALIBRATION = join(REPO, "bench", "ablation", "calibration.json");
/** A calibration's draws per Arm, spread over that Arm's Runs (design §11). */
const CALIBRATION_UNITS = 50;
const CALIBRATION_NULLS = 10;
/** Flags that take a value; every other argument not starting with `--` is a run folder. */
const VALUED: Record<string, true> = { "--units": true, "--null": true, "--cap": true, "--seed": true, "--commit": true, "--parallel": true };
/** The fates a fresh draw replaces; a dry run sends nothing, so only those found before any count. */
const REDRAWN: Fate[] = ["unstable", "unfaithful", "unlocated", "miscounted"];
const REDRAWN_DRY: Fate[] = ["unfaithful", "unlocated"];
/** A Plant position the window held, so the positive control can cut it. */
const HELD: Record<string, true> = { opening: true, pin: true, tail: true, summary: true };

export interface AblateOptions {
	units: number;
	nulls: number;
	controls: boolean;
	cap: number;
	seed: number;
	commit?: string;
	dryRun: boolean;
	/** A built tree of `commit` to reuse; built per pass when absent. */
	tree?: string;
	/** Ablating for `--calibrate`: the record is marked so a stopped calibration can reuse it. */
	calibration?: boolean;
}

/** What a Run's plan draws on: every main Call's units, original next action and Probe, by global main-Call ordinal. */
interface Planning {
	dir: string;
	record: RunRecord;
	label: string;
	callUnits: CallUnits[];
	calls: { turn: number; original: PlannedDraw["original"]; probe?: PlannedDraw["probe"] }[];
	controls: PlannedDraw[];
	rates: Rates;
}

/** One draw at the end of a pass: what was planned, and what the extension reported. */
interface Outcome {
	planned: PlannedDraw;
	result: DrawResult;
}

async function planning(dir: string): Promise<Planning> {
	const record = await readRecord(dir);
	const journal = join(dir, "journal.jsonl");
	const measures = await measureRun(dir);
	const { turns, compactions, entries } = await readBranch(journal);
	const pins = pinTexts(entries);
	const windows = measures.calls.filter((call) => !call.subagent).map((call) => call.window ?? "unknown");
	const addresses = turns.flatMap((turn) =>
		turn.messages.flatMap((message, at) => (message.role === "assistant" && message.usage ? [{ turn: turn.turnIndex, message: at }] : [])),
	);
	// The extension numbers Calls by the Journal's assistant messages, read its way; the plan must agree.
	const recorded = journalMessages(journal).filter((message) => message.role === "assistant").length;
	if (recorded !== addresses.length || windows.length !== addresses.length) {
		throw new Error(`${dir}: ${recorded} assistant messages in the Journal, ${addresses.length} main Calls on its branch`);
	}
	const completed = record.failedTurn ?? record.prompts.length;
	const messageAt = (address: { turn: number; message: number }) => turns[address.turn]?.messages[address.message] as HarnessMessage;
	const toolCallsOf = (message: HarnessMessage) => (Array.isArray(message.content) ? message.content.filter(isToolCall) : []);

	const calls: Planning["calls"] = [];
	const callUnits: CallUnits[] = [];
	const controls: PlannedDraw[] = [];
	for (const [call, address] of addresses.entries()) {
		const reply = messageAt(address);
		const original = actionOf(toolCallsOf(reply));
		const prompt = record.prompts[address.turn];
		const first = addresses.findIndex((each) => each.turn === address.turn) === call;
		// A Probe Call: a Probe Turn's first Call, whose recorded reply made no tool call.
		const scores = measures.plants.filter((score) => score.turn === address.turn);
		const probe =
			first && prompt && prompt.probes.length > 0 && original.length === 0
				? {
						plants: prompt.probes.map((id) => record.plants.find((plant) => plant.id === id) as RunRecord["plants"][number]),
						verdicts: prompt.probes.map((id) => scores.find((score) => score.id === id)?.right === true),
					}
				: undefined;
		calls.push({ turn: address.turn, original, ...(probe ? { probe } : {}) });
		const units = address.turn < completed ? unitsOf(turns, address, windows[call] ?? "unknown", compactions, pins) : [];
		callUnits.push({ call, units });
		if (!probe) continue;
		const held = scores.find((score) => score.right && HELD[score.position]);
		const value = held && record.plants.find((plant) => plant.id === held.id)?.value;
		const unit = held && value !== undefined ? controlUnit(units, turns, held, value) : undefined;
		if (unit) controls.push({ call, turn: address.turn, condition: "control", unit, original, probe });
	}
	return {
		dir,
		record,
		label: basename(dir),
		callUnits,
		calls,
		controls,
		rates: ratesOf(turns.flatMap((turn) => turn.messages)),
	};
}

/** The seed of one condition's draws in one pass: each pass and condition gets its own stream. */
function streamSeed(seed: number, pass: number, condition: Condition): number {
	return (seed + 2 * pass + (condition === "null" ? 1 : 0)) >>> 0;
}

/** The seed of the `nth` Run given: Runs of one Workload must not all draw the same Call ordinals. */
function runSeed(seed: number, nth: number): number {
	return (seed + Math.imul(nth, 0x9e3779b9)) >>> 0;
}

/** The ablation record beside the Run's record in `dir`, if it has one. */
export async function readAblation(dir: string): Promise<AblationRecord | undefined> {
	const path = join(dir, RECORD);
	return existsSync(path) ? (JSON.parse(await readFile(path, "utf8")) as AblationRecord) : undefined;
}

/** Replays the Run once with `draws` planned; each draw's result, in plan order. */
async function replayPass(plan: Planning, options: AblateOptions, draws: PlannedDraw[], cap: number, pass: number): Promise<Outcome[]> {
	const scratch = await mkdtemp(join(tmpdir(), "pichart-ablate-plan-"));
	const out = await mkdtemp(join(tmpdir(), "pichart-ablate-"));
	const planFile = join(scratch, "plan.json");
	const body: Plan = { draws, band: OFFSET_BAND, rates: plan.rates, cap, dryRun: options.dryRun };
	await writeFile(planFile, JSON.stringify(body));
	const turns = Math.max(...draws.map((draw) => draw.turn)) + 1;
	process.stderr.write(`[ablate] ${plan.label} pass ${pass + 1}: ${draws.length} draws over Turns 1..${turns}\n`);
	let calls: CallFile[];
	try {
		({ calls } = await replay({ runDir: plan.dir, commit: options.commit, tree: options.tree, out, turns, plan: planFile }));
	} catch (error) {
		const spent = (await callFiles(out)).flatMap((call) => call.draws ?? []).reduce((sum, result) => sum + result.spend, 0);
		const message = `${error instanceof Error ? error.message : error}; this pass spent $${spent.toFixed(2)}; its results are in ${out}`;
		throw new AblationStop(message, spent);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
	const results = new Map(calls.flatMap((call) => call.draws ?? []).map((result) => [result.draw, result]));
	const outcomes = draws.map((planned, at) => {
		const result = results.get(at);
		const error = result ? result.error : "the replay never reached it";
		if (error) {
			const spent = [...results.values()].reduce((sum, each) => sum + each.spend, 0);
			throw new AblationStop(`${plan.label}: Call ${planned.call}: ${error}; this pass spent $${spent.toFixed(2)}; results in ${out}`, spent);
		}
		return { planned, result: result as DrawResult };
	});
	if (options.dryRun) process.stderr.write(`[ablate] ${plan.label} pass ${pass + 1} results: ${out}\n`);
	else await rm(out, { recursive: true, force: true });
	return outcomes;
}

/** A finished draw as the record keeps it: each resend's action, match and price, and the verdict, derived here. */
function drawOf(outcome: Outcome, rates: Rates): Draw {
	const { planned, result } = outcome;
	const fate = result.fate as Fate;
	const resends = result.resends.map((sent): Resend => {
		const message: HarnessMessage = { role: "assistant", content: sent.content };
		const action = actionOf(sent.content.filter(isToolCall));
		const text = sent.content.flatMap((block) => (block.type === "text" && "text" in block ? [block.text] : [])).join("\n");
		return {
			condition: sent.condition,
			action,
			...(text ? { text } : {}),
			match: planned.probe ? probeMatches(planned.probe.plants, planned.probe.verdicts, message) : matches(planned.original, action),
			usage: sent.usage,
			spend: priceOf(sent.usage, rates),
		};
	});
	const decisive = planned.condition === "null" ? "sham2" : "cut";
	const counted = result.counts?.alone;
	return {
		call: planned.call,
		turn: planned.turn,
		condition: planned.condition,
		fate,
		unit: {
			...planned.unit,
			...(counted === undefined ? {} : { counted }),
			...(result.duplicated === undefined ? {} : { duplicated: result.duplicated }),
			...(result.location === undefined ? {} : { location: result.location }),
		},
		...(result.counts ? { counts: result.counts } : {}),
		original: planned.original,
		resends,
		...(fate === "judged" ? { verdict: verdict(resends.filter((each) => each.condition === decisive).map((each) => each.match)) } : {}),
		spend: resends.reduce((sum, each) => sum + each.spend, 0),
	};
}

/** A Run whose Ablation stopped before its record was written, with what its passes had spent. */
export class AblationStop extends Error {
	constructor(
		message: string,
		readonly spent: number,
	) {
		super(message);
	}
}

/**
 * Ablates one Run: draws, then replay passes with redraws (design §7).
 * Returns the record, or for a dry run every draw's outcome.
 */
export async function ablateRun(dir: string, options: AblateOptions): Promise<{ record?: AblationRecord; outcomes: Outcome[]; plan: Planning }> {
	const plan = await planning(dir);
	const drawn = new Set<number>();
	const pick = (condition: "ablate" | "null", n: number, pass: number): PlannedDraw[] => {
		const draws = sample(plan.callUnits, n, streamSeed(options.seed, pass, condition), drawn);
		for (const draw of draws) drawn.add(draw.call);
		return draws.map(({ call, unit }) => {
			const { turn, original, probe } = plan.calls[call] as Planning["calls"][number];
			return { call, turn, condition, unit, original, ...(probe ? { probe } : {}) };
		});
	};
	const redrawn = options.dryRun ? REDRAWN_DRY : REDRAWN;
	let pending = [...pick("ablate", options.units, 0), ...pick("null", options.nulls, 0), ...(options.controls ? plan.controls : [])];
	const outcomes: Outcome[] = [];
	const draws: Draw[] = [];
	let spend = 0;
	for (let pass = 0; pending.length > 0; pass++) {
		pending.sort((a, b) => a.call - b.call);
		const passed = await replayPass(plan, options, pending, options.cap - spend, pass).catch((error: unknown) => {
			// What every pass spent, so a caller sharing a cap across Runs still counts it.
			throw error instanceof AblationStop ? new AblationStop(error.message, spend + error.spent) : error;
		});
		outcomes.push(...passed);
		if (!options.dryRun) {
			const finished = passed.map((outcome) => drawOf(outcome, plan.rates));
			draws.push(...finished);
			spend += finished.reduce((sum, draw) => sum + draw.spend, 0);
			if (spend >= options.cap) break;
		}
		const replaced = (condition: Condition) =>
			passed.filter(({ planned, result }) => planned.condition === condition && result.fate && redrawn.includes(result.fate)).length;
		pending = [...pick("ablate", replaced("ablate"), pass + 1), ...pick("null", replaced("null"), pass + 1)];
	}
	if (options.dryRun) return { outcomes, plan };
	const record: AblationRecord = {
		arm: plan.record.arm,
		index: plan.record.index,
		seed: options.seed,
		cap: options.cap,
		band: OFFSET_BAND,
		// Only a pi-chart Run loads a pi-chart commit.
		...(plan.record.arm === "pi-chart" && (plan.record.piChart ?? options.commit) ? { commit: plan.record.piChart ?? options.commit } : {}),
		omp: plan.record.omp,
		draws,
		spend,
		...(options.calibration ? { calibration: true as const } : {}),
	};
	await writeFile(join(dir, RECORD), `${JSON.stringify(record, null, "\t")}\n`);
	return { record, outcomes, plan };
}

// ---- printing

function unitLabel(unit: Unit): string {
	const where = unit.turn === undefined ? "" : ` Turn ${unit.turn + 1}`;
	const what = unit.tool ?? (unit.pin === undefined ? "" : `#${unit.pin}`);
	return `${unit.kind}${what ? ` ${what}` : ""}${where}, ~${unit.tokens} tok`;
}

function drawLine(draw: Draw): string {
	const tally = (condition: Resend["condition"]) => {
		const of = draw.resends.filter((resend) => resend.condition === condition);
		return of.length === 0 ? [] : [`${condition} ${of.filter((resend) => resend.match).length}/${of.length}`];
	};
	return [
		`call ${String(draw.call).padStart(3)} (Turn ${draw.turn + 1}) ${draw.condition.padEnd(7)} ${unitLabel(draw.unit)}${draw.unit.duplicated ? ", duplicated" : ""}:`,
		draw.fate,
		...(draw.verdict ? [draw.verdict] : []),
		...tally("sham"),
		...tally("cut"),
		...tally("sham2"),
		usd(draw.spend),
	].join(" ");
}

function printRecords(records: AblationRecord[], labels: string[]): void {
	for (const [at, record] of records.entries()) {
		console.log(`${labels[at]} (${record.arm} ${record.index}, seed ${record.seed}, cap ${usd(record.cap)}): spent ${usd(record.spend)}`);
		for (const draw of record.draws) console.log(`  ${drawLine(draw)}`);
	}
	for (const [arm, summary] of summarise(records)) {
		const fates = Object.entries(summary.fates)
			.filter(([, count]) => count > 0)
			.map(([fate, count]) => `${fate} ${count}`)
			.join(", ");
		console.log(`${arm}: Needed ${shareLabel(summary.needed)}; duplicated apart ${shareLabel(summary.duplicated)}`);
		console.log(
			`  unclear ${percentLabel(summary.unclear)}; unstable ${summary.unstable.k}/${summary.unstable.n} Calls drawn; ${fates}; spend ${usd(summary.spend)}`,
		);
		if (summary.control) {
			console.log(`  positive control Needed ${shareLabel(summary.control.share)}: ${summary.control.trusted ? "trusted" : "the instrument is not trusted"}`);
		}
		if (summary.falseNeeded) console.log(`  null units false Needed ${shareLabel(summary.falseNeeded)}`);
	}
}

function printDryRun(plan: Planning, outcomes: Outcome[]): void {
	console.log(`${plan.label} (${plan.record.arm} ${plan.record.index}): dry run, nothing sent`);
	for (const { planned, result } of outcomes) {
		const counts = result.counts;
		const parts = [`call ${String(planned.call).padStart(3)} (Turn ${planned.turn + 1}) ${planned.condition.padEnd(7)} ${unitLabel(planned.unit)}:`];
		if (counts) parts.push(`offset ${counts.offset}`);
		if (counts?.sham !== undefined && counts.cut !== undefined && counts.alone !== undefined) {
			const freed = counts.sham - counts.cut;
			parts.push(`sham ${counts.sham} cut ${counts.cut} freed ${freed} alone ${counts.alone} excess ${freed - counts.alone}`);
		}
		if (result.duplicated) parts.push("duplicated");
		parts.push(result.fate ?? "counted");
		console.log(`  ${parts.join(" ")}`);
	}
	const counted = outcomes.filter(({ result }) => result.counts?.alone !== undefined);
	const miscounted = counted.filter(({ result }) => result.fate === "miscounted").length;
	const fate = (name: Fate) => outcomes.filter(({ result }) => result.fate === name).length;
	console.log(
		`  ${counted.length} units counted; miscounted ${miscounted}/${counted.length} (${percentLabel(miscounted / counted.length)}); ` +
			`unfaithful ${fate("unfaithful")}, unlocated ${fate("unlocated")}`,
	);
}

/**
 * A calibration (design §11): each Arm's 50 units and 10 null units spread
 * evenly over its Runs, the positive control on every eligible Probe Call,
 * then the set written under its key when the writer takes it, or why it did not.
 */
async function calibrate(dirs: string[], options: AblateOptions): Promise<void> {
	const records = await Promise.all(dirs.map((dir) => readRecord(dir)));
	const keys = records.map((record, at): CalibrationKey => {
		if (!record.model) throw new Error(`${dirs[at]}: run.json names no model, so the Run has no calibration key`);
		return { workload: { name: record.workload.name, version: record.workload.version }, model: record.model, omp: record.omp };
	});
	const key = keys[0] as CalibrationKey;
	const stray = keys.findIndex((each) => JSON.stringify(each) !== JSON.stringify(key));
	if (stray >= 0) throw new Error(`${dirs[stray]} is ${keyLabel(keys[stray] as CalibrationKey)}, not ${keyLabel(key)}: a calibration takes one key`);
	const file = JSON.parse(await readFile(CALIBRATION, "utf8")) as CalibrationFile;
	const frozen = setFor(file, key);
	if (frozen) throw new Error(`refusing: ${keyLabel(key)} already has a calibration set, made ${frozen.date}`);

	const arms = new Map<string, string[]>();
	for (const [at, { arm }] of records.entries()) arms.set(arm, [...(arms.get(arm) ?? []), dirs[at] as string]);
	// `total` spread evenly over `count` Runs: the first `total % count` take one more.
	const spread = (total: number, count: number, nth: number) => Math.floor(total / count) + (nth < total % count ? 1 : 0);
	const runs: { record: AblationRecord; label: string; dir: string }[] = [];
	for (const armDirs of arms.values()) {
		for (const [nth, dir] of armDirs.entries()) {
			const units = spread(CALIBRATION_UNITS, armDirs.length, nth);
			const nulls = spread(CALIBRATION_NULLS, armDirs.length, nth);
			// A calibration that stopped part-way keeps what its finished Runs already paid for.
			const kept = await readAblation(dir);
			if (kept) {
				process.stderr.write(`[ablate] ${basename(dir)}: reusing its calibration record\n`);
				runs.push({ record: kept, label: basename(dir), dir });
				continue;
			}
			const seed = runSeed(options.seed, dirs.indexOf(dir));
			const { record, plan } = await ablateRun(dir, { ...options, seed, units, nulls, controls: true, calibration: true });
			runs.push({ record: record as AblationRecord, label: plan.label, dir });
		}
	}
	printRecords(
		runs.map((each) => each.record),
		runs.map((each) => each.label),
	);

	const set = calibrationSet(
		key,
		await Promise.all(runs.map(async ({ record, dir }) => ({ record, turns: (await readBranch(join(dir, "journal.jsonl"))).turns }))),
		new Date().toISOString().slice(0, 10),
	);
	const perArm = [...arms.keys()]
		.map((arm) => `${arm} ${set.units.filter((unit) => unit.arm === arm).length} units, ${set.nulls.filter((unit) => unit.arm === arm).length} null`)
		.join("; ");
	console.log(`calibration ${keyLabel(key)}: ${perArm}; positive control Needed ${shareLabel(set.control.share)}`);
	const { file: written, refused } = addSet(file, set);
	if (refused) {
		console.log(`calibration not written: ${refused}; ${CALIBRATION} is unchanged`);
		process.exitCode = 1;
		return;
	}
	await writeFile(CALIBRATION, `${JSON.stringify(written, null, "\t")}\n`);
	console.log(`calibration set written to ${CALIBRATION}`);
}

// ---- CLI

async function main(argv: string[]): Promise<void> {
	const dirs = argv.filter((arg, at) => !arg.startsWith("--") && !VALUED[argv[at - 1] ?? ""]).map((dir) => resolve(dir));
	if (dirs.length === 0) throw new Error(USAGE);
	if (argv.includes("--report")) {
		const records = await Promise.all(
			dirs.map(async (dir) => {
				const record = await readAblation(dir);
				if (!record) throw new Error(`${dir} has no ${RECORD}`);
				return record;
			}),
		);
		printRecords(records, dirs.map((dir) => basename(dir)));
		return;
	}
	for (const dir of dirs) {
		const existing = await readAblation(dir);
		// `--calibrate` resumes over its own records; anything else is never overwritten or mixed in.
		if (existing && !(argv.includes("--calibrate") && existing.calibration === true)) {
			throw new Error(`refusing: ${join(dir, RECORD)} already exists`);
		}
	}
	const { flag, positive } = flagsOf(argv);
	const number = (name: string, fallback: number, valid: (value: number) => boolean, what: string) => {
		const raw = flag(name);
		if (raw === undefined) return fallback;
		const value = Number(raw);
		if (!valid(value)) throw new Error(`${name} must be ${what}, got ${raw}`);
		return value;
	};
	const rev = flag("--commit");
	const options: AblateOptions = {
		units: positive("--units", 20),
		nulls: number("--null", 0, (value) => Number.isInteger(value) && value >= 0, "a whole number"),
		controls: argv.includes("--controls"),
		cap: number("--cap", 10, (value) => value > 0, "a positive amount of USD"),
		seed: number("--seed", Math.floor(Math.random() * 2 ** 32), (value) => Number.isInteger(value) && value >= 0, "a whole number"),
		...(rev ? { commit: await resolveCommit(rev) } : {}),
		dryRun: argv.includes("--dry-run"),
	};
	process.stderr.write(`[ablate] seed ${options.seed}\n`);
	if (argv.includes("--calibrate")) {
		if (options.dryRun) throw new Error("--calibrate sends; it has no --dry-run");
		await calibrate(dirs, options);
		return;
	}
	const parallel = positive("--parallel", 1);
	const runs = await pool(
		dirs.map((dir, nth) => () => ablateRun(dir, { ...options, seed: runSeed(options.seed, nth) })),
		parallel,
	);
	if (options.dryRun) {
		for (const { plan, outcomes } of runs) printDryRun(plan, outcomes);
		return;
	}
	printRecords(
		runs.map((each) => each.record as AblationRecord),
		runs.map((each) => each.plan.label),
	);
}

if (import.meta.main) {
	await main(process.argv.slice(2)).catch((error: unknown) => {
		console.error(`ablate: ${error instanceof Error ? error.message : error}`);
		process.exitCode = 1;
	});
}
