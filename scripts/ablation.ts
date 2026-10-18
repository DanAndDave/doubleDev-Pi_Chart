/**
 * Ablation's rules, pure: no I/O, no omp, no model. The replay extension and
 * the driver share these, so a match and a verdict have one definition
 * (`openspec/changes/ablation/design.md`, decisions 4–9). Units and targets
 * live in `units.ts`, shared with Utilisation.
 */
import { EVICTION_NOTICE, OPENING_FRAMING } from "../src/assembler.ts";
import type { JournalTurn } from "../src/journal.ts";
import { isToolCall, messageText, renderToolCall, type HarnessMessage } from "../src/messages.ts";
import { approximateTokens } from "../src/tokens.ts";
import { type CalibrationKey, isCompared, keyLabel, type PpiEstimate, setFor } from "./calibration.ts";
import { answerOf, type RunRecord, type Score } from "./measures.ts";
import { wilson } from "./stats.ts";
import { type Action, type Unit, unitContent } from "./units.ts";

// ---- next action (spec: "The next action is compared on tool and target")

/**
 * Whether a resend's next action matches the original's: a reply with no
 * tool call matches one; else some resend tool call has the tool and target
 * of the original's first.
 */
export function matches(original: Action, resend: Action): boolean {
	const first = original[0];
	if (!first) return resend.length === 0;
	return resend.some((target) => target.tool === first.tool && target.target === first.target);
}

/**
 * Whether a resend on a Probe Call matches: `answerOf` scores every probed
 * Plant on it, as the Turn's reply, as the original scored them (`original`,
 * in `plants` order). `resend` is the resend's assistant message, text and
 * toolCall blocks under harness tool names.
 */
export function probeMatches(plants: RunRecord["plants"], original: boolean[], resend: HarnessMessage): boolean {
	const reply = messageText(resend);
	return plants.every((plant, at) => answerOf(plant, [resend], reply, 0).right === original[at]);
}

// ---- the positive control's unit (spec: "The units of a Call")

/**
 * The positive control's unit for a Plant `score` found held, among the
 * Probe Call's `units`: the Plant's whole planted Turn when the verbatim
 * tail held it, else the Opening, the Pin whose text holds `value`, or the
 * summary. None for a Plant the window did not hold.
 */
export function controlUnit(units: Unit[], turns: JournalTurn[], score: Score, value: string): Unit | undefined {
	switch (score.position) {
		case "tail": {
			const turn = score.planted === undefined ? undefined : turns[score.planted];
			if (!turn) return undefined;
			const callIds = turn.messages.flatMap((message) =>
				message.role === "assistant" && Array.isArray(message.content) ? message.content.filter(isToolCall).map((call) => call.id) : [],
			);
			return { kind: "turn", turn: turn.turnIndex, text: turn.prompt, callIds, tokens: approximateTokens(turn.messages) };
		}
		case "opening":
			return units.find((unit) => unit.kind === "opening");
		case "pin":
			return units.find((unit) => unit.kind === "pin" && unit.text?.includes(value));
		case "summary":
			return units.find((unit) => unit.kind === "summary");
		default:
			return undefined;
	}
}

// ---- noise and count (spec: "The count confirms the cut", "Noise decides the verdict")

/** Whether the count confirms the cut: |(sham − cut) − alone| ≤ max(20 tokens, 5% of the unit alone). */
export function countCheck(sham: number, cut: number, alone: number): boolean {
	return Math.abs(sham - cut - alone) <= Math.max(20, 0.05 * alone);
}

/** Whether a Call is stable: at least 3 of its 4 sham resends match. */
export function stability(matches: boolean[]): boolean {
	return matches.filter(Boolean).length >= 3;
}

export type Verdict = "needed" | "unclear" | "not-needed";

/** A unit's verdict from its 4 cut resends: needed when at most 1 matches, unclear at 2, not needed at 3 or 4. */
export function verdict(matches: boolean[]): Verdict {
	const matched = matches.filter(Boolean).length;
	return matched <= 1 ? "needed" : matched === 2 ? "unclear" : "not-needed";
}

// ---- sampling (spec: "Calls and units are sampled"; design §7)

/** A main Call's units, by its global main-Call ordinal. */
export interface CallUnits {
	call: number;
	units: Unit[];
}

