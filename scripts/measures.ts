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
import { pinTexts } from "../src/pins.ts";
import { approximateTokens } from "../src/tokens.ts";
import type { Plant, PlantKind, Turn, WorkloadId } from "./workload.ts";

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
	/** As declared; one recorded before Plants had kinds has none, and is a literal. */
	plants: (Omit<Plant, "kind"> & { kind?: PlantKind })[];
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

/** The tools that bring content into the window because the agent asked; pi-chart's only. */
export const PULL_TOOLS = [
	"recall_earlier_turns",
	"recall_across_conversations",
	"search_documentation",
	"walk_documentation",
	"codebase_structure",
] as const;
export type PullTool = (typeof PULL_TOOLS)[number];

/** Whether the window of the Call that pulled is known to have let go of what came back. */
export type RecallClass = "recall" | "unknown";

/** A Pull whose result held a Turn of the Run's own Conversation the window did not carry, or may not have. */
export interface RecallPull {
	turn: number;
	/** The Call that made the tool call, by its index in the Turn. */
	call: number;
	tool: PullTool;
	/** To the nearest such Turn; absent when the record names no Turn. */
	distance?: number;
	class: RecallClass;
}

/** Where a Plant sat in the window of its Probe's first Call. */
export type Position = "opening" | "pin" | "tail" | "summary" | "evicted" | "unplanted" | "unknown";
/** What held the Plant's value for the Probe's answer, searched window first. */
export type Source = "opening" | "pin" | "tail" | "summary" | "pull" | "result" | "none" | "unknown";
/**
 * Leak: right with nothing behind it. Despite: wrong with a source. Lapse:
 * wrong, evicted, unrecovered. Unknown: wrong where the window cannot tell.
 * Unplanted: wrong, and the Plant never entered the Conversation.
 */
export type ScoreClass = "leak" | "despite" | "lapse" | "unknown" | "unplanted";

/** One Plant scored at one Probe Turn. */
export interface Score {
	id: string;
	turn: number;
	kind: PlantKind;
	right: boolean;
	/** The Turn the value first entered by prompt or tool result; absent when unplanted. */
	planted?: number;
	distance?: number;
	position: Position;
	source: Source;
	/** Which Pull tool, when the source is a Pull. */
	pull?: PullTool;
	/** Absent when right with a source. */
	class?: ScoreClass;
	/** Superseded only: the reply gave the earlier value. */
	stale?: true;
	/** The Probe forbade tools and the Turn called one. */
	breach?: true;
	/** The Probe forbade tools. */
	tools?: false;
}

/** One key per Plant per Probe Turn, shared by a score and its Retention. */
export function probeKey(probe: { id: string; turn: number }): string {
	return `${probe.id}@${probe.turn}`;
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
	plants: Score[];
	/** Failed-Probe Lapses and failed Probes unknown, by distance band; zeros when none. */
	probe: { lapse: Banded; unknown: Banded };
	/** Every Re-fetch of the main Journal, in order. */
	refetches: Refetch[];
	/** Re-fetches per class by distance band; Lapses are `left`. */
	refetch: Record<RefetchClass, Banded>;
	/** Compactions on the branch; absent on pi-chart, which suppresses compaction. */
	compactions?: number;
	/** Calls and estimated tokens returned per Pull tool, in the main Journal; pi-chart only. */
	pulls?: Record<PullTool, { calls: number; tokens: number }>;
	/** `write_documentation` calls: they add nothing to the window and are not Pulls; pi-chart only. */
	writes?: number;
	/** Every recall Pull of the main Journal, in order; pi-chart only. */
	recalls?: RecallPull[];
	/** Recall Pulls per class by distance band: Lapses recovered, never added to Re-fetches; pi-chart only. */
	recall?: Record<RecallClass, Banded>;
}

export async function readRecord(dir: string): Promise<RunRecord> {
	return JSON.parse(await readFile(join(dir, "run.json"), "utf8")) as RunRecord;
}

