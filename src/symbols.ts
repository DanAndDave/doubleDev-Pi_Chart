import type { CodeGraph, GraphEdge, GraphSymbol } from "./graph.ts";

/** A symbol in play, with the connections around it. */
export interface Neighbourhood {
	symbol: GraphSymbol;
	/** Direct connections, both directions. One hop: two is the Codebase. */
	edges: GraphEdge[];
	/** Connections left out because the symbol has more than one pack can hold. */
	dropped: number;
}

/**
 * How many connections one symbol may contribute.
 *
 * A symbol's degree is unbounded and wildly variable: measured on this
 * repository, `register()` has 30 incident edges and renders to about 630
 * tokens while `.start()` renders to 77. A Budget counted only in symbols
 * would admit anything from a hundred tokens to several thousand.
 */
const MAX_EDGES = 12;

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

	/** What one identifier in the prompt matched, and how it was written. */
	interface Mention {
		code: boolean;
		symbols: GraphSymbol[];
	}

	const mentions = new Map<string, Mention>();
	for (const match of prompt.matchAll(IDENTIFIER)) {
		const [, member, identifier = "", call] = match;

		const whole = byName.get(canonical(identifier));
		const symbols =
			whole ??
			(identifier.match(WORD_PART) ?? [])
				.filter((part) => part.length > 2)
				.flatMap((part) => byName.get(canonical(part)) ?? []);
		if (symbols.length === 0) continue;

		// Does the prompt itself say this is code? `parseConcept`,
		// `record_pack`, `.read` and `read()` do outright. A capital says
		// so only when it names something that is not a method — every
		// sentence starts with a capital, and `Describe` opening a question
		// is not a reference to `.describe()`.
		const code =
			COMPOUND.test(identifier) ||
			member !== "" ||
			call !== undefined ||
			(CAPITALISED.test(identifier) &&
				symbols.some((each) => !each.label.startsWith(".")));

		const key = canonical(identifier);
		const seen = mentions.get(key);
		mentions.set(key, { code: code || (seen?.code ?? false), symbols });
	}

	// A bare English word that matches only a *method* name is the one
	// ambiguous case: measured live, "do not read, grep, or list any files"
	// matched `.read()` and `.list()` and spent 457 tokens on them. A bare
	// word matching a function or a type is not ambiguous in the same way.
	const unambiguous = [...mentions.values()].filter(
		(mention) =>
			mention.code || mention.symbols.some((each) => !each.label.startsWith(".")),
	);
	const considered = unambiguous.length > 0 ? unambiguous : [...mentions.values()];

	// Written-as-code first, then one symbol per identifier per round: a
	// word that happens to name three methods must not spend a Budget
	// ahead of the symbol the prompt was actually about.
	const ordered = [
		...considered.filter((mention) => mention.code),
		...considered.filter((mention) => !mention.code),
	];
	const found = new Map<string, GraphSymbol>();
	for (let round = 0; ; round++) {
		let added = false;
		for (const mention of ordered) {
			const symbol = mention.symbols[round];
			if (!symbol) continue;
			found.set(symbol.id, symbol);
			added = true;
		}
		if (!added) break;
	}

	return [...found.values()];
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
		result.push({
			symbol,
			edges: balance(symbol, edges),
			dropped: Math.max(edges.length - MAX_EDGES, 0),
		});
	}
	return result;
}

/**
 * The connections to keep when a symbol has more than a pack can hold.
 *
 * Taken alternately from each direction rather than in the order the
 * extraction happens to list them: measured on this repository, plain
 * truncation left two of nineteen over-sized symbols with no callers at
 * all, and "what calls this" is the question the Store exists for.
 */
function balance(symbol: GraphSymbol, edges: GraphEdge[]): GraphEdge[] {
	if (edges.length <= MAX_EDGES) return edges;

	const inbound = edges.filter((edge) => edge.to.id === symbol.id);
	const outbound = edges.filter((edge) => edge.from.id === symbol.id);
	const kept: GraphEdge[] = [];
	for (let index = 0; kept.length < MAX_EDGES; index++) {
		const next = [inbound[index], outbound[index]].filter(
			(edge): edge is GraphEdge => edge !== undefined,
		);
		if (next.length === 0) break;
		kept.push(...next.slice(0, MAX_EDGES - kept.length));
	}
	return kept;
}

/** A symbol as the accounting names it: two `.recordPack()` are not one. */
export function qualify(symbol: GraphSymbol): string {
	return `${symbol.label} (${place(symbol)})`;
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
