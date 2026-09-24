import {
	isToolCall,
	messageText,
	toolCallText,
	type ContentBlock,
	type HarnessMessage,
	type Turn,
} from "./messages.ts";
import { elide, ELIDED_WHOLE, ELISION } from "./elision.ts";
import { shares } from "./shares.ts";
import type { ConceptHit, ConceptMiss } from "./doc-index.ts";
import { describeEdge, qualify, type Neighbourhood } from "./symbols.ts";
import type { RecalledTurn, TurnMiss } from "./thread-store.ts";

export interface AssemblerConfig {
	/** How many completed Turns are carried verbatim ahead of the current one. */
	tailTurns: number;
	/** How many recalled Turns a pack may carry. */
	recallTurns: number;
	/** How many Concepts a pack may carry. Zero disables curated knowledge. */
	docConcepts: number;
	/** How many symbols' neighbourhoods a pack may carry. Zero disables them. */
	graphSymbols: number;
	/**
	 * Size Budgets, in estimated tokens, beside the counts above. A part is
	 * trimmed to whichever of its two Budgets binds first.
	 *
	 * A count says something a size cannot — `tailTurns: 0` is how a user
	 * asks for the current Turn alone — and a size says what a count cannot:
	 * a Turn carrying six file reads costs two orders of magnitude more than
	 * one carrying a sentence. Measured on real Journals, an eight-Turn tail
	 * reached 974,861 estimated tokens, so the count alone bounds nothing.
	 */
	tailTokens: number;
	recallTokens: number;
	docTokens: number;
	graphTokens: number;
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
	/** The count Budget that bounded this part, where one did. */
	budget?: number;
	/**
	 * The token Budget that bounded it. Recorded beside what the part spent,
	 * because a part carrying irreducible content can exceed it: a Turn of
	 * many messages, each already at the shortest length worth carrying, has
	 * a floor the Budget cannot argue with.
	 */
	tokenBudget?: number;
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
 * Builds the Context Pack for one Call: recalled Turns, then the verbatim
 * tail, then the Turn in progress. Pure — no I/O, no clock, no randomness —
 * so the same inputs always produce the same pack.
 */
export function assemble(input: AssembleInput, config: AssemblerConfig): Pack {
	const {
		turns,
		recalled = [],
		rejected = 0,
		recallMisses = [],
		unsearched = 0,
		concepts = [],
		conceptsRejected = 0,
		conceptMisses = [],
		structure = [],
		unavailable = {},
	} = input;
	const bound = config.explainCandidates;

	const current = turns[turns.length - 1];
	const completed = turns.slice(0, -1);
	// Withheld here rather than at ingest: the Journal recorded what
	// happened, and an unanswered call is part of what happened. It is the
	// Context Window that may not carry one — a provider refuses a call with
	// no result outright — so the refusal belongs where messages become
	// protocol messages, which is also where Turns from the live array pass.
	const byCount = (
		config.tailTurns > 0 ? completed.slice(-config.tailTurns) : []
	).map(paired);

	const parts: PackPart[] = [];

	// Recall goes first: it is background for the exchange that follows, and
	// it is trimmed to its own budget so it can never crowd out the tail.
	const carried = byCount.concat(current ? [current] : []);
	const eligible = eligibleRecollections(recalled, carried);
	const recollections = fit(
		eligible,
		config.recallTurns,
		config.recallTokens,
		(each, allowance) => [asRecollection(each, allowance)],
		"shorten",
	);
	parts.push({
		source: "recalled",
		messages: recollections.messages,
		approximateTokens: recollections.tokens,
		carried: recollections.kept.length,
		turnIndices: recollections.kept.map((each) => each.turnIndex),
		budget: config.recallTurns,
		tokenBudget: config.recallTokens,
		candidates: eligible.length,
		irrelevant: rejected,
		threshold: config.recallMaxDistance,
		excluded: exclusion(rejected, recollections),
		excludedCandidates: ledger(
			[
				...byBudget(recollections, (each) => ({ turnIndex: each.turnIndex })),
				...refused(recallMisses, config.recallMaxDistance, (miss) => ({
					turnIndex: miss.turnIndex,
				})),
			],
			bound,
		),
		absent: absence({
			budget: config.recallTurns,
			carried: recollections.kept.length,
			candidates: eligible.length,
			rejected,
			unavailable: unavailable.recalled,
		}),
		shortened: recollections.shortened || undefined,
	});

	// Curated knowledge sits ahead of the exchange, like recall: it is
	// background the agent is being given, not something it just said.
	const curated = fit(concepts, config.docConcepts, config.docTokens, (hit) => [
		asCuratedKnowledge(hit),
	]);
	parts.push({
		source: "curated",
		messages: curated.messages,
		approximateTokens: curated.tokens,
		carried: curated.kept.length,
		conceptIds: curated.kept.map((hit) => hit.conceptId),
		budget: config.docConcepts,
		tokenBudget: config.docTokens,
		candidates: concepts.length,
		irrelevant: conceptsRejected,
		threshold: config.docMaxDistance,
		excluded: exclusion(conceptsRejected, curated),
		excludedCandidates: ledger(
			[
				...byBudget(curated, (hit) => ({
					conceptId: hit.conceptId,
					distance: hit.distance,
				})),
				...refused(conceptMisses, config.docMaxDistance, (miss) => ({
					conceptId: miss.conceptId,
				})),
			],
			bound,
		),
		absent: absence({
			budget: config.docConcepts,
			carried: curated.kept.length,
			candidates: concepts.length,
			rejected: conceptsRejected,
			unavailable: unavailable.curated,
		}),
		shortened: curated.shortened || undefined,
	});

	// Structure is what the Codebase is, so it comes before what was said
	// about it — and ahead of the tail for the same reason recall is.
	const structural = fit(
		structure,
		config.graphSymbols,
		config.graphTokens,
		(each) => [asStructure(each)],
	);
	parts.push({
		source: "structure",
		messages: structural.messages,
		approximateTokens: structural.tokens,
		carried: structural.kept.length,
		symbols: structural.kept.map((each) => qualify(each.symbol)),
		budget: config.graphSymbols,
		tokenBudget: config.graphTokens,
		candidates: structure.length,
		// Symbols are matched by name, not ranked by distance, so this part
		// cannot refuse anything for irrelevance and says so.
		unranked: true,
		excluded: exclusion(0, structural),
		excludedCandidates: ledger(
			byBudget(structural, (each) => ({ symbol: qualify(each.symbol) })),
			bound,
		),
		absent: absence({
			budget: config.graphSymbols,
			carried: structural.kept.length,
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
	const tail = fitTail(byCount, config.tailTokens);
	parts.push({
		source: "verbatim-tail",
		messages: tail.messages,
		approximateTokens: tail.tokens,
		carried: tail.kept.length,
		turnIndices: tail.kept
			.map((turn) => turn.index)
			.filter((index) => index !== undefined),
		budget: config.tailTurns,
		tokenBudget: config.tailTokens,
		candidates: completed.length,
		// Recency, not relevance: the tail takes the newest Turns whatever
		// they are about.
		unranked: true,
		excluded: exclusion(0, {
			...tail,
			excludedByCount: Math.max(completed.length - byCount.length, 0),
		}),
		excludedCandidates: ledger(
			[
				...byBudget(tail, (turn) => ({ turnIndex: turn.index })),
				// The Turns the count never reached, newest first: they are
				// older than everything the window held, so they follow it.
				...completed
					.slice(0, Math.max(completed.length - byCount.length, 0))
					.reverse()
					.map((turn) => ({
						turnIndex: turn.index,
						reason: "count" as const,
						budget: config.tailTurns,
					})),
			],
			bound,
		),
		absent: absence({
			budget: config.tailTurns,
			carried: tail.kept.length,
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
		structure: (room) => {
			const refitted = fit(structure, config.graphSymbols, room, (each) => [
				asStructure(each),
			]);
			return {
				...refitted,
				carried: refitted.kept.length,
				symbols: refitted.kept.map((each) => qualify(each.symbol)),
			};
		},
		curated: (room) => {
			const refitted = fit(concepts, config.docConcepts, room, (hit) => [
				asCuratedKnowledge(hit),
			]);
			return {
				...refitted,
				carried: refitted.kept.length,
				conceptIds: refitted.kept.map((hit) => hit.conceptId),
			};
		},
		recalled: (room) => {
			const refitted = fit(
				eligible,
				config.recallTurns,
				room,
				(each, allowance) => [asRecollection(each, allowance)],
				"shorten",
			);
			return {
				...refitted,
				carried: refitted.kept.length,
				turnIndices: refitted.kept.map((each) => each.turnIndex),
			};
		},
		"verbatim-tail": (room) => {
			const refitted = fitTail(byCount, room);
			return {
				...refitted,
				carried: refitted.kept.length,
				turnIndices: refitted.kept
					.map((turn) => turn.index)
					.filter((index) => index !== undefined),
			};
		},
	});

	return {
		messages: parts.flatMap((part) => part.messages),
		parts,
		budgets: {
			tail: config.tailTurns,
			recall: config.recallTurns,
			docs: config.docConcepts,
			graph: config.graphSymbols,
		},
		rejected,
		unsearched,
		ceiling: config.packTokens,
		beforeCeiling,
		approximateTokens: totalOf(parts),
	};
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
	countBudget: number,
	tokenBudget: number,
	render: (candidate: T, allowance?: number) => HarnessMessage[],
	whenNothingFits: "drop" | "shorten" = "drop",
): Fitted<T> {
	const budget = Math.max(tokenBudget, 0);
	const allowed = candidates.slice(0, Math.max(countBudget, 0));
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
				excluded: excludedOf(
					candidates,
					allowed,
					kept.length + 1,
					render,
					countBudget,
					budget,
				),
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
		excluded: excludedOf(
			candidates,
			allowed,
			kept.length,
			render,
			countBudget,
			budget,
		),
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
	countBudget: number,
	tokenBudget: number,
): Excluded<T>[] {
	const excluded: Excluded<T>[] = [];
	for (let index = keptCount; index < allowed.length; index++) {
		const candidate = allowed[index];
		if (candidate === undefined) continue;
		excluded.push({
			candidate,
			reason: "size",
			tokens: approximateTokens(render(candidate)),
			budget: tokenBudget,
		});
	}
	for (let index = allowed.length; index < candidates.length; index++) {
		const candidate = candidates[index];
		if (candidate === undefined) continue;
		excluded.push({ candidate, reason: "count", budget: countBudget });
	}
	return excluded;
}

/**
 * The verbatim tail, newest Turn first and kept in order. Unlike every other
 * part the tail may not come back empty: its newest Turn is retained with its
 * tool results shortened when it cannot fit whole, because that Turn is what
 * the current one is reasoning about.
 */
function fitTail(byCount: Turn[], tokenBudget: number): Fitted<Turn> {
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
				excludedByCount: 0,
				excludedBySize: byCount.length,
				shortened: false,
				excluded: excluded(byCount.length),
			};
		}
		const shortened = shortenTurn(newest.messages, budget);
		return {
			kept: [newest],
			messages: shortened.messages,
			tokens: shortened.tokens,
			excludedByCount: 0,
			excludedBySize: byCount.length - 1,
			shortened: shortened.shortened,
			excluded: excluded(byCount.length - 1),
		};
	}

	return {
		kept,
		messages: kept.flatMap((turn) => turn.messages),
		tokens,
		excludedByCount: 0,
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
	fitted: Fitted<T>,
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
			return lineText(line, shortenLine(line.payload, allocation[at++] ?? 0));
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

/** One line's payload, head and tail, within the characters it may spend. */
function shortenLine(text: string, allowed: number): string {
	if (text.length <= allowed) return text;
	const half = Math.floor((allowed - ELISION(0, false).length) / 2);
	if (half < SHORTEST_HALF_CHARACTERS / 2) {
		// No room for a head and a tail worth reading: the line says only
		// that it had output and how much of it went.
		return ELIDED_WHOLE(Math.ceil(text.length / 4));
	}
	return elide(text, half, Math.ceil((text.length - half * 2) / 4), false);
}

/**
 * Deterministic stand-in for a tokenizer: the serialized message over four.
 *
 * Over the whole message, not its `content` alone: `details`, `toolName` and
 * `toolCallId` are sent with it and are comparable in size to `content` on a
 * real tool result. Measured against the harness's own reported figures over
 * 27 Calls of linear Journals, content-only ran 1.35× low at the median and
 * whole-message runs 1.15×, which is why the ceiling's default carries the
 * p90 of that residual as headroom.
 *
 * Fields the harness records but does not send onward are excluded, so the
 * estimate tracks what a provider is billed for rather than what a Journal
 * happens to keep.
 */
export function approximateTokens(messages: HarnessMessage[]): number {
	let characters = 0;
	for (const message of messages) characters += serialized(message).length;
	return Math.ceil(characters / 4);
}

/** Recorded by the harness, never sent to the model. */
const UNSENT: Record<string, true> = {
	contextSnapshot: true,
	usage: true,
	timestamp: true,
	api: true,
	provider: true,
	model: true,
	stopReason: true,
};

function serialized(message: HarnessMessage): string {
	const sent: Record<string, unknown> = {};
	// Key order follows the message's own, so the estimate is a function of
	// the message and not of insertion history.
	for (const [key, value] of Object.entries(message)) {
		if (UNSENT[key] === true || value === undefined) continue;
		sent[key] = value;
	}
	return JSON.stringify(sent);
}

/**
 * The fewest estimated tokens worth carrying of a shortened message: below
 * this there is no room for a head, a tail and a marker worth reading.
 */
const SHORTEST_TOKENS = 200;

/**
 * The fewest characters worth keeping on each side of the marker. Named in
 * characters rather than derived from `SHORTEST_TOKENS`, because the halves
 * are `slice` indices and a token-shaped constant divided by two is neither
 * unit.
 */
const SHORTEST_HALF_CHARACTERS = 100;

/** One message after shortening, with what it now costs. */
interface Shortened {
	message: HarnessMessage;
	tokens: number;
	shortened: boolean;
}

/** A Turn's messages after shortening, with what they now cost together. */
interface ShortenedMessages {
	messages: HarnessMessage[];
	tokens: number;
	shortened: boolean;
}

/**
 * Shortens one message of the verbatim tail or the current Turn to a token
 * allowance, keeping the head and the tail of whatever payload it carries.
 * Head-only would be the wrong half: the end of a tool result is where the
 * error, the total, or the last hunk is.
 *
 * What counts as payload here: a tool result's text, and the arguments of an
 * assistant's tool calls. That last one is measured, not assumed — on the
 * audited Conversation 84% of the largest Turn is the file contents an
 * assistant passed to `write`, so a rule that spared every assistant message
 * would leave the tail Budget unenforceable.
 *
 * What is never shortened: a user prompt, and an assistant's own text. Those
 * are the reasoning a pack exists to carry, and a shortened instruction is a
 * corrupted one.
 *
 * A recollection is shortened by `asRecollection`, not here. It is rendered
 * line by line from its Turn, so it gives way by line — outputs first, then
 * prose — which this function cannot express.
 */
function shorten(message: HarnessMessage, allowance: number): Shortened {
	const cost = approximateTokens([message]);
	if (cost <= allowance) return { message, tokens: cost, shortened: false };

	if (message.role === "toolResult") {
		return shortenText(message, allowance, cost);
	}
	if (message.role === "assistant") return shortenPayloads(message, allowance);
	return { message, tokens: cost, shortened: false };
}

/** Shortens the text a message carries, head and tail, with a marker between. */
function shortenText(
	message: HarnessMessage,
	allowance: number,
	cost: number,
): Shortened {
	const text = messageText(message);
	// `details` can rival the text it summarises, and a shortened message that
	// kept them would not be shorter — so they go, and they are excluded from
	// the overhead too. Counting them as overhead would starve the text of an
	// allowance already spent on something being deleted: measured, a 30,000
	// character `details` drove an otherwise 1,810-token text down to the
	// floor of 231 against a 2,000-token Budget.
	const withoutDetails: HarnessMessage = { ...message };
	const hadDetails = withoutDetails.details !== undefined;
	delete withoutDetails.details;

	const keptCost = approximateTokens([withoutDetails]);
	const textCost = Math.ceil(JSON.stringify(text).length / 4);
	const overhead = keptCost - textCost;
	const forText = Math.max(allowance - overhead, SHORTEST_TOKENS);
	const characters = forText * 4;
	// The dropped `details` count as elided whatever happens to the text, so
	// the marker never reports less than the shortening removed.
	const droppedDetails = cost - keptCost;
	if (text.length <= characters && droppedDetails === 0) {
		return { message, tokens: cost, shortened: false };
	}

	// Sized by construction, then checked: JSON escaping means the estimate
	// of the shortened message is not a linear function of the characters
	// kept, so the halves shrink until the message actually fits rather than
	// being trusted to.
	let half = Math.floor((characters - ELISION(0, hadDetails).length) / 2);
	let best: { message: HarnessMessage; tokens: number } | undefined;
	while (half >= SHORTEST_HALF_CHARACTERS) {
		const elidedText = Math.ceil((text.length - half * 2) / 4);
		const candidate: HarnessMessage = {
			...withoutDetails,
			content: elide(text, half, elidedText + droppedDetails, hadDetails),
			cmShortened: true,
		};
		const tokens = approximateTokens([candidate]);
		best = { message: candidate, tokens };
		if (tokens <= allowance) break;
		half = Math.floor(half * 0.9) - 1;
	}

	if (best === undefined) return { message, tokens: cost, shortened: false };
	return { message: best.message, tokens: best.tokens, shortened: true };
}

/**
 * Shortens the arguments of an assistant's tool calls, leaving its text
 * blocks and the calls' names and ids alone: the model must still be able to
 * see what it asked for, only not the whole of what it passed.
 */
function shortenPayloads(
	message: HarnessMessage,
	allowance: number,
): Shortened {
	const blocks = message.content;
	const cost = approximateTokens([message]);
	if (!Array.isArray(blocks)) return { message, tokens: cost, shortened: false };

	const others = cost - payloadCost(blocks);
	// What the payloads may take together, shared evenly among them so one
	// enormous call cannot starve the rest.
	const calls = blocks.filter(isToolCall).length;
	if (calls === 0) return { message, tokens: cost, shortened: false };
	const each = Math.max(
		Math.floor((allowance - others) / calls),
		SHORTEST_TOKENS,
	);

	let shortened = false;
	const kept = blocks.map((block) => {
		if (!isToolCall(block)) return block;
		const call = block;
		const passed = JSON.stringify(call.arguments ?? null);
		if (Math.ceil(passed.length / 4) <= each) return block;
		const half = Math.max(
			Math.floor((each * 4 - ELISION(0, false).length) / 2),
			SHORTEST_HALF_CHARACTERS,
		);
		if (passed.length <= half * 2) return block;
		shortened = true;
		const removed = Math.ceil((passed.length - half * 2) / 4);
		return { ...call, arguments: elide(passed, half, removed, false) };
	});

	if (!shortened) return { message, tokens: cost, shortened: false };
	const result: HarnessMessage = { ...message, content: kept, cmShortened: true };
	return { message: result, tokens: approximateTokens([result]), shortened: true };
}

function payloadCost(blocks: ContentBlock[]): number {
	let characters = 0;
	for (const block of blocks) {
		if (!isToolCall(block)) continue;
		characters += JSON.stringify(block.arguments ?? null).length;
	}
	return Math.ceil(characters / 4);
}

/**
 * Shortens a Turn's messages until they fit an allowance, oldest payload
 * first: the newest result is the one the Turn is still acting on.
 *
 * Every message carrying a payload is a candidate — tool results and the
 * arguments of assistant tool calls — because on a real working Turn the
 * write calls are most of the bytes. `shorten` decides what within a
 * message may go; this decides the order they are asked.
 */
function shortenTurn(
	messages: HarnessMessage[],
	allowance: number,
): ShortenedMessages {
	const kept = [...messages];
	let tokens = approximateTokens(kept);
	let shortened = false;
	if (tokens <= allowance) return { messages: kept, tokens, shortened };

	const shortenable = kept
		.map((message, index) => ({ message, index }))
		.filter(
			({ message }) =>
				message.role === "toolResult" || message.role === "assistant",
		);

	for (const { index } of shortenable) {
		const message = kept[index];
		if (message === undefined) continue;
		const excess = tokens - allowance;
		const cost = approximateTokens([message]);
		// Give this message what it needs to carry the whole Turn under the
		// allowance, never less than a readable head and tail.
		const target = Math.max(cost - excess, SHORTEST_TOKENS);
		const result = shorten(message, target);
		if (!result.shortened) continue;
		kept[index] = result.message;
		tokens = tokens - cost + result.tokens;
		shortened = true;
		if (tokens <= allowance) break;
	}

	return { messages: kept, tokens, shortened };
}

/** The order a pack gives things up in. Cheapest to recover goes first. */
const REDUCTION_ORDER: PackSource[] = [
	"structure",
	"curated",
	"recalled",
	"verbatim-tail",
];

/**
 * Re-selects a part's content under the room the ceiling leaves it, reporting
 * the identities it kept so the accounting stays truthful about what a
 * reduced part carried.
 */
type Refit = (room: number) => {
	carried: number;
	messages: HarnessMessage[];
	tokens: number;
	shortened: boolean;
	turnIndices?: number[];
	conceptIds?: string[];
	symbols?: string[];
};

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
	refit: Partial<Record<PackSource, Refit>>,
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
		const reselect = refit[source];
		const result = reselect?.(room);
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
	const result = shortenTurn(
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
