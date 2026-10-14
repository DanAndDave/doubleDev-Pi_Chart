import {
	isToolCall,
	messageText,
	toolCallText,
	type HarnessMessage,
	type Turn,
} from "./messages.ts";
import {
	elide,
	elidedWhole,
	elideLine,
	elideTurn,
	shrinkTurn,
	SHORTEST_TOKENS,
} from "./elision.ts";
import { approximateTokens } from "./tokens.ts";
import { shares } from "./shares.ts";
import type { ConceptHit } from "./doc-index.ts";
import type { RecalledTurn, TurnSize } from "./thread-store.ts";
import { renderPinned, type Pin } from "./pins.ts";

/**
 * What a part may carry, in both denominations at once.
 *
 * One value because it is one concept: a part is trimmed to whichever of
 * the two binds first. A count says something a size cannot — `count: 0`
 * is how a user asks for the current Turn alone — and a size says what a
 * count cannot: a Turn carrying six file reads costs two orders of
 * magnitude more than one carrying a sentence. Measured on real Journals,
 * an eight-Turn tail reached 974,861 estimated tokens, so the count alone
 * bounds nothing.
 */
export interface Budget {
	/** How many candidates, at most. */
	count: number;
	/** How large, in estimated tokens, at most. */
	tokens: number;
}

export interface AssemblerConfig {
	/** Completed Turns carried verbatim ahead of the current one. */
	tail: Budget;
	/**
	 * The share of both tail Budgets the tail drops to when a completed Turn
	 * carries it past either (ADR-0013). In (0, 1]; 1 slides the tail.
	 */
	tailLowWater: number;
	/**
	 * The Opening: Turn 0's prompt, carried in the system prompt from the
	 * first Turn (ADR-0015). A count or size of zero turns it off.
	 */
	opening: Budget;
	/**
	 * The whole pack's ceiling, in estimated tokens, independent of any one
	 * part's Budget. The system-prompt additions count toward it and are
	 * never reduced; when the rest exceeds the room left, the verbatim tail
	 * and then the current Turn are reduced, so an oversized pack is still a
	 * deterministic pack.
	 */
	packTokens: number;
	/**
	 * The Pin Budget in force. Recorded beside the Pins, never applied to
	 * them: it binds when a Pin is written, and a Pin already held is
	 * carried whatever the Budget has since become.
	 */
	pins: Budget;
	/**
	 * How many excluded candidates each part records by identity, nearest
	 * first, the rest surviving as counts. Measured: over 403 real Turns
	 * the Turn a user would ask about sat at rank 12 of the candidates at
	 * worst, and a head of 5 would have named it in fewer than half the
	 * cases it was reachable at all.
	 */
	explainCandidates: number;
}

/** Where a slice of a Context Pack came from. */
export type PackSource = "verbatim-tail" | "current-turn" | "opening" | "pinned";

export interface PackPart {
	source: PackSource;
	/** What the part sent as messages; empty for a part sent in the system prompt. */
	messages: HarnessMessage[];
	/**
	 * Local character-based estimate. Approximate by construction: nothing
	 * reports per-part cost, so this is never used for pack-versus-Floor.
	 */
	approximateTokens: number;
	/**
	 * Where the part was sent. Absent means among the messages; the Pins and
	 * the Opening ride the system prompt (ADR-0015).
	 */
	placement?: "system-prompt";
	/** How many Turns this part carried, known even when their positions are not. */
	carried?: number;
	/**
	 * Which Turns this part carried, by their position in the Conversation.
	 * Absent for content whose position is not known — identity, not count:
	 * `carried` is the count, so a pack is never reported as empty merely
	 * because its Turns have no position yet.
	 */
	turnIndices?: number[];
	/** Which Pins this part carried, by id. Identity, never text. */
	pinIds?: number[];
	/**
	 * The Budget that bounded this part, where one did. Recorded beside
	 * what the part spent, because a part carrying irreducible content can
	 * exceed the size half of it: a Turn of many messages, each already at
	 * the shortest length worth carrying, has a floor no Budget can argue
	 * with.
	 */
	budget?: Budget;
	/**
	 * How many candidates the part chose from. Larger than what it carried
	 * means the Budget was the binding constraint — the cheapest signal that
	 * a Budget is too small.
	 */
	candidates?: number;
	/**
	 * Why this part carried less than its candidates offered. Distinct
	 * reasons, because "the count ran out", "the size ran out", "the tail
	 * evicted" and "the pack had to shrink" call for different responses
	 * from whoever reads the accounting.
	 */
	excluded?: PartExclusion;
	/**
	 * Which candidates it did not carry, by identity, bounded to the
	 * retained head. `excluded` counts them; this names them, which is what
	 * makes an absence explainable rather than arithmetic.
	 */
	excludedCandidates?: ExcludedCandidate[];
	/** Why this part contributed nothing, where it contributed nothing. */
	absent?: AbsenceCause;
	/**
	 * How much this part would have carried had the pack ceiling not bound.
	 * Present only when the ceiling reduced it, so the cost of the ceiling
	 * is legible beside the cost of the part's own Budget.
	 */
	withoutCeiling?: number;
	/** Whether any content in this part was carried shortened to fit. */
	shortened?: boolean;
	/** How many of its messages were dropped to fit; absent where none were. */
	droppedMessages?: number;
}

