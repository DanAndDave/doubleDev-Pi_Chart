import type { JournalTurn } from "./journal.ts";
import type { Turn } from "./messages.ts";

/**
 * Where the Assembler gets the Turns behind a Context Pack's verbatim tail.
 *
 * Narrow on purpose: the Assembler depends on this, never on a database, which
 * is what keeps the default test suite container-free (ADR-0002) and what lets
 * the Doc and Graph Stores arrive behind the same shape.
 */
export interface TurnSource {
	/** The most recent completed Turns of a Conversation, oldest first. */
	recentTurns(conversationId: string, limit: number): Promise<Turn[]>;
}

/** Ingests a Conversation's recorded Turns. */
export interface TurnSink {
	ingest(conversationId: string, turns: JournalTurn[]): Promise<void>;
}

/** A Turn found by meaning, with where it sits in the Conversation. */
export interface RecalledTurn {
	turnIndex: number;
	turn: Turn;
}

/** What retrieval found, and what it refused as not relevant enough. */
export interface Recollections {
	turns: RecalledTurn[];
	/** Turns near enough to rank but too distant to be worth carrying. */
	rejected: number;
}

/** Finds Turns by meaning rather than recency. */
export interface TurnRecall {
	similarTurns(
		conversationId: string,
		prompt: string,
		limit: number,
		maxDistance: number,
	): Promise<Recollections>;
}

/** A Turn source backed by memory, for tests and for fixtures. */
export class MemoryTurnSource implements TurnSource, TurnSink {
	private readonly byConversation = new Map<string, Map<number, Turn>>();

	async ingest(conversationId: string, turns: JournalTurn[]): Promise<void> {
		const existing =
			this.byConversation.get(conversationId) ?? new Map<number, Turn>();
		for (const turn of turns) {
			// Keyed by address, so re-ingesting the same Journal replaces rather
			// than duplicates.
			existing.set(turn.turnIndex, {
				index: turn.turnIndex,
				prompt: turn.prompt,
				messages: turn.messages,
			});
		}
		this.byConversation.set(conversationId, existing);
	}

	async recentTurns(conversationId: string, limit: number): Promise<Turn[]> {
		const turns = this.byConversation.get(conversationId);
		if (!turns || limit <= 0) return [];
		return [...turns.entries()]
			.sort(([a], [b]) => a - b)
			.slice(-limit)
			.map(([, turn]) => turn);
	}
}
