import {
	isToolCall,
	messageText,
	toolCallText,
	type HarnessMessage,
	type Turn,
} from "./messages.ts";
import { elideLine, elideTurn, SHORTEST_TOKENS } from "./elision.ts";
import { approximateTokens } from "./tokens.ts";
import { shares } from "./shares.ts";
import type { ConceptHit, ConceptMiss } from "./doc-index.ts";
import { describeEdge, qualify, type Neighbourhood } from "./symbols.ts";
import type { RecalledTurn, TurnMiss } from "./thread-store.ts";

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
	/** Turns a pack may carry that were recalled by meaning. */
	recall: Budget;
	/** Concepts a pack may carry. A count of zero disables curated knowledge. */
	docs: Budget;
	/** Symbols' neighbourhoods a pack may carry. A count of zero disables them. */
	graph: Budget;
	/**
	 * The whole pack's ceiling, in estimated tokens, independent of any one
	 * part's Budget. When the selected parts exceed it they are reduced in a
	 * fixed order, so an oversized pack is still a deterministic pack.
	 */
	packTokens: number;
	/**
	 * The relevance thresholds the retrieving parts selected against, as
	 * cosine distance. Recorded beside what each part carried: a part that
	 * carried little against a threshold set too tight is a different fact
	 * from one whose corpus held nothing, and only the threshold in force
	 * tells them apart afterwards.
	 */
	recallMaxDistance: number;
	docMaxDistance: number;
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
export type PackSource =
	| "verbatim-tail"
	| "current-turn"
	| "recalled"
	| "curated"
	| "structure";

export interface PackPart {
	source: PackSource;
	messages: HarnessMessage[];
	/**
	 * Local character-based estimate. Approximate by construction: nothing
	 * reports per-part cost, so this is never used for pack-versus-Floor.
	 */
	approximateTokens: number;
	/** How many Turns this part carried, known even when their positions are not. */
	carried?: number;
	/**
	 * Which Turns this part carried, by their position in the Conversation.
	 * Absent for content whose position is not known — identity, not count:
	 * `carried` is the count, so a pack is never reported as empty merely
	 * because its Turns have no position yet.
	 */
	turnIndices?: number[];
	/** Which Concepts this part carried, by id. Identity, not count. */
	conceptIds?: string[];
	/** Which symbols this part carried, by name. Identity, not count. */
	symbols?: string[];
	/**
	 * The Budget that bounded this part, where one did. Recorded beside
	 * what the part spent, because a part carrying irreducible content can
	 * exceed the size half of it: a Turn of many messages, each already at
	 * the shortest length worth carrying, has a floor no Budget can argue
	 * with.
	 */
	budget?: Budget;
	/**
	 * How many candidates were refused for being insufficiently relevant, as
	 * opposed to excluded by the Budget. A part that carried little because
	 * little was relevant is a different fact from one that was trimmed.
	 */
	irrelevant?: number;
	/**
	 * How many candidates the part chose from. Larger than what it carried
	 * means the Budget was the binding constraint — the cheapest signal that
	 * a Budget is too small.
	 */
	candidates?: number;
	/**
	 * Why this part carried less than its candidates offered. Distinct
	 * reasons, because "nothing was relevant", "the count ran out", "the
	 * size ran out" and "the pack had to shrink" call for different
	 * responses from whoever reads the accounting.
	 */
	excluded?: PartExclusion;
	/**
	 * Which candidates it did not carry, by identity, nearest first and
	 * bounded to the retained head. `excluded` counts them; this names
	 * them, which is what makes an absence explainable rather than
	 * arithmetic.
	 */
	excludedCandidates?: ExcludedCandidate[];
	/** The relevance threshold this part selected against, where it had one. */
	threshold?: number;
	/**
	 * True where the part has no relevance threshold at all. Recorded
	 * rather than left absent, so a part that cannot refuse for irrelevance
	 * is distinguishable from one that refused nothing.
	 */
	unranked?: true;
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
}

export interface Pack {
	messages: HarnessMessage[];
	parts: PackPart[];
	/**
	 * How much of the Pack the harness supplied itself, and so can mark for
	 * caching: the approximate size of the run this Pack leads with. Zero
	 * when nothing the Assembler carried agreed with the harness's array at
	 * its own index, which is what a Call with nothing cached looks like
	 * from this side.
	 */
	leadingTokens: number;
	/** The Budgets in force for this Call, whether or not a part used them. */
	budgets: { tail: number; recall: number; docs: number; graph: number };
	/**
	 * Candidates retrieval refused as not relevant enough. A Call-level fact,
	 * not a part's: when everything is refused there is no recalled part to
	 * hang it on, and that is exactly the case worth explaining.
	 */
	rejected: number;
	/**
	 * Turns of the Conversation retrieval could not see, because they hold
	 * no valid vector yet. Call-level for the same reason as `rejected`, and
	 * distinct from it: a recall thinned by re-embedding is not a
	 * Conversation with nothing relevant in it.
	 */
	unsearched: number;
	/**
	 * Concepts the Doc Store could not rank at all, because their vectors
	 * were made by another embedding model. Beside `unsearched` rather
	 * than folded into it: the two Stores re-embed on their own schedules,
	 * and a curated part thinned by one of them is not a Conversation
	 * missing recall.
	 */
	conceptsUnsearched: number;
	/** The pack ceiling in force, and whether it had to bind. */
	ceiling: number;
	/**
	 * What the parts came to before the ceiling reduced them. Equal to
	 * `approximateTokens` when the ceiling did not bind, which is how a
	 * reader tells a pack that fitted from one that was made to fit.
	 */
	beforeCeiling: number;
	/** Sum of the parts' approximations. Approximate, for attribution only. */
	approximateTokens: number;
}