/** Every Measure of the Run recorded in `dir`. */
export async function measureRun(dir: string): Promise<RunMeasures> {
	const record = await readRecord(dir);
	const { turns, compactions, entries } = await readBranch(join(dir, "journal.jsonl"));
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

	const plants = scoresOf(record, turns, completed, windowAt, compactions, pinTexts(entries));
	const probeBanded = (kind: ScoreClass) =>
		band(plants.filter((score) => score.class === kind).map((score) => score.distance));

	const refetches = refetchesOf(turns, windowAt);
	const banded = (kind: RefetchClass) =>
		band(refetches.filter((refetch) => refetch.class === kind).map((refetch) => refetch.distance));

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
		probe: { lapse: probeBanded("lapse"), unknown: probeBanded("unknown") },
		refetches,
		refetch: { held: banded("held"), left: banded("left"), unknown: banded("unknown") },
		...(record.arm === "pi-chart" ? pullsOf(turns, windowAt, record.sessionId) : { compactions: compactions.length }),
	};
}

/**
 * One Score per Plant per Probe Turn below `completed`. Where the Plant
 * entered, and where its Probe's first Call held it, come from the Journal
 * and that Call's window, never from the declaration, so old records score.
 */
function scoresOf(
	record: RunRecord,
	turns: JournalTurn[],
	completed: number,
	windowAt: (at: MessageAddress, call: number) => Window,
	compactions: Compaction[],
	pins: Map<number, string>,
): Score[] {
	const scores: Score[] = [];
	for (const [turn, prompt] of record.prompts.entries()) {
		if (turn >= completed || prompt.probes.length === 0) continue;
		const messages = turns[turn]?.messages ?? [];
		const first = messages.findIndex((message) => message.role === "assistant" && message.usage);
		const window = first === -1 ? "unknown" : windowAt({ turn, message: first }, turns[turn]?.calls[first] ?? 0);
		const replyAt = messages.findLastIndex((message) => message.role === "assistant");
		const reply = replyAt === -1 ? "" : messageText(messages[replyAt] as HarnessMessage);
		const breach =
			prompt.tools === false &&
			messages.some((message) => message.role === "assistant" && toolCalls(message).length > 0);
		const summaryOf = (id: string | undefined) => compactions.find((compaction) => compaction.id === id)?.summary;

		for (const id of prompt.probes) {
			const plant = record.plants.find((known) => known.id === id);
			const kind = plant?.kind ?? "literal";
			const value = plant?.value;
			const { right, stale, scoredAt } = answerOf(plant, messages, reply, replyAt);

			const planted = value === undefined ? undefined : plantedAt(turns, value, turn);
			const inPin =
				window !== "unknown" && value !== undefined && window.pins.some((pin) => pins.get(pin)?.includes(value));
			const inSummary =
				window !== "unknown" && value !== undefined && summaryOf(window.summary)?.includes(value) === true;

			let position: Position;
			if (!planted) position = "unplanted";
			else if (window === "unknown") position = "unknown";
			else if (window.opening === planted.turn && planted.message === 0) position = "opening";
			else if (inPin) position = "pin";
			else if (inTail(window, planted)) position = window.tail.partial ? "unknown" : "tail";
			else if (inSummary) position = "summary";
			else position = "evicted";

			let source: Source = "none";
			let pull: PullTool | undefined;
			if (window === "unknown") source = "unknown";
			else if (value !== undefined) {
				const held = (message: HarnessMessage) => holds(message, value);
				const tailHolds = window.tail.turns.some((at) =>
					(turns[at]?.messages ?? []).some((message, index) => inTail(window, { turn: at, message: index }) && held(message)),
				);
				const results = messages.slice(0, Math.max(scoredAt, 0)).filter(
					(message) => message.role === "toolResult" && held(message),
				);
				const pulled = results.flatMap((message) => PULL_TOOLS.find((tool) => tool === message.toolName) ?? []);
				if (window.opening !== undefined && turns[window.opening]?.prompt.includes(value)) source = "opening";
				else if (inPin) source = "pin";
				else if (tailHolds) source = window.tail.partial ? "unknown" : "tail";
				else if (inSummary) source = "summary";
				else if (pulled.length > 0) {
					source = "pull";
					pull = pulled[0];
				} else if (results.length > 0) source = "result";
			}

			const scoreClass = classOf(right, position, source);
			scores.push({
				id,
				turn,
				kind,
				right,
				...(planted ? { planted: planted.turn, distance: turn - planted.turn } : {}),
				position,
				source,
				...(pull ? { pull } : {}),
				...(scoreClass ? { class: scoreClass } : {}),
				...(stale ? { stale: true as const } : {}),
				...(breach ? { breach: true as const } : {}),
				...(prompt.tools === false ? { tools: false as const } : {}),
			});
		}
	}
	return scores;
}

