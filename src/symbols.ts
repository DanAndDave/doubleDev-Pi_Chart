import type { CodeGraph, GraphEdge, GraphSymbol } from "./graph.ts";
import {
	isToolCall,
	messageText,
	renderToolCall,
	type HarnessMessage,
	type Turn,
} from "./messages.ts";

/**
 * A graph with the indexes selection and neighbourhood construction need,
 * built once where the parse is cached rather than per Call.
 *
 * One artifact with one invalidation rule: a memo inside this module would
 * be a second cache over the same file with no shared trigger, so a stale
 * index could outlive the graph it describes.
 */
export interface PreparedGraph {
	symbols: GraphSymbol[];
	edges: GraphEdge[];
	/** When the extraction was written, epoch milliseconds. */
	extractedAt: number;
	/** Canonical name to the symbols carrying it. */
	byName: Map<string, GraphSymbol[]>;
	/** Source file to the symbols it defines. */
	byFile: Map<string, GraphSymbol[]>;
	/** A file's name without directories or extension, to its files. */
	byStem: Map<string, string[]>;
	/** Symbol id to every edge touching it, either direction. */
	incident: Map<string, GraphEdge[]>;
}

export function prepare(graph: CodeGraph, extractedAt: number): PreparedGraph {
	const byName = new Map<string, GraphSymbol[]>();
	const byFile = new Map<string, GraphSymbol[]>();
	const byStem = new Map<string, string[]>();
	for (const symbol of graph.symbols) {
		const key = canonical(symbol.label);
		if (key.length > 0) byName.set(key, [...(byName.get(key) ?? []), symbol]);
		const file = normalisePath(symbol.file);
		if (file === "") continue;
		const known = byFile.get(file);
		if (known) known.push(symbol);
		else {
			byFile.set(file, [symbol]);
			const stem = canonical(stemOf(file));
			if (stem.length > 0) byStem.set(stem, [...(byStem.get(stem) ?? []), file]);
		}
	}

	const incident = new Map<string, GraphEdge[]>();
	for (const edge of graph.edges) {
		for (const end of [edge.from.id, edge.to.id]) {
			incident.set(end, [...(incident.get(end) ?? []), edge]);
		}
	}

	return {
		symbols: graph.symbols,
		edges: graph.edges,
		extractedAt,
		byName,
		byFile,
		byStem,
		incident,
	};
}

