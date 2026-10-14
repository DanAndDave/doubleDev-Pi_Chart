import type { CodeGraph, GraphEdge, GraphSymbol } from "./graph.ts";
import { approximateTokens } from "./tokens.ts";

/**
 * A graph with the indexes `findSymbol` and `neighbourhoods` need, built
 * once where the parse is cached rather than per question.
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
	/** Ids of the symbols defined in a test or script file; see `isHeldBack`. */
	heldBack: Set<string>;
	/** Symbol id to every edge touching it, either direction. */
	incident: Map<string, GraphEdge[]>;
}

export function prepare(graph: CodeGraph, extractedAt: number): PreparedGraph {
	const byName = new Map<string, GraphSymbol[]>();
	const heldBack = new Set<string>();
	for (const symbol of graph.symbols) {
		const key = canonical(symbol.label);
		if (key.length > 0) append(byName, key, symbol);
		const file = normalisePath(symbol.file);
		if (file !== "" && isHeldBack(file)) heldBack.add(symbol.id);
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
 * Whether a file is a test or a script, which a name carried by source as
 * well never resolves to; see `findSymbol`. Decided on the path alone, so
 * the rule holds for any Codebase rather than for this one's names.
 */
function isHeldBack(file: string): boolean {
	const segments = file.split("/");
	const name = segments.pop() ?? "";
	return (
		segments.some((segment) => HELD_BACK_DIRECTORY.has(segment)) ||
		HELD_BACK_NAME.test(name)
	);
}

/** A symbol with the connections around it. */
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

/** Letters and digits only, so `.recordPack()` and `record_pack` are one name. */
function canonical(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, "");
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

/**
 * The one symbol a name means, or the graph's names nearest to it.
 *
 * A structural question has one correct answer, so the name is matched
 * exactly, up to capitalisation and punctuation: `Store.read()` and
 * `store.read` name the same member. Where a name is carried by several
 * symbols, source is preferred over tests and scripts, a function over a
 * method, and then the most connected, so the same name always resolves to
 * the same symbol.
 */
export function findSymbol(
	graph: PreparedGraph,
	name: string,
): { node: GraphSymbol } | { nearest: string[] } {
	const written = name.trim().replace(/\(\)$/, "").trim();
	const dot = written.lastIndexOf(".");
	if (dot > 0 && dot < written.length - 1) {
		const member = canonical(written.slice(dot + 1));
		const members = (graph.byName.get(canonical(written.slice(0, dot))) ?? []).flatMap(
			(owner) =>
				(graph.incident.get(owner.id) ?? [])
					.filter(
						(edge) =>
							edge.from.id === owner.id &&
							MEMBERSHIP.has(edge.relation) &&
							canonical(edge.to.label) === member,
					)
					.map((edge) => edge.to),
		);
		const chosen = preferred(graph, members);
		if (chosen) return { node: chosen };
	}
	const key = canonical(written);
	const chosen = preferred(graph, graph.byName.get(key) ?? []);
	if (chosen) return { node: chosen };
	return { nearest: nearestNames(graph, key) };
}

function preferred(graph: PreparedGraph, candidates: GraphSymbol[]): GraphSymbol | undefined {
	const rank = (symbol: GraphSymbol) => [
		graph.heldBack.has(symbol.id) ? 1 : 0,
		symbol.label.startsWith(".") ? 1 : 0,
		-(graph.incident.get(symbol.id)?.length ?? 0),
	];
	return [...candidates].sort((left, right) => {
		const a = rank(left);
		const b = rank(right);
		for (let index = 0; index < a.length; index++) {
			if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
		}
		return qualify(left).localeCompare(qualify(right));
	})[0];
}

/** How many names an unknown name is offered in its place. */
const NEAREST = 5;

/**
 * The names nearest to one the graph does not know: those it begins, or
 * that begin it, first; then those containing it; then those a few edits
 * away. Anything further is not close, and is not offered.
 */
function nearestNames(graph: PreparedGraph, key: string): string[] {
	if (key.length === 0) return [];
	const scored: { name: string; tier: number; distance: number }[] = [];
	for (const [candidate, symbols] of graph.byName) {
		const distance = editDistance(key, candidate);
		const tier =
			candidate.startsWith(key) || key.startsWith(candidate)
				? 0
				: candidate.includes(key)
					? 1
					: distance <= Math.max(2, Math.floor(key.length / 3))
						? 2
						: undefined;
		if (tier === undefined) continue;
		for (const symbol of symbols) scored.push({ name: qualify(symbol), tier, distance });
	}
	return scored
		.sort(
			(left, right) =>
				left.tier - right.tier ||
				left.distance - right.distance ||
				left.name.localeCompare(right.name),
		)
		.slice(0, NEAREST)
		.map((each) => each.name);
}

function editDistance(left: string, right: string): number {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let row = 1; row <= left.length; row++) {
		const current = [row];
		for (let column = 1; column <= right.length; column++) {
			current[column] = Math.min(
				(previous[column] ?? 0) + 1,
				(current[column - 1] ?? 0) + 1,
				(previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1),
			);
		}
		previous = current;
	}
	return previous[right.length] ?? 0;
}

/** How far a structure question may reach: past three hops is the Codebase. */
const MAX_DEPTH = 3;

/**
 * The whole `codebase_structure` result for a name: the connections out to
 * `depth` hops, each once, in the form a pack carried them, cut at a whole
 * line to `maxTokens` with a marker saying how much went.
 *
 * Each hop is `neighbourhoods` over the symbols the previous hop reached, so
 * every symbol keeps its most informative connections and says how many it
 * left out, and depth 1 is exactly the one-hop neighbourhood.
 *
 * `older` is asked once, with the file of every symbol whose neighbourhood
 * the result holds, for those changed since the extraction. Each
 * neighbourhood carries its own age: the root's in the header, a later
 * hop's on each line it contributes, so one edited file never marks
 * structure that is still current.
 */
export async function codebaseStructure(
	graph: PreparedGraph,
	name: string,
	options: {
		depth?: number;
		maxTokens: number;
		older: (files: string[]) => Promise<ReadonlySet<string>>;
	},
): Promise<string> {
	const found = findSymbol(graph, name);
	if ("nearest" in found) {
		return found.nearest.length === 0
			? `No symbol named "${name.trim()}" in the codebase graph, and no name in the graph is close.`
			: `No symbol named "${name.trim()}" in the codebase graph. Nearest names:\n` +
					found.nearest.map((each) => `- ${each}`).join("\n");
	}

	const root = found.node;
	const depth = Math.min(Math.max(Math.floor(options.depth ?? 1), 1), MAX_DEPTH);
	const walked: Neighbourhood[] = [];
	const reached = new Set([root.id]);
	let frontier = [root];
	for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
		const next: GraphSymbol[] = [];
		for (const around of neighbourhoods(graph, frontier)) {
			walked.push(around);
			for (const edge of around.edges) {
				const other = edge.from.id === around.symbol.id ? edge.to : edge.from;
				if (!reached.has(other.id)) {
					reached.add(other.id);
					next.push(other);
				}
			}
		}
		frontier = next;
	}

	// Not the Concept's "(stale)": this is measured against the file, not
	// declared by an author, and one word for both would blur provenance.
	const caveat = " (older than the codebase)";
	const older = await options.older([root.file, ...walked.map((around) => around.symbol.file)]);
	const lines: string[] = [];
	const listed = new Set<GraphEdge>();
	for (const around of walked) {
		const own = around.symbol !== root && older.has(around.symbol.file) ? caveat : "";
		for (const edge of around.edges) {
			if (listed.has(edge)) continue;
			listed.add(edge);
			lines.push(`${describeEdge(edge)}${own}`);
		}
		// Saying how many were left out matters: silence would read as
		// "this symbol connects to twelve things", which for a hub is false.
		if (around.dropped > 0) {
			lines.push(
				around.symbol === root
					? `… and ${around.dropped} more connections`
					: `… and ${around.dropped} more connections of ${qualify(around.symbol)}`,
			);
		}
	}

	const header = `[codebase structure: ${qualify(root)}${older.has(root.file) ? caveat : ""}]`;
	const cost = (text: string) => approximateTokens([{ role: "user", content: text }]);
	const whole = [header, ...lines].join("\n");
	if (cost(whole) <= options.maxTokens) return whole;

	const marker = (left: number) =>
		`… [pi-chart elided ${left} more line${left === 1 ? "" : "s"} of this structure]`;
	let kept = lines.length - 1;
	while (
		kept > 0 &&
		cost([header, ...lines.slice(0, kept), marker(lines.length - kept)].join("\n")) >
			options.maxTokens
	) {
		kept--;
	}
	return [header, ...lines.slice(0, kept), marker(lines.length - kept)].join("\n");
}
