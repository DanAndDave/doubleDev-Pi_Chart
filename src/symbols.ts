import type { CodeGraph, GraphEdge, GraphSymbol } from "./graph.ts";

/** A symbol in play, with the connections around it. */
export interface Neighbourhood {
	symbol: GraphSymbol;
	/** Direct connections, both directions. One hop: two is the Codebase. */
	edges: GraphEdge[];
}

/** An identifier, with whatever punctuation marks it as code around it. */
const IDENTIFIER = /(\.?)([A-Za-z_][A-Za-z0-9_]{2,})(\s*\()?/g;
const WORD_PART = /[A-Z]?[a-z0-9]+/g;
const COMPOUND = /[a-z][A-Z]|_/;
const CAPITALISED = /^[A-Z]/;

/** Letters and digits only, so `.recordPack()` and `record_pack` are one name. */
function canonical(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The symbols a prompt refers to.
 *
 * By name, not by meaning: a symbol's name is exact, and a structural
 * question has one correct answer. An identifier that matches nothing is
 * split on case boundaries and its parts tried — but only then, so
 * `recordPack` does not drag in every `Pack`.
 */
export function symbolsInPlay(graph: CodeGraph, prompt: string): GraphSymbol[] {
	const byName = new Map<string, GraphSymbol[]>();
	for (const symbol of graph.symbols) {
		const key = canonical(symbol.label);
		if (key.length === 0) continue;
		byName.set(key, [...(byName.get(key) ?? []), symbol]);
	}

	const found = new Map<string, { symbol: GraphSymbol; written: number }>();
	const remember = (symbol: GraphSymbol, written: number) => {
		const seen = found.get(symbol.id);
		if (!seen || written > seen.written) found.set(symbol.id, { symbol, written });
	};

	for (const match of prompt.matchAll(IDENTIFIER)) {
		const [, member, identifier = "", call] = match;
		// How strongly the prompt says this word is code rather than
		// English. `parseConcept`, `record_pack`, `.read` and `read()` say
		// it outright; `Pack` suggests it; `read` in "do not read any
		// files" does not, even though some class has that method.
		const written =
			COMPOUND.test(identifier) || member !== "" || call !== undefined
				? 2
				: CAPITALISED.test(identifier)
					? 1
					: 0;

		const whole = byName.get(canonical(identifier));
		if (whole) {
			for (const symbol of whole) remember(symbol, written);
			continue;
		}
		for (const part of identifier.match(WORD_PART) ?? []) {
			if (part.length <= 2) continue;
			for (const symbol of byName.get(canonical(part)) ?? []) {
				remember(symbol, written);
			}
		}
	}

	// Only the strongest evidence in the prompt counts. When something is
	// unmistakably code, ordinary English words that happen to name methods
	// are noise — measured live, they spent 457 tokens on `.read()` and
	// `.list()` for a question about something else. When there is nothing
	// stronger, plain words are all there is to go on.
	const matches = [...found.values()];
	const strongest = Math.max(0, ...matches.map((each) => each.written));
	return matches
		.filter((each) => each.written === strongest)
		.map((each) => each.symbol);
}

/**
 * What a symbol connects to and what connects to it.
 *
 * A symbol with no connections yields nothing at all: an entry saying a
 * symbol exists and does nothing costs tokens and tells the agent less than
 * its absence does.
 */
export function neighbourhoods(
	graph: CodeGraph,
	symbols: GraphSymbol[],
): Neighbourhood[] {
	const wanted = new Set(symbols.map((symbol) => symbol.id));
	const around = new Map<string, GraphEdge[]>();
	for (const edge of graph.edges) {
		if (wanted.has(edge.from.id)) {
			around.set(edge.from.id, [...(around.get(edge.from.id) ?? []), edge]);
		}
		if (wanted.has(edge.to.id)) {
			around.set(edge.to.id, [...(around.get(edge.to.id) ?? []), edge]);
		}
	}

	const result: Neighbourhood[] = [];
	for (const symbol of symbols) {
		const edges = around.get(symbol.id);
		if (!edges || edges.length === 0) continue;
		result.push({ symbol, edges });
	}
	return result;
}

/** One connection, as the agent reads it: names, direction, and where. */
export function describeEdge(edge: GraphEdge): string {
	return (
		`${edge.from.label} (${place(edge.from)}) --${edge.relation}--> ` +
		`${edge.to.label} (${place(edge.to)})`
	);
}

function place(symbol: GraphSymbol): string {
	return symbol.position ? `${symbol.file}:${symbol.position}` : symbol.file;
}
