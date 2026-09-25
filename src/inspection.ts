import type {
	CallAccounting,
	MemoryBackendState,
	RecordedPart,
	TailSource,
	TurnAccounting,
} from "./accounting.ts";
import type {
	AbsenceCause,
	ExcludedCandidate,
	PackSource,
	PartExclusion,
} from "./assembler.ts";

/** One part of a pack, as an inspector presents it. */
export interface PartView {
	source: PackSource;
	/** Local estimate of what it contributed. Approximate by construction. */
	approximateTokens: number;
	/** How many Turns it carried, known even when their positions are not. */
	carried: number;
	/** Their positions, where those are known. Identity, not count. */
	turnIndices: number[];
	/** Which Concepts it carried, by id, where it carried any. */
	conceptIds: string[];
	/** Which symbols it carried, by name, where it carried any. */
	symbols: string[];
	budget?: number;
	/** The token Budget in force, which a part's irreducible content may exceed. */
	tokenBudget?: number;
	candidates?: number;
	/** True when the Budget, not the supply, decided what it carried. */
	trimmed: boolean;
	/** How many candidates the Budget excluded. */
	dropped: number;
	/** How many were refused as insufficiently relevant, before any Budget. */
	irrelevant: number;
	/**
	 * Why it carried less than its candidates offered, by reason: relevance,
	 * the count Budget, the size Budget, or the pack ceiling. A pack that
	 * carried little for want of room reads differently from one that
	 * carried little for want of anything relevant.
	 */
	excluded?: PartExclusion;
	/**
	 * Which candidates it did not carry, by identity, nearest first.
	 * Empty where nothing was excluded; empty *and* `explained: false`
	 * where the Call was recorded before identities were retained.
	 */
	excludedCandidates: ExcludedCandidate[];
	/** Whether this part's record names what it excluded at all. */
	explained: boolean;
	/** The relevance threshold it selected against, where it had one. */
	threshold?: number;
	/**
	 * True where the part is recorded as having no relevance threshold. A
	 * part that cannot refuse for irrelevance is not a part that refused
	 * nothing, and `irrelevant: 0` alone cannot say which this is.
	 */
	unranked: boolean;
	/** Why it contributed nothing, where it contributed nothing. */
	absent?: AbsenceCause;
	/** What it would have carried without the ceiling, where that bound. */
	withoutCeiling?: number;
	/** Whether any of its content was shortened to fit. */
	shortened?: boolean;
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
	/** Where the verbatim tail came from. Absent on records that predate it. */
	tailSource?: TailSource;
	/** The Budgets in force, recorded even where a part carried nothing. */
	budgets?: { tail: number; recall: number; docs: number; graph?: number };
	/**
	 * Candidates refused as not relevant enough. Reported on the Call, so it
	 * survives the case where nothing was relevant and there is no recalled
	 * part to carry it.
	 */
	rejected: number;
	/**
	 * Turns of the Conversation retrieval could not see, for want of a valid
	 * vector. A recall thinned by re-embedding reads differently from one
	 * where nothing was relevant.
	 */
	unsearched: number;
	/**
	 * Concepts the Doc Store could not rank, for want of a vector from the
	 * model in use. Curated knowledge thinned by a model change reads
	 * differently from a bundle with nothing relevant in it.
	 */
	conceptsUnsearched: number;
	/** The Pack ceiling in force. Absent on records that predate it. */
	ceiling?: number;
	/** What the parts came to before the ceiling reduced them. */
	beforeCeiling?: number;
	/** True when the ceiling had to reduce this pack. */
	reduced?: boolean;
	/**
	 * Our own estimate of what the pack cost, beside the harness's report
	 * of the window that carried it. Never presented as the reported size:
	 * the estimate is what every Budget is applied to, so its drift from
	 * the measurement is the thing worth seeing.
	 */
	approximateTokens?: number;
	/**
	 * Estimate over reported, where both exist. Above one is an estimate
	 * running high, below one an estimate running low — and the Budgets
	 * bind on the estimate.
	 */
	estimateRatio?: number;
	/** The compaction the harness was on for this Call, where it said. */
	compactionEpoch?: number;
	/** True where the harness compacted the Conversation at this Call. */
	compacted: boolean;
	/**
	 * What the harness's own memory backend was doing for this Call. Absent
	 * on Calls recorded before it was observed, which is not the same as a
	 * Call observed to be clean.
	 */
	memoryBackend?: MemoryBackendState;
	/**
	 * What the provider charged for this Call's window: tokens it read from
	 * the prompt cache, tokens it wrote into it, and tokens charged as
	 * neither. Absent where it reported nothing.
	 */
	cacheRead?: number;
	cacheWrite?: number;
	inputTokens?: number;
	/**
	 * How much of the Pack was read from cache rather than re-sent.
	 *
	 * Against the Pack, not against the window: the Floor is most of a
	 * window here — 25,588 of 29,328 tokens on the audited Call — and the
	 * Floor is the head of the prefix, so it caches whatever the Pack does.
	 * A rate over the whole window reads about 90% in a world where the
	 * Pack body is rewritten on every Call, which is the world this exists
	 * to detect. Cached Pack tokens are what is left of `cacheRead` once
	 * the Floor has taken its share, over the Pack's own size.
	 */
	cachedPackShare?: number;
	/** Whether any part of this Call names what it excluded. */
	explained: boolean;
}