/** A sampled Call and the unit drawn from it. */
export interface Sampled {
	call: number;
	unit: Unit;
}

/**
 * `n` Calls drawn uniformly without replacement from those holding a unit
 * and not in `exclude` (the Calls earlier passes drew), one unit each with
 * probability proportional to its tokens; fewer when fewer are left. The same
 * `callUnits`, `n`, `seed` and `exclude` give the same draws, in Call order.
 */
export function sample(callUnits: CallUnits[], n: number, seed: number, exclude: ReadonlySet<number>): Sampled[] {
	const random = mulberry32(seed);
	const pool = callUnits.filter((each) => each.units.length > 0 && !exclude.has(each.call));
	const draws: Sampled[] = [];
	// A partial Fisher–Yates shuffle: each step takes one of the Calls not yet taken, uniformly.
	for (let at = 0; at < Math.min(n, pool.length); at++) {
		const pick = at + Math.floor(random() * (pool.length - at));
		const drawn = pool[pick] as CallUnits;
		pool[pick] = pool[at] as CallUnits;
		pool[at] = drawn;
		const total = drawn.units.reduce((sum, unit) => sum + unit.tokens, 0);
		let left = random() * total;
		const unit = drawn.units.find((each) => (left -= each.tokens) < 0) ?? (drawn.units.at(-1) as Unit);
		draws.push({ call: drawn.call, unit });
	}
	return draws.sort((a, b) => a.call - b.call);
}

/** mulberry32: a seeded PRNG of uniform draws in [0, 1). */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---- pricing (design §8)

/** The tokens a Call was billed for, by kind. */
export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/** USD per token, by kind. */
export interface Rates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

const KINDS = ["input", "output", "cacheRead", "cacheWrite"] as const;

/**
 * The rates the provider charged a Run: per kind, its summed `usage.cost`
 * over its summed `usage` tokens, across the assistant messages with usage
 * (`{input, output, cacheRead, cacheWrite, cost: {input, …, total}}`); 0 for
 * a kind with no tokens.
 */
export function ratesOf(messages: HarnessMessage[]): Rates {
	const tokens: Rates = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	const cost: Rates = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	for (const message of messages) {
		const usage = message.usage as (Partial<Usage> & { cost?: Partial<Rates> }) | undefined;
		if (message.role !== "assistant" || !usage) continue;
		for (const kind of KINDS) {
			tokens[kind] += usage[kind] ?? 0;
			cost[kind] += usage.cost?.[kind] ?? 0;
		}
	}
	const rates: Rates = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	for (const kind of KINDS) rates[kind] = tokens[kind] > 0 ? cost[kind] / tokens[kind] : 0;
	return rates;
}

/** What a send cost: its usage at `rates`. */
export function priceOf(usage: Usage, rates: Rates): number {
	return KINDS.reduce((sum, kind) => sum + usage[kind] * rates[kind], 0);
}

// ---- record and summary (spec: "Every Ablation leaves a record", "Needed share…", "Controls…")

/** What a draw tests: an ordinary unit, a null unit (cut resends replaced by second shams), or the positive control. */
export type Condition = "ablate" | "null" | "control";

/** How a draw ended: judged, or why it got no verdict. */
export type Fate = "judged" | "unstable" | "unfaithful" | "unlocated" | "miscounted" | "capped";

const FATES: Fate[] = ["judged", "unstable", "unfaithful", "unlocated", "miscounted", "capped"];

/** One resend: its next action and whether it matched the original's. */
export interface Resend {
	condition: "sham" | "cut" | "sham2";
	action: Action;
	text?: string;
	match: boolean;
	usage?: Usage;
	spend: number;
}

/**
 * The endpoint's counts for a drawn Call, as far as it got: its rebuilt,
 * unchanged request less its `usage` input total (the faithful gate), then
 * the sham, the cut and the unit alone (the count check).
 */
export interface Counts {
	offset: number;
	sham?: number;
	cut?: number;
	alone?: number;
}

