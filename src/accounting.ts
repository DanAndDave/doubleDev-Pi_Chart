import type { Pack, PackSource } from "./assembler.ts";
import type { ContextSnapshot } from "./messages.ts";

/** Where a Call sits in its Conversation. A Turn may contain several Calls. */
export interface CallAddress {
	turnIndex: number;
	callIndex: number;
}

/** Where the verbatim tail of a Context Pack came from. */
export type TailSource = "thread-store" | "harness-fallback";

/**
 * What one Call's Context Window was made of.
 *
 * `packTokens` and `floorTokens` come from the harness's own report and are
 * absent until it has answered. `approximateTokens` is ours, and is only ever
 * used to attribute a pack across its parts.
 */
export interface CallAccounting extends CallAddress {
	at?: string;
	parts: RecordedPart[];
	approximateTokens?: number;
	packTokens?: number;
	floorTokens?: number;
	/** True when assembly failed and the harness's own array was used. */
	unassembled?: boolean;
	/** Whether the tail came from the store or from the harness's own history. */
	tailSource?: TailSource;
	/** The Budgets in force for this Call, recorded even when unused. */
	budgets?: { tail: number; recall: number };
	/** Candidates refused as not relevant enough, even when none survived. */
	rejected?: number;
}

/** What one part of a pack contributed, as recorded at assembly time. */
export interface RecordedPart {
	source: PackSource;
	approximateTokens: number;
	/** Always true: nothing reports per-part cost, so this is our estimate. */
	approximate: true;
	/** How many Turns it carried. Absent on older records. */
	carried?: number;
	/** Turns this part carried, by position. Absent on older records. */
	turnIndices?: number[];
	/** The Budget that bounded it, where one did. */
	budget?: number;
	/** How many candidates it chose from. */
	candidates?: number;
	/** How many were refused as insufficiently relevant. */
	irrelevant?: number;
}

/** Everything recorded for one Turn, which is one or more Calls. */
export interface TurnAccounting {
	conversationId: string;
	turnIndex: number;
	calls: CallAccounting[];
	/** The widest window this Turn reached, pack side. */
	packTokens?: number;
	/** The Floor during this Turn. Constant within a Turn in practice. */
	floorTokens?: number;
}

export interface Measurement extends CallAddress {
	snapshot: ContextSnapshot;
}

/**
 * Records what each Context Window contained. Implemented by the Thread Store
 * in production and in memory for tests that do not need a database.
 */
export interface AccountingStore {
	recordPack(
		conversationId: string,
		address: CallAddress,
		pack: Pack,
		tailSource: TailSource,
	): Promise<void>;
	recordUnassembled(
		conversationId: string,
		address: CallAddress,
	): Promise<void>;
	recordMeasurements(
		conversationId: string,
		measurements: Measurement[],
	): Promise<void>;
	readAccounting(conversationId: string): Promise<TurnAccounting[]>;
}

/** What is kept about a part: enough to explain a pack, not to replay it. */
export function recordPart(part: {
	source: PackSource;
	approximateTokens: number;
	carried?: number;
	turnIndices?: number[];
	budget?: number;
	candidates?: number;
	irrelevant?: number;
}): RecordedPart {
	return {
		source: part.source,
		approximateTokens: part.approximateTokens,
		approximate: true,
		carried: part.carried,
		turnIndices: part.turnIndices,
		budget: part.budget,
		candidates: part.candidates,
		irrelevant: part.irrelevant,
	};
}

/** Folds Calls into the Turns that contain them, in Turn order. */
export function groupByTurn(
	conversationId: string,
	calls: CallAccounting[],
): TurnAccounting[] {
	const turns = new Map<number, TurnAccounting>();
	const ordered = [...calls].sort(
		(a, b) => a.turnIndex - b.turnIndex || a.callIndex - b.callIndex,
	);

	for (const call of ordered) {
		const turn = turns.get(call.turnIndex) ?? {
			conversationId,
			turnIndex: call.turnIndex,
			calls: [],
		};
		turn.calls.push(call);
		if (call.packTokens !== undefined) {
			turn.packTokens = Math.max(turn.packTokens ?? 0, call.packTokens);
		}
		if (call.floorTokens !== undefined) turn.floorTokens = call.floorTokens;
		turns.set(call.turnIndex, turn);
	}

	return [...turns.values()].sort((a, b) => a.turnIndex - b.turnIndex);
}

/** Accounting held in memory, for tests and for the store-less fallback path. */
export class MemoryAccounting implements AccountingStore {
	private readonly calls = new Map<string, Map<string, CallAccounting>>();

	private forConversation(id: string): Map<string, CallAccounting> {
		const existing = this.calls.get(id);
		if (existing) return existing;
		const created = new Map<string, CallAccounting>();
		this.calls.set(id, created);
		return created;
	}

	private at(
		conversationId: string,
		address: CallAddress,
	): CallAccounting {
		const conversation = this.forConversation(conversationId);
		const key = `${address.turnIndex}:${address.callIndex}`;
		const existing = conversation.get(key);
		if (existing) return existing;
		const created: CallAccounting = { ...address, parts: [] };
		conversation.set(key, created);
		return created;
	}

	async recordPack(
		conversationId: string,
		address: CallAddress,
		pack: Pack,
		tailSource: TailSource,
	): Promise<void> {
		const call = this.at(conversationId, address);
		call.at = new Date().toISOString();
		call.parts = pack.parts.map(recordPart);
		call.approximateTokens = pack.approximateTokens;
		call.tailSource = tailSource;
		call.budgets = pack.budgets;
		call.rejected = pack.rejected;
	}

	async recordUnassembled(
		conversationId: string,
		address: CallAddress,
	): Promise<void> {
		const call = this.at(conversationId, address);
		call.at = new Date().toISOString();
		call.unassembled = true;
	}

	async recordMeasurements(
		conversationId: string,
		measurements: Measurement[],
	): Promise<void> {
		for (const measurement of measurements) {
			const call = this.at(conversationId, measurement);
			call.floorTokens = measurement.snapshot.nonMessageTokens;
			call.packTokens =
				measurement.snapshot.promptTokens - measurement.snapshot.nonMessageTokens;
		}
	}

	async readAccounting(conversationId: string): Promise<TurnAccounting[]> {
		return groupByTurn(conversationId, [
			...this.forConversation(conversationId).values(),
		]);
	}
}
