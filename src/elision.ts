import {
	isToolCall,
	messageText,
	type ContentBlock,
	type HarnessMessage,
} from "./messages.ts";
import { approximateTokens } from "./tokens.ts";

/**
 * Elision: what replaces the middle of a payload too large to carry whole.
 *
 * The head and the tail survive with a marker naming what went, so shortened
 * content is never mistaken for short content. Shared by the Assembler, which
 * elides to fit a Budget, and by the embed text, which elides to fit a
 * message's share of a Turn's vector — one marker, so a reader who has seen
 * one has seen both.
 */

/**
 * Marks the gap a shortened payload leaves, in the payload's own text.
 *
 * "content" rather than "result": a tool result is elided this way, and so
 * are the arguments an assistant passed to a call, so a `write` whose file
 * went would otherwise read as a result that did.
 *
 * Metadata is named separately when the shortening dropped it, because a
 * marker that counted only the text would understate what went: on a real
 * tool result the harness's `details` can rival the content it summarises.
 */
const ELISION = (tokens: number, alsoDropped: number) =>
	`\n… [context-manager elided ~${tokens} tokens from the middle of this` +
	`${alsoDropped > 0 ? " content, and its tool metadata" : " content"}]\n`;

/**
 * The marker for a payload with no room for a head and a tail at all: the
 * gap is the whole of it. Still marked, because content that was there and
 * is not must never read as content that never existed. Says nothing about
 * what the payload was — a recollection shortens the agent's own prose this
 * way as well as a tool's output.
 */
const ELIDED_WHOLE = (tokens: number) =>
	`… [context-manager elided ~${tokens} tokens here]`;

/** What else went with the text, beside the characters it may spend. */
interface Elision {
	/**
	 * Tokens dropped beside the text — the `details` a shortened tool
	 * result loses. Counted into the marker and named by it, so the marker
	 * never reports less than the shortening removed.
	 */
	alsoDropped?: number;
	/**
	 * The fewest characters worth keeping on each side. Below it there is
	 * no head and tail worth reading, and the caller is told so rather than
	 * handed two fragments.
	 */
	floor?: number;
}

/**
 * Head, marker, tail — a payload elided to the characters it may spend,
 * or nothing when it cannot be spent on a head and a tail worth reading.
 *
 * The arithmetic lives here rather than at each caller: every one of them
 * sized its halves by asking the marker how long it was, and three then
 * derived the same estimate of what the middle had cost.
 */
export function elide(
	text: string,
	characters: number,
	{ alsoDropped = 0, floor = 1 }: Elision = {},
): string | undefined {
	const half = Math.floor((characters - ELISION(0, alsoDropped).length) / 2);
	if (half < floor) return undefined;
	// A head and a tail that between them cover the text would carry its
	// middle twice, which is how a message shortened for its metadata alone
	// used to come back longer than it went in. Nothing of the text goes;
	// the marker still says what went beside it.
	if (half * 2 >= text.length) {
		return alsoDropped > 0 ? `${text}${ELISION(alsoDropped, alsoDropped)}` : text;
	}
	const removed = Math.ceil((text.length - half * 2) / 4) + alsoDropped;
	return `${text.slice(0, half)}${ELISION(removed, alsoDropped)}${text.slice(-half)}`;
}

/** The marker for a payload elided whole, in tokens. */
export function elidedWhole(text: string): string {
	return ELIDED_WHOLE(Math.ceil(text.length / 4));
}

/** The characters a marker and two floor-sized halves take together. */
function atLeast(alsoDropped = 0): number {
	return SHORTEST_HALF_CHARACTERS * 2 + ELISION(0, alsoDropped).length;
}

/**
 * The fewest estimated tokens worth carrying of a shortened message: below
 * this there is no room for a head, a tail and a marker worth reading.
 */
export const SHORTEST_TOKENS = 200;

