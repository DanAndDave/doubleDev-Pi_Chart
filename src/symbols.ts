import type { CodeGraph, GraphEdge, GraphSymbol } from "./graph.ts";
import {
	isToolCall,
	messageText,
	toolCallText,
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
	/**
	 * A file's name without directories or extension, to its files. Test and
	 * script files are left out: a bare word is a plain word, and plain words
	 * do not reach them.
	 */
	byStem: Map<string, string[]>;
	/** Ids of the symbols defined in a test or script file; see `isHeldBack`. */
	heldBack: Set<string>;
	/** Symbol id to every edge touching it, either direction. */
	incident: Map<string, GraphEdge[]>;
}

export function prepare(graph: CodeGraph, extractedAt: number): PreparedGraph {
	const byName = new Map<string, GraphSymbol[]>();
	const byFile = new Map<string, GraphSymbol[]>();
	const byStem = new Map<string, string[]>();
	const heldBack = new Set<string>();
	for (const symbol of graph.symbols) {
		const key = canonical(symbol.label);
		if (key.length > 0) append(byName, key, symbol);
		const file = normalisePath(symbol.file);
		if (file === "") continue;
		const held = isHeldBack(file);
		const known = byFile.get(file);
		if (known) known.push(symbol);
		else {
			byFile.set(file, [symbol]);
			const stem = canonical(stemOf(file));
			if (stem.length > 0 && !held) append(byStem, stem, file);
		}
		if (held) heldBack.add(symbol.id);
	}

	const incident = new Map<string, GraphEdge[]>();
	for (const edge of graph.edges) {
		append(incident, edge.from.id, edge);
		append(incident, edge.to.id, edge);
	}

	return {
		symbols: graph.symbols,
		edges: graph.edges,
		extractedAt,
		byName,
		byFile,
		byStem,
		heldBack,
		incident,
	};
}

/** In place: copying the list per entry made indexing quadratic in a symbol's edges. */
function append<T>(map: Map<string, T[]>, key: string, value: T): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/** Forward slashes, no leading `./` or `/`: one spelling per file. */
function normalisePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

const HELD_BACK_DIRECTORY = new Set(["test", "tests", "__tests__", "scripts"]);
const HELD_BACK_NAME = /\.(?:test|spec)\.|_test\.|^test_/;

/**
 * Whether a file is a test or a script, which plain words do not reach.
 *
 * Tests and scripts reuse the ordinary words of a Codebase's domain for
 * helpers and fixtures. Measured on this repository's benchmark, plain words
 * on a Turn's first Call carried `conversation()` and `CONVERSATION` from
 * `test/`, and of 90 slots spent in `test/` or `scripts/`, none was what the
 * Turn worked with. Decided on the path alone, so the rule holds for any
 * Codebase rather than for this one's names.
 */
function isHeldBack(file: string): boolean {
	const segments = file.split("/");
	const name = segments.pop() ?? "";
	return (
		segments.some((segment) => HELD_BACK_DIRECTORY.has(segment)) ||
		HELD_BACK_NAME.test(name)
	);
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
 * before any of them. Order is the whole contract — a Budget takes symbols
 * from the front — and the prompt, being what was asked about, leads:
 *
 * 1. what the prompt writes as code;
 * 2. the files whose path the prompt names;
 * 3. what the rest of the Turn writes as code, or, when nothing in the Turn
 *    is written as code, every plain word, the prompt's first;
 * 4. every other file: paths the rest of the Turn names, and bare words
 *    equal to a file's stem, which are plain words and so the weakest.
 */
export function symbolsInPlay(graph: PreparedGraph, turn: Turn): GraphSymbol[] {
	const whole = `${turn.prompt}\n${widerText(turn)}`;
	// One pass over the whole text, so whether anything is written as code
	// is judged over the Turn rather than the prompt alone; the prompt is
	// scanned again only to order the result.
	const all = mentioned(graph, whole);
	const prompt = mentioned(graph, turn.prompt);

	const tiers = [
		all.symbols.filter((symbol) => prompt.code.has(symbol.id)),
		throughFiles(graph, pathsNamed(graph, turn.prompt)),
		all.symbols,
		throughFiles(graph, [
			...new Set([...pathsNamed(graph, whole), ...stemsNamed(graph, whole)]),
		]),
	];
	const found = new Map<string, GraphSymbol>();
	for (const symbol of tiers.flat()) {
		if (!found.has(symbol.id)) found.set(symbol.id, symbol);
	}
	return [...found.values()];
}

/**
 * The Turn's text beyond its prompt, bounded by message and by recency.
 *
 * A tool call contributes what it passed, not the name it was made with:
 * `read(` reads as a call written as code, and measured live every Call of a
 * Turn that used the `read` tool carried `.read()`. A tool's name says what
 * the agent did, not what the Turn is about; its arguments and its result
 * still name the code it touched.
 */
function widerText(turn: Turn): string {
	const recent = turn.messages.slice(-RECENT_MESSAGES);
	const parts: string[] = [];
	for (const message of recent) {
		parts.push(messageText(message).slice(0, MESSAGE_HEAD));
		const content = message.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (isToolCall(block)) parts.push(toolCallText(block).passed.slice(0, MESSAGE_HEAD));
		}
	}
	return parts.filter((each) => each.length > 0).join("\n");
}

