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
	ingest(
		conversationId: string,
		turns: JournalTurn[],
		codebase?: string,
	): Promise<void>;
}

/** A Turn found anywhere in the store, with where it came from. */
export interface FoundTurn extends RecalledTurn {
	conversationId: string;
	/** Absent for Turns ingested before Codebases were recorded. */
	codebase?: string;
	/**
	 * How many Calls the agent took answering this Turn. One for a Turn
	 * answered directly, more for one it had to fight with.
	 */
	calls: number;
}

/** Searches every Conversation, on request rather than during assembly. */
export interface CorpusSearch {
	searchAll(
		query: string,
		limit: number,
		maxDistance: number,
	): Promise<FoundTurn[]>;
}

/** A Turn found by meaning, with where it sits in the Conversation. */
export interface RecalledTurn {
	turnIndex: number;
	turn: Turn;
}

/** What retrieval found, what it refused, and what it could not see. */
export interface Recollections {
	turns: RecalledTurn[];
	/** Turns near enough to rank but too distant to be worth carrying. */
	rejected: number;
	/**
	 * Turns of this Conversation holding no valid vector, so no search could
	 * reach them. A recall that came back short because the Conversation is
	 * still being embedded is a different fact from one where nothing was
	 * relevant, and only this tells them apart.
	 */
	unsearched: number;
}

/** Which model made the vectors a store holds. */
export interface VectorModels {
	/** The model embedding runs under now. */
	inUse: string;
	/**
	 * Models that produced stored vectors and are no longer in use, with the
	 * Turns each accounts for. Those Turns are not ranked: two vector spaces
	 * in one table make ranking arbitrary, so they count as pending instead.
	 */
	others: { model: string; turns: number }[];
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
