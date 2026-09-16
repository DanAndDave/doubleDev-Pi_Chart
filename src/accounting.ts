import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Pack, PackSource } from "./assembler.ts";
import type { ContextSnapshot } from "./messages.ts";

/**
 * What a single LLM call's Context Window was made of.
 *
 * `packTokens` and `floorTokens` come from the harness's own report and are
 * absent until it has responded. `approximateTokens` is ours and is only ever
 * used to attribute a pack across its parts.
 */
export interface TurnAccounting {
	conversationId: string;
	callIndex: number;
	at: string;
	parts: { source: PackSource; approximateTokens: number; approximate: true }[];
	approximateTokens: number;
	packTokens?: number;
	floorTokens?: number;
}

interface PackRecord {
	kind: "pack";
	conversationId: string;
	callIndex: number;
	at: string;
	parts: { source: PackSource; approximateTokens: number }[];
	approximateTokens: number;
}

interface MeasurementRecord {
	kind: "measurement";
	conversationId: string;
	callIndex: number;
	promptTokens: number;
	nonMessageTokens: number;
}

type Record_ = PackRecord | MeasurementRecord;

/**
 * Append-only per-Conversation record of what each Context Window contained.
 *
 * Append-only because measurements arrive after the pack they describe: a
 * later record refines an earlier one rather than rewriting it, which is also
 * the shape the Thread Store will ingest.
 */
export class AccountingLog {
	constructor(private readonly directory: string) {}

	private path(conversationId: string): string {
		return join(this.directory, `${conversationId}.jsonl`);
	}

	private async append(record: Record_): Promise<void> {
		await mkdir(this.directory, { recursive: true });
		await appendFile(this.path(record.conversationId), JSON.stringify(record) + "\n");
	}

	async recordPack(
		conversationId: string,
		callIndex: number,
		pack: Pack,
	): Promise<void> {
		await this.append({
			kind: "pack",
			conversationId,
			callIndex,
			at: new Date().toISOString(),
			parts: pack.parts.map((part) => ({
				source: part.source,
				approximateTokens: part.approximateTokens,
			})),
			approximateTokens: pack.approximateTokens,
		});
	}

	/** Reconciles harness-reported window sizes onto the calls they describe. */
	async recordMeasurements(
		conversationId: string,
		snapshots: ContextSnapshot[],
		firstCallIndex = 0,
	): Promise<void> {
		for (const [offset, snapshot] of snapshots.entries()) {
			await this.append({
				kind: "measurement",
				conversationId,
				callIndex: firstCallIndex + offset,
				promptTokens: snapshot.promptTokens,
				nonMessageTokens: snapshot.nonMessageTokens,
			});
		}
	}

	async read(conversationId: string): Promise<TurnAccounting[]> {
		let text: string;
		try {
			text = await readFile(this.path(conversationId), "utf8");
		} catch {
			return [];
		}

		const byCall = new Map<number, TurnAccounting>();
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			const record = JSON.parse(line) as Record_;
			if (record.kind === "pack") {
				byCall.set(record.callIndex, {
					conversationId: record.conversationId,
					callIndex: record.callIndex,
					at: record.at,
					parts: record.parts.map((part) => ({ ...part, approximate: true })),
					approximateTokens: record.approximateTokens,
				});
				continue;
			}
			const existing = byCall.get(record.callIndex);
			if (!existing) continue;
			existing.floorTokens = record.nonMessageTokens;
			existing.packTokens = record.promptTokens - record.nonMessageTokens;
		}

		return [...byCall.values()].sort((a, b) => a.callIndex - b.callIndex);
	}
}