/** One drawn Call, its unit, and every resend made for it. */
export interface Draw {
	/** The global main-Call ordinal. */
	call: number;
	turn: number;
	condition: Condition;
	fate: Fate;
	/** `counted`: the unit alone, by the endpoint. */
	unit: Unit & { counted?: number; duplicated?: boolean; location?: string };
	counts?: Counts;
	original: Action;
	resends: Resend[];
	/** Judged draws only; from the cut resends, or the second shams of a null unit. */
	verdict?: Verdict;
	spend: number;
}

/** `ablation.json`, beside the Run's `run.json`. */
export interface AblationRecord {
	arm: string;
	index: number;
	seed: number;
	cap: number;
	band: [number, number];
	commit?: string;
	omp: string;
	draws: Draw[];
	spend: number;
	/** Made by `--calibrate`, which may reuse it to finish a calibration that stopped part-way. */
	calibration?: true;
}

/** `k` of `n`, with its Wilson 95% interval. */
export interface Share {
	k: number;
	n: number;
	share: number;
	lower: number;
	upper: number;
}

/** One Arm's Ablation figures, over its records. */
export interface Summary {
	/** Ablate draws judged, not duplicated: k = needed. */
	needed: Share;
	/** Ablate draws judged and duplicated: k = needed. */
	duplicated: Share;
	/**
	 * Ablate draws judged Needed or not Needed whose unit is a tail or summary
	 * unit, duplicated ones included: the population a PPI Needed share estimates.
	 */
	tailSummary: Share;
	/** Unclear over judged non-duplicated ablate draws; NaN when none was judged. */
	unclear: number;
	/** Unstable Calls over Calls drawn (ablate and null). */
	unstable: { k: number; n: number };
	fates: Record<Fate, number>;
	spend: number;
	/** Present when any control draw was judged; trusted when its Needed share is at least 0.8. */
	control?: { share: Share; trusted: boolean };
	/** Present when any null draw was judged: null judged Needed over null judged. */
	falseNeeded?: Share;
}

/** The positive control's Needed share at or above which the instrument is trusted. */
const TRUSTED = 0.8;

/** Each Arm's figures over its ablation records, re-derived from the records alone. */
export function summarise(records: AblationRecord[]): Map<string, Summary> {
	const arms = new Map<string, AblationRecord[]>();
	for (const record of records) arms.set(record.arm, [...(arms.get(record.arm) ?? []), record]);

	const summaries = new Map<string, Summary>();
	for (const [arm, armRecords] of arms) {
		const draws = armRecords.flatMap((record) => record.draws);
		const judged = (condition: Condition) =>
			draws.filter((draw) => draw.condition === condition && draw.fate === "judged");
		const ablated = judged("ablate");
		const plain = ablated.filter((draw) => !draw.unit.duplicated);
		const drawn = draws.filter((draw) => draw.condition !== "control");
		const fates = Object.fromEntries(FATES.map((fate) => [fate, 0])) as Record<Fate, number>;
		for (const draw of draws) fates[draw.fate]++;
		const control = judged("control");
		const nulls = judged("null");
		const controlShare = neededShare(control);
		summaries.set(arm, {
			needed: neededShare(plain),
			duplicated: neededShare(ablated.filter((draw) => draw.unit.duplicated)),
			tailSummary: neededShare(ablated.filter(isCompared)),
			unclear: plain.filter((draw) => draw.verdict === "unclear").length / plain.length,
			unstable: { k: drawn.filter((draw) => draw.fate === "unstable").length, n: drawn.length },
			fates,
			spend: armRecords.reduce((sum, record) => sum + record.spend, 0),
			...(control.length > 0 ? { control: { share: controlShare, trusted: controlShare.share >= TRUSTED } } : {}),
			...(nulls.length > 0 ? { falseNeeded: neededShare(nulls) } : {}),
		});
	}
	return summaries;
}

/** The Needed share of judged draws, with its interval; NaN share when there are none. */
function neededShare(draws: Draw[]): Share {
	const k = draws.filter((draw) => draw.verdict === "needed").length;
	const n = draws.length;
	return { k, n, share: k / n, ...wilson(k, n) };
}

/** A share as a percentage to a tenth; "-" when nothing was judged. */
export const percentLabel = (share: number) => (Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : "-");

/** How every Ablation report prints a Share: `k/n share [lower, upper]`. */
export const shareLabel = (share: Share) =>
	`${share.k}/${share.n} ${percentLabel(share.share)} [${percentLabel(share.lower)}, ${percentLabel(share.upper)}]`;

