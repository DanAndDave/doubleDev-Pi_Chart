/**
 * Reads graphify's extraction into programmatic connections.
 *
 * Deliberately strict: graphify ships rapidly and its schema is expected to
 * move, so the adapter states what it requires and says which field was
 * missing when it is not there. A moving schema should cost recall, never
 * correctness.
 */

/** A symbol the parser found, and where it is. */
export interface GraphSymbol {
	id: string;
	/** As written in the Codebase: `assemble()`, `.recordPack()`, `Pack`. */
	label: string;
	file: string;
	/** Where in the file, as graphify reports it — `L92`. Absent if unknown. */
	position?: string;
}

/** One programmatic connection between two symbols. */
export interface GraphEdge {
	from: GraphSymbol;
	to: GraphSymbol;
	relation: ProgrammaticRelation;
}

/** A Codebase's structure, as much of it as a parser established. */
export interface CodeGraph {
	symbols: GraphSymbol[];
	edges: GraphEdge[];
}

/**
 * Connections a parser can establish. Anything else graphify emits —
 * `semantically_similar_to`, `cites` — is documentation or inference, and is
 * left out rather than assumed harmless.
 */
const PROGRAMMATIC = new Set([
	"calls",
	"imports",
	"imports_from",
	"re_exports",
	"implements",
	"inherits",
	"mixes_in",
	"embeds",
	"depends_on",
	"method",
	"contains",
	"references",
]);

export type ProgrammaticRelation = string;

/** What graphify states about an edge it did not have to guess at. */
const EXTRACTED = "EXTRACTED";
/** The node kind that is actually code, as opposed to a doc or a reference. */
const CODE = "code";

export class GraphFormatError extends Error {}

/**
 * Parses a graphify `graph.json`.
 *
 * @throws GraphFormatError naming the first requirement the document fails.
 */
export function readGraph(source: string): CodeGraph {
	let document: unknown;
	try {
		document = JSON.parse(source);
	} catch (error) {
		throw new GraphFormatError(
			`graph is not JSON: ${error instanceof Error ? error.message : "unreadable"}`,
		);
	}

	if (!isRecord(document)) {
		throw new GraphFormatError("graph is not an object");
	}
	const root = document;

	const nodes = root.nodes;
	if (!Array.isArray(nodes)) {
		throw new GraphFormatError('graph has no "nodes" array');
	}
	// NetworkX node-link calls them links; the field has been renamed before.
	const links = root.links ?? root.edges;
	if (!Array.isArray(links)) {
		throw new GraphFormatError('graph has no "links" array');
	}

	const symbols = new Map<string, GraphSymbol>();
	const declared = new Set<string>();
	for (const [index, entry] of nodes.entries()) {
		if (!isRecord(entry)) {
			throw new GraphFormatError(`node ${index} is not an object`);
		}
		const id = entry.id;
		if (typeof id !== "string") {
			throw new GraphFormatError(`node ${index} has no string "id"`);
		}
		declared.add(id);
		// Documentation, external references and concepts are not code, and
		// their connections are not programmatic.
		if (entry.file_type !== CODE) continue;

		symbols.set(id, {
			id,
			label: typeof entry.label === "string" ? entry.label : id,
			file: typeof entry.source_file === "string" ? entry.source_file : "",
			position:
				typeof entry.source_location === "string"
					? entry.source_location
					: undefined,
		});
	}

	// A graph with nodes but no code in it is a schema that moved, not a
	// Codebase without code: silently returning nothing would turn a rename
	// of `file_type` into permanent, invisible zero recall.
	if (nodes.length > 0 && symbols.size === 0) {
		throw new GraphFormatError(
			`no node is marked "file_type": "${CODE}"; the schema has moved`,
		);
	}

	const edges: GraphEdge[] = [];
	for (const [index, entry] of links.entries()) {
		if (!isRecord(entry)) {
			throw new GraphFormatError(`link ${index} is not an object`);
		}
		const source = entry.source;
		const target = entry.target;
		if (typeof source !== "string" || typeof target !== "string") {
			throw new GraphFormatError(
				`link ${index} has no string "source" and "target"`,
			);
		}
		const relation = entry.relation;
		if (typeof relation !== "string") {
			throw new GraphFormatError(`link ${index} has no string "relation"`);
		}

		// A link to an id no node declares is a broken document, not a
		// filtered one, and must not look like the latter.
		if (!declared.has(source) || !declared.has(target)) {
			throw new GraphFormatError(
				`link ${index} names a node the graph does not declare`,
			);
		}

		// Three conditions, because each excludes something the others do
		// not: confidence catches inferred calls, the relation list catches
		// citations, and the node kind catches documentation.
		if (entry.confidence !== EXTRACTED) continue;
		if (!PROGRAMMATIC.has(relation)) continue;
		const from = symbols.get(source);
		const to = symbols.get(target);
		if (!from || !to) continue;

		edges.push({ from, to, relation });
	}

	return { symbols: [...symbols.values()], edges };
}

/** Narrowing, not copying: a graph has hundreds of thousands of entries. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
