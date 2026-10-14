import { createHash } from "node:crypto";

import type { BranchEntry } from "./harness.ts";
import type { HarnessMessage } from "./messages.ts";

/**
 * Every Briefing a Call sent as a turn-scoped system message is stored as
 * sent and sent again, cleared, on every later Call that still carries the
 * message it followed (ADR-0011). Nothing here reads a Store or a clock:
 * the Journal is the only record, so a fresh process re-sends the same
 * bytes.
 */

/** The `customType` of every Briefing entry this extension writes. */
export const BRIEFING_ENTRY = "pi-chart.briefing";

/**
 * What a Briefing entry holds. `follows` names the Journal entry of the
 * message the Briefing followed. On a Turn's first Call that message, the
 * prompt, is not in the Journal yet, so the entry `precedes` it instead and
 * resolves to the first message written under it; `at` is the prompt's
 * timestamp, which guards against the prompt being flushed first.
 *
 * `text` is written only where no earlier entry of the file holds `hash`.
 */
export type BriefingEntry =
	| { v: 1; follows: string; hash: string; text?: string }
	| { v: 1; precedes: true; at?: number; hash: string; text?: string };

/** A stored Briefing as replayed: its text, or `undefined` where none is held. */
export interface StoredBriefing {
	hash: string;
	text: string | undefined;
}

