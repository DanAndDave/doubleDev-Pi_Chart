import { elide, ELISION } from "./elision.ts";
import { shares } from "./shares.ts";
import {
	isToolCall,
	messageText,
	renderToolCall,
	type HarnessMessage,
} from "./messages.ts";

/**
 * What a Turn is embedded as.
 *
 * The model reads at most 512 tokens and silently drops the rest, so the
 * question is not how much of a Turn to hand it but which parts. Handing it
 * a join of every message in order answers that by arrival: measured over
 * this machine's 220 Journals, of the 48 Turns larger than the cut only 3
 * had their own conclusion inside their vector and none had a tool call at
 * all. A Turn was findable by how it opened and by nothing it decided.
 *
 * So each contribution — the prompt, the prose, each tool call, each result
 * — competes for a share of a character allowance, and what cannot fit is
 * shortened head-and-tail rather than lost from the end. Same corpus:
 * 47 of 48 carry their conclusion and 47 of 48 carry a tool call.
 */

/**
 * The characters a Turn may be embedded from. 1,200 because it is the
 * largest round allowance whose composed text stayed inside the model's cut
 * on every one of this machine's 387 recorded Turns: 501 tokens at the
 * worst, 11 short of 512, measured through this composition with the real
 * elision marker. At 1,400 fourteen Turns overran the cut, which reinstates
 * the failure this composition exists to remove.
 */
export const EMBED_CHARACTERS = 1200;

/**
 * The fewest characters worth giving one contribution whose text has to be
 * elided, and so what decides how many are seated: below it a head, a tail
 * and a marker leave nothing readable.
 *
 * Measured, not chosen: at 100 a Turn's conclusion reached its vector in
 * 16 of the 48 oversized Turns here, because the last message's share was
 * too small to keep its tail; at 180, 47.
 */
export const SHORTEST_SHARE = 180;

/**
 * What a contribution is worth when the allowance cannot seat them all.
 *
 * The prompt states the subject; the Turn's last prose states what it
 * concluded, which is what a later prompt asks about; a call names what was
 * acted on in a few dozen characters; earlier prose restates it; a result is
 * the bulk of the bytes and the least of the meaning.
 */
const PROMPT = 0;
const CONCLUSION = 1;
const ACTION = 2;
const PROSE = 3;
const RESULT = 4;

/** One thing a Turn has to say, with its claim on the budget. */
interface Contribution {
	text: string;
	/** Which kind it is, by the order they give way in. */
	rank: number;
	/** Which message it came from, so the text stays chronological. */
	at: number;
}

/**
 * The text a Turn is embedded from: its prompt, its prose, the calls it made
 * with the arguments it made them with, and what those calls returned.
 *
 * Pure and container-free, so the composition can be held to its contract
 * without a database or a model, and so ingest and embedding derive the same
 * string from the same Turn — which is what makes the content hash mean
 * anything.
 */
export function embedText(
	messages: HarnessMessage[],
	characters = EMBED_CHARACTERS,
): string {
	if (characters <= 0) return "";

	const parts = contributions(messages);
	if (parts.length === 0) return "";

	// Who gets a seat: by kind, then by recency, because a Turn's last
	// actions and last words are what it arrived at. A contribution is
	// seated while the allowance can still give every seated one a readable
	// share — its own length if that is small, `SHORTEST_SHARE` if it will
	// have to be elided.
	//
	// Counted rather than capped at `characters / SHORTEST_SHARE`: that cap
	// discarded contributions while the allowance sat almost untouched,
	// because eight short messages need eight short shares, not eight
	// floors. The thread-store delta requires every other message of a Turn
	// to contribute when the representation can carry them.
	const ordered = parts
		.map((part, order) => ({ part, order }))
		.sort(
			(a, b) =>
				a.part.rank - b.part.rank ||
				b.part.at - a.part.at ||
				a.order - b.order,
		);

	const admitted: { part: Contribution; order: number }[] = [];
	let needed = 0;
	for (const candidate of ordered) {
		const claim = Math.min(candidate.part.text.length, SHORTEST_SHARE);
		if (admitted.length > 0 && needed + claim > characters) break;
		needed += claim;
		admitted.push(candidate);
	}

	const seated = admitted
		.sort((a, b) => a.order - b.order)
		.map((each) => each.part);

	const allowances = shares(
		seated.map((part) => part.text.length),
		characters,
	);

	const marker = ELISION(0, false).length;
	const lines: string[] = [];
	for (const [index, part] of seated.entries()) {
		const allowance = allowances[index] ?? 0;
		if (part.text.length <= allowance) {
			lines.push(part.text);
			continue;
		}
		const half = Math.floor((allowance - marker) / 2);
		if (half < 1) continue;
		lines.push(
			elide(part.text, half, Math.ceil((part.text.length - half * 2) / 4), false),
		);
	}
	return lines.join("\n");
}

/**
 * The fingerprint a Turn's embed text is stored under, so a changed Turn can
 * be told from an unchanged one without keeping the text itself.
 *
 * Over the derived text rather than the raw messages: change how a Turn is
 * composed and every fingerprint changes with it, which is what invalidates
 * the corpus without a version column or a hand-written backfill.
 */
export function embedFingerprint(messages: HarnessMessage[]): string {
	return new Bun.CryptoHasher("sha256")
		.update(embedText(messages))
		.digest("hex")
		.slice(0, 32);
}

/** Everything a Turn's messages have to say, in the order they said it. */
function contributions(messages: HarnessMessage[]): Contribution[] {
	// The conclusion is the last prose the agent produced, wherever it sits:
	// a Turn that ends on a tool result concluded before it.
	const concluded = messages.findLastIndex(
		(message) => message.role === "assistant" && messageText(message).trim() !== "",
	);

	const parts: Contribution[] = [];
	for (const [at, message] of messages.entries()) {
		const text = messageText(message).trim();
		if (text !== "") {
			const rank =
				message.role === "user"
					? PROMPT
					: at === concluded
						? CONCLUSION
						: message.role === "toolResult"
							? RESULT
							: PROSE;
			parts.push({ text, rank, at });
		}

		const content = message.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			// A call whose result never came is still what the Turn did, and
			// this is text rather than protocol: it is embedded like any
			// other action, so an interrupted Turn stays findable by it.
			if (!isToolCall(block)) continue;
			parts.push({ text: renderToolCall(block), rank: ACTION, at });
		}
	}
	return parts;
}