export interface Pack {
	messages: HarnessMessage[];
	parts: PackPart[];
	/**
	 * The estimated size of pi-chart's system-prompt additions this Call
	 * was sent: the Pins, the Opening and the eviction notice. Zero when
	 * the harness did not offer the system prompt. Accounting takes it out
	 * of the reported non-message size, so the Floor is the harness's own.
	 */
	systemTokens: number;
	/** The Budgets in force for this Call, whether or not a part used them. */
	budgets: {
		tail: number;
		opening: number;
		pins: number;
	};
	/** The pack ceiling in force, and whether it had to bind. */
	ceiling: number;
	/**
	 * What the parts came to before the ceiling reduced them. Equal to
	 * `approximateTokens` when the ceiling did not bind, which is how a
	 * reader tells a pack that fitted from one that was made to fit.
	 */
	beforeCeiling: number;
	/**
	 * The parts' approximations, the system-prompt additions included.
	 * Approximate, for attribution only.
	 */
	approximateTokens: number;
}

/**
 * Why a part carried less than it could have. Counts, not identities: what
 * was left out is the Journal's business, not the accounting's.
 */
export interface PartExclusion {
	/** Excluded because the part's count Budget was exhausted. */
	count?: number;
	/** Excluded because the part's token Budget was exhausted. */
	size?: number;
	/** Excluded or shortened because the pack exceeded its ceiling. */
	ceiling?: number;
	/** Left behind by the verbatim tail's Eviction (ADR-0013). */
	evicted?: number;
}

/** Why a candidate was offered to a part and not carried. */
export type ExclusionReason = "count" | "size" | "ceiling" | "evicted";

/**
 * One candidate a part did not carry, by identity.
 *
 * Identity, size and reason — never the text, which would make Accounting
 * a second copy of the Journal. A Turn left out is readable in full by its
 * position.
 */
export interface ExcludedCandidate {
	/** A Turn by its position in the Conversation. */
	turnIndex?: number;
	reason: ExclusionReason;
	/** What carrying it would have cost, where a size Budget decided. */
	tokens?: number;
	/** The count or token Budget that excluded it, where one did. */
	budget?: number;
}

/**
 * Why a part contributed nothing. A part that carried nothing because its
 * Store was never configured calls for a different response from one whose
 * Budget is zero, and an absence with no cause reads as neither.
 */
export type AbsenceCause =
	/** Its Budget is zero: excluded deliberately, not for want of supply. */
	| "disabled"
	/** No Store was configured to supply it. */
	| "unconfigured"
	/** Retrieval was attempted and failed, or did not answer in time. */
	| "failed"
	/** There were no candidates to consider. */
	| "none"
	/** There were candidates and none fitted the size Budget. */
	| "size"
	/** The Opening only: Turn 0's prompt is empty or whitespace. */
	| "empty"
	/** The Opening only: no Turn 0 is stored, and no other Turn stands in. */
	| "missing"
	/** The Pins and the Opening: the harness never offered the system prompt. */
	| "unhooked";

export interface AssembleInput {
	/** Turns to carry verbatim: the recent ones, current Turn last. */
	turns: Turn[];
	/**
	 * What pi-chart added to this Turn's system prompt when the Turn
	 * started. Absent when the harness never offered the system prompt:
	 * the Pins and the Opening are then recorded absent, `unhooked`, and
	 * nothing stands in for them.
	 */
	system?: SystemAdditions;
	/** Why the tail's Store could not supply it, where it could not. */
	unavailable?: { "verbatim-tail"?: "unconfigured" | "failed" };
	/**
	 * Every completed Turn the Conversation holds, oldest first, with its
	 * `tailTokens` size: what the tail's start is replayed from. Absent,
	 * the start is replayed from the completed Turns in `turns`.
	 */
	tailSizes?: TurnSize[];
}

/**
 * Builds the Context Pack for one Call: the verbatim tail then the Turn in
 * progress, as messages, beside the system-prompt additions the Turn
 * started with. Nothing is added to the messages, so every Call of a Turn
 * reads back from cache all that the Call before it sent (ADR-0015). Pure —
 * no I/O, no clock, no randomness — so the same inputs always produce the
 * same pack.
 */
