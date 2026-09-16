import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { GraphFormatError, readGraph } from "../src/graph.ts";
import { describeEdge, neighbourhoods, symbolsInPlay } from "../src/symbols.ts";

const FIXTURE = readFileSync(
	new URL("./fixtures/graph.json", import.meta.url).pathname,
	"utf8",
);
const graph = readGraph(FIXTURE);

describe("reading an extraction", () => {
	test("carries what a parser established", () => {
		const relations = graph.edges.map((edge) => edge.relation);

		expect(relations).toEqual(["calls", "calls"]);
	});

	test("leaves out an inferred connection", () => {
		// graphify emits these even under --code-only, at confidence 0.8.
		const inferred = graph.edges.filter(
			(edge) => edge.to.label === ".recordPack()",
		);

		expect(inferred).toEqual([]);
	});

	test("leaves out a documentation node and its connections", () => {
		expect(graph.symbols.map((symbol) => symbol.label)).not.toContain(
			"ADR-0003",
		);
		expect(graph.edges.map((edge) => edge.relation)).not.toContain("cites");
	});

	test("leaves out a relation it does not know", () => {
		expect(graph.edges.map((edge) => edge.relation)).not.toContain(
			"semantically_similar_to",
		);
	});

	test("leaves out a connection to something that is not code", () => {
		const toBun = graph.edges.filter((edge) => edge.to.label === "ref_bun");

		expect(toBun).toEqual([]);
	});

	test("keeps where each symbol is", () => {
		const assemble = graph.symbols.find(
			(symbol) => symbol.label === "assemble()",
		);

		expect(assemble?.file).toBe("src/assembler.ts");
		expect(assemble?.position).toBe("L92");
	});

	test("an extraction with nothing extracted carries nothing", () => {
		const guessed = readGraph(
			JSON.stringify({
				nodes: [
					{ id: "a", label: "a()", file_type: "code", source_file: "a.ts" },
					{ id: "b", label: "b()", file_type: "code", source_file: "b.ts" },
				],
				links: [
					{ source: "a", target: "b", relation: "calls", confidence: "INFERRED" },
				],
			}),
		);

		expect(guessed.edges).toEqual([]);
		expect(guessed.symbols).toHaveLength(2);
	});
});

describe("an extraction that is not what the adapter requires", () => {
	test("names the missing nodes array", () => {
		expect(() => readGraph(JSON.stringify({ links: [] }))).toThrow(
			/"nodes"/,
		);
	});

	test("names the missing links array", () => {
		expect(() => readGraph(JSON.stringify({ nodes: [] }))).toThrow(/"links"/);
	});

	test("names a node without an id", () => {
		expect(() =>
			readGraph(JSON.stringify({ nodes: [{ label: "a" }], links: [] })),
		).toThrow(/node 0 has no string "id"/);
	});

	test("names a link without a relation", () => {
		expect(() =>
			readGraph(
				JSON.stringify({ nodes: [], links: [{ source: "a", target: "b" }] }),
			),
		).toThrow(/link 0 has no string "relation"/);
	});

	test("refuses a graph in which nothing is code", () => {
		// A renamed `file_type` would otherwise turn into permanent,
		// invisible zero recall rather than an error.
		expect(() =>
			readGraph(
				JSON.stringify({
					nodes: [{ id: "a", label: "a", kind: "code", source_file: "a.ts" }],
					links: [],
				}),
			),
		).toThrow(/file_type/);
	});

	test("refuses a link naming a node the graph does not declare", () => {
		expect(() =>
			readGraph(
				JSON.stringify({
					nodes: [
						{ id: "a", label: "a()", file_type: "code", source_file: "a.ts" },
					],
					links: [
						{
							source: "ghost",
							target: "a",
							relation: "calls",
							confidence: "EXTRACTED",
						},
					],
				}),
			),
		).toThrow(/does not declare/);
	});

	test("reports unreadable json rather than guessing", () => {
		expect(() => readGraph("{not json")).toThrow(GraphFormatError);
	});

	test("accepts the older edges field", () => {
		// NetworkX node-link has renamed this field before; the adapter
		// reads either rather than failing on a graph it can understand.
		const older = readGraph(
			JSON.stringify({
				nodes: [
					{ id: "a", label: "a()", file_type: "code", source_file: "a.ts" },
					{ id: "b", label: "b()", file_type: "code", source_file: "b.ts" },
				],
				edges: [
					{ source: "a", target: "b", relation: "calls", confidence: "EXTRACTED" },
				],
			}),
		);

		expect(older.edges).toHaveLength(1);
	});
});