/** The identity a Briefing's text is stored and referenced under. */
export function hashOf(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/**
 * The cleared message a Briefing is sent as: a turn-scoped system message
 * the harness clears at the next user message (ADR-0011). The one
 * constructor, so re-sending a stored text yields the bytes first sent.
 * `timestamp` is the followed message's.
 */
export function briefingMessage(text: string, timestamp: number | undefined): HarnessMessage {
	const message: HarnessMessage = {
		role: "developer",
		content: [{ type: "text", text }],
		providerPayload: { type: "anthropicMessage", clearAt: "next_user_message" },
	};
	if (timestamp !== undefined) message.timestamp = timestamp;
	return message;
}

/**
 * The entry that stores `text`, carrying it inline only where the file
 * holds no text under its hash yet.
 */
export function briefingEntry(
	text: string,
	followed: { follows: string } | { precedes: true; at?: number },
	entries: readonly BranchEntry[],
): BriefingEntry {
	const hash = hashOf(text);
	const known = textsOf(entries).has(hash);
	return { v: 1, ...followed, hash, ...(known ? {} : { text }) };
}

/**
 * Every stored Briefing of a Journal, by the entry id of the message it
 * followed. Read over the whole file, not the branch: an entry lands after
 * its message, so it can lie off a branch its message lies on. The entry
 * written last for a message wins, as a retried Call's Briefing must. A
 * hash whose text no entry holds resolves with `text: undefined`, which
 * makes it missing rather than replaced.
 *
 * Malformed data is skipped rather than thrown on: a hand-edited Journal
 * must not take assembly down with it.
 */
export function replayBriefings(entries: readonly BranchEntry[]): Map<string, StoredBriefing> {
	const texts = textsOf(entries);
	const byId = new Map<string, BranchEntry>();
	const firstChild = new Map<string, BranchEntry>();
	for (const entry of entries) {
		if (entry.id === undefined) continue;
		byId.set(entry.id, entry);
		if (typeof entry.parentId === "string" && !firstChild.has(entry.parentId)) {
			firstChild.set(entry.parentId, entry);
		}
	}

	const stored = new Map<string, StoredBriefing>();
	for (const entry of entries) {
		const parsed = parseEntry(entry);
		if (parsed === undefined) continue;
		const followed =
			"follows" in parsed ? parsed.follows : promptOf(entry, parsed.at, byId, firstChild);
		if (followed === undefined) continue;
		// Deleted first so the map's order is the order of the last writes.
		stored.delete(followed);
		stored.set(followed, { hash: parsed.hash, text: texts.get(parsed.hash) });
	}
	return stored;
}

/** What placing stored Briefings sent, for Accounting. */
interface Placement {
	messages: HarnessMessage[];
	/** Earlier Briefings sent again. */
	resent: number;
	/** Their texts' size, in UTF-8 bytes. */
	resentBytes: number;
	/** Briefings that should have been sent again but have no stored text. */
	missing: number;
}

/**
 * `messages` with every stored Briefing inserted, cleared, directly after
 * the message it followed. `keyOf` names a message's Journal entry, or
 * nothing for one that has none. A message the Pack does not carry sends
 * no Briefing; a Briefing with no stored text is counted and nothing is
 * sent in its place, since a substitute would not be the bytes first sent.
 */
export function placeBriefings(
	messages: readonly HarnessMessage[],
	keyOf: (message: HarnessMessage) => string | undefined,
	stored: ReadonlyMap<string, StoredBriefing>,
): Placement {
	const placed: Placement = { messages: [], resent: 0, resentBytes: 0, missing: 0 };
	for (const message of messages) {
		placed.messages.push(message);
		const key = keyOf(message);
		const briefing = key === undefined ? undefined : stored.get(key);
		if (briefing === undefined) continue;
		if (briefing.text === undefined) {
			placed.missing += 1;
			continue;
		}
		placed.messages.push(briefingMessage(briefing.text, message.timestamp));
		placed.resent += 1;
		placed.resentBytes += Buffer.byteLength(briefing.text);
	}
	return placed;
}

/**
 * The entries a new Journal needs so its first Call sends again every
 * Briefing the parent stored for a message on the copied `path`. Each
 * carries its text inline: the copy may lack the entry the parent's
 * hash-only references point at. One the copy already resolves to the same
 * text is not written again.
 */
export function carriedBriefings(
	path: readonly BranchEntry[],
	parent: ReadonlyMap<string, StoredBriefing>,
	copied: ReadonlyMap<string, StoredBriefing>,
): BriefingEntry[] {
	const carried: BriefingEntry[] = [];
	for (const entry of path) {
		if (entry.type !== "message" || entry.id === undefined) continue;
		const briefing = parent.get(entry.id);
		if (briefing?.text === undefined) continue;
		const already = copied.get(entry.id);
		if (already?.hash === briefing.hash && already.text !== undefined) continue;
		carried.push({ v: 1, follows: entry.id, hash: briefing.hash, text: briefing.text });
	}
	return carried;
}

/** Every Briefing text the file holds, by hash. */
function textsOf(entries: readonly BranchEntry[]): Map<string, string> {
	const texts = new Map<string, string>();
	for (const entry of entries) {
		const parsed = parseEntry(entry);
		if (parsed?.text !== undefined && !texts.has(parsed.hash)) {
			texts.set(parsed.hash, parsed.text);
		}
	}
	return texts;
}

/**
 * The prompt a first Call's entry was written for: the first message
 * written under it, through any entry written between (a retried Call's
 * own). Where the prompt was flushed before the entry, the entry's parent
 * is that prompt, recognised by its timestamp.
 */
function promptOf(
	entry: BranchEntry,
	at: number | undefined,
	byId: ReadonlyMap<string, BranchEntry>,
	firstChild: ReadonlyMap<string, BranchEntry>,
): string | undefined {
	const parent = typeof entry.parentId === "string" ? byId.get(entry.parentId) : undefined;
	if (at !== undefined && parent?.type === "message" && parent.message?.timestamp === at) {
		return parent.id;
	}
	const seen = new Set<string>();
	let next = entry.id === undefined ? undefined : firstChild.get(entry.id);
	while (next?.id !== undefined && !seen.has(next.id)) {
		if (next.type === "message") return next.id;
		seen.add(next.id);
		next = firstChild.get(next.id);
	}
	return undefined;
}

function parseEntry(entry: BranchEntry): BriefingEntry | undefined {
	if (entry.type !== "custom" || entry.customType !== BRIEFING_ENTRY) return undefined;
	const data = entry.data;
	if (typeof data !== "object" || data === null) return undefined;
	const fields = data as Record<string, unknown>;
	if (fields.v !== 1 || typeof fields.hash !== "string") return undefined;
	if (fields.text !== undefined && typeof fields.text !== "string") return undefined;
	const text = fields.text;
	if (typeof fields.follows === "string") {
		return { v: 1, follows: fields.follows, hash: fields.hash, text };
	}
	if (fields.precedes !== true) return undefined;
	if (fields.at !== undefined && typeof fields.at !== "number") return undefined;
	return { v: 1, precedes: true, at: fields.at, hash: fields.hash, text };
}
