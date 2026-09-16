import type { HarnessMessage, Turn } from "./messages.ts";

export interface AssemblerConfig {
	/** How many completed Turns are carried verbatim ahead of the current one. */
	tailTurns: number;
}

/** Where a slice of a Context Pack came from. */
export type PackSource = "verbatim-tail" | "current-turn";

export interface PackPart {
	source: PackSource;
	messages: HarnessMessage[];
	/**
	 * Local character-based estimate. Approximate by construction: nothing
	 * reports per-part cost, so this is never used for pack-versus-Floor.
	 */
	approximateTokens: number;
}

export interface Pack {
	messages: HarnessMessage[];
	parts: PackPart[];
	/** Sum of the parts' approximations. Approximate, for attribution only. */
	approximateTokens: number;
}

/**
 * Builds the Context Pack for one Turn: the Turn in progress, preceded by the
 * last `tailTurns` completed Turns verbatim. Pure — no I/O, no clock, no
 * randomness — so the same inputs always produce the same pack.
 */
export function assemble(turns: Turn[], config: AssemblerConfig): Pack {
	const current = turns[turns.length - 1];
	const completed = turns.slice(0, -1);
	const tail = config.tailTurns > 0 ? completed.slice(-config.tailTurns) : [];

	const parts: PackPart[] = [];

	const tailMessages = tail.flatMap((turn) => turn.messages);
	if (tailMessages.length > 0) {
		parts.push({
			source: "verbatim-tail",
			messages: tailMessages,
			approximateTokens: approximateTokens(tailMessages),
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