/**
 * The fewest characters worth keeping on each side of the marker. Named in
 * characters rather than derived from `SHORTEST_TOKENS`, because the halves
 * are `slice` indices and a token-shaped constant divided by two is neither
 * unit.
 */
const SHORTEST_HALF_CHARACTERS = 100;

/** One message after shortening, with what it now costs. */
export interface Shortened {
	message: HarnessMessage;
	tokens: number;
	shortened: boolean;
}

/** A Turn's messages after shortening, with what they now cost together. */
export interface ShortenedMessages {
	messages: HarnessMessage[];
	tokens: number;
	shortened: boolean;
}

/**
 * Shortens one message of the verbatim tail or the current Turn to a token
 * allowance, keeping the head and the tail of whatever payload it carries.
 * Head-only would be the wrong half: the end of a tool result is where the
 * error, the total, or the last hunk is.
 *
 * What counts as payload here: a tool result's text, and the arguments of an
 * assistant's tool calls. That last one is measured, not assumed — on the
 * audited Conversation 84% of the largest Turn is the file contents an
 * assistant passed to `write`, so a rule that spared every assistant message
 * would leave the tail Budget unenforceable.
 *
 * What is never shortened: a user prompt, and an assistant's own text. Those
 * are the reasoning a pack exists to carry, and a shortened instruction is a
 * corrupted one.
 *
 * A recollection is shortened by `asRecollection`, not here. It is rendered
 * line by line from its Turn, so it gives way by line — outputs first, then
 * prose — which this function cannot express.
 */
export function elideMessage(
	message: HarnessMessage,
	allowance: number,
): Shortened {
	const cost = approximateTokens([message]);
	if (cost <= allowance) return { message, tokens: cost, shortened: false };

	if (message.role === "toolResult") {
		return shortenText(message, allowance, cost);
	}
	if (message.role === "assistant") return shortenPayloads(message, allowance);
	return { message, tokens: cost, shortened: false };
}

/** Shortens the text a message carries, head and tail, with a marker between. */
function shortenText(
	message: HarnessMessage,
	allowance: number,
	cost: number,
): Shortened {
	const text = messageText(message);
	// `details` can rival the text it summarises, and a shortened message that
	// kept them would not be shorter — so they go, and they are excluded from
	// the overhead too. Counting them as overhead would starve the text of an
	// allowance already spent on something being deleted: measured, a 30,000
	// character `details` drove an otherwise 1,810-token text down to the
	// floor of 231 against a 2,000-token Budget.
	const withoutDetails: HarnessMessage = { ...message };
	delete withoutDetails.details;

	const keptCost = approximateTokens([withoutDetails]);
	const textCost = Math.ceil(JSON.stringify(text).length / 4);
	const overhead = keptCost - textCost;
	const forText = Math.max(allowance - overhead, SHORTEST_TOKENS);
	const characters = forText * 4;
	// The dropped `details` count as elided whatever happens to the text, so
	// the marker never reports less than the shortening removed.
	const droppedDetails = cost - keptCost;
	if (text.length <= characters && droppedDetails === 0) {
		return { message, tokens: cost, shortened: false };
	}

	// Sized by construction, then checked: JSON escaping means the estimate
	// of the shortened message is not a linear function of the characters
	// kept, so the halves shrink until the message actually fits rather than
	// being trusted to.
	let room = characters;
	let best: { message: HarnessMessage; tokens: number } | undefined;
	while (true) {
		const content = elide(text, room, {
			alsoDropped: droppedDetails,
			floor: SHORTEST_HALF_CHARACTERS,
		});
		if (content === undefined) break;
		const candidate: HarnessMessage = {
			...withoutDetails,
			content,
			cmShortened: true,
		};
		const tokens = approximateTokens([candidate]);
		best = { message: candidate, tokens };
		if (tokens <= allowance) break;
		room = Math.floor(room * 0.9) - 2;
	}

	if (best === undefined) return { message, tokens: cost, shortened: false };
	return { message: best.message, tokens: best.tokens, shortened: true };
}