/** How every report prints a PPI Needed share: `share [lower, upper]`. */
export const estimateLabel = (estimate: PpiEstimate) =>
	`${percentLabel(estimate.share)} [${percentLabel(estimate.lower)}, ${percentLabel(estimate.upper)}]`;

// ---- calibration set (spec: "A calibration set is frozen per key")

/** A judged unit kept for `utilisation-calibration`: its Run's folder, its content, its Call's original next action, its verdict. */
export interface CalibrationUnit {
	arm: string;
	/** The basename of the Run's folder, under the set's `runs`: what finds the unit's Run, never its Arm and index. */
	folder: string;
	/** The Run's index in its Arm. */
	run: number;
	call: number;
	turn: number;
	unit: Draw["unit"];
	/** The unit's text as the model saw it. */
	content: string;
	original: Action;
	verdict: Verdict;
	/** Once calibrated, on a tail or summary unit judged Needed or not Needed: its Used verdict per cell, by `cellId`. */
	used?: Record<string, boolean>;
}

export interface CalibrationSet {
	key: CalibrationKey;
	/** The day the set was made, `YYYY-MM-DD`. */
	date: string;
	/** Judged ordinary units, every Arm's. */
	units: CalibrationUnit[];
	/** Judged null units, every Arm's. */
	nulls: CalibrationUnit[];
	/** The positive control over every Arm's judged control units. */
	control: { share: Share; trusted: boolean };
	/** The Run folders the units draw from, relative to the repository; absent on a set made before they were kept. */
	runs?: string;
	/** The chosen cell and its pooled κ, once calibrated; κ is null when no cell had one. */
	rule?: { s: number; k: number; kappa: number | null };
}

/** `bench/ablation/calibration.json`. */
export interface CalibrationFile {
	sets: CalibrationSet[];
}

/** A calibration's set under `key`, from its Runs' ablation records, their Journals' Turns and their folders' basenames. */
export function calibrationSet(
	key: CalibrationKey,
	runs: { record: AblationRecord; turns: JournalTurn[]; folder: string }[],
	date: string,
): CalibrationSet {
	const kept = (condition: Condition) =>
		runs.flatMap(({ record, turns, folder }) =>
			record.draws
				.filter((draw) => draw.condition === condition && draw.fate === "judged")
				.map(
					(draw): CalibrationUnit => ({
						arm: record.arm,
						folder,
						run: record.index,
						call: draw.call,
						turn: draw.turn,
						unit: draw.unit,
						content: unitContent(draw.unit, turns),
						original: draw.original,
						verdict: draw.verdict as Verdict,
					}),
				),
		);
	const share = neededShare(runs.flatMap(({ record }) => record.draws.filter((draw) => draw.condition === "control" && draw.fate === "judged")));
	return { key, date, units: kept("ablate"), nulls: kept("null"), control: { share, trusted: share.share >= TRUSTED } };
}
/**
 * `file` with `set` added; `file` itself, and why, when its key already has
 * a set or its positive control does not hold.
 */
export function addSet(file: CalibrationFile, set: CalibrationSet): { file: CalibrationFile; refused?: string } {
	const existing = setFor(file, set.key);
	if (existing) return { file, refused: `${keyLabel(set.key)} already has a calibration set, made ${existing.date}` };
	const { share, trusted } = set.control;
	if (share.n === 0) return { file, refused: "no positive-control unit was judged: the instrument is untested" };
	if (!trusted) {
		return { file, refused: `the positive control came out ${shareLabel(share)} Needed, below ${TRUSTED * 100}%: the instrument is not trusted` };
	}
	return { file: { sets: [...file.sets, set] } };
}

// ------------------------------------------------------- the request body --

/** A content block of an Anthropic Messages request, as far as a cut needs it. */
export interface BodyBlock {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	input?: unknown;
	tool_use_id?: string;
	content?: string | BodyBlock[];
	cache_control?: unknown;
	[field: string]: unknown;
}
export interface BodyMessage {
	role: string;
	content: string | BodyBlock[];
}
/** An Anthropic Messages request body. */
export interface RequestBody {
	system?: BodyBlock[];
	messages: BodyMessage[];
	tools?: BodyBlock[];
	[field: string]: unknown;
}

