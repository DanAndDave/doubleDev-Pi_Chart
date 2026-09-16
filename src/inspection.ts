import type {
	CallAccounting,
	RecordedPart,
	TurnAccounting,
} from "./accounting.ts";
import type { PackSource } from "./assembler.ts";

/** One part of a pack, as an inspector presents it. */
export interface PartView {
	source: PackSource;
	/** Local estimate of what it contributed. Approximate by construction. */
	approximateTokens: number;
	/** How many Turns it carried, known even when their positions are not. */
	carried: number;
	/** Their positions, where those are known. Identity, not count. */
	turnIndices: number[];
	budget?: number;
	candidates?: number;
	/** True when the Budget, not the supply, decided what it carried. */
	trimmed: boolean;
	/** How many candidates the Budget excluded. */
	dropped: number;
}

/** What one Call's Context Window was made of. */
export interface CallView {
	turnIndex: number;
	callIndex: number;
	parts: PartView[];
	/** Harness-reported, absent until the provider has answered. */
	packTokens?: number;
	floorTokens?: number;
	/** The Floor's share of the window, 0 to 1. Absent when unmeasured. */
	floorShare?: number;
	unassembled: boolean;
	/** The Budgets in force, recorded even where a part carried nothing. */
	budgets?: { tail: number; recall: number };
}

/** What changed between two Calls' packs. */
export interface PackDiff {
	entered: { source: PackSource; turnIndex: number }[];
	left: { source: PackSource; turnIndex: number }[];
	unchanged: { source: PackSource; turnIndex: number }[];
}

/** What a whole Conversation's windows cost. */
export interface ConversationSummary {
	conversationId: string;
	calls: number;
	measuredCalls: number;
	/** Averages across measured Calls only. Absent when none were measured. */
	averagePackTokens?: number;
	averageFloorTokens?: number;
	averageFloorShare?: number;
	/** Per part: how much of its Budget it typically spent. */
	budgetUse: {
		source: PackSource;
		averageCarried: number;
		budget?: number;
		timesTrimmed: number;
	}[];
}

/**
 * Reads recorded accounting back as something a person can judge.
 *
 * Pure: every function here takes recorded accounting and returns a view of
 * it, so inspecting can never alter what it inspects.
 */
export function inspectCall(call: CallAccounting): CallView {
	const floorShare =
		call.floorTokens !== undefined && call.packTokens !== undefined
			? call.floorTokens / (call.floorTokens + call.packTokens)
			: undefined;

	return {
		turnIndex: call.turnIndex,
		callIndex: call.callIndex,
		parts: call.parts.map(viewPart),
		packTokens: call.packTokens,
		floorTokens: call.floorTokens,
		floorShare,
		unassembled: call.unassembled === true,
		budgets: call.budgets,
	};
}

function viewPart(part: RecordedPart): PartView {
	const turnIndices = part.turnIndices ?? [];
	// Count first, positions second: a part whose Turns have no position yet
	// still carried them, and reporting nothing would understate the pack.
	const carried = part.carried ?? turnIndices.length;
	const candidates = part.candidates;
	const dropped =
		candidates === undefined ? 0 : Math.max(candidates - carried, 0);

	return {
		source: part.source,
		approximateTokens: part.approximateTokens,
		carried,
		turnIndices,
		budget: part.budget,
		candidates,
		// Trimmed means the Budget bound it, not merely that supply ran out.
		trimmed: dropped > 0 && part.budget !== undefined && carried >= part.budget,
		dropped,
	};
}

/** Every Call of a Conversation, in order. */
export function inspectConversation(turns: TurnAccounting[]): CallView[] {
	return turns.flatMap((turn) => turn.calls.map(inspectCall));
}

/**
 * What entered, left, and stayed between two packs.
 *
 * Compared by what they carried rather than by size: a recollection that
 * flickers in and out between Calls is the most likely way recall fails, and
 * only content-level comparison makes that visible.
 */
export function comparePacks(before: CallView, after: CallView): PackDiff {
	const beforeItems = itemsOf(before);
	const afterItems = itemsOf(after);

	const entered = [...afterItems].filter(([id]) => !beforeItems.has(id));
	const left = [...beforeItems].filter(([id]) => !afterItems.has(id));
	const unchanged = [...afterItems].filter(([id]) => beforeItems.has(id));

	return {
		entered: entered.map(([, item]) => item),
		left: left.map(([, item]) => item),
		unchanged: unchanged.map(([, item]) => item),
	};
}

interface Item {
	source: PackSource;
	turnIndex: number;
}

/** A pack's contents keyed by identity, so two packs can be compared. */
function itemsOf(view: CallView): Map<string, Item> {
	const items = new Map<string, Item>();
	for (const part of view.parts) {
		for (const turnIndex of part.turnIndices) {
			items.set(`${part.source}:${turnIndex}`, { source: part.source, turnIndex });
		}
	}
	return items;
}

export function summarise(
	conversationId: string,
	turns: TurnAccounting[],
): ConversationSummary {
	const calls = inspectConversation(turns);
	const measured = calls.filter((call) => call.floorShare !== undefined);

	const summary: ConversationSummary = {
		conversationId,
		calls: calls.length,
		measuredCalls: measured.length,
		budgetUse: budgetUse(calls),
	};

	if (measured.length === 0) return summary;

	summary.averagePackTokens = mean(measured.map((call) => call.packTokens ?? 0));
	summary.averageFloorTokens = mean(measured.map((call) => call.floorTokens ?? 0));
	summary.averageFloorShare = mean(measured.map((call) => call.floorShare ?? 0));
	return summary;
}

/** How much of each part's Budget the Conversation typically spent. */
function budgetUse(calls: CallView[]): ConversationSummary["budgetUse"] {
	const bySource = new Map<PackSource, PartView[]>();
	for (const call of calls) {
		for (const part of call.parts) {
			bySource.set(part.source, [...(bySource.get(part.source) ?? []), part]);
		}
	}

	return [...bySource.entries()].map(([source, parts]) => ({
		source,
		averageCarried: mean(parts.map((part) => part.carried)),
		// The Budget most recently in force: an average across a mid-session
		// change would describe a Budget that never existed.
		budget: parts.findLast((part) => part.budget !== undefined)?.budget,
		timesTrimmed: parts.filter((part) => part.trimmed).length,
	}));
}

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	let sum = 0;
	for (const value of values) sum += value;
	return Math.round((sum / values.length) * 100) / 100;
}
