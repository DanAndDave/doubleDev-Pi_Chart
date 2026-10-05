import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { messageText, type HarnessMessage } from "./messages.ts";

/** A Turn as it was recorded on disk, with its position in the Conversation. */
export interface JournalTurn {
	turnIndex: number;
	prompt: string;
	messages: HarnessMessage[];
	/** How many Calls the agent made answering this Turn. */
	callCount: number;
	/**
	 * Which Call produced each message, by the same index the accounting
	 * uses. Parallel to `messages`, so a message keeps its address without
	 * the record of what was said having to carry it.
	 */
	calls: number[];
}

interface JournalEntry {
	type?: string;
	id?: string;
	parentId?: string | null;
	message?: HarnessMessage;
}

/**
 * Reads one Conversation's Journal along the branch ending at `leafId`, or
 * at the last entry written when the harness names no leaf.
 *
 * The Journal is the record and the Thread Store is derived from it (ADR-0002),
 * so ingest reads this rather than the live session: a store rebuilt from disk
 * is then a real operation rather than an aspiration.
 */
export async function readJournal(
	path: string,
	leafId?: string,
): Promise<JournalTurn[]> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return [];
	}

	const turns: JournalTurn[] = [];
	for (const entry of activeBranch(parse(text), leafId)) {
		const message = entry.type === "message" ? entry.message : undefined;
		if (!message?.role) continue;

		const current = turns[turns.length - 1];
		if (message.role === "user" || current === undefined) {
			turns.push({
				turnIndex: turns.length,
				prompt: message.role === "user" ? messageText(message) : "",
				messages: [message],
				// A prompt never carries a snapshot, but a Journal whose
				// first message is not a prompt can: counting it here keeps
				// ingest and the accounting on the same Call.
				callCount: message.contextSnapshot ? 1 : 0,
				calls: [0],
			});
			continue;
		}

		current.messages.push(message);
		// The message belongs to the Call in progress, and a snapshot ends
		// it: the same direction `addressOf` counts in, so ingest and
		// accounting cannot disagree about which Call a thing was.
		current.calls.push(current.callCount);
		if (message.contextSnapshot) current.callCount++;
	}

	return turns;
}

/** Every entry the Journal holds, in file order. */
function parse(text: string): JournalEntry[] {
	const entries: JournalEntry[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line) as JournalEntry);
		} catch {
			// A partially flushed final line is not a reason to lose the session.
		}
	}
	return entries;
}

/**
 * The entries on the branch the harness is on, root first.
 *
 * One file holds every branch: `/tree` and `/branch` move the leaf to an
 * earlier entry and new entries hang off it, so what was abandoned stays in
 * the file. The branch is the parent chain from the leaf — `leafId` when the
 * harness names it, which it must right after a rewind that appended
 * nothing, else the last entry written, where the harness appends.
 * A tree entry names its parent, `null` at the root; the session header
 * carries an id but no parent and is not one. A Journal without tree
 * entries has no branches to choose between and is read in file order.
 */
function activeBranch(entries: JournalEntry[], leafId?: string): JournalEntry[] {
	const tree = entries.filter((entry) => entry.id && entry.parentId !== undefined);
	if (tree.length === 0) return entries;
	const byId = new Map(tree.map((entry) => [entry.id, entry]));

	const leaf = (leafId === undefined ? undefined : byId.get(leafId)) ?? tree.at(-1);

	const branch: JournalEntry[] = [];
	const seen = new Set<string>();
	for (let entry = leaf; entry?.id && !seen.has(entry.id); ) {
		seen.add(entry.id);
		branch.push(entry);
		entry = entry.parentId ? byId.get(entry.parentId) : undefined;
	}
	return branch.reverse();
}

/** Where the harness keeps its Journals, unless told otherwise. */
export const SESSION_ROOT = join(homedir(), ".omp", "agent", "sessions");

/**
 * Where the harness keeps a Conversation's Journal. The directory encodes the
 * working directory, so the Conversation id alone is not enough to find it.
 */
export async function findJournal(
	conversationId: string,
	sessionRoot = SESSION_ROOT,
): Promise<string | undefined> {
	const glob = new Bun.Glob(`*/*${conversationId}*.jsonl`);
	for await (const match of glob.scan({ cwd: sessionRoot, absolute: true })) {
		return match;
	}
	return undefined;
}