/** A content block by position: message `message`'s block `block`. */
export interface BlockRef {
	message: number;
	block: number;
}

/** Where a unit sits in a request: whole message blocks, or a span of one system block's text. */
export interface Location {
	blocks: BlockRef[];
	/** Opening and Pin: `[start, end)` of system block `block`'s text, a section separator included. */
	span?: { block: number; start: number; end: number };
}

const THINKING = new Set(["thinking", "redacted_thinking"]);
/** pi-chart's sections in its system block are joined by this (`SECTION_BREAK`, `renderPinned`). */
const BREAK = "\n\n";
/** The API takes at most this many cache breakpoints. */
const MAX_BREAKPOINTS = 4;
const BREAKPOINT = { type: "ephemeral", ttl: "1h" };

function blocksOf(message: BodyMessage): BodyBlock[] {
	return typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
}

/** A tool result's text: its string content, or its text blocks joined. */
function resultText(block: BodyBlock): string {
	if (typeof block.content === "string") return block.content;
	return (block.content ?? []).flatMap((part) => (part.type === "text" ? [part.text ?? ""] : [])).join("\n");
}

/** A block as text: what a unit counted alone holds, and what a duplicate is searched in. */
function blockText(block: BodyBlock): string {
	if (block.type === "text") return block.text ?? "";
	if (block.type === "tool_result") return resultText(block);
	if (block.type === "tool_use") return renderToolCall({ type: "toolCall", id: block.id ?? "", name: block.name ?? "", arguments: block.input });
	return "";
}

/** `[start, end)` of `section` in `text` with one adjoining separator, so the sections around it stay joined once. */
function sectionSpan(text: string, start: number, end: number): { start: number; end: number } {
	if (start >= BREAK.length && text.slice(start - BREAK.length, start) === BREAK) return { start: start - BREAK.length, end };
	if (text.slice(end, end + BREAK.length) === BREAK) return { start, end: end + BREAK.length };
	return { start, end };
}

/**
 * Where `unit` sits in `body`; undefined when it cannot be found.
 * - tool-call, pull: the `tool_use` with the Journal's call id, and the `tool_result` answering it;
 * - prose: the text block that is the Turn's prompt, and the assistant text blocks after it up to the next prompt;
 * - opening: the system section from `OPENING_FRAMING` up to the eviction notice or the block's end;
 * - pin: the system section `[pinned by the user: #<id>, …]` holding the Pin's text;
 * - summary: the text block holding the summary;
 * - turn: its prose and every tool call it made, each located as its own unit; unlocated when any is.
 */
export function locate(body: RequestBody, unit: Unit): Location | undefined {
	const messages = body.messages;
	const find = (test: (block: BodyBlock, message: BodyMessage) => boolean): BlockRef | undefined => {
		for (const [m, message] of messages.entries()) {
			const at = blocksOf(message).findIndex((block) => test(block, message));
			if (at !== -1) return { message: m, block: at };
		}
		return undefined;
	};
	switch (unit.kind) {
		case "tool-call":
		case "pull": {
			const call = find((block) => block.type === "tool_use" && block.id === unit.callId);
			const result = find((block) => block.type === "tool_result" && block.tool_use_id === unit.callId);
			return call && result ? { blocks: [call, result] } : undefined;
		}
		case "prose": {
			const prompt = find((block, message) => message.role === "user" && block.type === "text" && block.text === unit.text);
			if (!prompt) return undefined;
			const blocks = [prompt];
			for (let m = prompt.message + 1; m < messages.length; m++) {
				const message = messages[m] as BodyMessage;
				const content = blocksOf(message);
				if (message.role === "user" && content.some((block) => block.type === "text")) break;
				if (message.role !== "assistant") continue;
				for (const [b, block] of content.entries()) if (block.type === "text") blocks.push({ message: m, block: b });
			}
			return { blocks };
		}
		case "summary": {
			const at = find((block, message) => message.role === "user" && block.type === "text" && unit.text !== undefined && (block.text ?? "").includes(unit.text));
			return at ? { blocks: [at] } : undefined;
		}
		case "turn": {
			const parts = [
				locate(body, { kind: "prose", text: unit.text, tokens: 0 }),
				...(unit.callIds ?? []).map((callId) => locate(body, { kind: "tool-call", callId, tokens: 0 })),
			];
			if (parts.some((part) => part === undefined)) return undefined;
			const blocks = parts.flatMap((part) => (part as Location).blocks);
			blocks.sort((a, b) => a.message - b.message || a.block - b.block);
			return { blocks };
		}
		case "opening": {
			for (const [b, block] of (body.system ?? []).entries()) {
				const text = block.text ?? "";
				const start = text.indexOf(OPENING_FRAMING);
				if (start === -1) continue;
				const notice = text.indexOf(`${BREAK}${EVICTION_NOTICE}`, start);
				return { blocks: [], span: { block: b, ...sectionSpan(text, start, notice === -1 ? text.length : notice) } };
			}
			return undefined;
		}
		case "pin": {
			for (const [b, block] of (body.system ?? []).entries()) {
				const text = block.text ?? "";
				const start = text.indexOf(`[pinned by the user: #${unit.pin},`);
				if (start === -1) continue;
				const header = text.indexOf("\n", start);
				const end = header === -1 ? -1 : header + 1 + (unit.text ?? "").length;
				if (end === -1 || text.slice(header + 1, end) !== unit.text) return undefined;
				return { blocks: [], span: { block: b, ...sectionSpan(text, start, end) } };
			}
			return undefined;
		}
	}
}