/**
 * Why a part carried less than it could have. Counts, not identities: what
 * was refused is the Journal's and the bundle's business, not the
 * accounting's.
 */
export interface PartExclusion {
	/** Refused as insufficiently relevant, before any Budget applied. */
	irrelevant?: number;
	/** Excluded because the part's count Budget was exhausted. */
	count?: number;
	/** Excluded because the part's token Budget was exhausted. */
	size?: number;
	/** Excluded or shortened because the pack exceeded its ceiling. */
	ceiling?: number;
}

/** Why a candidate was offered to a part and not carried. */
export type ExclusionReason = "irrelevant" | "count" | "size" | "ceiling";

/**
 * One candidate a part did not carry, by identity.
 *
 * Identity, distance, size and reason — never the text, the embedding, or
 * anything else that would make Accounting a second copy of the Journal or
 * the bundle. A Turn refused at 0.61 is readable in full by its position.
 */
export interface ExcludedCandidate {
	/** A Turn by its position in the Conversation. */
	turnIndex?: number;
	/** A Concept by its id. */
	conceptId?: string;
	/** A symbol by its qualified name. */
	symbol?: string;
	reason: ExclusionReason;
	/** How far it sat from the prompt, where relevance ranked it. */
	distance?: number;
	/** What carrying it would have cost, where a size Budget decided. */
	tokens?: number;
	/** The relevance threshold it failed, where relevance decided. */
	threshold?: number;
	/** The count or token Budget that excluded it, where one did. */
	budget?: number;
}

/**
 * Why a part contributed nothing. A part that carried nothing because its
 * Store was never configured calls for a different response from one whose
 * threshold refused everything, and an absence with no cause reads as
 * neither.
 */
export type AbsenceCause =
	/** Its count Budget is zero: excluded deliberately, not for want of supply. */
	| "disabled"
	/** No Store was configured to supply it. */
	| "unconfigured"
	/** Retrieval was attempted and failed, or did not answer in time. */
	| "failed"
	/** There were no candidates to consider. */
	| "none"
	/** There were candidates and none met the relevance threshold. */
	| "irrelevant"
	/** There were candidates and none fitted the size Budget. */
	| "size";

export interface AssembleInput {
	/** Turns to carry verbatim: the recent ones, current Turn last. */
	turns: Turn[];
	/**
	 * The messages the harness supplied for this Call, in its own order.
	 * Read only to decide how much of the tail can lead the Pack unaltered:
	 * the harness caches a returned array as far as the first message that
	 * differs from its own at that index, so a Pack that opens with an
	 * assembled part is cached not at all (ADR-0005). Nothing is carried
	 * from here that the Turns do not already hold.
	 */
	supplied?: HarnessMessage[];
	/** Turns found by meaning, most relevant first. */
	recalled?: RecalledTurn[];
	/** How many candidates retrieval refused as not relevant enough. */
	rejected?: number;
	/** Turns recall refused, nearest first: position and distance only. */
	recallMisses?: TurnMiss[];
	/** How many Turns of the Conversation retrieval could not see at all. */
	unsearched?: number;
	/** Concepts found in the Doc Store, most relevant first. */
	concepts?: ConceptHit[];
	/** How many Concepts the Doc Store refused as not relevant enough. */
	conceptsRejected?: number;
	/** Concepts the Doc Store refused, nearest first. */
	conceptMisses?: ConceptMiss[];
	/** How many Concepts the Doc Store could not rank at all. */
	conceptsUnsearched?: number;
	/** Neighbourhoods of the symbols this prompt refers to. */
	structure?: Neighbourhood[];
	/**
	 * Parts no Store could supply, and why. A part absent because nothing
	 * was configured to fill it is a different fact from one absent because
	 * nothing relevant was found, and only the caller knows which.
	 */
	unavailable?: Partial<Record<PackSource, "unconfigured" | "failed">>;
}

/**
 * Builds the Context Pack for one Call: the run of messages the harness
 * already sent, the parts this Assembler composed, the rest of the verbatim
 * tail, then the Turn in progress — see `compose` for why it opens that
 * way. Pure — no I/O, no clock, no randomness — so the same inputs always
 * produce the same pack.
 */
