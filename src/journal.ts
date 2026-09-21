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
	message?: HarnessMessage;
}

/**
 * Reads the harness's append-only Journal for one Conversation.
 *
 * The Journal is the record and the Thread Store is derived from it (ADR-0002),
 * so ingest reads this rather than the live session: a store rebuilt from disk
 * is then a real operation rather than an aspiration.
 */
export async function readJournal(path: string): Promise<JournalTurn[]> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return [];
	}

	const turns: JournalTurn[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;

		let entry: JournalEntry;
		try {
			entry = JSON.parse(line) as JournalEntry;
		} catch {
			// A partially flushed final line is not a reason to lose the session.
			continue;
		}

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