export function assemble(input: AssembleInput, config: AssemblerConfig): Pack {
	const { turns, system, unavailable = {}, tailSizes } = input;
	const bound = config.explainCandidates;

	const current = turns[turns.length - 1];
	const completed = turns.slice(0, -1);
	// Where the tail starts, replayed (ADR-0013). Withheld calls are applied
	// here rather than at ingest: the Journal recorded what happened, and an
	// unanswered call is part of what happened. It is the Context Window
	// that may not carry one — a provider refuses a call with no result
	// outright — so the refusal belongs where messages become protocol
	// messages, which is also where Turns from the live array pass.
	const tailFromPosition = tailFrom(completed, tailSizes, config);

	// The tail fills from its most recent Turn backwards, and the most recent
	// Turn is kept even when it alone exceeds the Budget — shrunk by its
	// oldest actions, not dropped. Measured on real Journals, the newest
	// completed Turn of a working session can be three times the whole tail
	// Budget, and a drop-only rule would empty the tail exactly when working
	// state matters most. A configured token Budget of nothing is the one
	// thing that disables it, decided here so that a ceiling leaving no room
	// still gets that Turn's smallest form.
	const selectTail = tailSelector(
		completed,
		tailFromPosition,
		config.tail.tokens > 0,
	);
	const tail = selectTail(config.tail);

	// The system-prompt additions as the Turn started with them, or absent
	// for want of the hook. Never rebuilt here: what is recorded is exactly
	// what was sent.
	const parts: PackPart[] = system
		? [{ ...system.pinned }, { ...system.opening }]
		: [absentPart("pinned", config.pins, "unhooked"), absentPart("opening", config.opening, "unhooked")];
	const systemTokens = system?.tokens ?? 0;

	parts.push({
		source: "verbatim-tail",
		messages: tail.messages,
		approximateTokens: tail.tokens,
		carried: tail.carried,
		turnIndices: tail.turnIndices,
		budget: config.tail,
		candidates: completed.length,
		excluded: exclusion(tail),
		excludedCandidates: ledger(tail.excluded, bound),
		absent: absence({
			budget: config.tail.count,
			carried: tail.carried,
			candidates: completed.length,
			unavailable: unavailable["verbatim-tail"],
		}),
		shortened: tail.shortened || undefined,
		droppedMessages: tail.droppedMessages,
	});

	// The current Turn is never dropped and never trimmed to a Budget: it is
	// the prompt being answered. Only the ceiling may shorten it.
	parts.push({
		source: "current-turn",
		messages: current?.messages ?? [],
		approximateTokens: current ? approximateTokens(current.messages) : 0,
		carried: current ? 1 : 0,
		turnIndices: current?.index === undefined ? [] : [current.index],
		excludedCandidates: [],
		absent: current === undefined ? "none" : undefined,
	});

	// The parts' estimates already count the Pins and the Opening; the
	// eviction notice and the section breaks are the rest of the block.
	const notice = systemTokens - systemPartTokens(parts);
	const beforeCeiling = totalOf(parts) + notice;
	// Reduction re-runs the tail's selection under a smaller Budget rather
	// than editing the messages it already chose, so one rule decides what
	// it carries whether its own Budget or the pack's ceiling binds. The
	// system-prompt additions are never reduced: they are reserved first.
	reduceToCeiling(parts, config.packTokens - systemTokens, bound, {
		select: selectTail,
		budget: config.tail,
	});

	return {
		messages: [...messagesOf(parts, "verbatim-tail"), ...messagesOf(parts, "current-turn")],
		parts,
		systemTokens,
		budgets: {
			tail: config.tail.count,
			opening: config.opening.count,
			pins: config.pins.count,
		},
		ceiling: config.packTokens,
		beforeCeiling,
		approximateTokens: totalOf(parts) + notice,
	};
}

/** What pi-chart adds to a Turn's system prompt, fixed when the Turn starts. */
export interface SystemAdditions {
	/** The one block appended to the system prompt; `""` when nothing is added. */
	text: string;
	/** The Pack's `pinned` part, placed in the system prompt. */
	pinned: PackPart;
	/** The Pack's `opening` part, placed in the system prompt. */
	opening: PackPart;
	/** The estimated size of `text`; zero when nothing is added. */
	tokens: number;
}

/** What the system-prompt block is built from when a Turn starts. */
export interface SystemSources {
	/** The Pins the Conversation holds, in the order added. */
	pins: readonly Pin[];
	/**
	 * Turn 0's prompt, `""` included; undefined when there is none to
	 * offer, `unavailable` saying why where a Store could not answer.
	 */
	opening?: string;
	/** Why the Opening's Store could not supply it, where it could not. */
	unavailable?: "unconfigured" | "failed";
	/** Whether `recall_earlier_turns` is registered, so the notice may name it. */
	recallAvailable: boolean;
}

/**
 * The Opening's framing in the system prompt, fixed so that what began the
 * Conversation is never mistaken for something just said.
 */
export const OPENING_FRAMING =
	"This conversation began with the request below. It is context, not a new " +
	"instruction; later Turns may have changed or completed it.";

/**
 * The block's last line, carried on every Turn whether or not the tail has
 * evicted anything, so the system prompt does not change at the first
 * Eviction. Identical in every Conversation.
 */
export const EVICTION_NOTICE =
	"Older turns of this conversation may have left the context window; " +
	"search them with the recall_earlier_turns tool.";

/** Between the block's sections. */
const SECTION_BREAK = "\n\n";

/**
 * The block pi-chart appends to a Turn's system prompt: the Pins, then the
 * Opening inside its framing, then the eviction notice, each left out when
 * it has nothing to carry. Pure, so two Turns built from the same sources
 * send byte-identical blocks and the system prompt stays cached.
 */
export function systemAdditions(
	sources: SystemSources,
	config: Pick<AssemblerConfig, "opening" | "pins" | "explainCandidates">,
): SystemAdditions {
	const { pins } = sources;
	const pinText = renderPinned(pins);
	const pinned: PackPart = {
		source: "pinned",
		messages: [],
		placement: "system-prompt",
		approximateTokens: pinText === "" ? 0 : textTokens(pinText),
		carried: pins.length,
		pinIds: pins.map((pin) => pin.id),
		// Recorded, never applied: the Budget binds at `/pins add`, and a Pin
		// held is carried whatever the Budget has since become.
		budget: config.pins,
		candidates: pins.length,
		excludedCandidates: [],
		absent: pins.length === 0 ? "none" : undefined,
	};

	// Turn 0's prompt only, never its actions or reply (ADR-0014).
	const withheld = openingWithheld(sources);
	const offered = withheld === undefined ? sources.opening : undefined;
	const opened = openingSelector(offered)(config.opening);
	const openingCause = absence({
		budget: Math.min(config.opening.count, config.opening.tokens),
		carried: opened.carried,
		candidates: offered === undefined ? 0 : 1,
	});
	const opening: PackPart = {
		source: "opening",
		messages: [],
		placement: "system-prompt",
		approximateTokens: opened.tokens,
		carried: opened.carried,
		turnIndices: opened.carried > 0 ? [0] : [],
		budget: config.opening,
		candidates: offered === undefined ? 0 : 1,
		excluded: exclusion(opened),
		excludedCandidates: ledger(opened.excluded, config.explainCandidates),
		// Nothing on offer means the reason it was withheld, never "none".
		absent: openingCause === "none" ? withheld : openingCause,
		shortened: opened.shortened || undefined,
	};

	const sections = [pinText, opened.messages.map(messageText).join("")];
	if (sources.recallAvailable) sections.push(EVICTION_NOTICE);
	const text = sections.filter((section) => section !== "").join(SECTION_BREAK);
	return { text, pinned, opening, tokens: text === "" ? 0 : textTokens(text) };
}

