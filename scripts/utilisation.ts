/**
 * Utilisation, pure: which tail and summary units of a main Call's Context
 * Window its next action Used, by lexical signals alone, and their share of
 * the window's judged tokens (`openspec/changes/archive/2026-10-17-utilisation/design.md`
 * §2–§9). Uncalibrated: Used is never Needed.
 */
import type { Compaction, JournalTurn, MessageAddress } from "../src/journal.ts";
import { isToolCall, messageText, type HarnessMessage } from "../src/messages.ts";
import type { KnownWindow, Window } from "./measures.ts";
import { deviceCall, sentLines, targetOf, type ToolCallLike, type Unit, unitContent, unitsOf, withoutSelector } from "./units.ts";

/** The unit kinds Utilisation judges: the tail and the summary, never the Opening, a Pin or the Call's own Turn. */
export type JudgedKind = "tool-call" | "pull" | "prose" | "summary";
export const JUDGED_KINDS: readonly JudgedKind[] = ["tool-call", "pull", "prose", "summary"];

/** How a report names each judged kind. */
export const KIND_LABEL: Record<JudgedKind, string> = {
	"tool-call": "tool-call group",
	pull: "Pull result",
	prose: "prose",
	summary: "summary",
};

/** Whether an Arm can hold a kind at all: Pull results are pi-chart's alone, a summary plain omp's. */
export function armHolds(arm: string, kind: JudgedKind): boolean {
	if (kind === "pull") return arm === "pi-chart";
	if (kind === "summary") return arm !== "pi-chart";
	return true;
}

/** What every report showing Utilisation states under it. */
export const CAVEATS = [
	"Utilisation is lexical and uncalibrated: Used is not Needed.",
	"Earlier tool results of a Call's own Turn are never measured.",
	"Items found in the system prompt outside the Opening and Pins are not excluded; the record does not hold that text.",
];

/** Estimated tokens: those judged, and those of them Used. */
export interface Tally {
	used: number;
	judged: number;
}

/** The share of judged tokens Used; NaN when none were judged, which reports show as no figure. */
export function share({ used, judged }: Tally): number {
	return used / judged;
}

/** One measured Call: in total, and per kind it judged any tokens of. */
export interface CallUtilisation extends Tally {
	byKind: Partial<Record<JudgedKind, Tally>>;
}

/** A Run's sums over its measured Calls, and how many Calls were measured, held nothing to judge, or had an unknown window. */
export interface RunUtilisation extends Tally {
	byKind: Record<JudgedKind, Tally>;
	calls: { measured: number; empty: number; unknown: number };
}

/** The Used rule's parameters: the copied-span length *s* and the rare items *k* a unit must share. */
export interface Rule {
	s: number;
	k: number;
}

export const DEFAULT_RULE: Rule = { s: 8, k: 2 };

/** An item is rare when fewer than this share of the Run's distinct judged units hold it. */
export const RARE = 0.05;

/** A main Call to measure: its assistant message, and its window as `measureRun` gives it. */
export interface MeasuredCall {
	address: MessageAddress;
	window: Window;
}

/** A Call's next action, as the signals read it. */
interface NextAction {
	/** Its tokens in order. */
	tokens: string[];
	/** Its items: code-shaped identifiers, numbers and string literals, each argument string among them. */
	items: Set<string>;
	/** The paths its target names, relative to the working directory. */
	paths: string[];
}

/** A Call with something to judge: its units, by identity, and its next action. */
interface Judging {
	address: MessageAddress;
	window: KnownWindow;
	units: { id: string; unit: Unit }[];
	action: NextAction;
}

/** Whether `item` is excluded for the Call at `address` with `window`. */
type Excluded = (item: string, address: MessageAddress, window: KnownWindow) => boolean;

/** The Run's lookups over its distinct judged units, built once and shared by every Call. */
interface RunIndex {
	/** The units holding each `s`-token span some action holds. */
	byGram: Map<string, Set<string>>;
	/** The units holding each item some action holds. */
	byItem: Map<string, Set<string>>;
	/** Each unit's text, for the path signal. */
	texts: Map<string, string>;
	rare: (item: string) => boolean;
	excluded: Excluded;
}

/**
 * Each Call's Utilisation, in `calls` order: its figures, `"empty"` when its
 * window held no judged unit, `"unknown"` when its window is unknown; and the
 * Run's sums over the measured Calls. `pins` is `pinTexts`; `cwd` the Run's
 * working directory, which the path signal compares relative to.
 */