describe("finding the symbols in play", () => {
	test("finds a symbol a prompt names", () => {
		const found = symbolsInPlay(graph, "who calls assemble in this codebase?");

		expect(found.map((symbol) => symbol.label)).toEqual(["assemble()"]);
	});

	test("finds a symbol written in a different style", () => {
		// The graph records `.recordPack()`; the prompt writes it three
		// other ways.
		for (const written of ["recordPack", "record_pack", "RecordPack"]) {
			const found = symbolsInPlay(graph, `what happens in ${written}?`);

			expect(found.map((symbol) => symbol.label)).toEqual([".recordPack()"]);
		}
	});

	test("an identifier that matches is not also split into parts", () => {
		const found = symbolsInPlay(graph, "what happens when recordPack runs?");

		// Not `approximateTokens()` via "record", nor anything via "pack".
		expect(found).toHaveLength(1);
	});

	test("an identifier that matches nothing falls back to its parts", () => {
		const found = symbolsInPlay(graph, "is assembleLater a thing?");

		expect(found.map((symbol) => symbol.label)).toEqual(["assemble()"]);
	});

	test("an ordinary word is dropped when the prompt names real code", () => {
		// Observed live: "do not read, grep, or list any files" matched
		// `.read()` and `.list()`, and they spent the Budget ahead of the
		// symbol the question was about.
		const graph = readGraph(
			JSON.stringify({
				nodes: [
					{
						id: "doc_store_read",
						label: ".read()",
						file_type: "code",
						source_file: "src/doc-store.ts",
					},
					{
						id: "concept_parseconcept",
						label: "parseConcept()",
						file_type: "code",
						source_file: "src/concept.ts",
					},
				],
				links: [],
			}),
		);

		// The ordinary word comes first in the prompt, so insertion order
		// alone would put `.read()` ahead of what was actually asked about.
		const found = symbolsInPlay(
			graph,
			"do not read any files: which functions call parseConcept?",
		);

		expect(found.map((symbol) => symbol.label)).toEqual(["parseConcept()"]);
	});

	test("a plainly written symbol is kept beside a compound one", () => {
		// Found in review: filtering on how the prompt writes a name lost
		// `assemble` whenever the prompt also said something like
		// `recordPack`, though the prompt names both.
		const found = symbolsInPlay(graph, "does recordPack call assemble?");

		expect(found.map((symbol) => symbol.label).sort()).toEqual([
			".recordPack()",
			"assemble()",
		]);
	});

	test("a word naming several methods cannot crowd out the symbol asked about", () => {
		// Found in review: "Describe what symbolsInPlay does" matched three
		// `describe()` before `symbolsInPlay()`, and a Budget of three
		// carried none of what was asked about.
		const nodes = [
			{
				id: "target",
				label: "symbolsInPlay()",
				file_type: "code",
				source_file: "src/symbols.ts",
			},
		];
		for (let index = 0; index < 3; index++) {
			nodes.push({
				id: `describe${index}`,
				label: ".describe()",
				file_type: "code",
				source_file: `src/other${index}.ts`,
			});
		}
		const crowded = readGraph(JSON.stringify({ nodes, links: [] }));

		const found = symbolsInPlay(crowded, "Describe what symbolsInPlay does");

		expect(found[0]?.label).toBe("symbolsInPlay()");
	});

	test("each named symbol gets a turn before any gets a second", () => {
		const nodes = [
			{
				id: "assemble",
				label: "assemble()",
				file_type: "code",
				source_file: "src/assembler.ts",
			},
		];
		for (let index = 0; index < 3; index++) {
			nodes.push({
				id: `record${index}`,
				label: ".recordPack()",
				file_type: "code",
				source_file: `src/store${index}.ts`,
			});
		}
		const many = readGraph(JSON.stringify({ nodes, links: [] }));

		const found = symbolsInPlay(many, "does recordPack call assemble?");

		// Three same-named methods must not spend a Budget of three before
		// the other symbol the prompt names.
		expect(found.slice(0, 2).map((symbol) => symbol.label)).toEqual([
			".recordPack()",
			"assemble()",
		]);
	});

	test("a type named by its capitalised name is not an ordinary word", () => {
		// `Pack` has no case boundary, so only its capital distinguishes it
		// from a word like `read`.
		const graph = readGraph(
			JSON.stringify({
				nodes: [
					{
						id: "doc_store_read",
						label: ".read()",
						file_type: "code",
						source_file: "src/doc-store.ts",
					},
					{
						id: "assembler_pack",
						label: "Pack",
						file_type: "code",
						source_file: "src/assembler.ts",
					},
				],
				links: [],
			}),
		);

		const found = symbolsInPlay(graph, "do not read any files: what is a Pack?");

		expect(found.map((symbol) => symbol.label)).toEqual(["Pack"]);
	});

	test("an ordinary word written as a call still counts as code", () => {
		const graph = readGraph(
			JSON.stringify({
				nodes: [
					{
						id: "doc_store_read",
						label: ".read()",
						file_type: "code",
						source_file: "src/doc-store.ts",
					},
				],
				links: [],
			}),
		);

		expect(symbolsInPlay(graph, "what does read() do?")).toHaveLength(1);
		expect(symbolsInPlay(graph, "what does store.read do?")).toHaveLength(1);
	});

	test("a prompt about nothing in the codebase finds nothing", () => {
		expect(symbolsInPlay(graph, "what is the capital of Peru")).toEqual([]);
	});
});