/**
 * What a Turn whose hook failed records: nothing added to the system
 * prompt, and both parts absent for that failure rather than for a hook
 * the harness never ran.
 */
export function failedAdditions(config: Pick<AssemblerConfig, "opening" | "pins">): SystemAdditions {
	return {
		text: "",
		pinned: absentPart("pinned", config.pins, "failed"),
		opening: absentPart("opening", config.opening, "failed"),
		tokens: 0,
	};
}

/** A system-prompt part that carried nothing, and why. */
function absentPart(
	source: "pinned" | "opening",
	budget: Budget,
	absent: "unhooked" | "failed",
): PackPart {
	return {
		source,
		messages: [],
		placement: "system-prompt",
		approximateTokens: 0,
		carried: 0,
		budget,
		excludedCandidates: [],
		absent,
	};
}

/** Text as the estimator sizes it: one message holding it. */
function textTokens(text: string): number {
	return approximateTokens([{ role: "user", content: text }]);
}

function systemPartTokens(parts: PackPart[]): number {
	let total = 0;
	for (const part of parts) {
		if (part.placement === "system-prompt") total += part.approximateTokens;
	}
	return total;
}

function messagesOf(parts: PackPart[], source: PackSource): HarnessMessage[] {
	return parts.find((part) => part.source === source)?.messages ?? [];
}

function totalOf(parts: PackPart[]): number {
	let total = 0;
	for (const part of parts) total += part.approximateTokens;
	return total;
}

/** One candidate a Budget excluded, and what it would have cost. */
interface Excluded<T> {
	candidate: T;
	reason: "count" | "size";
	/** Absent where the candidate was never rendered, so never costed. */
	tokens?: number;
	/** The Budget that excluded it: a count of items or a size in tokens. */
	budget: number;
}

/** What a part selected, and what each Budget cost it. */
interface Fitted<T> {
	kept: T[];
	messages: HarnessMessage[];
	tokens: number;
	excludedByCount: number;
	excludedBySize: number;
	shortened: boolean;
	/** Messages dropped from within what it kept, not whole candidates. */
	droppedMessages?: number;
	/** Which candidates the Budgets excluded, strongest first. */
	excluded: Excluded<T>[];
}

/**
 * What a part carried under a Budget, and what each denomination cost it.
 *
 * The identities rather than the candidates: every consumer — the part it
 * fills, the ledger, the ceiling's re-selection — only ever wanted to know
 * which Turns survived.
 */
interface Selected {
	carried: number;
	messages: HarnessMessage[];
	tokens: number;
	excludedByCount: number;
	/** Turns the verbatim tail evicted; no other part evicts. */
	excludedByEviction?: number;
	excludedBySize: number;
	shortened: boolean;
	droppedMessages?: number;
	/** What the Budget kept out, by identity, strongest first. */
	excluded: ExcludedCandidate[];
	turnIndices?: number[];
}

/**
 * A part's selection, as a function of the Budget it runs under.
 *
 * One per part, called twice: once with the part's own Budget, and again
 * with the room the ceiling leaves it. One rule for both, so a part cannot
 * be selected one way under its own Budget and another under the ceiling.
 */
type Selector = (within: Budget) => Selected;

/**
 * Where in `completed` the verbatim tail starts: the first position at or
 * after the Turn `tailStart` replays to.
 *
 * Positions stand in for Turns with no index — the harness's own history
 * reconstructed in a test — so sizes taken from `completed` and the Turns
 * they size always agree. A tail disabled by a Budget of nothing evicts
 * nothing; a start past every Turn held, which only sizes disagreeing with
 * the Turns can produce, still leaves the newest.
 */
function tailFrom(
	completed: Turn[],
	tailSizes: TurnSize[] | undefined,
	config: AssemblerConfig,
): number {
	if (config.tail.count <= 0 || config.tail.tokens <= 0) return 0;
	const sizes =
		tailSizes ??
		completed.map((turn, position) => ({
			index: turn.index ?? position,
			tokens: tailTokens(turn),
		}));
	const start = tailStart(sizes, config.tail, config.tailLowWater);
	if (start === undefined) return 0;
	const from = completed.findIndex(
		(turn, position) => (turn.index ?? position) >= start,
	);
	return from === -1 ? Math.max(completed.length - 1, 0) : from;
}

/**
 * The index of the first Turn the verbatim tail carries (ADR-0013).
 *
 * Replayed over every completed Turn, oldest first: each is added behind
 * the tail, and one that carries it past either Budget evicts its oldest
 * Turns in one step, down to `mark` of both. The Turn just added is never
 * evicted. Derived, never stored, so every process that sees the same
 * sizes under the same configuration agrees where the tail starts — and
 * between Evictions the first message of the pack does not change.
 */