export function utilisationOf(
	turns: JournalTurn[],
	calls: MeasuredCall[],
	compactions: Compaction[],
	pins: Map<number, string>,
	cwd: string,
	rule: Rule = DEFAULT_RULE,
): { calls: (CallUtilisation | "empty" | "unknown")[]; run: RunUtilisation } {
	const run: RunUtilisation = {
		used: 0,
		judged: 0,
		byKind: { "tool-call": tally(), pull: tally(), prose: tally(), summary: tally() },
		calls: { measured: 0, empty: 0, unknown: 0 },
	};

	// Each Call's judged units and next action; the Run's distinct units by identity.
	const distinct = new Map<string, Unit>();
	const judging: (Judging | "empty" | "unknown")[] = [];
	for (const { address, window } of calls) {
		if (window === "unknown") {
			judging.push("unknown");
			continue;
		}
		const units = unitsOf(turns, address, window, compactions, pins)
			.filter((unit) => (JUDGED_KINDS as readonly string[]).includes(unit.kind))
			.map((unit) => ({ id: identity(unit, window), unit }));
		if (units.length === 0) {
			judging.push("empty");
			continue;
		}
		for (const { id, unit } of units) distinct.set(id, unit);
		judging.push({ address, window, units, action: nextAction(turns[address.turn]?.messages[address.message], cwd) });
	}

	// The two indexes, over the distinct units, restricted to what some action can look up (design §7).
	const actions = judging.flatMap((each) => (typeof each === "string" ? [] : [each.action]));
	const wantedGrams = new Set(actions.flatMap((action) => grams(action.tokens, rule.s)));
	const wantedItems = new Set(actions.flatMap((action) => [...action.items]));
	const index: RunIndex = {
		byGram: new Map(),
		byItem: new Map(),
		texts: new Map(),
		rare: (item) => (index.byItem.get(item)?.size ?? 0) < RARE * distinct.size,
		excluded: exclusions(turns, pins),
	};
	for (const [id, unit] of distinct) {
		const text = unitContent(unit, turns);
		index.texts.set(id, text);
		for (const gram of grams(tokensOf(text), rule.s)) if (wantedGrams.has(gram)) add(index.byGram, gram, id);
		for (const item of itemsOf(text)) if (wantedItems.has(item)) add(index.byItem, item, id);
	}

	const figures: (CallUtilisation | "empty" | "unknown")[] = [];
	for (const each of judging) {
		if (typeof each === "string") {
			run.calls[each]++;
			figures.push(each);
			continue;
		}
		run.calls.measured++;
		const used = usedBy(each, rule, index);
		const figure: CallUtilisation = { ...tally(), byKind: {} };
		for (const { id, unit } of each.units) {
			const kind = unit.kind as JudgedKind;
			for (const into of [figure, (figure.byKind[kind] ??= tally()), run, run.byKind[kind]]) {
				into.judged += unit.tokens;
				if (used.has(id)) into.used += unit.tokens;
			}
		}
		figures.push(figure);
	}
	return { calls: figures, run };
}

const tally = (): Tally => ({ used: 0, judged: 0 });

function add(index: Map<string, Set<string>>, key: string, id: string): void {
	const ids = index.get(key);
	if (ids) ids.add(id);
	else index.set(key, new Set([id]));
}

/** A unit's identity across the Run's Calls: a tool call by Turn and id, prose by Turn, the summary by its compaction. */
function identity(unit: Unit, window: KnownWindow): string {
	if (unit.kind === "summary") return `summary ${window.summary}`;
	if (unit.kind === "prose") return `prose ${unit.turn}`;
	return `call ${unit.turn} ${unit.callId}`;
}

/** The ids of the Call's units that any signal makes Used. */
function usedBy(judging: Judging, rule: Rule, { byGram, byItem, texts, rare, excluded }: RunIndex): Set<string> {
	const { action, units, address, window } = judging;
	const mine = new Set(units.map((each) => each.id));
	const used = new Set<string>();
	// Copied span.
	for (const gram of grams(action.tokens, rule.s)) {
		for (const id of byGram.get(gram) ?? []) if (mine.has(id)) used.add(id);
	}
	// Rare identifiers.
	const shared = new Map<string, number>();
	for (const item of action.items) {
		if (!rare(item) || excluded(item, address, window)) continue;
		for (const id of byItem.get(item) ?? []) if (mine.has(id)) shared.set(id, (shared.get(id) ?? 0) + 1);
	}
	for (const [id, count] of shared) if (count >= rule.k) used.add(id);
	// Path.
	for (const id of mine) {
		if (used.has(id)) continue;
		const text = texts.get(id) ?? "";
		if (action.paths.some((path) => mentions(text, path))) used.add(id);
	}
	return used;
}

// ---- the next action (design §5)

/**
 * The next action of the reply `message`: its first tool call's argument
 * values, a device call's parsed content standing for its arguments, and that
 * call's target paths; else its visible text. Thinking is never read.
 */
function nextAction(message: HarnessMessage | undefined, cwd: string): NextAction {
	const content = Array.isArray(message?.content) ? message.content : [];
	const first = content.find(isToolCall);
	if (!first) {
		const text = message ? messageText(message) : "";
		return { tokens: tokensOf(text), items: itemsOf(text), paths: [] };
	}
	const values = leaves((deviceCall(first) ?? first).arguments);
	const text = values.join("\n");
	const items = itemsOf(text);
	for (const value of values) if (value.trim()) items.add(value);
	return { tokens: tokensOf(text), items, paths: pathsOf(first, cwd) };
}