/** Forward slashes, no leading `./` or `/`: one spelling per file. */
function normalisePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function stemOf(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.indexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

/** A symbol in play, with the connections around it. */
export interface Neighbourhood {
	symbol: GraphSymbol;
	/** Direct connections, both directions. One hop: two is the Codebase. */
	edges: GraphEdge[];
	/** Connections left out because the symbol has more than one pack can hold. */
	dropped: number;
	/**
	 * True where the symbol's file has changed since the extraction, or
	 * where its age could not be established at all. Absent means current,
	 * so the mark means something when it appears.
	 */
	stale?: true;
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
 * How much of each message is read for symbol names, and how many of a
 * Turn's messages are read at all.
 *
 * Measured over this machine's 423 real Turns: the median Turn offers 91
 * candidate characters and the widest 1,580,818 across 1,805 messages.
 * Scanning that Turn whole costs 89 ms on the Call's own path — more than
 * recall's entire measured budget — while its most recent 32 messages at
 * 1,000 characters each cost 1.1 ms and still name 95 symbols. A tool loop
 * works on what it just did, so recency is what bounds it.
 */
const MESSAGE_HEAD = 1_000;
const RECENT_MESSAGES = 32;

/** A path-shaped token: `src/assembler.ts`, `./src/assembler.ts`, `graph.ts`. */
const PATH_TOKEN = /[A-Za-z0-9_@.~-]*(?:\/[A-Za-z0-9_@.-]+)+|[A-Za-z0-9_-]+\.[A-Za-z]{1,5}\b/g;

/**
 * The symbols the current Turn is working with.
 *
 * By name, not by meaning: a symbol's name is exact, and a structural
 * question has one correct answer. An identifier that matches nothing is
 * split on case boundaries and its parts tried — but only then, so
 * `recordPack` does not drag in every `Pack`.
 *
 * The whole Turn, not its opening prompt: a Call made ten tool results into
 * an agentic Turn would otherwise derive structure from a sentence written
 * before any of them. What the prompt names still comes first, then what
 * the rest of the Turn names, then what is reached only through a file the
 * Turn is working with.
 */
export function symbolsInPlay(graph: PreparedGraph, turn: Turn): GraphSymbol[] {
	const wider = widerText(turn);
	// One pass over the whole text, so the rule that disregards an ordinary
	// word matching only a member's name weighs the Turn rather than the
	// prompt alone; the prompt is scanned again only to order the result.
	const all = mentioned(graph, `${turn.prompt}\n${wider}`);
	const named = new Set(mentioned(graph, turn.prompt).map((symbol) => symbol.id));

	const found = new Map<string, GraphSymbol>();
	for (const symbol of all.filter((each) => named.has(each.id))) {
		found.set(symbol.id, symbol);
	}
	for (const symbol of all) found.set(symbol.id, symbol);
	// Last: a file in play says what the Turn is looking at, not what it
	// asked about, so a symbol named outright outranks a file's others.
	for (const symbol of throughFiles(graph, `${turn.prompt}\n${wider}`)) {
		found.set(symbol.id, symbol);
	}
	return [...found.values()];
}

/** The Turn's text beyond its prompt, bounded by message and by recency. */
function widerText(turn: Turn): string {
	const recent = turn.messages.slice(-RECENT_MESSAGES);
	const parts: string[] = [];
	for (const message of recent) {
		if (message.toolName) parts.push(message.toolName);
		parts.push(messageText(message).slice(0, MESSAGE_HEAD));
		const content = message.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (isToolCall(block)) parts.push(renderToolCall(block).slice(0, MESSAGE_HEAD));
		}
	}
	return parts.filter((each) => each.length > 0).join("\n");
}

/** The symbols a piece of text names, strongest first. */
function mentioned(graph: PreparedGraph, text: string): GraphSymbol[] {
	/** What one identifier matched, and how it was written. */
	interface Mention {
		code: boolean;
		symbols: GraphSymbol[];
	}

	const mentions = new Map<string, Mention>();
	for (const match of text.matchAll(IDENTIFIER)) {
		const [, member, identifier = "", call] = match;

		const whole = graph.byName.get(canonical(identifier));
		const symbols =
			whole ??
			(identifier.match(WORD_PART) ?? [])
				.filter((part) => part.length > 2)
				.flatMap((part) => graph.byName.get(canonical(part)) ?? []);
		if (symbols.length === 0) continue;

		// Does the text itself say this is code? `parseConcept`,
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
	// ahead of the symbol the text was actually about.
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
 * The symbols of every file the text names.
 *
 * Through the file the graph itself states, not through a suffix rule on
 * the name: that is how `assembler` reaches `assemble` without `canonical`
 * learning morphology, and why a path matching no file yields nothing
 * rather than a partial-token guess.
 */
function throughFiles(graph: PreparedGraph, text: string): GraphSymbol[] {
	const files = new Set<string>();
	for (const [token] of text.matchAll(PATH_TOKEN)) {
		const path = normalisePath(token);
		if (path === "") continue;
		for (const file of graph.byFile.keys()) {
			// Either spelling: a repository-relative path is a suffix of an
			// absolute one, and the graph's own path may be the longer.
			if (endsWithPath(file, path) || endsWithPath(path, file)) files.add(file);
		}
	}
	// A bare word naming a file: `assembler` for `src/assembler.ts`.
	for (const [, , identifier = ""] of text.matchAll(IDENTIFIER)) {
		for (const file of graph.byStem.get(canonical(identifier)) ?? []) {
			files.add(file);
		}
	}

	return [...files].flatMap((file) => graph.byFile.get(file) ?? []);
}

/** Whether one path ends with another at a directory boundary. */
function endsWithPath(path: string, suffix: string): boolean {
	if (path === suffix) return true;
	return path.endsWith(`/${suffix}`);
}

/**
 * What a symbol connects to and what connects to it.
 *
 * A symbol with no connections yields nothing at all: an entry saying a
 * symbol exists and does nothing costs tokens and tells the agent less than
 * its absence does.
 */
export function neighbourhoods(
	graph: PreparedGraph,
	symbols: GraphSymbol[],
): Neighbourhood[] {
	const result: Neighbourhood[] = [];
	for (const symbol of symbols) {
		const edges = graph.incident.get(symbol.id);
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
 * Connections that say what a symbol holds or belongs to, as against the
 * ones that say how it is used or what it depends on.
 *
 * Named as the short list rather than the long one because it is the
 * complement of an allow-list already stated elsewhere: `PROGRAMMATIC`
 * (`src/graph.ts`) carries exactly fifteen relations, and everything
 * outside these three — `calls`, `imports`, `imports_from`, `re_exports`,
 * `dynamic_import`, `inherits`, `extends`, `implements`, `mixes_in`,
 * `embeds`, `depends_on`, `requires` — is a use or a dependency. A second
 * list of twelve would be the same rule written to fall out of step.
 *
 * "What calls this" is the question the Store exists for; a hub class with
 * twenty members would otherwise spend the whole cap restating its own
 * contents. Measured on this repository's own graph before the ranking: of
 * 57 over-sized symbols, 38 kept at least one membership connection, 188 of
 * 684 kept connections were membership, and 29 symbols had uses displaced
 * by them. After it: 28, 127, and 14.
 */
const MEMBERSHIP = new Set(["contains", "method", "references"]);

/**
 * The connections to keep when a symbol has more than a pack can hold.
 *
 * Ranked by what the connection says, then taken alternately from each
 * direction rather than in the order the extraction happens to list them:
 * measured on this repository, plain truncation left two of nineteen
 * over-sized symbols with no callers at all. Ranking is stable, so
 * truncating the same neighbourhood twice keeps the same connections in the
 * same order.
 */
function balance(symbol: GraphSymbol, edges: GraphEdge[]): GraphEdge[] {
	if (edges.length <= MAX_EDGES) return edges;

	const informative = (side: GraphEdge[]) => [
		...side.filter((edge) => !MEMBERSHIP.has(edge.relation)),
		...side.filter((edge) => MEMBERSHIP.has(edge.relation)),
	];
	const inbound = informative(edges.filter((edge) => edge.to.id === symbol.id));
	const outbound = informative(edges.filter((edge) => edge.from.id === symbol.id));
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
