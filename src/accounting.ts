import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Pack, PackSource } from "./assembler.ts";
import type { ContextSnapshot } from "./messages.ts";

/** Where a Call sits in its Conversation. A Turn may contain several Calls. */
export interface CallAddress {
	turnIndex: number;
	callIndex: number;
}

/**
 * What one Call's Context Window was made of.
 *
 * `packTokens` and `floorTokens` come from the harness's own report and are
 * absent until it has answered. `approximateTokens` is ours, and is only ever
 * used to attribute a pack across its parts.
 */
export interface CallAccounting extends CallAddress {
	at?: string;
	parts: { source: PackSource; approximateTokens: number; approximate: true }[];
	approximateTokens?: number;
	packTokens?: number;
	floorTokens?: number;
	/** True when assembly failed and the harness's own array was used. */
	unassembled?: boolean;
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

interface PackEntry extends CallAddress {
	kind: "pack";
	conversationId: string;
	at: string;
	parts: { source: PackSource; approximateTokens: number }[];
	approximateTokens: number;
	unassembled?: boolean;
}

interface MeasurementEntry extends CallAddress {
	kind: "measurement";
	conversationId: string;
	promptTokens: number;
	nonMessageTokens: number;
}

type AccountingEntry = PackEntry | MeasurementEntry;

/**
 * Append-only per-Conversation record of what each Context Window contained.
 *
 * Append-only because measurements arrive after the pack they describe, often
 * after the process that assembled it has exited: a later entry refines an
 * earlier one rather than rewriting it, which is also the shape the Thread
 * Store will ingest.
 */
export class Accounting {
	constructor(private readonly directory: string) {}

	private path(conversationId: string): string {
		return join(this.directory, `${conversationId}.jsonl`);
	}

	private async append(entry: AccountingEntry): Promise<void> {
		await mkdir(this.directory, { recursive: true });
		await appendFile(this.path(entry.conversationId), JSON.stringify(entry) + "\n");
	}

	async recordPack(
		conversationId: string,
		address: CallAddress,
		pack: Pack,
	): Promise<void> {
		await this.append({
			kind: "pack",
			conversationId,
			...address,
			at: new Date().toISOString(),
			parts: pack.parts.map((part) => ({
				source: part.source,
				approximateTokens: part.approximateTokens,
			})),
			approximateTokens: pack.approximateTokens,
		});
	}

	/** Records a Call the Assembler could not build a pack for. */
	async recordUnassembled(
		conversationId: string,
		address: CallAddress,
	): Promise<void> {
		await this.append({
			kind: "pack",
			conversationId,
			...address,
			at: new Date().toISOString(),
			parts: [],
			approximateTokens: 0,
			unassembled: true,
		});
	}

	/** Reconciles harness-reported window sizes onto the Calls they describe. */
	async recordMeasurements(
		conversationId: string,
		measurements: (CallAddress & { snapshot: ContextSnapshot })[],
	): Promise<void> {
		for (const measurement of measurements) {
			await this.append({
				kind: "measurement",
				conversationId,
				turnIndex: measurement.turnIndex,
				callIndex: measurement.callIndex,
				promptTokens: measurement.snapshot.promptTokens,
				nonMessageTokens: measurement.snapshot.nonMessageTokens,
			});
		}
	}

	/** Every Turn of a Conversation, in Turn order, each with its Calls. */
	async read(conversationId: string): Promise<TurnAccounting[]> {
		let text: string;
		try {
			text = await readFile(this.path(conversationId), "utf8");
		} catch {
			return [];
		}

		const calls = new Map<string, CallAccounting>();
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			const entry = JSON.parse(line) as AccountingEntry;
			const key = `${entry.turnIndex}:${entry.callIndex}`;
			const call = calls.get(key) ?? {
				turnIndex: entry.turnIndex,
				callIndex: entry.callIndex,
				parts: [],
			};

			if (entry.kind === "pack") {
				call.at = entry.at;
				call.parts = entry.parts.map((part) => ({ ...part, approximate: true }));
				call.approximateTokens = entry.approximateTokens;
				if (entry.unassembled) call.unassembled = true;
			} else {
				// A measurement with no pack is still evidence the Call happened.
				call.floorTokens = entry.nonMessageTokens;
				call.packTokens = entry.promptTokens - entry.nonMessageTokens;
			}

			calls.set(key, call);
		}

		const turns = new Map<number, TurnAccounting>();
		for (const call of [...calls.values()].sort(byAddress)) {
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
}

function byAddress(a: CallAddress, b: CallAddress): number {
	return a.turnIndex - b.turnIndex || a.callIndex - b.callIndex;
}