/** Every string and number in `value`, however deeply nested, as text; keys left out. */
function leaves(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (typeof value === "number") return [String(value)];
	if (Array.isArray(value)) return value.flatMap(leaves);
	if (value && typeof value === "object") return Object.values(value).flatMap(leaves);
	return [];
}

/** A glob's wildcards: a grep's or glob's path holding one is a pattern, not a path. */
const WILDCARD = /[*?[\]{}]/;

/**
 * The paths the call's target names, relative to `cwd`: a `read`'s or
 * `write`'s, each file an `edit` names, a `grep`'s or `glob`'s path without
 * its line selector. The working directory itself, `.` and a glob pattern
 * name none.
 */
function pathsOf(call: ToolCallLike, cwd: string): string[] {
	const { tool, target } = targetOf(call);
	if (target === undefined) return [];
	let named: string[];
	switch (tool) {
		case "read":
		case "write":
			named = [target];
			break;
		case "edit":
			named = target.split("\n");
			break;
		case "grep":
		case "glob": {
			const path = (JSON.parse(target) as [string | null, string | null])[1];
			named = path === null ? [] : path.split(";").map((each) => withoutSelector(each.trim())).filter((each) => !WILDCARD.test(each));
			break;
		}
		default:
			return [];
	}
	return named.map((path) => relativeToCwd(path.trim(), cwd)).filter((path) => path !== "" && path !== ".");
}

/** `path` with `cwd/` and any leading `./` dropped; `cwd` itself becomes empty. */
function relativeToCwd(path: string, cwd: string): string {
	let out = path === cwd ? "" : path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
	while (out.startsWith("./")) out = out.slice(2);
	return out.replace(/\/+$/, "");
}

/** Whether `text` names `path` where it is no part of a longer name; a `/` may precede it, so an absolute mention counts. */
function mentions(text: string, path: string): boolean {
	for (let at = text.indexOf(path); at !== -1; at = text.indexOf(path, at + 1)) {
		const before = text[at - 1];
		const after = text[at + path.length];
		const next = text[at + path.length + 1];
		if (before !== undefined && /[\w.-]/.test(before)) continue;
		if (after !== undefined && /[\w-]/.test(after)) continue;
		// A full stop after the path ends a sentence; one followed by a name character extends the name.
		if (after === "." && next !== undefined && /\w/.test(next)) continue;
		return true;
	}
	return false;
}

// ---- lexical units (design §6)

const TOKEN = /[\p{L}\p{N}_]+/gu;
const NUMBER = /^\p{N}+$/u;
/** A code-shaped identifier: a letter or underscore first, then an underscore, a digit or a capital. */
const CODE_SHAPED = /^[\p{L}_][\p{L}\p{N}_]*[_\p{N}\p{Lu}]/u;
const LITERALS = [/"([^"\n]+)"/g, /`([^`\n]+)`/g, /(?<![\p{L}\p{N}])'([^'\n]+)'(?![\p{L}\p{N}])/gu];

function tokensOf(text: string): string[] {
	return text.match(TOKEN) ?? [];
}

/** The `s`-token spans of `tokens`, each joined by NUL. */
function grams(tokens: string[], s: number): string[] {
	const out: string[] = [];
	for (let at = 0; at + s <= tokens.length; at++) out.push(tokens.slice(at, at + s).join("\u0000"));
	return out;
}

/** The items of `text`: code-shaped identifiers, numbers, and the contents of quoted string literals on one line. */
function itemsOf(text: string): Set<string> {
	const items = new Set<string>();
	for (const token of tokensOf(text)) if (NUMBER.test(token) || CODE_SHAPED.test(token)) items.add(token);
	for (const literal of LITERALS) {
		for (const match of text.matchAll(literal)) {
			const inner = match[1] as string;
			if (inner.trim()) items.add(inner);
		}
	}
	return items;
}

// ---- exclusions (design §8)

/**
 * Whether `item` is excluded for the Call at `address`: found in what its own
 * Turn sent before it, in the Opening it carried, or in a Pin it carried.
 * Each message's items are found once and kept.
 */
function exclusions(turns: JournalTurn[], pins: Map<number, string>): Excluded {
	const messageItems = new Map<HarnessMessage, Set<string>>();
	const textItems = new Map<string, Set<string>>();
	const ofMessage = (message: HarnessMessage) => {
		let items = messageItems.get(message);
		if (!items) {
			items = itemsOf(sentLines(message, true).join("\n"));
			messageItems.set(message, items);
		}
		return items;
	};
	const ofText = (text: string) => {
		let items = textItems.get(text);
		if (!items) {
			items = itemsOf(text);
			textItems.set(text, items);
		}
		return items;
	};
	return (item, address, window) => {
		const own = turns[address.turn]?.messages.slice(0, address.message) ?? [];
		if (own.some((message) => ofMessage(message).has(item))) return true;
		const opening = window.opening === undefined ? undefined : turns[window.opening]?.prompt;
		if (opening !== undefined && ofText(opening).has(item)) return true;
		return window.pins.some((pin) => {
			const text = pins.get(pin);
			return text !== undefined && ofText(text).has(item);
		});
	};
}
