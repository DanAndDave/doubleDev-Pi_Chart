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
	"implements",
	"inherits",
	"mixes_in",
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

	if (typeof document !== "object" || document === null) {
		throw new GraphFormatError("graph is not an object");
	}
	const root: Record<string, unknown> = { ...document };

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
	for (const [index, entry] of nodes.entries()) {
		const node = asRecord(entry);
		if (!node) throw new GraphFormatError(`node ${index} is not an object`);

		const id = node.id;
		if (typeof id !== "string") {
			throw new GraphFormatError(`node ${index} has no string "id"`);
		}
		// Documentation, external references and concepts are not code, and
		// their connections are not programmatic.
		if (node.file_type !== CODE) continue;

		symbols.set(id, {
			id,
			label: typeof node.label === "string" ? node.label : id,
			file: typeof node.source_file === "string" ? node.source_file : "",
			position:
				typeof node.source_location === "string"
					? node.source_location
					: undefined,
		});
	}

	const edges: GraphEdge[] = [];
	for (const [index, entry] of links.entries()) {
		const link = asRecord(entry);
		if (!link) throw new GraphFormatError(`link ${index} is not an object`);

		const source = link.source;
		const target = link.target;
		if (typeof source !== "string" || typeof target !== "string") {
			throw new GraphFormatError(
				`link ${index} has no string "source" and "target"`,
			);
		}
		const relation = link.relation;
		if (typeof relation !== "string") {
			throw new GraphFormatError(`link ${index} has no string "relation"`);
		}

		// Three conditions, because each excludes something the others do
		// not: confidence catches inferred calls, the relation list catches
		// citations, and the node kind catches documentation.
		if (link.confidence !== EXTRACTED) continue;
		if (!PROGRAMMATIC.has(relation)) continue;
		const from = symbols.get(source);
		const to = symbols.get(target);
		if (!from || !to) continue;

		edges.push({ from, to, relation });
	}

	return { symbols: [...symbols.values()], edges };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	return { ...value };
}