export function assemble(input: AssembleInput, config: AssemblerConfig): Pack {
	const {
		turns,
		supplied = [],
		recalled = [],
		rejected = 0,
		recallMisses = [],
		unsearched = 0,
		concepts = [],
		conceptsRejected = 0,
		conceptMisses = [],
		conceptsUnsearched = 0,
		structure = [],
		unavailable = {},
	} = input;
	const bound = config.explainCandidates;

	const current = turns[turns.length - 1];
	const completed = turns.slice(0, -1);
	// The Turns the tail will reach, needed here as well because a
	// recollection of a Turn the tail already carries is a Turn in the
	// window twice. Withheld calls are applied here rather than at ingest:
	// the Journal recorded what happened, and an unanswered call is part of
	// what happened. It is the Context Window that may not carry one — a
	// provider refuses a call with no result outright — so the refusal
	// belongs where messages become protocol messages, which is also where
	// Turns from the live array pass.
	const inTail = (
		config.tail.count > 0 ? completed.slice(-config.tail.count) : []
	).map(paired);

	const parts: PackPart[] = [];

	// Recall comes first among the parts this Assembler composes, all of
	// which are background for the Turns that follow them, and it is
	// trimmed to its own Budget so it can never crowd out the tail.
	const carried = inTail.concat(current ? [current] : []);
	const eligible = eligibleRecollections(recalled, carried);
	const selectRecall = selecting(
		eligible,
		(each, allowance) => [asRecollection(each, allowance)],
		(each) => ({ turnIndex: each.turnIndex }),
		(kept) => ({ turnIndices: kept.map((each) => each.turnIndex) }),
		"shorten",
	);
	const recollections = selectRecall(config.recall);
	parts.push({
		source: "recalled",
		messages: recollections.messages,
		approximateTokens: recollections.tokens,
		carried: recollections.carried,
		turnIndices: recollections.turnIndices,
		budget: config.recall,
		candidates: eligible.length,
		irrelevant: rejected,
		threshold: config.recallMaxDistance,
		excluded: exclusion(rejected, recollections),
		excludedCandidates: ledger(
			[
				...recollections.excluded,
				...refused(recallMisses, config.recallMaxDistance, (miss) => ({
					turnIndex: miss.turnIndex,
				})),
			],
			bound,
		),
		absent: absence({
			budget: config.recall.count,
			carried: recollections.carried,
			candidates: eligible.length,
			rejected,
			unavailable: unavailable.recalled,
		}),
		shortened: recollections.shortened || undefined,
	});

	// Curated knowledge sits with recall, ahead of the newest Turns: it is
	// background the agent is being given, not something it just said.
	const selectCurated = selecting(
		concepts,
		(hit) => [asCuratedKnowledge(hit)],
		(hit) => ({ conceptId: hit.conceptId, distance: hit.distance }),
		(kept) => ({ conceptIds: kept.map((hit) => hit.conceptId) }),
	);
	const curated = selectCurated(config.docs);
	parts.push({
		source: "curated",
		messages: curated.messages,
		approximateTokens: curated.tokens,
		carried: curated.carried,
		conceptIds: curated.conceptIds,
		budget: config.docs,
		candidates: concepts.length,
		irrelevant: conceptsRejected,
		threshold: config.docMaxDistance,
		excluded: exclusion(conceptsRejected, curated),
		excludedCandidates: ledger(
			[
				...curated.excluded,
				...refused(conceptMisses, config.docMaxDistance, (miss) => ({
					conceptId: miss.conceptId,
				})),
			],
			bound,
		),
		absent: absence({
			budget: config.docs.count,
			carried: curated.carried,
			candidates: concepts.length,
			rejected: conceptsRejected,
			unavailable: unavailable.curated,
		}),
		shortened: curated.shortened || undefined,
	});

	// Structure is what the Codebase is, so it comes before what was said
	// about it — and ahead of the tail for the same reason recall is.
	const selectStructure = selecting(
		structure,
		(each) => [asStructure(each)],
		(each) => ({ symbol: qualify(each.symbol) }),
		(kept) => ({ symbols: kept.map((each) => qualify(each.symbol)) }),
	);
	const structural = selectStructure(config.graph);
	parts.push({
		source: "structure",
		messages: structural.messages,
		approximateTokens: structural.tokens,
		carried: structural.carried,
		symbols: structural.symbols,
		budget: config.graph,
		candidates: structure.length,
		// Symbols are matched by name, not ranked by distance, so this part
		// cannot refuse anything for irrelevance and says so.
		unranked: true,
		excluded: exclusion(0, structural),
		excludedCandidates: ledger(structural.excluded, bound),
		absent: absence({
			budget: config.graph.count,
			carried: structural.carried,
			candidates: structure.length,
			rejected: 0,
			unavailable: unavailable.structure,
		}),
		shortened: structural.shortened || undefined,
	});

	// The tail fills from its most recent Turn backwards, and the most recent
	// Turn is kept even when it alone exceeds the Budget — shortened, not
	// dropped. Measured on real Journals, the newest completed Turn of a
	// working session can be three times the whole tail Budget, and a
	// drop-only rule would empty the tail exactly when working state matters
	// most.
	const selectTail = tailSelector(completed);
	const tail = selectTail(config.tail);
	parts.push({
		source: "verbatim-tail",
		messages: tail.messages,
		approximateTokens: tail.tokens,
		carried: tail.carried,
		turnIndices: tail.turnIndices,
		budget: config.tail,
		candidates: completed.length,
		// Recency, not relevance: the tail takes the newest Turns whatever
		// they are about.
		unranked: true,
		excluded: exclusion(0, tail),
		excludedCandidates: ledger(tail.excluded, bound),
		absent: absence({
			budget: config.tail.count,
			carried: tail.carried,
			candidates: completed.length,
			rejected: 0,
			unavailable: unavailable["verbatim-tail"],
		}),
		shortened: tail.shortened || undefined,
	});

	// The current Turn is never dropped and never trimmed to a Budget: it is
	// the prompt being answered. Only the ceiling may shorten it.
	parts.push({
		source: "current-turn",
		messages: current?.messages ?? [],
		approximateTokens: current ? approximateTokens(current.messages) : 0,
		carried: current ? 1 : 0,
		turnIndices: current?.index === undefined ? [] : [current.index],
		// The prompt being answered: no Budget selects it and nothing
		// competes with it, so it has neither candidates nor a threshold.
		unranked: true,
		excludedCandidates: [],
		absent: current === undefined ? "none" : undefined,
	});

	const beforeCeiling = totalOf(parts);
	// Reduction re-runs selection under a smaller Budget rather than editing
	// the messages a part already chose, so one rule decides what a part
	// carries whether the part's own Budget or the pack's ceiling is what
	// binds. The order is reconstructibility: structure is one grep away, a
	// Concept is retrievable next Call, a recollection is re-retrievable
	// within the Conversation, and the tail is irreplaceable working state.
	reduceToCeiling(parts, config.packTokens, bound, {
		structure: { select: selectStructure, budget: config.graph },
		curated: { select: selectCurated, budget: config.docs },
		recalled: { select: selectRecall, budget: config.recall },
		"verbatim-tail": { select: selectTail, budget: config.tail },
	});

	const composed = compose(parts, supplied);
	return {
		messages: composed.messages,
		// What the harness can recognise, in tokens rather than messages:
		// what a cache reads back is measured in tokens, and a run of six
		// short messages and a run of six long ones are not the same offer.
		leadingTokens: approximateTokens(composed.leading),
		parts,
		budgets: {
			tail: config.tail.count,
			recall: config.recall.count,
			docs: config.docs.count,
			graph: config.graph.count,
		},
		rejected,
		unsearched,
		conceptsUnsearched,
		ceiling: config.packTokens,
		beforeCeiling,
		approximateTokens: totalOf(parts),
	};
}

