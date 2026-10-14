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
	`\n… [pi-chart elided ~${tokens} tokens from the middle of this` +
	`${alsoDropped > 0 ? " content, and its tool metadata" : " content"}]\n`;

/**
 * The marker for a payload with no room for a head and a tail at all: the
 * gap is the whole of it. Still marked, because content that was there and
 * is not must never read as content that never existed. Says nothing about
 * what the payload was — a recollection shortens the agent's own prose this
 * way as well as a tool's output.
 */
const ELIDED_WHOLE = (tokens: number) =>
	`… [pi-chart elided ~${tokens} tokens here]`;

/**
 * The marker for content carried whole that lost only what travelled
 * beside it: a tool result whose text fitted and whose `details` did not.
 * Says so rather than reusing the elision marker, which would claim a
 * middle went that is still there.
 */
const METADATA_ONLY = (tokens: number) =>
	`\n… [pi-chart dropped ~${tokens} tokens of tool metadata; this content is whole]\n`;

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
 * The arithmetic lives here because it is the marker's: how much room a
 * head and a tail have left depends on how long the marker is, and what
 * the middle cost is what the marker reports.
 */
export function elide(
	text: string,
	characters: number,
	{ alsoDropped = 0, floor = 1 }: Elision = {},
): string | undefined {
	const half = Math.floor((characters - ELISION(0, alsoDropped).length) / 2);
	if (half < floor) return undefined;
	// A head and a tail that between them cover the text would carry its
	// middle twice, and a shortened message longer than the one it replaced
	// is not a shortened message. Nothing of the text goes, so the marker
	// names only what went beside it.
	if (half * 2 >= text.length) {
		return alsoDropped > 0 ? `${text}${METADATA_ONLY(alsoDropped)}` : text;
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
			content: asCarried(message.content, content),
			piChartShortened: true,
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
 * The shortened text, in the shape the message carried it.
 *
 * A message's `content` is protocol: the harness hands a tool result to a
 * provider as the blocks it arrived in, and a bare string where blocks
 * were is a request the provider refuses — a Turn that fails rather than
 * a Turn that carries less. Blocks in, one text block out; a string in, a
 * string out.
 */
function asCarried(original: unknown, text: string): string | ContentBlock[] {
	return Array.isArray(original) ? [{ type: "text", text }] : text;
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

	// Everything but the payloads, as the shortened message will carry it:
	// the flag it gains is sent too.
	const others =
		approximateTokens([{ ...message, piChartShortened: true }]) - payloadCost(blocks);
	// What the payloads may take together, shared evenly among them so one
	// enormous call cannot starve the rest.
	const calls = blocks.filter(isToolCall).length;
	if (calls === 0) return { message, tokens: cost, shortened: false };
	let each = Math.max(
		Math.floor((allowance - others) / calls),
		SHORTEST_TOKENS,
	);

	// Sized by construction, then checked, as `shortenText` is: escaping
	// the marker and rounding each estimate leave the message a few tokens
	// off what it was sized for, and the share narrows until it fits.
	while (true) {
		const kept = shortenCalls(blocks, each);
		if (kept === undefined) return { message, tokens: cost, shortened: false };
		const result: HarnessMessage = { ...message, content: kept, piChartShortened: true };
		const tokens = approximateTokens([result]);
		if (tokens <= allowance || each <= SHORTEST_TOKENS) {
			return { message: result, tokens, shortened: true };
		}
		each = Math.max(each - Math.ceil((tokens - allowance) / calls), SHORTEST_TOKENS);
	}
}

/** The blocks with every call's arguments elided to `each` tokens, or nothing where none were. */
function shortenCalls(blocks: ContentBlock[], each: number): ContentBlock[] | undefined {
	let shortened = false;
	const kept = blocks.map((block) => {
		if (!isToolCall(block)) return block;
		const call = block;
		const passed = JSON.stringify(call.arguments ?? null);
		if (Math.ceil(passed.length / 4) <= each) return block;
		// Never below a readable head and tail, even where the share is
		// smaller than that: the alternative is carrying the payload whole.
		const room = Math.max(each * 4, atLeast());
		// A payload no longer than the room would come back longer for
		// having been elided, marker and all.
		if (passed.length <= room) return block;
		const elided = elideArguments(call.arguments, room);
		if (elided === undefined) return block;
		shortened = true;
		return { ...call, arguments: elided };
	});
	return shortened ? kept : undefined;
}

/**
 * What a call passed, shortened to the characters it may spend, still an
 * object.
 *
 * Its shape is protocol: a provider is handed the arguments as the object
 * the model produced, so a string in their place is a request the provider
 * refuses outright — which is a Turn that fails rather than a Turn that
 * carries less. The bulk of an oversized call is one or two long strings
 * in it, so those give way, longest first, and everything else — the path,
 * the flags, the ids the model is reasoning about — is untouched.
 */
function elideArguments(passed: unknown, room: number): unknown {
	if (typeof passed !== "object" || passed === null || Array.isArray(passed)) {
		return undefined;
	}
	const shortened: Record<string, unknown> = { ...(passed as Record<string, unknown>) };
	const strings = Object.entries(shortened)
		.filter(([, value]) => typeof value === "string")
		.sort((a, b) => (b[1] as string).length - (a[1] as string).length);
	if (strings.length === 0) return undefined;

	let elided = false;
	for (const [key] of strings) {
		if (JSON.stringify(shortened).length <= room) break;
		const value = shortened[key];
		if (typeof value !== "string") continue;
		// What this one may spend: the room, less what the rest of the
		// object costs around it.
		const rest = JSON.stringify({ ...shortened, [key]: "" }).length;
		const allowance = room - rest;
		const cut = elide(value, allowance, { floor: SHORTEST_HALF_CHARACTERS });
		if (cut === undefined || cut.length >= value.length) continue;
		shortened[key] = cut;
		elided = true;
	}
	return elided ? shortened : undefined;
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

/** A Turn after shrinking: shortened, and short by `droppedMessages` messages. */
export interface ShrunkMessages extends ShortenedMessages {
	droppedMessages: number;
}

/**
 * The newest tail Turn brought within an allowance by dropping its oldest
 * tool-call groups whole, after eliding its payloads (ADR-0012).
 *
 * A Turn is its head — the prompt — then its groups, then its final reply.
 * A group is an assistant message and the results answering its calls,
 * matched by id, so dropping one can never strand a call or a result. The
 * fewest oldest groups that let the Turn fit are dropped, found by binary
 * search with every probe measured rather than predicted, and the head
 * carries a marker naming what went. Below the smallest form the final
 * reply is elided, then the head, and the marker survives both.
 *
 * Never for the current Turn: every message of that one is carried.
 */
export function shrinkTurn(
	messages: HarnessMessage[],
	allowance: number,
): ShrunkMessages {
	const elided = elideTurn(messages, allowance);
	if (elided.tokens <= allowance) return { ...elided, droppedMessages: 0 };

	const shape = shapeOf(messages);
	const probe = (dropping: number) =>
		elideTurn(formOf(messages, shape, dropping), allowance);

	const all = shape.groups.length;
	let smallest = probe(all);
	if (smallest.tokens <= allowance) {
		// Fit only grows with the groups dropped, so the fewest that fit is
		// found by halving between one that does not and one that does.
		let low = 0;
		let high = all;
		let found = smallest;
		while (high - low > 1) {
			const middle = Math.floor((low + high) / 2);
			const result = probe(middle);
			if (result.tokens <= allowance) {
				high = middle;
				found = result;
			} else {
				low = middle;
			}
		}
		return { ...found, droppedMessages: droppedBy(shape, high).length };
	}

	const dropped = droppedOf(messages, shape, all);
	smallest = belowSmallest(smallest, messages[0], shape, droppedMarker(dropped), allowance);
	return { ...smallest, droppedMessages: dropped.length };
}

/** Where a Turn's groups and final reply sit, by message index. */
interface TurnShape {
	/** Oldest first; each a set of message indices dropped together. */
	groups: number[][];
	reply?: number;
}

function shapeOf(messages: HarnessMessage[]): TurnShape {
	const last = messages.length - 1;
	const ending = messages[last];
	const reply =
		last > 0 && ending !== undefined && ending.role === "assistant" && callsOf(ending).length === 0
			? last
			: undefined;

	// Whatever answers a call belongs with the call; the head's own calls
	// keep their results with the head, which is never dropped.
	const head = [0];
	const groups: number[][] = [];
	const owner = new Map<string, number[]>();
	for (const call of callsOf(messages[0])) owner.set(call.id, head);

	const end = reply ?? messages.length;
	for (let index = 1; index < end; index++) {
		const message = messages[index];
		if (message === undefined) continue;
		const answering =
			message.role === "toolResult" && typeof message.toolCallId === "string"
				? owner.get(message.toolCallId)
				: undefined;
		if (answering !== undefined) {
			answering.push(index);
			continue;
		}
		const group = [index];
		groups.push(group);
		for (const call of callsOf(message)) owner.set(call.id, group);
	}
	return { groups, reply };
}

function callsOf(message: HarnessMessage | undefined) {
	const content = message?.content;
	return Array.isArray(content) ? content.filter(isToolCall) : [];
}

/** The message indices the oldest `count` groups hold, in Turn order. */
function droppedBy(shape: TurnShape, count: number): number[] {
	return shape.groups
		.slice(0, count)
		.flat()
		.sort((a, b) => a - b);
}

/** The messages the oldest `count` groups hold, in Turn order. */
function droppedOf(
	messages: HarnessMessage[],
	shape: TurnShape,
	count: number,
): HarnessMessage[] {
	const dropped = new Set(droppedBy(shape, count));
	return messages.filter((_, index) => dropped.has(index));
}

/** The Turn with its oldest `count` groups dropped and the head marked. */
function formOf(
	messages: HarnessMessage[],
	shape: TurnShape,
	count: number,
): HarnessMessage[] {
	if (count === 0) return messages;
	const dropped = new Set(droppedBy(shape, count));
	const marker = droppedMarker(droppedOf(messages, shape, count));
	return messages.flatMap((message, index) => {
		if (dropped.has(index)) return [];
		return index === 0 ? [withMarker(message, marker)] : [message];
	});
}

/**
 * Names what a shrunk Turn did not carry: how many messages, which tools
 * they ran in the order first used, and roughly what they cost. Its length
 * grows with the tools named, not the calls made.
 */
function droppedMarker(dropped: HarnessMessage[]): string {
	const tools = new Map<string, number>();
	for (const message of dropped) {
		for (const call of callsOf(message)) {
			const name = typeof call.name === "string" && call.name !== "" ? call.name : "unknown";
			tools.set(name, (tools.get(name) ?? 0) + 1);
		}
	}
	const count = dropped.length;
	const ran =
		tools.size === 0
			? ""
			: `: ${[...tools].map(([name, calls]) => `${name} ×${calls}`).join(", ")}`;
	return (
		`[pi-chart did not carry ${count} earlier message${count === 1 ? "" : "s"} ` +
		`of this Turn${ran}; ${tokenFigure(approximateTokens(dropped))} tokens]`
	);
}

/** Exact below a thousand; rounded thousands, marked as such, from there. */
function tokenFigure(tokens: number): string {
	return tokens < 1_000 ? String(tokens) : `~${Math.round(tokens / 1_000)}k`;
}

/**
 * The head with the marker after its text. A copy, keeping every other
 * field — `timestamp` included, so the message stays recognisably itself.
 */
function withMarker(message: HarnessMessage, marker: string): HarnessMessage {
	const content = message.content;
	if (!Array.isArray(content)) {
		const text = typeof content === "string" ? content : "";
		return { ...message, content: text === "" ? marker : `${text}\n\n${marker}` };
	}
	let last = -1;
	content.forEach((block, index) => {
		if (block.type === "text" && "text" in block && typeof block.text === "string") {
			last = index;
		}
	});
	if (last === -1) {
		return { ...message, content: [...content, { type: "text", text: marker }] };
	}
	return {
		...message,
		content: content.map((block, index) =>
			index === last && "text" in block
				? { ...block, text: `${block.text}\n\n${marker}` }
				: block,
		),
	};
}

/**
 * The smallest form still over the allowance: the final reply gives way
 * first, then the head, whose marker is put back after so it always
 * survives. What is left after both is irreducible and returned over.
 */
function belowSmallest(
	smallest: ShortenedMessages,
	head: HarnessMessage | undefined,
	shape: TurnShape,
	marker: string,
	allowance: number,
): ShortenedMessages {
	const kept = [...smallest.messages];
	let tokens = smallest.tokens;
	let shortened = smallest.shortened;

	const replyAt = shape.reply === undefined ? undefined : kept.length - 1;
	const reply = replyAt === undefined ? undefined : kept[replyAt];
	if (replyAt !== undefined && reply !== undefined) {
		const cost = approximateTokens([reply]);
		const result = shortenText(reply, Math.max(allowance - (tokens - cost), 0), cost);
		if (result.shortened) {
			kept[replyAt] = result.message;
			tokens = tokens - cost + result.tokens;
			shortened = true;
		}
	}
	if (tokens <= allowance) return { messages: kept, tokens, shortened };

	const marked = kept[0];
	if (head === undefined || marked === undefined) return { messages: kept, tokens, shortened };
	const markedCost = approximateTokens([marked]);
	const headCost = approximateTokens([head]);
	const markerCost = shape.groups.length > 0 ? markedCost - headCost : 0;
	const room = Math.max(allowance - (tokens - markedCost) - markerCost, 0);
	const result = shortenText(head, room, headCost);
	if (!result.shortened) return { messages: kept, tokens, shortened };
	const carried = shape.groups.length > 0 ? withMarker(result.message, marker) : result.message;
	kept[0] = carried;
	tokens = tokens - markedCost + approximateTokens([carried]);
	return { messages: kept, tokens, shortened: true };
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