function tailStart(
	sizes: TurnSize[],
	budget: Budget,
	mark: number,
): number | undefined {
	const markTokens = Math.floor(mark * budget.tokens);
	const markCount = Math.max(1, Math.floor(mark * budget.count));
	let start = 0;
	let tokens = 0;
	for (let newest = 0; newest < sizes.length; newest++) {
		tokens += sizes[newest]?.tokens ?? 0;
		const over = (tokenLimit: number, countLimit: number) =>
			tokens > tokenLimit || newest - start + 1 > countLimit;
		if (!over(budget.tokens, budget.count)) continue;
		while (start < newest && over(markTokens, markCount)) {
			tokens -= sizes[start]?.tokens ?? 0;
			start++;
		}
	}
	return sizes[start]?.index;
}

/**
 * A completed Turn's size as the verbatim tail carries it: withheld calls
 * withheld. The one measure the tail's start is replayed from, wherever a
 * Turn is sized — at ingest, from the live history, or here.
 */
export function tailTokens(turn: Turn): number {
	return approximateTokens(paired(turn).messages);
}

/**
 * The verbatim tail's selector, over the Turns from its start.
 *
 * Both Budgets arrive the same way every other part's do, and the count is
 * applied here rather than by the caller, so `Selected.excludedByCount`
 * means the same thing for the tail as for every other part.
 *
 * Newest Turn first and kept in order. Unlike every other part the tail may
 * not come back empty: its newest Turn is retained, shrunk by its oldest
 * actions when it cannot fit whole, because that Turn is what the current
 * one is reasoning about. Only a configured Budget of nothing, which
 * `keepsNewest` carries, disables it; a ceiling leaving no room does not.
 * Neither moves the start: the ceiling re-runs this over the same Turns.
 */
function tailSelector(
	completed: Turn[],
	from: number,
	keepsNewest: boolean,
): Selector {
	return (within) => {
		// A disabled tail evicts nothing: what it does not carry, its
		// Budget of nothing excluded.
		const evicted = within.count > 0 ? from : 0;
		const window = completed.slice(evicted);
		const byCount = (
			within.count > 0 ? window.slice(-within.count) : []
		).map(paired);
		const byCountExcluded = window.length - byCount.length;
		// Older than everything the window held, so after what the size
		// Budget kept out; newest first, the order a reader misses them in.
		const beyondCount: ExcludedCandidate[] = window
			.slice(0, byCountExcluded)
			.reverse()
			.map((turn) => ({
				turnIndex: turn.index,
				reason: "count" as const,
				budget: within.count,
			}));
		const evictedTurns: ExcludedCandidate[] = completed
			.slice(0, evicted)
			.reverse()
			.map((turn) => ({ turnIndex: turn.index, reason: "evicted" as const }));
		const fitted = fitTail(byCount, within.tokens, keepsNewest);
		return {
			carried: fitted.kept.length,
			messages: fitted.messages,
			tokens: fitted.tokens,
			excludedByCount: byCountExcluded,
			excludedBySize: fitted.excludedBySize,
			excludedByEviction: evicted,
			shortened: fitted.shortened,
			droppedMessages: fitted.droppedMessages,
			excluded: [
				...byBudget(fitted, (turn) => ({ turnIndex: turn.index })),
				...beyondCount,
				...evictedTurns,
			],
			turnIndices: fitted.kept
				.map((turn) => turn.index)
				.filter((index) => index !== undefined),
		};
	};
}

/**
 * The size Budget's half of the tail: how far back it reaches.
 *
 * The count is not its business — `tailSelector` applies it before this
 * runs — so it does not report a count exclusion it did not make.
 */
function fitTail(
	byCount: Turn[],
	tokenBudget: number,
	keepsNewest: boolean,
): Omit<Fitted<Turn>, "excludedByCount"> {
	const budget = Math.max(tokenBudget, 0);
	const kept: Turn[] = [];
	let tokens = 0;

	for (let index = byCount.length - 1; index >= 0; index--) {
		const turn = byCount[index];
		if (turn === undefined) continue;
		const cost = approximateTokens(turn.messages);
		if (tokens + cost > budget) break;
		kept.unshift(turn);
		tokens += cost;
	}

	// The oldest Turns of the window, in the order the tail gave them up:
	// newest of the excluded first, because the newest is what a reader
	// misses first.
	const excluded = (count: number): Excluded<Turn>[] =>
		byCount
			.slice(0, Math.max(count, 0))
			.reverse()
			.map((turn) => ({
				candidate: turn,
				reason: "size" as const,
				tokens: approximateTokens(turn.messages),
				budget: budget,
			}));

	if (kept.length === 0) {
		const newest = byCount[byCount.length - 1];
		if (newest === undefined || !keepsNewest) {
			return {
				kept: [],
				messages: [],
				tokens: 0,
				excludedBySize: byCount.length,
				shortened: false,
				excluded: excluded(byCount.length),
			};
		}
		const shrunk = shrinkTurn(newest.messages, budget);
		return {
			kept: [newest],
			messages: shrunk.messages,
			tokens: shrunk.tokens,
			excludedBySize: byCount.length - 1,
			shortened: shrunk.shortened,
			droppedMessages: shrunk.droppedMessages || undefined,
			excluded: excluded(byCount.length - 1),
		};
	}

	return {
		kept,
		messages: kept.flatMap((turn) => turn.messages),
		tokens,
		excludedBySize: byCount.length - kept.length,
		shortened: false,
		excluded: excluded(byCount.length - kept.length),
	};
}

/**
 * A Turn with its unanswered tool calls withheld.
 *
 * A provider rejects a Context Window carrying a call with no result, so a
 * Turn the agent was interrupted mid-tool cannot be replayed as it stands.
 * Only the call goes: the prompt, the prose, and every answered call with
 * its result stay, and a message left with nothing but the withheld call
 * goes with it rather than arriving empty.
 *
 * A Turn whose calls were all answered is returned as it came, by identity,
 * so a tail assembled under this rule is the same object graph as one
 * assembled without it.
 */