/**
 * The Pack's messages: the run of tail messages the harness itself sent,
 * then the assembled parts, then whatever of the tail it did not send, then
 * the Turn in progress.
 *
 * The harness caches a returned array only as far as the first message that
 * is not its own at that index, so a Pack that opens with an assembled part
 * offers no prefix to cache at all — measured at 0.0% of the Pack against
 * 97.2% ungoverned (ADR-0005). Leading with the run is what gives it one.
 *
 * The run comes out of the tail because no other part can: recalled Turns,
 * Concepts and structure are prose this Assembler wrote, and the Turn in
 * progress is the prompt being answered and ends the Pack. Splitting the
 * tail keeps it in order — the run is its oldest messages — so the
 * assembled parts still sit between the Turns already answered and the
 * prompt they are background for.
 */
function compose(
	parts: PackPart[],
	supplied: HarnessMessage[],
): { messages: HarnessMessage[]; leading: HarnessMessage[] } {
	const tail = parts.find((part) => part.source === "verbatim-tail");
	const lead = tail ? leadingRun(tail.messages, supplied) : 0;
	if (!tail || lead === 0) {
		return { messages: parts.flatMap((part) => part.messages), leading: [] };
	}

	// The harness's own objects, not the equal-by-value copies the tail
	// carries: the harness marks its messages with a property nothing
	// outside it can reproduce, and a Pack that hands back a faithful copy
	// is a Pack it does not recognise. Same content either way — that is
	// what the comparison below established — so this costs nothing and is
	// the difference between a cached prefix and none.
	const leading = supplied.slice(0, lead);
	const messages = [...leading];
	for (const part of parts) {
		if (part === tail) messages.push(...part.messages.slice(lead));
		else messages.push(...part.messages);
	}
	return { messages, leading };
}

/**
 * How many of the tail's first messages are the harness's own, in its own
 * positions.
 *
 * By value rather than by identity: rebuilding a message costs nothing at
 * the harness's comparison, while moving one costs everything. The run ends
 * at the first disagreement and is never repaired by substituting a
 * different message — where the tail carries something the harness did not
 * send, shortened or read back from the Thread Store with an edit behind
 * it, that message follows the run.
 */
