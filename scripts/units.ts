/**
 * What a main Call's Context Window is made of, outside its own Turn, and
 * what a tool call aimed at: one definition shared by Ablation, which cuts
 * the units, and Utilisation, which judges them
 * (`openspec/changes/utilisation/design.md` §1). Pure: no I/O.
 */
import type { Compaction, JournalTurn, MessageAddress } from "../src/journal.ts";
import { isToolCall, messageText, renderToolCall, type HarnessMessage } from "../src/messages.ts";
import { approximateTokens } from "../src/tokens.ts";
import type { Window } from "./measures.ts";

/** The tools that bring content into the window because the agent asked; pi-chart's only. */
export const PULL_TOOLS = [
	"recall_earlier_turns",
	"recall_across_conversations",
	"search_documentation",
	"walk_documentation",
	"codebase_structure",
] as const;
export type PullTool = (typeof PULL_TOOLS)[number];

// ---- tool and target (spec: "The next action is compared on tool and target")

/** A tool call as the Journal records it, or as a resend's reply holds it under harness tool names. */
export interface ToolCallLike {
	name: string;
	arguments?: unknown;
}

/** What a tool call did, for comparing next actions: the tool, and what it aimed at when the tool has a target. */
export interface Target {
	tool: string;
	target?: string;
}

/**
 * omp's line selector after a path's last colons: lines (`:1-40`, `:50+10`,
 * `:-60`, `:1-12,120-160`) and `:raw`, alone or chained.
 */
const SELECTOR = /(?::(?:raw|-?\d+(?:[-+]\d*)?(?:,-?\d+(?:[-+]\d*)?)*))+$/;

/** An omp `edit` input's file header: `[path#TAG]`. */
const EDIT_HEADER = /^\[([^\]\n]+)#[0-9A-Fa-f]{4}\]$/gm;

/**
 * A tool call's tool and target, by the spec's table. A device call (`write`
 * to `xd://<tool>` with JSON `content`) counts as `<tool>` with the parsed
 * content as its arguments; unparseable content, help mode among it, ran no
 * tool and stays `write`.
 */
export function targetOf(call: ToolCallLike): Target {
	const device = deviceCall(call);
	if (device) return targetOf(device);
	const args = (call.arguments ?? {}) as Record<string, unknown>;
	const text = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : undefined);
	const aimed = (target: string | undefined): Target => ({ tool: call.name, ...(target === undefined ? {} : { target }) });
	switch (call.name) {
		case "read":
		case "write":
			return aimed(text("path")?.replace(SELECTOR, ""));
		case "edit": {
			// omp's edit names its files in the input, one header per file; a several-file edit aims at them all.
			const files = [...(text("input") ?? "").matchAll(EDIT_HEADER)].map((header) => (header[1] as string).replace(SELECTOR, ""));
			return aimed(files.length > 0 ? files.join("\n") : text("path")?.replace(SELECTOR, ""));
		}
		case "grep":
		case "glob":
			// glob's pattern is its path; a JSON pair keeps a pattern and a path from running into each other.
			return aimed(JSON.stringify([text("pattern") ?? null, text("path") ?? null]));
		case "bash":
			return aimed(text("command")?.replace(/\s+/g, " ").trim());
		default:
			return { tool: call.name };
	}
}

/** The tool a `write` to omp's tool device ran, with its arguments; none for any other call. */
export function deviceCall(call: ToolCallLike): ToolCallLike | undefined {
	const { path, content } = (call.arguments ?? {}) as { path?: unknown; content?: unknown };
	if (call.name !== "write" || typeof path !== "string" || !path.startsWith("xd://") || typeof content !== "string") {
		return undefined;
	}
	const name = path.slice("xd://".length);
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return undefined;
	}
	if (name === "" || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	return { name, arguments: parsed };
}

/** A reply's next action: its tool calls' targets in order; [] for a reply with none. */
export type Action = Target[];

export function actionOf(calls: ToolCallLike[]): Action {
	return calls.map(targetOf);
}

// ---- units (spec: "The units of a Call")

export type UnitKind = "tool-call" | "prose" | "summary" | "opening" | "pin" | "pull" | "turn";

/**
 * One part of a main Call's request, outside the Call's own Turn, that
 * Ablation may cut. A `turn` is a whole earlier Turn, its prose with every
 * tool call it made: the positive control's unit for a Plant in the verbatim
 * tail, never listed by `unitsOf`.
 */
export interface Unit {
	kind: UnitKind;
	/** tool-call, pull, prose, opening, turn: the Turn it came from. */
	turn?: number;
	/** tool-call, pull: the Journal's tool call id. */
	callId?: string;
	/** turn: the Journal's ids of every tool call the Turn made. */
	callIds?: string[];
	/** tool-call, pull: the tool it ran, a device call resolved. */
	tool?: string;
	/** pin: the Pin's id. */
	pin?: number;
	/** prose, opening and turn: the Turn's prompt; summary: the summary text; pin: the Pin's text. */
	text?: string;
	/** approximateTokens estimate, for sampling only. */
	tokens: number;
}

