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
 * `details` is named separately when the shortening dropped it, because a
 * marker that counted only the text would understate what went: on a real
 * tool result the harness's `details` can rival the content it summarises.
 */
export const ELISION = (tokens: number, withoutDetails: boolean) =>
	`\n… [context-manager elided ~${tokens} tokens from the middle of this` +
	`${withoutDetails ? " result, and its tool metadata" : " result"}]\n`;

/**
 * The marker for a payload with no room for a head and a tail at all: the
 * gap is the whole of it. Still marked, because content that was there and
 * is not must never read as content that never existed.
 */
export const ELIDED_WHOLE = (tokens: number) =>
	`… [context-manager elided ~${tokens} tokens of output]`;

/** Head, marker, tail — the shape every shortened payload takes. */
export function elide(
	text: string,
	half: number,
	removed: number,
	withoutDetails: boolean,
): string {
	return (
		`${text.slice(0, half)}` +
		`${ELISION(removed, withoutDetails)}` +
		`${text.slice(-half)}`
	);
}