function leadingRun(
	carried: HarnessMessage[],
	supplied: HarnessMessage[],
): number {
	const bound = Math.min(carried.length, supplied.length);
	let run = 0;
	while (run < bound) {
		if (!sameMessage(carried[run], supplied[run])) break;
		run++;
	}
	// Back to a Turn boundary, because assembled prose goes in the gap the
	// run leaves: a tool call separated from its result is a window a
	// provider refuses outright, which is what the tail is measured in
	// Turns to prevent. A Turn starts at its prompt, so the run may end
	// only where the next message carried is one.
	while (run > 0 && run < carried.length && carried[run]?.role !== "user") {
		run--;
	}
	return run;
}

/**
 * Whether two messages say the same thing.
 *
 * Structural rather than `Bun.deepEquals`, which compares symbol
 * properties: the harness hangs one on every message it owns, and a marker
 * this side cannot see — or reproduce — is not a difference in what the
 * message says. Missing and undefined are the same for the same reason: a
 * field dropped by the Thread Store's JSON round trip carried nothing.
 */
function sameMessage(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (typeof left !== "object" || typeof right !== "object") return false;
	if (left === null || right === null) return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right)) return false;
		if (left.length !== right.length) return false;
		return left.every((each, index) => sameMessage(each, right[index]));
	}
	const mine = left as Record<string, unknown>;
	const theirs = right as Record<string, unknown>;
	for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
		if (!sameMessage(mine[key], theirs[key])) return false;
	}
	return true;
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
	/** Which candidates the Budgets excluded, strongest first. */
	excluded: Excluded<T>[];
}

/**
 * What a part carried under a Budget, and what each denomination cost it.
 *
 * The identities rather than the candidates: every consumer — the part it
 * fills, the ledger, the ceiling's re-selection — only ever wanted to know
 * which Turns, Concepts or symbols survived.
 */
interface Selected {
	carried: number;
	messages: HarnessMessage[];
	tokens: number;
	excludedByCount: number;
	excludedBySize: number;
	shortened: boolean;
	/** What the Budget kept out, by identity, strongest first. */
	excluded: ExcludedCandidate[];
	turnIndices?: number[];
	conceptIds?: string[];
	symbols?: string[];
}

/**
 * A part's selection, as a function of the Budget it runs under.
 *
 * One per part, called twice: once with the part's own Budget, and again
 * with the room the ceiling leaves it. One rule for both, so a part cannot
 * be selected one way under its own Budget and another under the ceiling.
 */
type Selector = (within: Budget) => Selected;

/** A selector over candidates a renderer turns into messages. */
function selecting<T>(
	candidates: T[],
	render: (candidate: T, allowance?: number) => HarnessMessage[],
	identify: (candidate: T) => Omit<ExcludedCandidate, "reason">,
	carried: (kept: T[]) => Pick<Selected, "turnIndices" | "conceptIds" | "symbols">,
	whenNothingFits: "drop" | "shorten" = "drop",
): Selector {
	return (within) => {
		const fitted = fit(candidates, within, render, whenNothingFits);
		return {
			carried: fitted.kept.length,
			messages: fitted.messages,
			tokens: fitted.tokens,
			excludedByCount: fitted.excludedByCount,
			excludedBySize: fitted.excludedBySize,
			shortened: fitted.shortened,
			excluded: byBudget(fitted, identify),
			...carried(fitted.kept),
		};
	};
}

/**
 * Takes candidates strongest-first under both Budgets: the count first,
 * because it is the cheaper constraint to explain, then the size. Stops at
 * the first candidate that does not fit rather than skipping it, so a pack
 * never reorders relevance to pack more in.
 *
 * `whenNothingFits` decides what happens when even the strongest candidate
 * is too large. A Concept is dropped — the bundle holds others and
 * `walk_documentation` reaches the rest at no Budget — while a recollection
 * is shortened, because the Conversation has exactly one Turn that said the
 * thing and half of it is worth more than none of it. A renderer that takes
 * an allowance decides for itself what within it gives way.
 */
