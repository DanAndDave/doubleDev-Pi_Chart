import { messageText, type HarnessMessage, type Turn } from "./messages.ts";
import type { ConceptHit } from "./doc-index.ts";
import { describeEdge, qualify, type Neighbourhood } from "./symbols.ts";
import type { RecalledTurn } from "./thread-store.ts";

export interface AssemblerConfig {
	/** How many completed Turns are carried verbatim ahead of the current one. */
	tailTurns: number;
	/**
	 * How many recalled Turns a pack may carry.
	 *
	 * Counted in Turns rather than tokens, as every Budget here is: the only
	 * token count available at assembly is the local approximation, and a
	 * Budget enforced with a number known to be wrong is worse than one
	 * honestly named. The inspector reports both, so the cost of a count is
	 * visible even though the count is what binds.
	 */
	recallTurns: number;
	/** How many Concepts a pack may carry. Zero disables curated knowledge. */
	docConcepts: number;
	/** How many symbols' neighbourhoods a pack may carry. Zero disables them. */
	graphSymbols: number;
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
	/** The Budget that bounded this part, where one did. */
	budget?: number;
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
	/** Sum of the parts' approximations. Approximate, for attribution only. */
	approximateTokens: number;
}

export interface AssembleInput {
	/** Turns to carry verbatim: the recent ones, current Turn last. */
	turns: Turn[];
	/** Turns found by meaning, most relevant first. */
	recalled?: RecalledTurn[];
	/** How many candidates retrieval refused as not relevant enough. */
	rejected?: number;
	/** Concepts found in the Doc Store, most relevant first. */
	concepts?: ConceptHit[];
	/** Neighbourhoods of the symbols this prompt refers to. */
	structure?: Neighbourhood[];
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
		concepts = [],
		structure = [],
	} = input;

	const current = turns[turns.length - 1];
	const completed = turns.slice(0, -1);
	const tail = config.tailTurns > 0 ? completed.slice(-config.tailTurns) : [];

	const parts: PackPart[] = [];

	// Recall goes first: it is background for the exchange that follows, and
	// it is trimmed to its own budget so it can never crowd out the tail.
	const carried = tail.concat(current ? [current] : []);
	const eligible = eligibleRecollections(recalled, carried);
	const recollections = eligible.slice(0, Math.max(config.recallTurns, 0));
	if (recollections.length > 0) {
		const messages = recollections.map(asRecollection);
		parts.push({
			source: "recalled",
			messages,
			approximateTokens: approximateTokens(messages),
			carried: recollections.length,
			turnIndices: recollections.map((each) => each.turnIndex),
			budget: config.recallTurns,
			candidates: eligible.length,
			irrelevant: rejected,
		});
	}

	// Curated knowledge sits ahead of the exchange, like recall: it is
	// background the agent is being given, not something it just said.
	const carriedConcepts = concepts.slice(0, Math.max(config.docConcepts, 0));
	if (carriedConcepts.length > 0) {
		const messages = carriedConcepts.map(asCuratedKnowledge);
		parts.push({
			source: "curated",
			messages,
			approximateTokens: approximateTokens(messages),
			carried: carriedConcepts.length,
			conceptIds: carriedConcepts.map((hit) => hit.conceptId),
			budget: config.docConcepts,
			candidates: concepts.length,
		});
	}

	// Structure is what the Codebase is, so it comes before what was said
	// about it — and ahead of the tail for the same reason recall is.
	const carriedStructure = structure.slice(0, Math.max(config.graphSymbols, 0));
	if (carriedStructure.length > 0) {
		const messages = carriedStructure.map(asStructure);
		parts.push({
			source: "structure",
			messages,
			approximateTokens: approximateTokens(messages),
			carried: carriedStructure.length,
			symbols: carriedStructure.map((each) => qualify(each.symbol)),
			budget: config.graphSymbols,
			candidates: structure.length,
		});
	}

	const tailMessages = tail.flatMap((turn) => turn.messages);
	if (tailMessages.length > 0) {
		parts.push({
			source: "verbatim-tail",
			messages: tailMessages,
			approximateTokens: approximateTokens(tailMessages),
			carried: tail.length,
			turnIndices: tail
				.map((turn) => turn.index)
				.filter((index) => index !== undefined),
			budget: config.tailTurns,
			// No `candidates`: the tail arrives already trimmed to its Budget,
			// so a count here could never exceed it and would read as evidence
			// of a constraint that cannot fire.
		});
	}

	if (current !== undefined) {
		parts.push({
			source: "current-turn",
			messages: current.messages,
			approximateTokens: approximateTokens(current.messages),
			carried: 1,
			turnIndices: current.index === undefined ? [] : [current.index],
		});
	}

	const messages = parts.flatMap((part) => part.messages);
	let total = 0;
	for (const part of parts) total += part.approximateTokens;

	return {
		messages,
		parts,
		budgets: {
			tail: config.tailTurns,
			recall: config.recallTurns,
			docs: config.docConcepts,
			graph: config.graphSymbols,
		},
		rejected,
		approximateTokens: total,
	};
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
 */
function asStructure(around: Neighbourhood): HarnessMessage {
	const lines = around.edges.map(describeEdge);
	// Saying how many were left out matters: silence would read as "this
	// symbol connects to twelve things", which for a hub is false.
	if (around.dropped > 0) {
		lines.push(`… and ${around.dropped} more connections`);
	}
	return {
		role: "user",
		content: `[codebase structure: ${qualify(around.symbol)}]\n${lines.join("\n")}`,
		cmStructure: true,
	};
}

/**
 * A Concept enters the window as knowledge with a source. Curated knowledge
 * the agent did not derive must be visibly borrowed, or it cannot be
 * questioned.
 */
function asCuratedKnowledge(hit: ConceptHit): HarnessMessage {
	const caveat = hit.stale ? " (stale)" : "";
	return {
		role: "user",
		content: `[curated knowledge: ${hit.conceptId}${caveat}]\n${hit.text}`,
		cmCurated: true,
	};
}

/**
 * A recalled Turn enters the window as one attributed message, not as a
 * replayed exchange: the model must be able to tell what was said just now
 * from what is being remembered.
 */
function asRecollection(recalled: RecalledTurn): HarnessMessage {
	const transcript = recalled.turn.messages
		.map((message) => `${message.role}: ${messageText(message)}`)
		.filter((line) => line.trim().length > line.indexOf(":") + 1)
		.join("\n");

	return {
		role: "user",
		content: `[recalled from turn ${recalled.turnIndex} of this conversation]\n${transcript}`,
		cmRecalled: true,
	};
}

/**
 * Deterministic stand-in for a tokenizer: serialized length over four. Used
 * only to attribute a pack's size across its parts, never to measure the
 * Context Window, which the harness reports exactly.
 */
export function approximateTokens(messages: HarnessMessage[]): number {
	let characters = 0;
	for (const message of messages) {
		characters += JSON.stringify(message.content ?? "").length;
	}
	return Math.ceil(characters / 4);
}