/**
 * The units of the main Call at `address`, whose window is `window`
 * (`measureRun`'s `Call.window`): the Opening unless it carries the Call's
 * own Turn, each Pin (`pins`: `pinTexts`), the summary (from `compactions`),
 * and the prose and tool calls of every other Turn the tail carried. A tail
 * Turn's messages before `tail.from` were not sent, so a tool call made there
 * is no unit, nor is the prose of a Turn whose prompt went. An "unknown"
 * window has no units.
 */
export function unitsOf(
	turns: JournalTurn[],
	address: MessageAddress,
	window: Window,
	compactions: Compaction[],
	pins: Map<number, string>,
): Unit[] {
	if (window === "unknown") return [];
	const units: Unit[] = [];
	const opening = window.opening === undefined ? undefined : turns[window.opening];
	if (opening && opening.turnIndex !== address.turn && opening.messages[0]) {
		units.push({ kind: "opening", turn: opening.turnIndex, text: opening.prompt, tokens: approximateTokens([opening.messages[0]]) });
	}
	for (const pin of window.pins) {
		const text = pins.get(pin);
		if (text !== undefined) units.push({ kind: "pin", pin, text, tokens: approximateTokens([{ role: "user", content: text }]) });
	}
	const summary = compactions.find((compaction) => compaction.id === window.summary)?.summary;
	if (window.summary !== undefined && summary !== undefined) {
		units.push({ kind: "summary", text: summary, tokens: approximateTokens([{ role: "user", content: summary }]) });
	}
	for (const at of window.tail.turns) {
		const turn = turns[at];
		if (at === address.turn || !turn) continue;
		units.push(...turnUnits(turn, window.tail.from?.turn === at ? window.tail.from.message : 0));
	}
	return units;
}

/** The prose and tool-call units of an earlier Turn whose messages from `from` on were sent. */
function turnUnits(turn: JournalTurn, from: number): Unit[] {
	const units: Unit[] = [];
	const [first, ...rest] = turn.messages;
	if (from === 0 && first?.role === "user") {
		// Prose is the prompt and the assistant's text; its tool calls and thinking stay.
		const said = rest.flatMap((message): HarnessMessage[] =>
			message.role === "assistant" && Array.isArray(message.content)
				? [{ role: "assistant", content: message.content.filter((block) => block.type === "text") }]
				: [],
		);
		units.push({ kind: "prose", turn: turn.turnIndex, text: turn.prompt, tokens: approximateTokens([first, ...said]) });
	}
	for (const message of turn.messages.slice(from)) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const call of message.content.filter(isToolCall)) {
			const answer = turn.messages.find((each) => each.role === "toolResult" && each.toolCallId === call.id);
			const { tool } = targetOf(call);
			units.push({
				kind: (PULL_TOOLS as readonly string[]).includes(tool) ? "pull" : "tool-call",
				turn: turn.turnIndex,
				callId: call.id,
				tool,
				tokens: approximateTokens([{ role: "assistant", content: [call] }, ...(answer ? [answer] : [])]),
			});
		}
	}
	return units;
}

/**
 * A unit's text as the model saw it, a line per message or block: a tool
 * call or Pull as `renderToolCall` renders it, then its result; prose as the
 * prompt and the replies' text; a whole Turn as every message, its tool
 * calls rendered; an Opening, a Pin or the summary as its own text.
 */
export function unitContent(unit: Unit, turns: JournalTurn[]): string {
	if (unit.kind === "opening" || unit.kind === "pin" || unit.kind === "summary") return unit.text ?? "";
	const turn = turns.find((each) => each.turnIndex === unit.turn);
	if (!turn) throw new Error(`the Journal has no Turn ${unit.turn} for a ${unit.kind} unit`);
	if (unit.kind === "tool-call" || unit.kind === "pull") {
		const call = turn.messages
			.flatMap((message) => (message.role === "assistant" && Array.isArray(message.content) ? message.content.filter(isToolCall) : []))
			.find((each) => each.id === unit.callId);
		if (!call) throw new Error(`Turn ${unit.turn} of the Journal has no tool call ${unit.callId}`);
		const result = turn.messages.find((message) => message.role === "toolResult" && message.toolCallId === unit.callId);
		return [renderToolCall(call), ...(result ? [messageText(result)] : [])].join("\n");
	}
	const calls = unit.kind === "turn";
	return turn.messages
		.filter((message) => calls || message.role !== "toolResult")
		.flatMap((message) =>
			message.role === "assistant" && Array.isArray(message.content)
				? message.content.flatMap((block) => {
						if (isToolCall(block)) return calls ? [renderToolCall(block)] : [];
						return block.type === "text" && "text" in block ? [block.text] : [];
					})
				: [messageText(message)],
		)
		.filter((line) => line.length > 0)
		.join("\n");
}
