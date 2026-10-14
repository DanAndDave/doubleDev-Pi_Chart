import type {
	AbsenceCause,
	Budget,
	ExcludedCandidate,
	Pack,
	PackSource,
	PartExclusion,
} from "./assembler.ts";
import type { CallUsage, ContextSnapshot } from "./messages.ts";

/** Where a Call sits in its Conversation. A Turn may contain several Calls. */
export interface CallAddress {
	turnIndex: number;
	callIndex: number;
}

/**
 * Where the verbatim tail of a Context Pack came from: `harness` when every
 * tail Turn came from the harness's live history, `thread-store` when at
 * least one was the Store's copy of a Turn the live history no longer held,
 * `harness-fallback` when the Store's Turn sizes were unavailable.
 */
export type TailSource = "harness" | "thread-store" | "harness-fallback";

/**
 * What the harness's own memory backend was doing while a Conversation ran,
 * in the three states it can actually be in.
 *
 * `unconfirmed` is not a synonym for off: a harness that does not answer has
 * told us nothing, and rounding silence to off would make it indistinguishable
 * from one that confirmed it (ADR-0003, ADR-0004).
 */
export type MemoryBackendState = "off" | "active" | "unconfirmed";

/**
 * What one Call's Context Window was made of.
 *
 * `packTokens` and `floorTokens` come from the harness's own report and are
 * absent until it has answered, less only `systemTokens`, which is ours.
 * `approximateTokens` is ours, and is only ever used to attribute a pack
 * across its parts.
 */
export interface CallAccounting extends CallAddress {
	at?: string;
	parts: RecordedPart[];
	approximateTokens?: number;
	packTokens?: number;
	floorTokens?: number;
	/** True when assembly failed and the harness's own array was used. */
	unassembled?: boolean;
	/** Where the verbatim tail came from. */
	tailSource?: TailSource;
	/** The Budgets in force for this Call, recorded even when unused. */
	budgets?: {
		tail: number;
		/** Absent from Calls recorded before the Opening existed. */
		opening?: number;
		pins?: number;
	};
	/**
	 * The estimated size of pi-chart's additions to this Call's system
	 * prompt, taken out of the reported non-message size so the Floor is the
	 * harness's own. Absent on records written before it was recorded, and
	 * on Calls whose Pack was never assembled.
	 */
	systemTokens?: number;
	/** The Pack ceiling in force for this Call. Absent on older records. */
	ceiling?: number;
	/**
	 * What the parts came to before the ceiling reduced them. Equal to
	 * `approximateTokens` when the ceiling did not bind, so the two together
	 * say whether a pack fitted or was made to fit.
	 */
	beforeCeiling?: number;
	/**
	 * The compaction the harness reported for the window that carried this
	 * Call. Absent where it reported none and on records written before it
	 * was read — an epoch nobody recorded is unknown, not zero.
	 */
	compactionEpoch?: number;
	/**
	 * What the harness's own memory backend was doing for this Call. The
	 * Assembler cannot reach the Floor the backend injects into, so this is
	 * the record that says whether anything else was filling the window.
	 * Absent on Calls recorded before it was observed.
	 */
	memoryBackend?: MemoryBackendState;
	/**
	 * What the window cost, as the provider reported it: tokens read from
	 * the prompt cache, written into it, and charged as neither. Absent
	 * where the provider reported none and on records written before they
	 * were read — a Call nobody measured is unmeasured, not free.
	 */
	cacheRead?: number;
	cacheWrite?: number;
	inputTokens?: number;
}

/** What one part of a pack contributed, as recorded at assembly time. */
export interface RecordedPart {
	source: PackSource;
	approximateTokens: number;
	/** Always true: nothing reports per-part cost, so this is our estimate. */
	approximate: true;
	/** Where it was sent; absent means among the messages. */
	placement?: "system-prompt";
	/** How many Turns it carried. Absent on older records. */
	carried?: number;
	/** Turns this part carried, by position. Absent on older records. */
	turnIndices?: number[];
	/** Pins this part carried, by id — never their text, which the Journal holds. */
	pinIds?: number[];
	/**
	 * The Budget that bounded it, where one did. Rows written before a
	 * Budget was one value carry the pair `budget`/`tokenBudget` instead,
	 * which the inspector still reads: a recorded Call is what was sent,
	 * and nothing migrates it.
	 */
	budget?: Budget | number;
	/** The token half, on rows written before the pair became one value. */
	tokenBudget?: number;
	/** How many candidates it chose from. */
	candidates?: number;
	/**
	 * Why it carried less than its candidates offered, by reason. Absent on
	 * older records, and absent when nothing was excluded.
	 */
	excluded?: PartExclusion;
	/**
	 * Which candidates it did not carry, by identity. Absent on records
	 * written before identities were retained, which is what makes such a
	 * Call unexplainable rather than one that excluded nothing.
	 */
	excludedCandidates?: ExcludedCandidate[];
	/** Why it contributed nothing, where it contributed nothing. */
	absent?: AbsenceCause;
	/** What it would have carried had the pack ceiling not bound. */
	withoutCeiling?: number;
	/** Whether any of its content was carried shortened. */
	shortened?: boolean;
	/** How many of its messages were dropped to fit; absent where none were. */
	droppedMessages?: number;
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
	/** What the provider charged for it, where it said. */
	usage?: CallUsage;
}

/**
 * Records what each Context Window contained. Implemented by the Thread Store
 * in production and in memory for tests that do not need a database.
 *
 * `memoryBackend` is required on both writes because every Call has one: a
 * Conversation that could not interrogate the harness is `unconfirmed`, not
 * absent. Absence means only that a row predates the record, which is a
 * read-side fact about old rows and never a choice a writer makes.
 */
