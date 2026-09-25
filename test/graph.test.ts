import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { GraphFormatError, readGraph } from "../src/graph.ts";
import type { HarnessMessage } from "../src/messages.ts";
import {
	describeEdge,
	neighbourhoods,
	prepare,
	symbolsInPlay,
} from "../src/symbols.ts";

const FIXTURE = readFileSync(
	new URL("./fixtures/graph.json", import.meta.url).pathname,
	"utf8",
);
const graph = readGraph(FIXTURE);

/**
 * A prompt as a Turn, which is what selection now reads. Extraction time is
 * irrelevant to selection, so these fixtures leave it at zero.
 */
function inPlay(text: string, of = graph) {
	return symbolsInPlay(prepare(of, 0), { prompt: text, messages: [] });
}

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
		const found = inPlay("who calls assemble in this codebase?");

		expect(found.map((symbol) => symbol.label)).toEqual(["assemble()"]);
	});

	test("finds a symbol written in a different style", () => {
		// The graph records `.recordPack()`; the prompt writes it three
		// other ways.
		for (const written of ["recordPack", "record_pack", "RecordPack"]) {
			const found = inPlay(`what happens in ${written}?`);

			expect(found.map((symbol) => symbol.label)).toEqual([".recordPack()"]);
		}
	});

	test("an identifier that matches is not also split into parts", () => {
		const found = inPlay("what happens when recordPack runs?");

		// Not `approximateTokens()` via "record", nor anything via "pack".
		expect(found).toHaveLength(1);
	});

	test("an identifier that matches nothing falls back to its parts", () => {
		const found = inPlay("is assembleLater a thing?");

		expect(found.map((symbol) => symbol.label)).toEqual(["assemble()"]);
	});

	test("an ordinary word is dropped when the prompt names real code", () => {
		// Observed live: "do not read, grep, or list any files" matched
		// `.read()` and `.list()`, and they spent the Budget ahead of the
		// symbol the question was about.
		const local = readGraph(
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
		const found = inPlay(
			"do not read any files: which functions call parseConcept?",
			local,
		);

		expect(found.map((symbol) => symbol.label)).toEqual(["parseConcept()"]);
	});

	test("a plainly written symbol is kept beside a compound one", () => {
		// Found in review: filtering on how the prompt writes a name lost
		// `assemble` whenever the prompt also said something like
		// `recordPack`, though the prompt names both.
		const found = inPlay("does recordPack call assemble?");

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

		const found = inPlay("Describe what symbolsInPlay does", crowded);

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

		const found = inPlay("does recordPack call assemble?", many);

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
		const local = readGraph(
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

		const found = inPlay("do not read any files: what is a Pack?", local);

		expect(found.map((symbol) => symbol.label)).toEqual(["Pack"]);
	});

	test("an ordinary word written as a call still counts as code", () => {
		const local = readGraph(
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

		expect(inPlay("what does read() do?", local)).toHaveLength(1);
		expect(inPlay("what does store.read do?", local)).toHaveLength(1);
	});

	test("a prompt about nothing in the codebase finds nothing", () => {
		expect(inPlay("what is the capital of Peru")).toEqual([]);
	});
});

describe("the symbols a turn is working with", () => {
	/** A Turn whose prompt names nothing, but whose messages do. */
	function turn(prompt: string, ...messages: HarnessMessage[]) {
		return symbolsInPlay(prepare(graph, 0), { prompt, messages });
	}

	const read = (path: string): HarnessMessage => ({
		role: "assistant",
		content: [
			{ type: "toolCall", id: "t1", name: "read", arguments: { path } },
		],
	});

	test("a tool-loop call whose prompt names nothing still finds symbols", () => {
		// The question a tool loop asks is "continue", and the Turn has
		// been reading files for ten steps.
		const found = turn("keep going", read("src/assembler.ts"));

		expect(found.map((symbol) => symbol.label)).toContain("assemble()");
	});

	test("a symbol the prompt names outranks a file's other symbols", () => {
		const found = turn(
			"what calls piChart?",
			read("src/assembler.ts"),
		);

		expect(found[0]?.label).toBe("piChart()");
		expect(found.map((symbol) => symbol.label)).toContain("assemble()");
	});

	test("only the head of a message is read", () => {
		// One message's contribution is bounded, so a tool result that
		// dwarfs the Turn cannot decide what the Turn is about. Measured:
		// scanning this machine's widest Turn unbounded cost 89 ms on the
		// Call's own path, against recall's whole 81 ms budget.
		const buried: HarnessMessage = {
			role: "toolResult",
			content: `${"filler ".repeat(2_000)}unusedHelper()`,
		};
		const stated: HarnessMessage = {
			role: "toolResult",
			content: `unusedHelper() ${"filler ".repeat(2_000)}`,
		};

		expect(turn("keep going", buried)).toEqual([]);
		expect(turn("keep going", stated).map((each) => each.label)).toContain(
			"unusedHelper()",
		);
	});

	test("an outsized tool result cannot displace what the turn is about", () => {
		const noise: HarnessMessage = {
			role: "toolResult",
			content: "unusedHelper ".repeat(20_000),
		};
		const found = turn("what calls piChart?", noise, read("src/assembler.ts"));

		expect(found[0]?.label).toBe("piChart()");
		expect(found.map((symbol) => symbol.label)).toContain("assemble()");
	});

	test("only the turn's recent messages are read", () => {
		// Forty messages of history, the symbol named in the oldest: a
		// Turn works on what it just did, and scanning a 1,805-message Turn
		// whole was measured at 89 ms on the Call's own path.
		const old: HarnessMessage = { role: "toolResult", content: "unusedHelper()" };
		const filler = Array.from({ length: 40 }, () => ({
			role: "toolResult",
			content: "nothing to see",
		}));

		expect(turn("keep going", old, ...filler).map((each) => each.label)).toEqual([]);
		expect(turn("keep going", old).map((each) => each.label)).toContain(
			"unusedHelper()",
		);
	});

	test("the member-name rule still holds over the turn's wider text", () => {
		const found = turn("keep going", {
			role: "toolResult",
			content: "do not read any files; look at recordPack instead",
		});

		expect(found.map((symbol) => symbol.label)).toEqual([".recordPack()"]);
	});

	test("a turn naming nothing the graph knows finds nothing", () => {
		const found = turn("keep going", {
			role: "toolResult",
			content: "the capital of Peru is Lima",
		});

		expect(found).toEqual([]);
	});
});

describe("a file in play", () => {
	const forPath = (path: string) =>
		symbolsInPlay(prepare(graph, 0), { prompt: `look at ${path}`, messages: [] })
			.map((symbol) => symbol.label);

	test("a path resolves to the symbols that file defines", () => {
		expect(forPath("src/assembler.ts")).toEqual(
			expect.arrayContaining(["assemble()", "approximateTokens()"]),
		);
	});

	test("every spelling of the same path resolves to the same symbols", () => {
		const relative = forPath("src/assembler.ts");

		expect(forPath("./src/assembler.ts")).toEqual(relative);
		expect(forPath("/home/user/dev/pi-chart/src/assembler.ts")).toEqual(
			relative,
		);
	});

	test("a bare word naming a file reaches the file's symbols", () => {
		// `assembler` is not `assemble`, and `canonical` will never make it
		// one: the link is the file the graph states.
		expect(forPath("assembler")).toContain("assemble()");
	});

	test("a path no symbol belongs to yields nothing", () => {
		expect(forPath("src/nowhere-at-all.ts")).toEqual([]);
	});
});

describe("truncating an over-sized neighbourhood", () => {
	/** A hub with more members than the cap, plus callers and importers. */
	function hub(): ReturnType<typeof readGraph> {
		const nodes = [
			{ id: "hub", label: "Hub", file_type: "code", source_file: "src/hub.ts" },
		];
		const links: Record<string, unknown>[] = [];
		for (let index = 0; index < 16; index++) {
			nodes.push({
				id: `m${index}`,
				label: `.member${index}()`,
				file_type: "code",
				source_file: "src/hub.ts",
			});
			links.push({
				source: "hub",
				target: `m${index}`,
				relation: index % 2 === 0 ? "contains" : "method",
				confidence: "EXTRACTED",
			});
		}
		for (const [index, relation] of ["calls", "imports", "calls"].entries()) {
			nodes.push({
				id: `u${index}`,
				label: `user${index}()`,
				file_type: "code",
				source_file: "src/user.ts",
			});
			links.push({
				source: `u${index}`,
				target: "hub",
				relation,
				confidence: "EXTRACTED",
			});
		}
		nodes.push({
			id: "dep",
			label: "dependency()",
			file_type: "code",
			source_file: "src/dep.ts",
		});
		links.push({
			source: "hub",
			target: "dep",
			relation: "calls",
			confidence: "EXTRACTED",
		});
		return readGraph(JSON.stringify({ nodes, links }));
	}

	const around = (of = hub()) => {
		const prepared = prepare(of, 0);
		const [neighbourhood] = neighbourhoods(
			prepared,
			symbolsInPlay(prepared, { prompt: "tell me about Hub", messages: [] }),
		);
		if (!neighbourhood) throw new Error("no neighbourhood");
		return neighbourhood;
	};

	test("what uses a hub survives while its members are left out", () => {
		const relations = around().edges.map((edge) => edge.relation);

		// Every use is carried; membership fills only what is left.
		expect(relations.filter((each) => each === "calls")).toHaveLength(3);
		expect(relations).toContain("imports");
		expect(relations.filter((each) => each === "contains" || each === "method"))
			.toHaveLength(8);
	});

	test("the cap and the direction alternation are unchanged", () => {
		const neighbourhood = around();

		expect(neighbourhood.edges).toHaveLength(12);
		expect(neighbourhood.dropped).toBe(20 - 12);
		const inbound = neighbourhood.edges.filter((edge) => edge.to.id === "hub");
		const outbound = neighbourhood.edges.filter((edge) => edge.from.id === "hub");
		expect(inbound.length).toBeGreaterThan(0);
		expect(outbound.length).toBeGreaterThan(0);
	});

	test("truncating the same neighbourhood twice keeps the same connections", () => {
		const graphOf = hub();

		expect(around(graphOf).edges.map(describeEdge)).toEqual(
			around(graphOf).edges.map(describeEdge),
		);
	});
});

describe("the neighbourhood of a symbol", () => {
	test("carries both what calls it and what it calls", () => {
		const [around] = neighbourhoods(prepare(graph, 0),
			inPlay("tell me about assemble"),
		);

		const described = (around?.edges ?? []).map(describeEdge);
		expect(described).toHaveLength(2);
		expect(described.join("\n")).toContain("piChart() (src/extension.ts:L520)");
		expect(described.join("\n")).toContain("approximateTokens()");
	});

	test("a connection says where both ends are", () => {
		const [around] = neighbourhoods(prepare(graph, 0),
			inPlay("tell me about assemble"),
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

		const [around] = neighbourhoods(prepare(big, 0), inPlay("tell me about hub", big));

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

		const [around] = neighbourhoods(prepare(big, 0), inPlay("tell me about hub", big));

		expect(
			(around?.edges ?? []).some((edge) => edge.from.label === "caller()"),
		).toBe(true);
	});

	test("a symbol with no connections yields nothing", () => {
		const found = inPlay("what about unusedHelper?");

		expect(found).toHaveLength(1);
		expect(neighbourhoods(prepare(graph, 0), found)).toEqual([]);
	});
});