/**
 * Whether the Probe Turn answered `plant` right, and the message that
 * answered: the final reply, or a right constraint's first tool call
 * obeying it. An undeclared Plant is wrong.
 */
function answerOf(
	plant: RunRecord["plants"][number] | undefined,
	messages: HarnessMessage[],
	reply: string,
	replyAt: number,
): { right: boolean; stale: boolean; scoredAt: number } {
	const value = plant?.value;
	if (value === undefined) return { right: false, stale: false, scoredAt: replyAt };
	if (plant?.kind === "constraint") {
		const obeyed = messages.findIndex(
			(message) =>
				message.role === "assistant" &&
				toolCalls(message).some((call) => stringLeaves(call.arguments).some((leaf) => leaf.includes(value))),
		);
		return { right: obeyed !== -1, stale: false, scoredAt: obeyed === -1 ? replyAt : obeyed };
	}
	const stale = plant?.kind === "superseded" && plant.earlier !== undefined && reply.includes(plant.earlier);
	return { right: reply.includes(value) && !stale, stale, scoredAt: replyAt };
}

/** A score's class from its result, position and source; none when right with a source. */
function classOf(right: boolean, position: Position, source: Source): ScoreClass | undefined {
	if (right) return source === "none" ? "leak" : undefined;
	if (position === "unplanted") return "unplanted";
	if (source === "unknown") return "unknown";
	if (source === "none") return position === "evicted" ? "lapse" : "unknown";
	return "despite";
}

/**
 * Where `value` first entered the Conversation before Turn `before`: a
 * prompt or a tool result holding it. An assistant message only echoes.
 */
function plantedAt(turns: JournalTurn[], value: string, before: number): MessageAddress | undefined {
	for (const turn of turns.slice(0, before)) {
		const message = turn.messages.findIndex(
			(message, index) => (index === 0 || message.role === "toolResult") && messageText(message).includes(value),
		);
		if (message !== -1) return { turn: turn.turnIndex, message };
	}
	return undefined;
}

/** Whether a message's text, or a string anywhere in its tool calls' arguments, holds `value`. */
function holds(message: HarnessMessage, value: string): boolean {
	return (
		messageText(message).includes(value) ||
		toolCalls(message).some((call) => stringLeaves(call.arguments).some((leaf) => leaf.includes(value)))
	);
}

function toolCalls(message: HarnessMessage) {
	return Array.isArray(message.content) ? message.content.filter(isToolCall) : [];
}

/** Every string in `value`, however deeply nested; matched as is, so escaping cannot hide one. */
function stringLeaves(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(stringLeaves);
	if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves);
	return [];
}

/** A count of `distances` in total and per band; an absent distance counts in the total only. */
function band(distances: (number | undefined)[]): Banded {
	return {
		total: distances.length,
		bands: BANDS.map(
			([low, high]) => distances.filter((distance) => distance !== undefined && distance >= low && distance <= high).length,
		),
	};
}

/**
 * The Pulls of the main Journal, and which of them recovered a Turn of the
 * Run's own Conversation, `own`, that the pulling Call's window had let go.
 */
function pullsOf(
	turns: JournalTurn[],
	windowAt: (at: MessageAddress, call: number) => Window,
	own: string | undefined,
): Pick<RunMeasures, "pulls" | "writes" | "recalls" | "recall"> {
	const pulls = Object.fromEntries(PULL_TOOLS.map((tool) => [tool, { calls: 0, tokens: 0 }])) as Record<
		PullTool,
		{ calls: number; tokens: number }
	>;
	let writes = 0;
	const recalls: RecallPull[] = [];
	for (const turn of turns) {
		for (const [index, message] of turn.messages.entries()) {
			if (message.role !== "toolResult") continue;
			if (message.toolName === "write_documentation") writes++;
			const tool = PULL_TOOLS.find((name) => name === message.toolName);
			if (!tool) continue;
			pulls[tool].calls++;
			pulls[tool].tokens += approximateTokens([message]);

			const caller = callerOf(turn, index);
			const call = turn.calls[caller ?? index] ?? 0;
			const window = (): Window =>
				caller === undefined ? "unknown" : windowAt({ turn: turn.turnIndex, message: caller }, call);
			const recalled = recallOf(tool, message, turn.turnIndex, window, own);
			if (recalled) recalls.push({ turn: turn.turnIndex, call, tool, ...recalled });
		}
	}
	const banded = (kind: RecallClass) =>
		band(recalls.filter((recall) => recall.class === kind).map((recall) => recall.distance));
	return { pulls, writes, recalls, recall: { recall: banded("recall"), unknown: banded("unknown") } };
}