function fit<T>(
	candidates: T[],
	within: Budget,
	render: (candidate: T, allowance?: number) => HarnessMessage[],
	whenNothingFits: "drop" | "shorten" = "drop",
): Fitted<T> {
	const budget = Math.max(within.tokens, 0);
	const allowed = candidates.slice(0, Math.max(within.count, 0));
	const kept: T[] = [];
	const messages: HarnessMessage[] = [];
	let tokens = 0;
	let excludedBySize = 0;

	let refused: T | undefined;
	for (const candidate of allowed) {
		const rendered = render(candidate);
		const cost = approximateTokens(rendered);
		if (tokens + cost > budget) {
			excludedBySize = allowed.length - kept.length;
			refused = candidate;
			break;
		}
		kept.push(candidate);
		messages.push(...rendered);
		tokens += cost;
	}

	// The candidate that did not fit is carried shortened rather than lost,
	// whether it was the strongest or merely the next one: the Conversation
	// has exactly one Turn that said the thing, and half of it is worth more
	// than none of it. Concepts are dropped instead — the bundle holds others
	// and `walk_documentation` reaches the rest at no Budget.
	// Below the shortest length worth carrying there is nothing to shorten
	// to: a recollection reduced to a header and two markers costs Budget
	// and says nothing, so it is excluded for size like any other candidate.
	if (
		whenNothingFits === "shorten" &&
		refused !== undefined &&
		budget - tokens >= SHORTEST_TOKENS
	) {
		const room = budget - tokens;
		const rendered = render(refused, room);
		const cost = approximateTokens(rendered);
		// Only if it actually fits: a part that overran its own Budget would
		// make every Budget a suggestion.
		if (cost <= room) {
			return {
				kept: [...kept, refused],
				messages: [...messages, ...rendered],
				tokens: tokens + cost,
				excludedByCount: Math.max(candidates.length - allowed.length, 0),
				excludedBySize: Math.max(excludedBySize - 1, 0),
				shortened: true,
				excluded: excludedOf(candidates, allowed, kept.length + 1, render, within),
			};
		}
	}

	return {
		kept,
		messages,
		tokens,
		excludedByCount: Math.max(candidates.length - allowed.length, 0),
		excludedBySize,
		shortened: false,
		excluded: excludedOf(candidates, allowed, kept.length, render, within),
	};
}

/**
 * The candidates a part's Budgets kept out, strongest first: those inside
 * the count that did not fit the size, then those the count never reached.
 *
 * The ones inside the count are costed, because what a candidate would have
 * cost is the whole of why a size Budget refused it; the ones beyond the
 * count were never rendered and are not rendered here to find out — the
 * count refused them whatever they cost.
 */
function excludedOf<T>(
	candidates: T[],
	allowed: T[],
	keptCount: number,
	render: (candidate: T, allowance?: number) => HarnessMessage[],
	within: Budget,
): Excluded<T>[] {
	const excluded: Excluded<T>[] = [];
	for (let index = keptCount; index < allowed.length; index++) {
		const candidate = allowed[index];
		if (candidate === undefined) continue;
		excluded.push({
			candidate,
			reason: "size",
			tokens: approximateTokens(render(candidate)),
			budget: Math.max(within.tokens, 0),
		});
	}
	for (let index = allowed.length; index < candidates.length; index++) {
		const candidate = candidates[index];
		if (candidate === undefined) continue;
		excluded.push({ candidate, reason: "count", budget: within.count });
	}
	return excluded;
}

/**
 * The verbatim tail's selector, over the Turns already answered.
 *
 * Both Budgets arrive the same way every other part's do, and the count is
 * applied here rather than by the caller, so `Selected.excludedByCount`
 * means the same thing for the tail as for every other part.
 *
 * Newest Turn first and kept in order. Unlike every other part the tail may
 * not come back empty: its newest Turn is retained with its tool results
 * shortened when it cannot fit whole, because that Turn is what the current
 * one is reasoning about.
 */