/** The located unit's text, piece by piece: one per block, or the system span. */
function pieces(body: RequestBody, location: Location): string[] {
	if (location.span) {
		const { block, start, end } = location.span;
		return [(body.system?.[block]?.text ?? "").slice(start, end).trim()];
	}
	return location.blocks.map(({ message, block }) => blockText(blocksOf(body.messages[message] as BodyMessage)[block] as BodyBlock));
}

/**
 * The two requests whose counts differ by the unit alone (design §6), each
 * opened by a user message and carrying the request's model and tools.
 * - tool-call, pull: the unit's own messages as the body holds them, siblings
 *   kept and thinking left out, against the same messages without the unit,
 *   emptied ones dropped. A call beside another costs more than one alone in
 *   its message, so it is counted where it sits.
 * - any other unit: its blocks in their own messages, roles kept, against the
 *   same messages holding "." in each block, so the framing of the messages
 *   cancels and that of the blocks counts. A system span is one user message
 *   of its text.
 */
export function alone(body: RequestBody, location: Location, unit: Unit): { unit: RequestBody; placeholder: RequestBody } {
	const dot = (): BodyBlock => ({ type: "text", text: "." });
	const bare = (block: BodyBlock): BodyBlock => {
		const { cache_control: _, ...copy } = structuredClone(block);
		return copy;
	};
	const request = (messages: BodyMessage[]): RequestBody => ({ model: body.model, ...(body.tools ? { tools: body.tools } : {}), messages });
	if (unit.kind === "tool-call" || unit.kind === "pull") {
		const own = [...new Set(location.blocks.map((ref) => ref.message))].sort((a, b) => a - b);
		const held = (withUnit: boolean): BodyMessage[] => [
			{ role: "user", content: [dot()] },
			...own.flatMap((m) => {
				const message = body.messages[m] as BodyMessage;
				const content = blocksOf(message).flatMap((block, b) =>
					THINKING.has(block.type) || (!withUnit && inUnit(location, m, b)) ? [] : [bare(block)],
				);
				return content.length > 0 ? [{ role: message.role, content }] : [];
			}),
		];
		return { unit: request(held(true)), placeholder: request(held(false)) };
	}
	const messages: BodyMessage[] = [];
	if (location.span) messages.push({ role: "user", content: [{ type: "text", text: pieces(body, location)[0] ?? "" }] });
	let from = -1;
	for (const { message, block } of location.blocks) {
		const source = body.messages[message] as BodyMessage;
		const copy = bare(blocksOf(source)[block] as BodyBlock);
		if (message === from) (messages.at(-1)?.content as BodyBlock[]).push(copy);
		else messages.push({ role: source.role, content: [copy] });
		from = message;
	}
	if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: [dot()] });
	return {
		unit: request(messages),
		placeholder: request(messages.map(({ role, content }) => ({ role, content: (content as BodyBlock[]).map(dot) }))),
	};
}