export interface AccountingStore {
	recordPack(
		conversationId: string,
		address: CallAddress,
		pack: Pack,
		tailSource: TailSource,
		memoryBackend: MemoryBackendState,
	): Promise<void>;
	recordUnassembled(
		conversationId: string,
		address: CallAddress,
		memoryBackend: MemoryBackendState,
	): Promise<void>;
	recordMeasurements(
		conversationId: string,
		measurements: Measurement[],
	): Promise<void>;
	/**
	 * Adds what the provider charged to Calls already recorded, and to no
	 * others. Read back from the Journal, where the live path missed them:
	 * the Journal numbers its Calls by walking a file that keeps abandoned
	 * branches, so a Call it names that Accounting does not hold is a Call
	 * this system never assembled — recording it would put a cost beside a
	 * Pack that was never there.
	 */
	recordCosts(
		conversationId: string,
		measurements: Measurement[],
	): Promise<void>;
	readAccounting(conversationId: string): Promise<TurnAccounting[]>;
}

/**
 * What is kept about a part: enough to explain a pack, not to replay it.
 *
 * Every field is named and copied rather than spread. What arrives is a
 * `PackPart`, which carries the part's messages: a spread would put the
 * Conversation's content into Accounting, which ADR-0002 reserves for the
 * Journal and the bundle. The list is the wall.
 *
 * The ledger is written even when empty, because an empty ledger and an
 * absent one mean different things: nothing was excluded, against a Call
 * recorded before exclusions were named at all.
 */
export function recordPart(part: {
	source: PackSource;
	approximateTokens: number;
	placement?: "system-prompt";
	carried?: number;
	turnIndices?: number[];
	pinIds?: number[];
	budget?: Budget;
	candidates?: number;
	excluded?: PartExclusion;
	excludedCandidates?: ExcludedCandidate[];
	absent?: AbsenceCause;
	withoutCeiling?: number;
	shortened?: boolean;
	droppedMessages?: number;
}): RecordedPart {
	return {
		source: part.source,
		approximateTokens: part.approximateTokens,
		approximate: true,
		placement: part.placement,
		carried: part.carried,
		turnIndices: part.turnIndices,
		pinIds: part.pinIds,
		budget: part.budget,
		candidates: part.candidates,
		excluded: part.excluded,
		excludedCandidates: part.excludedCandidates ?? [],
		absent: part.absent,
		withoutCeiling: part.withoutCeiling,
		shortened: part.shortened,
		droppedMessages: part.droppedMessages,
	};
}

/**
 * The Floor and the pack side of one reported window. The harness reports
 * the system prompt inside one non-message figure, so pi-chart's additions
 * to it are taken out by estimate: they belong to the pack, and the Floor is
 * what the Assembler does not control. Never below zero — an estimate over
 * the reported figure must not invent a negative Floor.
 */
export function splitWindow(
	snapshot: ContextSnapshot,
	systemTokens = 0,
): { floorTokens: number; packTokens: number } {
	const floorTokens = Math.max(0, snapshot.nonMessageTokens - systemTokens);
	return { floorTokens, packTokens: snapshot.promptTokens - floorTokens };
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
		memoryBackend: MemoryBackendState,
	): Promise<void> {
		const call = this.at(conversationId, address);
		call.at = new Date().toISOString();
		call.parts = pack.parts.map(recordPart);
		call.approximateTokens = pack.approximateTokens;
		call.tailSource = tailSource;
		call.budgets = pack.budgets;
		call.systemTokens = pack.systemTokens;
		call.ceiling = pack.ceiling;
		call.beforeCeiling = pack.beforeCeiling;
		call.memoryBackend = memoryBackend;
	}

	async recordUnassembled(
		conversationId: string,
		address: CallAddress,
		memoryBackend: MemoryBackendState,
	): Promise<void> {
		const call = this.at(conversationId, address);
		call.at = new Date().toISOString();
		call.unassembled = true;
		call.memoryBackend = memoryBackend;
	}

	async recordMeasurements(
		conversationId: string,
		measurements: Measurement[],
	): Promise<void> {
		for (const measurement of measurements) {
			const call = this.at(conversationId, measurement);
			const { floorTokens, packTokens } = splitWindow(
				measurement.snapshot,
				call.systemTokens,
			);
			call.floorTokens = floorTokens;
			call.packTokens = packTokens;
			call.compactionEpoch = measurement.snapshot.compactionEpoch;
			// Left alone where the provider reported nothing: a Call it did
			// not price is unmeasured, and zeroes would read as free.
			const usage = measurement.usage;
			if (usage?.cacheRead !== undefined) call.cacheRead = usage.cacheRead;
			if (usage?.cacheWrite !== undefined) call.cacheWrite = usage.cacheWrite;
			if (usage?.input !== undefined) call.inputTokens = usage.input;
		}
	}

	async recordCosts(
		conversationId: string,
		measurements: Measurement[],
	): Promise<void> {
		const conversation = this.forConversation(conversationId);
		for (const measurement of measurements) {
			const key = `${measurement.turnIndex}:${measurement.callIndex}`;
			const call = conversation.get(key);
			// Only Calls this system recorded: an address the Journal names
			// and Accounting does not is a Call nothing here assembled.
			if (!call) continue;
			const usage = measurement.usage;
			if (usage?.cacheRead !== undefined) call.cacheRead = usage.cacheRead;
			if (usage?.cacheWrite !== undefined) call.cacheWrite = usage.cacheWrite;
			if (usage?.input !== undefined) call.inputTokens = usage.input;
		}
	}

	async readAccounting(conversationId: string): Promise<TurnAccounting[]> {
		return groupByTurn(conversationId, [
			...this.forConversation(conversationId).values(),
		]);
	}
}