/** What changed between two Calls' packs. */
export interface PackDiff {
	entered: PackItem[];
	left: PackItem[];
	unchanged: PackItem[];
}

/** One thing a pack carried: a Turn by position, or a Concept by id. */
export interface PackItem {
	source: PackSource;
	turnIndex?: number;
	conceptId?: string;
	symbol?: string;
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
	/**
	 * How the estimate compared with the reported sizes, averaged across
	 * the Calls that carry both. Absent where none does.
	 */
	averageEstimateRatio?: number;
	/** Where the harness compacted the Conversation, in order. */
	compactions: { turnIndex: number; callIndex: number }[];
	/**
	 * The Calls that ran with the harness's own memory backend active or
	 * unconfirmed — a second injector in the Context Window the Assembler
	 * could not reach (ADR-0004). Empty where every Call was observed off,
	 * and where none recorded the state at all.
	 */
	exposed: {
		turnIndex: number;
		callIndex: number;
		state: MemoryBackendState;
	}[];
	/** Per part: how much of its Budget it typically spent. */
	budgetUse: {
		source: PackSource;
		averageCarried: number;
		/** How many candidates were typically refused as irrelevant. */
		averageIrrelevant: number;
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

	// A `cacheRead` below the Floor means the cache did not reach the Pack
	// at all: the Floor is the head of the prefix, so nothing beyond it can
	// have been read from cache. Reported as none, never as a share of what
	// the Floor alone accounted for.
	const cachedPack =
		call.cacheRead !== undefined && call.floorTokens !== undefined
			? Math.max(0, call.cacheRead - call.floorTokens)
			: undefined;
	const cachedPackShare =
		cachedPack !== undefined && call.packTokens !== undefined && call.packTokens > 0
			? round(cachedPack / call.packTokens)
			: undefined;

	return {
		turnIndex: call.turnIndex,
		callIndex: call.callIndex,
		parts: call.parts.map(viewPart),
		packTokens: call.packTokens,
		floorTokens: call.floorTokens,
		floorShare,
		approximateTokens: call.approximateTokens,
		estimateRatio:
			call.approximateTokens !== undefined &&
			call.packTokens !== undefined &&
			call.packTokens > 0
				? round(call.approximateTokens / call.packTokens)
				: undefined,
		unassembled: call.unassembled === true,
		tailSource: call.tailSource,
		budgets: call.budgets,
		rejected: call.rejected ?? 0,
		unsearched: call.unsearched ?? 0,
		conceptsUnsearched: call.conceptsUnsearched ?? 0,
		ceiling: call.ceiling,
		beforeCeiling: call.beforeCeiling,
		compactionEpoch: call.compactionEpoch,
		memoryBackend: call.memoryBackend,
		cacheRead: call.cacheRead,
		cacheWrite: call.cacheWrite,
		inputTokens: call.inputTokens,
		cachedPackShare,
		// Set by `inspectConversation`, which is the only place that can
		// see the Call before this one: a compaction is a change of epoch,
		// and one Call alone has nothing to have changed from.
		compacted: false,
		// Any part, not every part: parts are written together, so a Call
		// with one ledger has them all — while a Call with no parts at all,
		// which is what an unassembled one is, must read as unexplainable
		// rather than as vacuously explained.
		explained: call.parts.some((part) => part.excludedCandidates !== undefined),
		// Reduced, not merely ceilinged: both figures exist on every recent
		// Call, and they differ only when the ceiling had to bind.
		reduced:
			call.beforeCeiling !== undefined &&
			call.approximateTokens !== undefined &&
			call.beforeCeiling > call.approximateTokens,
	};
}

function viewPart(part: RecordedPart): PartView {
	const turnIndices = part.turnIndices ?? [];
	const conceptIds = part.conceptIds ?? [];
	const symbols = part.symbols ?? [];
	// Count first, positions second: a part whose Turns have no position yet
	// still carried them, and reporting nothing would understate the pack.
	const carried = part.carried ?? turnIndices.length;
	const candidates = part.candidates;
	const dropped =
		candidates === undefined ? 0 : Math.max(candidates - carried, 0);

	return {
		source: part.source,
		symbols,
		approximateTokens: part.approximateTokens,
		carried,
		turnIndices,
		conceptIds,
		budget: part.budget,
		tokenBudget: part.tokenBudget,
		candidates,
		// Trimmed means the Budget bound it, not merely that supply ran out
		// or that nothing was relevant enough to carry.
		trimmed: dropped > 0 && part.budget !== undefined && carried >= part.budget,
		dropped,
		irrelevant: part.irrelevant ?? 0,
		excluded: part.excluded,
		excludedCandidates: part.excludedCandidates ?? [],
		explained: part.excludedCandidates !== undefined,
		threshold: part.threshold,
		unranked: part.unranked === true,
		absent: part.absent,
		withoutCeiling: part.withoutCeiling,
		shortened: part.shortened === true ? true : undefined,
	};
}

/**
 * Every Call of a Conversation, in order, with the compactions marked.
 *
 * A compaction is a change of reported epoch, so it belongs to the Call it
 * was first reported at and to no other: the Calls before it were
 * assembled against a window the harness has since rewritten, and the
 * Calls after it were not.
 */
export function inspectConversation(turns: TurnAccounting[]): CallView[] {
	const calls = turns.flatMap((turn) => turn.calls.map(inspectCall));
	let epoch: number | undefined;
	for (const call of calls) {
		if (call.compactionEpoch === undefined) continue;
		// The first epoch seen is a starting point, not a compaction:
		// nothing was compacted between a Conversation and its own start.
		if (epoch !== undefined && call.compactionEpoch > epoch) call.compacted = true;
		epoch = call.compactionEpoch;
	}
	return calls;
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

/** A pack's contents keyed by identity, so two packs can be compared. */
function itemsOf(view: CallView): Map<string, PackItem> {
	const items = new Map<string, PackItem>();
	for (const part of view.parts) {
		for (const turnIndex of part.turnIndices) {
			items.set(`${part.source}:${turnIndex}`, { source: part.source, turnIndex });
		}
		// Concepts flicker more than recollections, because the query
		// changes every prompt — so the diff has to see them too.
		for (const conceptId of part.conceptIds) {
			items.set(`${part.source}:${conceptId}`, { source: part.source, conceptId });
		}
		for (const symbol of part.symbols) {
			items.set(`${part.source}:${symbol}`, { source: part.source, symbol });
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
	const reconciled = calls.filter((call) => call.estimateRatio !== undefined);

	const summary: ConversationSummary = {
		conversationId,
		calls: calls.length,
		measuredCalls: measured.length,
		compactions: calls
			.filter((call) => call.compacted)
			.map((call) => ({ turnIndex: call.turnIndex, callIndex: call.callIndex })),
		// Which Calls ran with a second injector in the window. Listed
		// rather than counted: "two of nine" invites the question the
		// addresses answer, and `pack <n>` is what reads one of them.
		exposed: calls
			.filter((call) => call.memoryBackend && call.memoryBackend !== "off")
			.map((call) => ({
				turnIndex: call.turnIndex,
				callIndex: call.callIndex,
				state: call.memoryBackend ?? "unconfirmed",
			})),
		budgetUse: budgetUse(calls),
	};

	// Reported on the Calls that carry both figures, which is not the same
	// set as the measured ones: a Call the harness measured but assembly
	// never recorded has nothing to reconcile against.
	if (reconciled.length > 0) {
		summary.averageEstimateRatio = mean(
			reconciled.map((call) => call.estimateRatio ?? 0),
		);
	}

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
		averageIrrelevant: mean(parts.map((part) => part.irrelevant)),
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
	return round(sum / values.length);
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Where a Call sits, as a reader names it: a Turn, and maybe a Call. */
export interface CallRef {
	turnIndex: number;
	/** Absent means the last recorded Call of that Turn. */
	callIndex?: number;
}

/**
 * A Call address as written: `12`, or `12.3` for the fourth Call of Turn
 * twelve. Absent where the text is not an address at all, which is how a
 * caller tells an address from a subject.
 */
export function parseAddress(text: string): CallRef | undefined {
	const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
	if (!match) return undefined;
	const turnIndex = Number(match[1]);
	const callIndex = match[2] === undefined ? undefined : Number(match[2]);
	return { turnIndex, callIndex };
}

/**
 * The Call at an address, or nothing.
 *
 * Nothing rather than the nearest: an address that was never recorded,
 * answered with a different Call, is exactly the confusion addressing
 * exists to remove. A Turn without a Call resolves to its last recorded
 * Call — the one whose Pack carried the whole tool loop.
 */
export function resolveCall(
	calls: CallView[],
	address: CallRef,
): CallView | undefined {
	const ofTurn = calls.filter((call) => call.turnIndex === address.turnIndex);
	if (ofTurn.length === 0) return undefined;
	if (address.callIndex === undefined) return ofTurn[ofTurn.length - 1];
	return ofTurn.find((call) => call.callIndex === address.callIndex);
}

/** One candidate an answer names, with the part that considered it. */
export interface Considered {
	source: PackSource;
	candidate: ExcludedCandidate;
}

/** Why content matching a subject was or was not carried by one Call. */
export interface Explanation {
	subject: string;
	turnIndex: number;
	callIndex: number;
	/** True where no part of the Call names what it excluded. */
	unexplainable: boolean;
	/** Matching content the Call did carry, by identity. */
	carried: PackItem[];
	/** Matching candidates it excluded, nearest first. */
	excluded: Considered[];
}

/**
 * Why a Call did not carry what a user asks about.
 *
 * Matched against identities, because identities are all the record holds:
 * a Turn by its position, a Concept by its id, a symbol by its name. The
 * text of what was refused stays in the Journal and the bundle, which is
 * the point — Accounting explains, it does not replay.
 */
export function explain(call: CallView, subject: string): Explanation {
	const wanted = subject.trim().toLowerCase();
	const asTurn = /^(?:turn\s+)?(\d+)$/.exec(wanted);
	const turnIndex = asTurn ? Number(asTurn[1]) : undefined;

	// A number means a Turn and nothing else. Matching it as text too
	// would answer "why not turn 0" with every Concept whose id happens
	// to contain a zero, which is an answer about something else.
	const matches = (item: { turnIndex?: number; conceptId?: string; symbol?: string }) =>
		turnIndex !== undefined
			? item.turnIndex === turnIndex
			: (item.conceptId !== undefined &&
					item.conceptId.toLowerCase().includes(wanted)) ||
				(item.symbol !== undefined && item.symbol.toLowerCase().includes(wanted));

	const excluded: Considered[] = [];
	for (const part of call.parts) {
		for (const candidate of part.excludedCandidates) {
			if (matches(candidate)) excluded.push({ source: part.source, candidate });
		}
	}
	// Nearest first across the parts that considered it, so the answer
	// reads as a ranking rather than as an order of assembly. A candidate
	// with no distance at all leads: recall's Budget exclusions carry
	// none — only the Store that ranked them knew it — and a candidate
	// nobody can place is the one most worth looking at by hand.
	excluded.sort(
		(a, b) => (a.candidate.distance ?? -1) - (b.candidate.distance ?? -1),
	);

	return {
		subject: subject.trim(),
		turnIndex: call.turnIndex,
		callIndex: call.callIndex,
		unexplainable: !call.explained,
		carried: [...itemsOf(call).values()].filter(matches),
		excluded,
	};
}