/** The symbols a piece of text names, and which of them it wrote as code. */
interface Mentioned {
	symbols: GraphSymbol[];
	code: Set<string>;
}

/** What one identifier matched, and how it was written. */
interface Mention {
	code: boolean;
	symbols: GraphSymbol[];
}

function mentioned(graph: PreparedGraph, text: string): Mentioned {
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

	// A plain word counts only when nothing in the text is written as code.
	// Prose is full of words that happen to name symbols: measured live,
	// "read" carried `.read()`, "explain" `explain()`, "summarise"
	// `summarise()`, "conversation" `conversation()` and "report" `report()`,
	// each spending a slot beside the symbol the text wrote as code. A text
	// written entirely in prose still finds what its words name — but a word
	// matching only a method gives way to one matching a function or a type:
	// the first Call of a Turn has seen no code yet, and measured on the
	// benchmark, "Read src/elision.ts" spent a slot on `.read()` that way.
	// Nor does a plain word reach a test or script file (`isHeldBack`) —
	// decided after choosing which words count, so a word naming a test
	// helper still sets aside a method word rather than handing it the slot.
	const all = [...mentions.values()];
	const code = all.filter((mention) => mention.code);
	const unambiguous = all.filter((mention) =>
		mention.symbols.some((each) => !each.label.startsWith(".")),
	);
	const considered = (
		code.length > 0 ? code : unambiguous.length > 0 ? unambiguous : all
	).map((mention) =>
		mention.code
			? mention
			: {
					...mention,
					symbols: mention.symbols.filter((each) => !graph.heldBack.has(each.id)),
				},
	);

	// One symbol per identifier per round: a word that happens to name
	// three methods must not spend a Budget ahead of the next identifier.
	const found = new Map<string, GraphSymbol>();
	for (const symbol of takenInTurn(considered.map((mention) => mention.symbols))) {
		if (!found.has(symbol.id)) found.set(symbol.id, symbol);
	}

	// What is considered is either all written as code or all plain words.
	return {
		symbols: [...found.values()],
		code: new Set(code.length > 0 ? found.keys() : []),
	};
}

/** One from each list per round, so no list spends a Budget before the rest. */
function takenInTurn<T>(lists: T[][]): T[] {
	const result: T[] = [];
	for (let round = 0; ; round++) {
		let added = false;
		for (const list of lists) {
			if (round >= list.length) continue;
			result.push(list[round] as T);
			added = true;
		}
		if (!added) return result;
	}
}

/**
 * The files a text names by path, in the order it first names them.
 *
 * Through the file the graph itself states, not through a suffix rule on
 * the name: that is how `assembler` reaches `assemble` without `canonical`
 * learning morphology, and why a path matching no file yields nothing
 * rather than a partial-token guess. A path reaches a test or script file
 * like any other.
 */
function pathsNamed(graph: PreparedGraph, text: string): string[] {
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
	return [...files];
}

/**
 * The files a text names by a bare word equal to a file's stem: `assembler`
 * for `src/assembler.ts`. A bare word is a plain word, so it never reaches a
 * test or script file (`isHeldBack`).
 */
function stemsNamed(graph: PreparedGraph, text: string): string[] {
	const files = new Set<string>();
	for (const [, , identifier = ""] of text.matchAll(IDENTIFIER)) {
		for (const file of graph.byStem.get(canonical(identifier)) ?? []) {
			files.add(file);
		}
	}
	return [...files];
}

/**
 * The symbols of some files: within a file, the most-connected first, a tie
 * going to the earlier line; across files, one from each per round, so a
 * prompt naming two files carries both under a Budget of three.
 *
 * Connections, because extraction order is not importance: what most of the
 * codebase touches says most about what a file is for. The file's own node
 * takes part like any other — its connections are what it imports and what
 * imports it.
 */
function throughFiles(graph: PreparedGraph, files: string[]): GraphSymbol[] {
	return takenInTurn(
		files.map((file) =>
			(graph.byFile.get(file) ?? [])
				.map((symbol) => ({
					symbol,
					degree: graph.incident.get(symbol.id)?.length ?? 0,
					line: lineOf(symbol),
				}))
				// Stable, so a full tie keeps extraction order.
				.sort((a, b) => b.degree - a.degree || a.line - b.line)
				.map((each) => each.symbol),
		),
	);
}

/** A symbol's line, `L92` → 92; one with no position sorts after the rest. */
function lineOf(symbol: GraphSymbol): number {
	const digits = symbol.position?.match(/\d+/);
	return digits ? Number(digits[0]) : Number.MAX_SAFE_INTEGER;
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