/**
 * Shortens the arguments of an assistant's tool calls, leaving its text
 * blocks and the calls' names and ids alone: the model must still be able to
 * see what it asked for, only not the whole of what it passed.
 */
function shortenPayloads(
	message: HarnessMessage,
	allowance: number,
): Shortened {
	const blocks = message.content;
	const cost = approximateTokens([message]);
	if (!Array.isArray(blocks)) return { message, tokens: cost, shortened: false };

	const others = cost - payloadCost(blocks);
	// What the payloads may take together, shared evenly among them so one
	// enormous call cannot starve the rest.
	const calls = blocks.filter(isToolCall).length;
	if (calls === 0) return { message, tokens: cost, shortened: false };
	const each = Math.max(
		Math.floor((allowance - others) / calls),
		SHORTEST_TOKENS,
	);

	let shortened = false;
	const kept = blocks.map((block) => {
		if (!isToolCall(block)) return block;
		const call = block;
		const passed = JSON.stringify(call.arguments ?? null);
		if (Math.ceil(passed.length / 4) <= each) return block;
		// Never below a readable head and tail, even where the share is
		// smaller than that: the alternative is carrying the payload whole.
		const room = Math.max(each * 4, atLeast());
		const elided = elide(passed, room, { floor: SHORTEST_HALF_CHARACTERS });
		if (elided === undefined || passed.length <= room) return block;
		shortened = true;
		return { ...call, arguments: elided };
	});

	if (!shortened) return { message, tokens: cost, shortened: false };
	const result: HarnessMessage = { ...message, content: kept, cmShortened: true };
	return { message: result, tokens: approximateTokens([result]), shortened: true };
}

function payloadCost(blocks: ContentBlock[]): number {
	let characters = 0;
	for (const block of blocks) {
		if (!isToolCall(block)) continue;
		characters += JSON.stringify(block.arguments ?? null).length;
	}
	return Math.ceil(characters / 4);
}

/**
 * Shortens a Turn's messages until they fit an allowance, oldest payload
 * first: the newest result is the one the Turn is still acting on.
 *
 * Every message carrying a payload is a candidate — tool results and the
 * arguments of assistant tool calls — because on a real working Turn the
 * write calls are most of the bytes. `shorten` decides what within a
 * message may go; this decides the order they are asked.
 */
export function elideTurn(
	messages: HarnessMessage[],
	allowance: number,
): ShortenedMessages {
	const kept = [...messages];
	let tokens = approximateTokens(kept);
	let shortened = false;
	if (tokens <= allowance) return { messages: kept, tokens, shortened };

	const shortenable = kept
		.map((message, index) => ({ message, index }))
		.filter(
			({ message }) =>
				message.role === "toolResult" || message.role === "assistant",
		);

	for (const { index } of shortenable) {
		const message = kept[index];
		if (message === undefined) continue;
		const excess = tokens - allowance;
		const cost = approximateTokens([message]);
		// Give this message what it needs to carry the whole Turn under the
		// allowance, never less than a readable head and tail.
		const target = Math.max(cost - excess, SHORTEST_TOKENS);
		const result = elideMessage(message, target);
		if (!result.shortened) continue;
		kept[index] = result.message;
		tokens = tokens - cost + result.tokens;
		shortened = true;
		if (tokens <= allowance) break;
	}

	return { messages: kept, tokens, shortened };
}

/** One line's payload, head and tail, within the characters it may spend. */
export function elideLine(text: string, allowed: number): string {
	if (text.length <= allowed) return text;
	// No room for a head and a tail worth reading: the line says only that
	// it had output and how much of it went.
	return (
		elide(text, allowed, { floor: SHORTEST_HALF_CHARACTERS / 2 }) ??
		elidedWhole(text)
	);
}