function paired(turn: Turn): Turn {
	const answered = answeredCalls(turn.messages);
	let withheld = false;

	const messages: HarnessMessage[] = [];
	for (const message of turn.messages) {
		const content = message.content;
		if (!Array.isArray(content)) {
			messages.push(message);
			continue;
		}
		const kept = content.filter(
			(block) =>
				!isToolCall(block) || answered.has(block.id),
		);
		if (kept.length === content.length) {
			messages.push(message);
			continue;
		}
		withheld = true;
		// A message that carried nothing but the withheld call has nothing
		// left to say; one that also carried text keeps the text.
		if (kept.length > 0) messages.push({ ...message, content: kept });
	}

	return withheld ? { ...turn, messages } : turn;
}

function exclusion(
	fitted: Pick<Selected, "excludedByCount" | "excludedBySize" | "excludedByEviction">,
): PartExclusion | undefined {
	const result: PartExclusion = {};
	if (fitted.excludedByCount > 0) result.count = fitted.excludedByCount;
	if (fitted.excludedBySize > 0) result.size = fitted.excludedBySize;
	if ((fitted.excludedByEviction ?? 0) > 0) result.evicted = fitted.excludedByEviction;
	return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * A part's excluded candidates, cut to the retained head. What is cut
 * survives in `PartExclusion`'s counts, which is why the counts stay.
 */
function ledger(candidates: ExcludedCandidate[], bound: number): ExcludedCandidate[] {
	return bound <= 0 ? [] : candidates.slice(0, bound);
}

/** The candidates a part's own Budgets excluded, named. */
function byBudget<T>(
	fitted: Pick<Fitted<T>, "excluded">,
	identify: (candidate: T) => Omit<ExcludedCandidate, "reason">,
): ExcludedCandidate[] {
	return fitted.excluded.map((each) => ({
		...identify(each.candidate),
		reason: each.reason,
		tokens: each.tokens,
		budget: each.budget,
	}));
}

/**
 * Why a part contributed nothing, where it contributed nothing.
 *
 * Order matters: a Budget of zero is a decision and outranks everything
 * that follows, an unreachable Store outranks its empty results, and
 * candidates that existed rule out "there were none".
 */
function absence(part: {
	budget: number;
	carried: number;
	candidates: number;
	unavailable?: "unconfigured" | "failed";
}): AbsenceCause | undefined {
	if (part.carried > 0) return undefined;
	if (part.budget <= 0) return "disabled";
	if (part.unavailable !== undefined) return part.unavailable;
	if (part.candidates > 0) return "size";
	return "none";
}

/**
 * Why the Opening has nothing to offer, first match wins; undefined when
 * Turn 0's prompt is on offer. A Budget of nothing outranks all of these,
 * as for every part, and is decided by `absence`.
 */
function openingWithheld(
	source: Pick<SystemSources, "opening" | "unavailable">,
): AbsenceCause | undefined {
	if (source.unavailable !== undefined) return source.unavailable;
	if (source.opening === undefined) return "missing";
	if (source.opening.trim() === "") return "empty";
	return undefined;
}

function asOpening(prompt: string): HarnessMessage {
	return { role: "user", content: `${OPENING_FRAMING}\n${prompt}` };
}

/**
 * The Opening's selection: the prompt whole when it fits, else elided to
 * its Budget, else nothing. `prompt` is undefined when there is nothing to
 * offer, whatever the reason.
 */
function openingSelector(prompt: string | undefined): Selector {
	return (within) => {
		const nothing: Selected = {
			carried: 0,
			messages: [],
			tokens: 0,
			excludedByCount: 0,
			excludedBySize: 0,
			shortened: false,
			excluded: [],
			turnIndices: [],
		};
		if (prompt === undefined) return nothing;
		if (within.count < 1) {
			return {
				...nothing,
				excludedByCount: 1,
				excluded: [{ turnIndex: 0, reason: "count", budget: within.count }],
			};
		}

		const whole = asOpening(prompt);
		const cost = approximateTokens([whole]);
		const carried = (message: HarnessMessage, tokens: number, shortened: boolean): Selected => ({
			...nothing,
			carried: 1,
			messages: [message],
			tokens,
			shortened,
			turnIndices: [0],
		});
		if (cost <= within.tokens) return carried(whole, cost, false);

		const elided = within.tokens >= SHORTEST_TOKENS ? elidedOpening(prompt, within.tokens) : undefined;
		if (elided === undefined) {
			return {
				...nothing,
				excludedBySize: 1,
				excluded: [{ turnIndex: 0, reason: "size", tokens: cost, budget: within.tokens }],
			};
		}
		return carried(elided.message, elided.tokens, true);
	};
}

/**
 * The Opening elided to `allowance`. Sized by construction then checked,
 * as a recollection is, because JSON escaping makes the estimate of the
 * elided prompt a non-linear function of the characters kept.
 */
function elidedOpening(
	prompt: string,
	allowance: number,
): { message: HarnessMessage; tokens: number } | undefined {
	const fixed = approximateTokens([asOpening("")]) * 4;
	for (const room of shrinkingRooms(allowance * 4 - fixed)) {
		const kept = elide(prompt, room);
		if (kept === undefined) return undefined;
		const message = asOpening(kept);
		const tokens = approximateTokens([message]);
		if (tokens <= allowance) return { message, tokens };
	}
	return undefined;
}

/**
 * The character allowances to try, largest first, when the estimate of
 * what is kept is a non-linear function of the characters kept: each one
 * 10% and a character under the last, while any room is left.
 */
function* shrinkingRooms(start: number): Generator<number> {
	for (let room = start; room > 0; room = Math.floor(room * 0.9) - 1) yield room;
}

/**
 * A Concept enters the window as knowledge with a source. Curated knowledge
 * the agent did not derive must be visibly borrowed, or it cannot be
 * questioned.
 *
 * What is returned is usually one section of a Concept, not the Concept, so
 * the header says which part it is and how many there are, and the rest is
 * offered through `walk_documentation`. A fragment
 * headed with the Concept's name alone reads as the Concept's complete
 * answer — the one thing curated knowledge must never do.
 *
 * What a Concept declares it is *not* travels with it: a definition served
 * without the exclusions that bound it invites the mistake they exist to
 * prevent.
 */
export function asCuratedKnowledge(
	hit: ConceptHit,
	allowance = Number.POSITIVE_INFINITY,
): HarnessMessage {
	const caveat = hit.stale ? " (stale)" : "";
	const partial = hit.sectionCount > 1;
	const part = partial
		? ` — part ${hit.sectionIndex + 1} of ${hit.sectionCount}`
		: "";
	const header = `[curated knowledge: ${hit.conceptId}${part}${caveat}]`;
	const after: string[] = [];
	for (const exclusion of hit.exclusions ?? []) {
		const why = exclusion.why ? ` — ${exclusion.why}` : "";
		const instead = exclusion.instead ? ` Use instead: ${exclusion.instead}` : "";
		after.push(`Not: ${exclusion.term}${why}${instead}`);
	}
	if (partial) {
		after.push(`(the rest of ${hit.conceptId} is readable with walk_documentation)`);
	}
	const message = (text: string): HarnessMessage => ({
		role: "user",
		content: [header, text, ...after].join("\n"),
	});
	const whole = message(hit.text);
	if (approximateTokens([whole]) <= allowance) return whole;
	// Only the section's text gives way: what the Concept is, what it is not
	// and where the rest lives must survive any cut, or the fragment would
	// read as the whole answer.
	const fixed = approximateTokens([message("")]);
	for (const room of shrinkingRooms(Math.max((allowance - fixed) * 4, 0))) {
		const kept = elide(hit.text, room);
		if (kept === undefined) break;
		const shortened = message(kept);
		if (approximateTokens([shortened]) <= allowance) return shortened;
	}
	return message(elidedWhole(hit.text));
}

/**
 * A recalled Turn enters the window as one attributed message, not as a
 * replayed exchange: the model must be able to tell what was said just now
 * from what is being remembered.
 *
 * It carries what the Turn did as well as what came back. A result with no
 * call attached is an answer to a question nobody can see, and until this
 * carried calls that is what a recalled tool-using Turn was: `messageText`
 * returns text blocks only, so the call vanished and its output survived.
 *
 * `allowance` is the estimated tokens the recollection may cost. Over it,
 * three things give way in turn: the outputs first, the prose second, and
 * last the arguments the calls were made with. What never gives way is the
 * attribution and the name of each call — the short, irreplaceable half. A
 * recollection reduced to who spoke and what they called still says what
 * the Turn did; one reduced to its output alone is an answer with no
 * question attached.
 */
export function asRecollection(
	recalled: RecalledTurn,
	allowance = Number.POSITIVE_INFINITY,
): HarnessMessage {
	const header = `[recalled from turn ${recalled.turnIndex} of this conversation]`;
	const lines = recollectionLines(recalled.turn.messages);
	const whole = recollection(header, lines.map((line) => lineText(line)));
	if (approximateTokens([whole]) <= allowance) return whole;

	let best = whole;
	for (const shortenable of GIVING_ORDER) {
		best = fitRecollection(header, lines, allowance, shortenable);
		if (approximateTokens([best]) <= allowance) return best;
	}
	return best;
}

/**
 * What may be shortened, in the order it is asked of: the outputs, then the
 * prose as well, then the call arguments too.
 *
 * Each pass is tried whole before the next is reached, so a Turn only gives
 * up its arguments when shortening everything it said could not fit.
 */
const GIVING_ORDER: ReadonlyArray<(line: RecollectionLine) => boolean> = [
	(line) => line.kind === "output",
	(line) => line.kind !== "action",
	() => true,
];

/**
 * Renders a recollection whose shortenable lines are shrunk until the whole
 * fits its allowance.
 *
 * Sized by construction then checked, because JSON escaping makes the
 * estimate of the shortened message a non-linear function of the characters
 * kept. `shortenable` decides which lines may give way; what it excludes is
 * charged as fixed cost.
 */
function fitRecollection(
	header: string,
	lines: RecollectionLine[],
	allowance: number,
	shortenable: (line: RecollectionLine) => boolean,
): HarnessMessage {
	const fixed = lines.reduce(
		(total, line) =>
			total +
			line.prefix.length +
			line.suffix.length +
			1 +
			(shortenable(line) ? 0 : line.payload.length),
		header.length,
	);
	const giving = lines.filter(shortenable);
	const build = (room: number): HarnessMessage => {
		const allocation = shares(
			giving.map((line) => line.payload.length),
			room,
		);
		let at = 0;
		const shortened = lines.map((line) => {
			if (!shortenable(line)) return lineText(line);
			return lineText(line, elideLine(line.payload, allocation[at++] ?? 0));
		});
		return { ...recollection(header, shortened), piChartShortened: true };
	};
	for (const room of shrinkingRooms(allowance * 4 - fixed)) {
		const best = build(room);
		if (approximateTokens([best]) <= allowance) return best;
	}
	return build(0);
}

/** One line of a recollection, split into what may give way and what may not. */
interface RecollectionLine {
	/**
	 * Who said it and, for a call, what was called. Never shortened: a line
	 * that lost this is a fragment nobody can attribute.
	 */
	prefix: string;
	/** What the line carries — said, returned, or passed to a call. */
	payload: string;
	/** What closes it: a call's bracket, and whether anything answered it. */
	suffix: string;
	/**
	 * What the line is, which decides when its payload gives way: what an
	 * action returned goes first, what the agent said second, and what a
	 * call passed only when neither was enough.
	 */
	kind: "output" | "prose" | "action";
}

/** A line as text, with its payload shortened or whole. */
function lineText(line: RecollectionLine, payload = line.payload): string {
	return `${line.prefix}${payload}${line.suffix}`;
}

function recollection(header: string, lines: string[]): HarnessMessage {
	return { role: "user", content: `${header}\n${lines.join("\n")}` };
}

/** A recalled Turn as attributed lines: who said it, or what was called. */
function recollectionLines(messages: HarnessMessage[]): RecollectionLine[] {
	const answered = answeredCalls(messages);
	const lines: RecollectionLine[] = [];

	for (const message of messages) {
		const text = messageText(message).trim();
		if (text !== "") {
			lines.push({
				prefix: `${message.role}: `,
				payload: text,
				suffix: "",
				kind: message.role === "toolResult" ? "output" : "prose",
			});
		}

		const content = message.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (!isToolCall(block)) continue;
			const call = block;
			// A call nothing answered is history worth having: this is text,
			// not protocol, so it is labelled rather than withheld the way
			// the verbatim tail must withhold it.
			const unanswered = answered.has(call.id) ? "" : " — no result recorded";
			const { head, passed, tail } = toolCallText(call);
			lines.push({
				prefix: `${message.role}: ${head}`,
				payload: passed,
				suffix: `${tail}${unanswered}`,
				kind: "action",
			});
		}
	}
	return lines;
}