/**
 * Whether a Pull's result held a Turn of the Run, `own`, that the window of
 * the Call at Turn `current` did not carry, and how far back the nearest is.
 * None when it is no recall Pull at all.
 */
function recallOf(
	tool: PullTool,
	result: HarnessMessage,
	current: number,
	window: () => Window,
	own: string | undefined,
): Pick<RecallPull, "distance" | "class"> | undefined {
	const details = (result.details ?? {}) as { turnIndices?: unknown; turns?: unknown; results?: unknown };
	const nearest = (indices: number[]) => ({ distance: current - Math.max(...indices) });
	if (tool === "recall_earlier_turns") {
		// The tool returns only Turns from before the tail of the very Call
		// that made it: the window it would be checked against.
		const indices = Array.isArray(details.turnIndices) ? (details.turnIndices as number[]) : [];
		return indices.length > 0 ? { ...nearest(indices), class: "recall" } : undefined;
	}
	if (tool !== "recall_across_conversations") return undefined;

	if (!Array.isArray(details.turns)) {
		// Recorded before results named their Turns: some came back, whose is unsaid.
		return typeof details.results === "number" && details.results > 0 ? { class: "unknown" } : undefined;
	}
	const found = details.turns as { conversationId: string; turnIndex: number }[];
	// Without the Run's id, no result can be told for the Run's own.
	if (own === undefined) return found.length > 0 ? { class: "unknown" } : undefined;
	// The Call's own Turn is always in its window.
	const owned = found.filter((each) => each.conversationId === own && each.turnIndex !== current).map((each) => each.turnIndex);
	if (owned.length === 0) return undefined;
	const held = window();
	if (held === "unknown") return { ...nearest(owned), class: "unknown" };
	// The Opening carries only its Turn's prompt; a Pull returns the whole Turn.
	const left = owned.filter((turn) => !held.tail.turns.includes(turn));
	return left.length > 0 ? { ...nearest(left), class: "recall" } : undefined;
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
	if (inTail(window, earlier)) return window.tail.partial ? "unknown" : "held";
	// The Opening carries its Turn's prompt and nothing after it.
	if (window.opening === earlier.turn && earlier.message === 0) return "held";
	return "left";
}

/** Whether the message at `at` sits in the window's tail; a partial tail may still have dropped it. */
function inTail(window: Exclude<Window, "unknown">, at: MessageAddress): boolean {
	const { tail } = window;
	return tail.turns.includes(at.turn) && (tail.from?.turn !== at.turn || at.message >= tail.from.message);
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
	/** Per Probe, in Probe order: how many complete Runs scored that Plant right at that Turn, of how many. */
	retention: { id: string; turn: number; kind: PlantKind; tools?: false; right: number; of: number }[];
	/**
	 * The rest count every score of the complete Runs, and are absent when a
	 * score was recorded before Scores had positions. `byBand` is right of
	 * scored per distance band, indexed like `BANDS`; unplanted scores are in none.
	 */
	byBand?: { right: number; of: number }[];
	byPosition?: Record<Position, { right: number; of: number }>;
	sources?: Record<Source, { right: number; wrong: number }>;
	counts?: { leak: number; despite: number; stale: number; breach: number };
}