describe("the neighbourhood of a symbol", () => {
	test("carries both what calls it and what it calls", () => {
		const [around] = neighbourhoods(
			graph,
			symbolsInPlay(graph, "tell me about assemble"),
		);

		const described = (around?.edges ?? []).map(describeEdge);
		expect(described).toHaveLength(2);
		expect(described.join("\n")).toContain("contextManager() (src/extension.ts:L520)");
		expect(described.join("\n")).toContain("approximateTokens()");
	});

	test("a connection says where both ends are", () => {
		const [around] = neighbourhoods(
			graph,
			symbolsInPlay(graph, "tell me about assemble"),
		);
		const first = around?.edges[0];
		if (!first) throw new Error("no edge");

		expect(describeEdge(first)).toContain("src/assembler.ts:L92");
	});

	test("a symbol with more connections than a pack holds says so", () => {
		const nodes = [
			{ id: "hub", label: "hub()", file_type: "code", source_file: "a.ts" },
		];
		const links = [];
		for (let index = 0; index < 20; index++) {
			nodes.push({
				id: `n${index}`,
				label: `n${index}()`,
				file_type: "code",
				source_file: "b.ts",
			});
			links.push({
				source: "hub",
				target: `n${index}`,
				relation: "calls",
				confidence: "EXTRACTED",
			});
		}
		const big = readGraph(JSON.stringify({ nodes, links }));

		const [around] = neighbourhoods(big, symbolsInPlay(big, "tell me about hub"));

		// A hub's degree is unbounded; a pack's budget is not.
		expect(around?.edges.length).toBeLessThan(20);
		expect(around?.dropped).toBe(20 - (around?.edges.length ?? 0));
	});

	test("a capped neighbourhood keeps callers, not just callees", () => {
		// Measured on this repository: plain truncation left two of
		// nineteen over-sized symbols with no callers at all.
		const nodes = [
			{ id: "hub", label: "hub()", file_type: "code", source_file: "a.ts" },
		];
		const links = [];
		for (let index = 0; index < 20; index++) {
			nodes.push({
				id: `out${index}`,
				label: `out${index}()`,
				file_type: "code",
				source_file: "b.ts",
			});
			links.push({
				source: "hub",
				target: `out${index}`,
				relation: "calls",
				confidence: "EXTRACTED",
			});
		}
		nodes.push({
			id: "caller",
			label: "caller()",
			file_type: "code",
			source_file: "c.ts",
		});
		// Listed last, so file order alone would drop it.
		links.push({
			source: "caller",
			target: "hub",
			relation: "calls",
			confidence: "EXTRACTED",
		});
		const big = readGraph(JSON.stringify({ nodes, links }));

		const [around] = neighbourhoods(big, symbolsInPlay(big, "tell me about hub"));

		expect(
			(around?.edges ?? []).some((edge) => edge.from.label === "caller()"),
		).toBe(true);
	});

	test("a symbol with no connections yields nothing", () => {
		const found = symbolsInPlay(graph, "what about unusedHelper?");

		expect(found).toHaveLength(1);
		expect(neighbourhoods(graph, found)).toEqual([]);
	});
});