/** The calls of a Turn that a result in the same Turn answered. */
function answeredCalls(messages: HarnessMessage[]): Set<string> {
	const answered = new Set<string>();
	for (const message of messages) {
		if (message.role !== "toolResult") continue;
		if (typeof message.toolCallId === "string") answered.add(message.toolCallId);
	}
	return answered;
}

/**
 * Brings a pack within its ceiling, in place, the system-prompt additions
 * already reserved out of it.
 *
 * The tail is re-selected under the room the current Turn leaves it, so it
 * loses its oldest Turns the way its own Budget would have made it lose
 * them. The current Turn and the tail's newest Turn are never dropped: the
 * tail keeps that Turn at its smallest form, and when what is left still
 * exceeds the ceiling the current Turn's tool results are elided.
 */
function reduceToCeiling(
	parts: PackPart[],
	ceiling: number,
	bound: number,
	tail: { select: Selector; budget: Budget },
): void {
	const ceilingTokens = Math.max(ceiling, 0);
	// The system-prompt parts are reserved out of the ceiling, never reduced.
	const sent = () => totalOf(parts) - systemPartTokens(parts);
	if (sent() <= ceilingTokens) return;

	const part = parts.find((each) => each.source === "verbatim-tail");
	// A tail that carried nothing has nothing to give up, and reducing it
	// would record a ceiling that took what was never there.
	if (part !== undefined && (part.carried ?? 0) > 0) {
		const carriedBefore = part.carried ?? 0;
		const sizeBefore = part.approximateTokens;
		const before = part.turnIndices ?? [];
		const room = Math.max(ceilingTokens - (sent() - sizeBefore), 0);
		// The tail's own count still applies: the ceiling takes size, and a
		// tail reduced by it is the same selection under less room. Its
		// newest Turn is never dropped (ADR-0012): its smallest form counts
		// even over the room, and the current Turn is elided around it.
		const result = tail.select({ count: tail.budget.count, tokens: room });
		part.withoutCeiling = sizeBefore;
		part.messages = result.messages;
		part.approximateTokens = result.tokens;
		part.carried = result.carried;
		part.turnIndices = result.turnIndices ?? [];
		part.shortened = result.shortened || undefined;
		part.droppedMessages = result.droppedMessages;
		part.excluded = {
			...(part.excluded ?? {}),
			ceiling: carriedBefore - result.carried,
		};
		// What the ceiling took leads the ledger — and the ledger is re-cut,
		// because the head is a bound on what is retained, not on what is
		// added last. Oldest first: the ceiling took the oldest Turns.
		const kept = new Set(part.turnIndices);
		part.excludedCandidates = ledger(
			[
				...before
					.filter((index) => !kept.has(index))
					.map((turnIndex) => ({ turnIndex, reason: "ceiling" as const })),
				...(part.excludedCandidates ?? []),
			],
			bound,
		);
		if (result.carried === 0) part.absent = "size";
	}

	if (sent() <= ceilingTokens) return;

	// Only the current Turn is left to give, and it may not be dropped.
	const current = parts.find((each) => each.source === "current-turn");
	if (current === undefined) return;
	const others = sent() - current.approximateTokens;
	const result = elideTurn(
		current.messages,
		Math.max(ceilingTokens - others, 0),
	);
	current.withoutCeiling = current.approximateTokens;
	current.messages = result.messages;
	current.approximateTokens = result.tokens;
	current.shortened = result.shortened || undefined;
	current.excluded = { ...(current.excluded ?? {}), ceiling: 0 };
}