export const POSITIONS: Position[] = ["opening", "pin", "tail", "summary", "evicted", "unplanted", "unknown"];
export const SOURCES: Source[] = ["opening", "pin", "tail", "summary", "pull", "result", "none", "unknown"];

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

		const byProbe = new Map<string, ArmAggregate["retention"][number]>();
		for (const run of complete) {
			for (const score of run.plants) {
				const key = probeKey(score);
				let probe = byProbe.get(key);
				if (!probe) {
					probe = {
						id: score.id,
						turn: score.turn,
						kind: score.kind ?? "literal",
						...(score.tools === false ? { tools: false as const } : {}),
						right: 0,
						of: 0,
					};
					byProbe.set(key, probe);
				}
				probe.of++;
				if (score.right) probe.right++;
			}
		}
		const retention = [...byProbe.values()].sort((a, b) => a.turn - b.turn);

		const scores = complete.flatMap((run) => run.plants);
		const positioned = scores.every((score) => score.position !== undefined);
		const tally = (of: Score[]) => ({ right: of.filter((score) => score.right).length, of: of.length });
		const breakdown = positioned
			? {
					byBand: BANDS.map(([low, high]) =>
						tally(scores.filter((s) => s.distance !== undefined && s.distance >= low && s.distance <= high)),
					),
					byPosition: Object.fromEntries(
						POSITIONS.map((position) => [position, tally(scores.filter((s) => s.position === position))]),
					) as Record<Position, { right: number; of: number }>,
					sources: Object.fromEntries(
						SOURCES.map((source) => {
							const { right, of } = tally(scores.filter((s) => s.source === source));
							return [source, { right, wrong: of - right }];
						}),
					) as Record<Source, { right: number; wrong: number }>,
					counts: {
						leak: scores.filter((s) => s.class === "leak").length,
						despite: scores.filter((s) => s.class === "despite").length,
						stale: scores.filter((s) => s.stale).length,
						breach: scores.filter((s) => s.breach).length,
					},
				}
			: {};

		result.set(arm, { arm, complete, excluded: all.length - complete.length, costPerPass, retention, ...breakdown });
	}
	return result;
}

export const usd = (x: number) => (Number.isFinite(x) ? `$${x.toFixed(4)}` : "—");
export const int = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString("en-US") : "—");
export const percent = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : "—");
export const bandLabel = ([low, high]: (typeof BANDS)[number]) =>
	high === Number.POSITIVE_INFINITY ? `≥${low}` : `${low}–${high}`;

const CLASS_LABEL: Record<ScoreClass, string> = {
	leak: "leak",
	despite: "wrong despite a source",
	lapse: "Lapse",
	unknown: "failed Probe unknown",
	unplanted: "unplanted",
};

/** One Score as a line: `build: wrong at Turn 40, literal, 37 Turns back, evicted, source none (Lapse)`. */
export function scoreLine(score: Score): string {
	const parts = [
		`${score.id}: ${score.right ? "right" : "wrong"} at Turn ${score.turn + 1}`,
		score.kind,
		...(score.distance === undefined ? [] : [`${score.distance} Turn${score.distance === 1 ? "" : "s"} back`]),
		score.position,
		`source ${score.source}${score.pull ? ` (${score.pull})` : ""}`,
		...(score.stale ? ["stale"] : []),
		...(score.breach ? ["called a tool the Probe forbade"] : []),
	];
	return parts.join(", ") + (score.class ? ` (${CLASS_LABEL[score.class]})` : "");
}

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
		if (measures.plants.length === 0) console.log("Retention: no Probe reached");
		for (const score of measures.plants) console.log(scoreLine(score));
		const banded = (name: string, count: Banded) =>
			console.log(
				`${name}: ${count.total} (${BANDS.map((band, at) => `${bandLabel(band)} ${count.bands[at]}`).join(", ")})`,
			);
		banded("Re-fetches held", measures.refetch.held);
		banded("Lapses", measures.refetch.left);
		banded("Re-fetches unknown", measures.refetch.unknown);
		banded("Failed-Probe Lapses", measures.probe.lapse);
		banded("Failed Probes unknown", measures.probe.unknown);
		console.log(`Compactions per Run: ${measures.compactions ?? "n/a"}`);
		if (measures.pulls && measures.recall) {
			for (const tool of PULL_TOOLS) {
				const { calls, tokens } = measures.pulls[tool];
				console.log(`Pulls, ${tool}: ${calls} (~${int(tokens)} tokens)`);
			}
			console.log(`write_documentation calls: ${measures.writes ?? 0}`);
			banded("Recall Pulls (Lapses)", measures.recall.recall);
			banded("Recall Pulls unknown", measures.recall.unknown);
		} else {
			console.log("Pulls: n/a");
		}
	}
}