/** How the record names a location: `system[4][120:860]`, or `messages[3][1] messages[4][0]`. */
export function locationLabel(location: Location): string {
	if (location.span) return `system[${location.span.block}][${location.span.start}:${location.span.end}]`;
	return location.blocks.map(({ message, block }) => `messages[${message}][${block}]`).join(" ");
}

/**
 * Whether the unit's whole text occurs again in the request outside it.
 * A tool-call group or Pull result is its result's text; any other unit is
 * every piece of its text.
 */
export function duplicated(body: RequestBody, location: Location, unit: Unit): boolean {
	const all = pieces(body, location);
	const wanted = (unit.kind === "tool-call" || unit.kind === "pull" ? all.slice(1) : all).filter((piece) => piece !== "");
	if (wanted.length === 0) return false;
	const outside = removed(body, location);
	const texts = [
		...(outside.system ?? []).map((block) => block.text ?? ""),
		...outside.messages.flatMap((message) => blocksOf(message).map(blockText)),
	];
	return wanted.every((piece) => texts.some((text) => text.includes(piece)));
}

/** Where a block sits in send order: tools, then system blocks, then message blocks. */
type Slot = { list: "tools" | "system"; index: number } | { list: "messages"; message: number; block: number };

function slots(body: RequestBody): Slot[] {
	return [
		...(body.tools ?? []).map((_, index) => ({ list: "tools" as const, index })),
		...(body.system ?? []).map((_, index) => ({ list: "system" as const, index })),
		...body.messages.flatMap((message, m) => blocksOf(message).map((_, block) => ({ list: "messages" as const, message: m, block }))),
	];
}

/** The block at `at`; none for a string-content message, which has no block to carry a breakpoint. */
function blockAt(body: RequestBody, at: Slot): BodyBlock | undefined {
	if (at.list !== "messages") return at.list === "tools" ? body.tools?.[at.index] : body.system?.[at.index];
	const content = body.messages[at.message]?.content;
	return Array.isArray(content) ? content[at.block] : undefined;
}

function sameSlot(a: Slot, b: Slot): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A copy of `body` with the breakpoints a sham and its cut share: the
 * existing ones outside the unit, plus one on the last block before the
 * unit that can carry one, the earliest dropped while there are more than
 * the API takes.
 */
function withBreakpoints(body: RequestBody, location: Location): RequestBody {
	const copy = structuredClone(body);
	const all = slots(copy);
	const first: Slot = location.span
		? { list: "system", index: location.span.block }
		: { list: "messages", ...(location.blocks[0] as BlockRef) };
	const unitAt = all.findIndex((at) => sameSlot(at, first));
	const inside = (at: Slot) => at.list === "messages" && inUnit(location, at.message, at.block);
	// Thinking blocks may not carry a breakpoint.
	const carries = (at: Slot) => {
		const block = blockAt(copy, at);
		return block !== undefined && !THINKING.has(block.type);
	};
	const anchor = all.slice(0, unitAt).findLast(carries);
	const kept = all.filter((at) => !inside(at) && blockAt(copy, at)?.cache_control !== undefined);
	for (const at of all) {
		const block = blockAt(copy, at);
		if (block) delete block.cache_control;
	}
	const marks = anchor && !kept.some((at) => sameSlot(at, anchor)) ? [...kept, anchor] : kept;
	marks.sort((a, b) => all.findIndex((at) => sameSlot(at, a)) - all.findIndex((at) => sameSlot(at, b)));
	const original = new Map(kept.map((at) => [JSON.stringify(at), blockAt(body, at)?.cache_control]));
	while (marks.length > MAX_BREAKPOINTS) {
		const earliest = marks.findIndex((at) => !anchor || !sameSlot(at, anchor));
		marks.splice(earliest, 1);
	}
	for (const at of marks) {
		const block = blockAt(copy, at) as BodyBlock;
		block.cache_control = original.get(JSON.stringify(at)) ?? BREAKPOINT;
	}
	return copy;
}

function inUnit(location: Location, message: number, block: number): boolean {
	return location.blocks.some((ref) => ref.message === message && ref.block === block);
}

