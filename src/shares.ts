/**
 * An equal share of the room each, with what a small claim does not use
 * released to the rest.
 *
 * Used wherever several pieces of one thing compete for room: the messages
 * of a Turn being embedded, and the tool results inside a recollection being
 * shortened. Equal-then-released rather than proportional, because
 * proportional shares give the largest piece the most room, which is exactly
 * the piece least worth carrying whole.
 *
 * Returns what each claim may spend, parallel to `sizes`. A claim that gets
 * nothing gets zero. Room is in characters at both call sites, but nothing
 * here depends on the unit.
 */
export function shares(sizes: number[], room: number): number[] {
	const allocation = new Array<number>(sizes.length).fill(0);
	let remaining = Math.max(room, 0);
	const open = sizes.map((_, index) => index);

	while (open.length > 0) {
		const share = Math.floor(remaining / open.length);
		if (share <= 0) break;
		// Everything at or under an equal share is settled at its own size,
		// and what it did not take is shared out again. When nothing is under
		// the share, every claim is larger than the room can meet and they
		// divide what is left evenly.
		const settled = open.filter((index) => (sizes[index] ?? 0) <= share);
		if (settled.length === 0) {
			for (const index of open) allocation[index] = share;
			break;
		}
		for (const index of settled) {
			const size = sizes[index] ?? 0;
			allocation[index] = size;
			remaining -= size;
		}
		for (const index of settled) open.splice(open.indexOf(index), 1);
	}

	return allocation;
}
