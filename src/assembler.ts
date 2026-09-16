import { messageText, type HarnessMessage, type Turn } from "./messages.ts";
import type { RecalledTurn } from "./thread-store.ts";

export interface AssemblerConfig {
	/** How many completed Turns are carried verbatim ahead of the current one. */
	tailTurns: number;
	/**
	 * How many recalled Turns a pack may carry. Measured in Turns rather than
	 * tokens: the only token count available here is the local approximation,
	 * and a budget enforced with a number known to be wrong is worse than one
	 * honestly named. `pack-inspector` makes tokens the unit.
	 */
	recallTurns: number;
}

/** Where a slice of a Context Pack came from. */
export type PackSource = "verbatim-tail" | "current-turn" | "recalled";

export interface PackPart {
	source: PackSource;
	messages: HarnessMessage[];
	/**
	 * Local character-based estimate. Approximate by construction: nothing
	 * reports per-part cost, so this is never used for pack-versus-Floor.
	 */
	approximateTokens: number;
	/**
	 * Which Turns this part carried, by their position in the Conversation.
	 * Absent for content with no durable position, such as the Turn in
	 * progress. Recorded so a pack can be explained afterwards rather than
	 * only measured.
	 */
	turnIndices?: number[];
	/** The Budget that bounded this part, where one did. */
	budget?: number;
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
	/** Sum of the parts' approximations. Approximate, for attribution only. */
	approximateTokens: number;
}

export interface AssembleInput {
	/** Turns to carry verbatim: the recent ones, current Turn last. */
	turns: Turn[];
	/** Turns found by meaning, most relevant first. */
	recalled?: RecalledTurn[];
}

/**
 * Builds the Context Pack for one Call: recalled Turns, then the verbatim
 * tail, then the Turn in progress. Pure — no I/O, no clock, no randomness —
 * so the same inputs always produce the same pack.
 */
export function assemble(input: AssembleInput, config: AssemblerConfig): Pack {
	const { turns, recalled = [] } = input;

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
			turnIndices: recollections.map((each) => each.turnIndex),
			budget: config.recallTurns,
			candidates: eligible.length,
		});
	}

	const tailMessages = tail.flatMap((turn) => turn.messages);
	if (tailMessages.length > 0) {
		parts.push({
			source: "verbatim-tail",
			messages: tailMessages,
			approximateTokens: approximateTokens(tailMessages),
			turnIndices: tail
				.map((turn) => turn.index)
				.filter((index) => index !== undefined),
			budget: config.tailTurns,
			candidates: completed.length,
		});
	}

	if (current !== undefined) {
		parts.push({
			source: "current-turn",
			messages: current.messages,
			approximateTokens: approximateTokens(current.messages),
		});
	}

	const messages = parts.flatMap((part) => part.messages);
	let total = 0;
	for (const part of parts) total += part.approximateTokens;

	return { messages, parts, approximateTokens: total };
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