/** `body` without the message blocks `gone` names; a message left empty, or with only thinking, is dropped. */
function without(body: RequestBody, gone: (message: number, block: number) => boolean): RequestBody {
	const copy = structuredClone(body);
	copy.messages = copy.messages.flatMap((message, m) => {
		const all = blocksOf(message);
		const content = all.filter((_, b) => !gone(m, b));
		if (content.length === all.length) return [message];
		if (content.length === 0 || content.every((block) => THINKING.has(block.type))) return [];
		return [{ ...message, content }];
	});
	return copy;
}

/** `body` without the located unit: emptied messages, and assistant messages left with only thinking, dropped. */
function removed(body: RequestBody, location: Location): RequestBody {
	if (!location.span) return without(body, (m, b) => inUnit(location, m, b));
	const copy = structuredClone(body);
	const { block, start, end } = location.span;
	const target = copy.system?.[block] as BodyBlock;
	target.text = (target.text ?? "").slice(0, start) + (target.text ?? "").slice(end);
	if (target.text === "") copy.system?.splice(block, 1);
	return copy;
}

/**
 * The thinking a sham and its cut both lose. The server drops every signed
 * thinking block after a change to the request's prefix, so the cut loses it
 * whatever we send; the sham loses it too, so the two differ by the unit
 * alone. For a unit in the system prompt that is all thinking in the
 * messages; for a unit in the messages, every thinking block after the
 * unit's first block, and those of each message the cut leaves with only
 * thinking.
 */
function lostThinking(body: RequestBody, location: Location): (message: number, block: number) => boolean {
	const thinking = (m: number, b: number) => THINKING.has((blocksOf(body.messages[m] as BodyMessage)[b] as BodyBlock).type);
	if (location.span) return thinking;
	const first = location.blocks.reduce((a, b) => (b.message < a.message || (b.message === a.message && b.block < a.block) ? b : a));
	const emptied = new Set(
		[...new Set(location.blocks.map((ref) => ref.message))].filter((m) =>
			blocksOf(body.messages[m] as BodyMessage).every((block, b) => inUnit(location, m, b) || THINKING.has(block.type)),
		),
	);
	return (m, b) => thinking(m, b) && (emptied.has(m) || m > first.message || (m === first.message && b > first.block));
}

/** What a cut takes from the messages: the lost thinking, and the unit when it sits there. */
function cutFromMessages(body: RequestBody, location: Location): (message: number, block: number) => boolean {
	const lost = lostThinking(body, location);
	return location.span ? lost : (m, b) => lost(m, b) || inUnit(location, m, b);
}

/**
 * The system messages (omp's mid-conversation reminders) that taking `gone`
 * would leave after anything but a user message or an assistant message
 * ending in a server tool result. The API refuses those, so a cut drops
 * them, and its sham drops them too.
 */
function orphanedSystem(body: RequestBody, gone: (message: number, block: number) => boolean): Set<number> {
	const orphans = new Set<number>();
	let previous: { role: string; last?: string } | undefined;
	for (const [m, message] of body.messages.entries()) {
		const kept = blocksOf(message).filter((_, b) => !gone(m, b));
		if (kept.length === 0 || kept.every((block) => THINKING.has(block.type))) continue;
		const follows = previous?.role === "user" || (previous?.role === "assistant" && previous.last?.endsWith("_tool_result") === true);
		if (message.role === "system" && !follows) {
			orphans.add(m);
			continue;
		}
		previous = { role: message.role, last: kept.at(-1)?.type };
	}
	return orphans;
}

/** The request with the unit cut, carrying the sham's breakpoints and losing its thinking. The freed space is not refilled. */
export function cut(body: RequestBody, location: Location): RequestBody {
	const gone = cutFromMessages(body, location);
	const orphans = orphanedSystem(body, gone);
	const marked = withBreakpoints(body, location);
	return without(location.span ? removed(marked, location) : marked, (m, b) => gone(m, b) || orphans.has(m));
}

/** The request with nothing removed but what the cut loses besides the unit, carrying the cut's breakpoints. */
export function sham(body: RequestBody, location: Location): RequestBody {
	const lost = lostThinking(body, location);
	const orphans = orphanedSystem(body, cutFromMessages(body, location));
	return without(withBreakpoints(body, location), (m, b) => lost(m, b) || orphans.has(m));
}