function tailSelector(completed: Turn[]): Selector {
	return (within) => {
		const byCount = (
			within.count > 0 ? completed.slice(-within.count) : []
		).map(paired);
		const byCountExcluded = Math.max(completed.length - byCount.length, 0);
		// The Turns the count never reached, newest first: they are older
		// than everything the window held, so they follow what the size
		// Budget kept out.
		const beyondCount: ExcludedCandidate[] = completed
			.slice(0, byCountExcluded)
			.reverse()
			.map((turn) => ({
				turnIndex: turn.index,
				reason: "count" as const,
				budget: within.count,
			}));
		const fitted = fitTail(byCount, within.tokens);
		return {
			carried: fitted.kept.length,
			messages: fitted.messages,
			tokens: fitted.tokens,
			excludedByCount: byCountExcluded,
			excludedBySize: fitted.excludedBySize,
			shortened: fitted.shortened,
			excluded: [
				...byBudget(fitted, (turn) => ({ turnIndex: turn.index })),
				...beyondCount,
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
		if (newest === undefined || budget === 0) {
			return {
				kept: [],
				messages: [],
				tokens: 0,
				excludedBySize: byCount.length,
				shortened: false,
				excluded: excluded(byCount.length),
			};
		}
		const shortened = elideTurn(newest.messages, budget);
		return {
			kept: [newest],
			messages: shortened.messages,
			tokens: shortened.tokens,
			excludedBySize: byCount.length - 1,
			shortened: shortened.shortened,
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
	irrelevant: number,
	fitted: { excludedByCount: number; excludedBySize: number },
): PartExclusion | undefined {
	const result: PartExclusion = {};
	if (irrelevant > 0) result.irrelevant = irrelevant;
	if (fitted.excludedByCount > 0) result.count = fitted.excludedByCount;
	if (fitted.excludedBySize > 0) result.size = fitted.excludedBySize;
	return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * A part's excluded candidates, cut to the retained head.
 *
 * The list arrives in relevance order by construction — what a Budget kept
 * out is nearer than anything the threshold refused, because the threshold
 * is the outer filter — so heading it keeps the nearest. What is cut
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

/** The candidates a relevance threshold refused, nearest first. */
function refused<T extends { distance: number }>(
	misses: T[],
	threshold: number,
	identify: (miss: T) => Omit<ExcludedCandidate, "reason">,
): ExcludedCandidate[] {
	return [...misses]
		.sort((a, b) => a.distance - b.distance)
		.map((miss) => ({
			...identify(miss),
			reason: "irrelevant" as const,
			distance: miss.distance,
			threshold,
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
	rejected: number;
	unavailable?: "unconfigured" | "failed";
}): AbsenceCause | undefined {
	if (part.carried > 0) return undefined;
	if (part.budget <= 0) return "disabled";
	if (part.unavailable !== undefined) return part.unavailable;
	if (part.candidates > 0) return "size";
	if (part.rejected > 0) return "irrelevant";
	return "none";
}

/**
 * Every recollection the pack could legitimately carry, strongest first,
 * minus anything it already carries verbatim — a Turn must never appear
 * twice in one window. The Budget is applied after, so the caller can see
 * how many candidates it discarded.
 */
function eligibleRecollections(
	recalled: RecalledTurn[],
	carried: Turn[],
): RecalledTurn[] {
	// Compared by position, not by wording: two Turns can share a prompt
	// ("continue", "run the tests") without being the same Turn.
	const alreadyCarried = new Set(
		carried.map((turn) => turn.index).filter((index) => index !== undefined),
	);
	return recalled.filter(
		(candidate) => !alreadyCarried.has(candidate.turnIndex),
	);
}

/**
 * A symbol's neighbourhood enters the window as fact, not prose: what calls
 * it, what it calls, and where each of those is, so the agent can act
 * without opening a file.
 *
 * Structure derived before the file's current state is marked where the
 * agent reads the coordinates, as a stale Concept is: positions it cannot
 * rely on must be visibly second-hand rather than presented as current.
 */
function asStructure(around: Neighbourhood): HarnessMessage {
	const lines = around.edges.map(describeEdge);
	// Saying how many were left out matters: silence would read as "this
	// symbol connects to twelve things", which for a hub is false.
	if (around.dropped > 0) {
		lines.push(`… and ${around.dropped} more connections`);
	}
	// Not the Concept's word, "(stale)": that one is the author's own
	// declaration in the bundle's frontmatter, while this is measured
	// against the file the symbol lives in. One wording for both would
	// offer the agent a provenance neither of them has.
	const caveat = around.stale ? " (older than the codebase)" : "";
	return {
		role: "user",
		content:
			`[codebase structure: ${qualify(around.symbol)}${caveat}]\n` +
			lines.join("\n"),
		cmStructure: true,
	};
}

/**
 * A Concept enters the window as knowledge with a source. Curated knowledge
 * the agent did not derive must be visibly borrowed, or it cannot be
 * questioned.
 *
 * What is carried is usually one section of a Concept, not the Concept, so
 * the header says which part it is and how many there are, and the rest is
 * offered through `walk_documentation`, which costs no Budget. A fragment
 * headed with the Concept's name alone reads as the Concept's complete
 * answer — the one thing curated knowledge must never do.
 *
 * What a Concept declares it is *not* travels with it: a definition served
 * without the exclusions that bound it invites the mistake they exist to
 * prevent.
 */
function asCuratedKnowledge(hit: ConceptHit): HarnessMessage {
	const caveat = hit.stale ? " (stale)" : "";
	const partial = hit.sectionCount > 1;
	const part = partial
		? ` — part ${hit.sectionIndex + 1} of ${hit.sectionCount}`
		: "";
	const lines = [`[curated knowledge: ${hit.conceptId}${part}${caveat}]`, hit.text];
	for (const exclusion of hit.exclusions ?? []) {
		const why = exclusion.why ? ` — ${exclusion.why}` : "";
		const instead = exclusion.instead ? ` Use instead: ${exclusion.instead}` : "";
		lines.push(`Not: ${exclusion.term}${why}${instead}`);
	}
	if (partial) {
		lines.push(
			`(the rest of ${hit.conceptId} is readable with walk_documentation, ` +
				`at no budget)`,
		);
	}
	return {
		role: "user",
		content: lines.join("\n"),
		cmCurated: true,
	};
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
function asRecollection(
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
	let room = Math.max(allowance * 4 - fixed, 0);

	let best = recollection(header, lines.map((line) => lineText(line)));
	while (room >= 0) {
		const allocation = shares(
			giving.map((line) => line.payload.length),
			room,
		);
		let at = 0;
		const shortened = lines.map((line) => {
			if (!shortenable(line)) return lineText(line);
			return lineText(line, elideLine(line.payload, allocation[at++] ?? 0));
		});
		best = { ...recollection(header, shortened), cmShortened: true };
		if (approximateTokens([best]) <= allowance || room === 0) break;
		room = Math.floor(room * 0.9) - 1;
		if (room < 0) room = 0;
	}
	return best;
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
	return {
		role: "user",
		content: `${header}\n${lines.join("\n")}`,
		cmRecalled: true,
	};
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

/** The order a pack gives things up in. Cheapest to recover goes first. */
const REDUCTION_ORDER: PackSource[] = [
	"structure",
	"curated",
	"recalled",
	"verbatim-tail",
];

/** A part's selector and the Budget it ran under, for the ceiling to reuse. */
interface Reducible {
	select: Selector;
	budget: Budget;
}

/**
 * Brings a pack within its ceiling, in place.
 *
 * Each reducible part is re-selected under the room left by the parts that
 * outrank it, so a part loses whole candidates the way its own Budget would
 * have made it lose them — the tail its oldest Turns, recall its weakest
 * matches. The current Turn is never dropped, so when it alone exceeds the
 * ceiling its tool results are elided instead.
 */
function reduceToCeiling(
	parts: PackPart[],
	ceiling: number,
	bound: number,
	reducible: Partial<Record<PackSource, Reducible>>,
): void {
	const ceilingTokens = Math.max(ceiling, 0);
	if (totalOf(parts) <= ceilingTokens) return;

	for (const source of REDUCTION_ORDER) {
		if (totalOf(parts) <= ceilingTokens) return;
		const part = parts.find((each) => each.source === source);
		if (part === undefined) continue;
		// A part that carried nothing has nothing to give up, and reducing
		// it would record a ceiling that took what was never there.
		if ((part.carried ?? 0) === 0) continue;

		const carriedBefore = part.carried ?? 0;
		const sizeBefore = part.approximateTokens;
		const before = {
			turnIndices: part.turnIndices ?? [],
			conceptIds: part.conceptIds ?? [],
			symbols: part.symbols ?? [],
		};
		const room = Math.max(ceilingTokens - (totalOf(parts) - sizeBefore), 0);
		// The part's own count still applies: the ceiling takes size, and a
		// part reduced by it is the same selection under less room.
		const reduce = reducible[source];
		const result = reduce?.select({ count: reduce.budget.count, tokens: room });
		const usable = result !== undefined && result.tokens <= room;

		part.withoutCeiling = sizeBefore;
		part.messages = usable ? result.messages : [];
		part.approximateTokens = usable ? result.tokens : 0;
		part.carried = usable ? result.carried : 0;
		if (part.turnIndices !== undefined) {
			part.turnIndices = usable ? (result.turnIndices ?? []) : [];
		}
		if (part.conceptIds !== undefined) {
			part.conceptIds = usable ? (result.conceptIds ?? []) : [];
		}
		if (part.symbols !== undefined) {
			part.symbols = usable ? (result.symbols ?? []) : [];
		}
		part.shortened = (usable && result.shortened) || undefined;
		part.excluded = {
			...(part.excluded ?? {}),
			ceiling: carriedBefore - (part.carried ?? 0),
		};
		// What the ceiling took was the nearest of everything excluded, so
		// it leads the ledger — and the ledger is re-cut, because the head
		// is a bound on what is retained, not on what is added last.
		part.excludedCandidates = ledger(
			[
				...lost(before, part),
				...(part.excludedCandidates ?? []),
			],
			bound,
		);
		// Nothing survived the ceiling: the part is absent, and absent for
		// the ceiling rather than for want of anything to carry.
		if ((part.carried ?? 0) === 0) part.absent = "size";
	}

	if (totalOf(parts) <= ceilingTokens) return;

	// Only the current Turn is left to give, and it may not be dropped.
	const current = parts.find((part) => part.source === "current-turn");
	if (current === undefined) return;
	const others = totalOf(parts) - current.approximateTokens;
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

/**
 * Which identities a part stopped carrying when the ceiling re-selected it.
 *
 * Order follows the part's own: what it listed first it valued most, so the
 * first identity to go is the weakest it had been carrying.
 */
function lost(
	before: { turnIndices: number[]; conceptIds: string[]; symbols: string[] },
	part: PackPart,
): ExcludedCandidate[] {
	const turns = new Set(part.turnIndices ?? []);
	const concepts = new Set(part.conceptIds ?? []);
	const symbols = new Set(part.symbols ?? []);
	return [
		...before.turnIndices
			.filter((index) => !turns.has(index))
			.map((turnIndex) => ({ turnIndex, reason: "ceiling" as const })),
		...before.conceptIds
			.filter((id) => !concepts.has(id))
			.map((conceptId) => ({ conceptId, reason: "ceiling" as const })),
		...before.symbols
			.filter((name) => !symbols.has(name))
			.map((symbol) => ({ symbol, reason: "ceiling" as const })),
	];
}
