import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { GraphFormatError, readGraph } from "../src/graph.ts";
import {
	codebaseStructure,
	describeEdge,
	findSymbol,
	neighbourhoods,
	prepare,
} from "../src/symbols.ts";
import { approximateTokens } from "../src/tokens.ts";

const FIXTURE = readFileSync(
	new URL("./fixtures/graph.json", import.meta.url).pathname,
	"utf8",
);
const graph = readGraph(FIXTURE);

/** The symbol a name resolves to; extraction time is irrelevant here. */
function symbol(name: string, of = graph) {
	const found = findSymbol(prepare(of, 0), name);
	if (!("node" in found)) throw new Error(`no symbol named ${name}`);
	return found.node;
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
		const [neighbourhood] = neighbourhoods(prepare(of, 0), [symbol("Hub", of)]);
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
		const [around] = neighbourhoods(prepare(graph, 0), [symbol("assemble")]);

		const described = (around?.edges ?? []).map(describeEdge);
		expect(described).toHaveLength(2);
		expect(described.join("\n")).toContain("piChart() (src/extension.ts:L520)");
		expect(described.join("\n")).toContain("approximateTokens()");
	});

	test("a connection says where both ends are", () => {
		const [around] = neighbourhoods(prepare(graph, 0), [symbol("assemble")]);
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

		const [around] = neighbourhoods(prepare(big, 0), [symbol("hub", big)]);

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

		const [around] = neighbourhoods(prepare(big, 0), [symbol("hub", big)]);

		expect(
			(around?.edges ?? []).some((edge) => edge.from.label === "caller()"),
		).toBe(true);
	});

	test("a symbol with no connections yields nothing", () => {
		expect(neighbourhoods(prepare(graph, 0), [symbol("unusedHelper")])).toEqual([]);
	});
});

describe("asking for a symbol's structure", () => {
	/**
	 * A chain a → b → c → d → e, a class `Store` holding `.read()`, another
	 * `.read()` elsewhere, and `b` also calling `a` so one edge is reachable
	 * from both ends.
	 */
	function chain() {
		const node = (id: string, label: string, file: string, line: number) => ({
			id, label, file_type: "code", source_file: file, source_location: `L${line}`,
		});
		const link = (source: string, relation: string, target: string) => ({
			source, target, relation, confidence: "EXTRACTED",
		});
		return prepare(readGraph(JSON.stringify({
			nodes: [
				node("a", "alpha()", "src/a.ts", 1),
				node("b", "beta()", "src/b.ts", 2),
				node("c", "gamma()", "src/c.ts", 3),
				node("d", "delta()", "src/d.ts", 4),
				node("e", "epsilon()", "src/e.ts", 5),
				node("store", "Store", "src/store.ts", 10),
				node("store_read", ".read()", "src/store.ts", 12),
				node("other_read", ".read()", "src/other.ts", 7),
			],
			links: [
				link("a", "calls", "b"),
				link("b", "calls", "a"),
				link("b", "calls", "c"),
				link("c", "calls", "d"),
				link("d", "calls", "e"),
				link("store", "method", "store_read"),
				link("e", "calls", "other_read"),
			],
		})), 0);
	}
	const resolved = (name: string, of = chain()) => {
		const found = findSymbol(of, name);
		return "node" in found ? found.node.id : undefined;
	};
	const edgeLines = (text: string) => text.split("\n").filter((line) => line.includes("--"));
	/** Files edited since the extraction: the Graph Store's answer to `older`. */
	const edited =
		(...files: string[]) =>
		async () =>
			new Set(files);
	const lookup = (name: string, options: { depth?: number; maxTokens?: number } = {}, of = chain()) =>
		codebaseStructure(of, name, { maxTokens: 1000, older: edited(), ...options });

	test("a bare name resolves to its symbol", () => {
		expect(resolved("beta")).toBe("b");
		expect(resolved("  Beta ")).toBe("b");
	});

	test("a trailing () is ignored", () => {
		expect(resolved("beta()")).toBe("b");
	});

	test("a name written in a different style resolves to the same symbol", () => {
		// The graph records `.recordPack()`.
		for (const written of ["recordPack", "record_pack", "RecordPack"]) {
			const found = findSymbol(prepare(graph, 0), written);

			expect("node" in found ? found.node.label : undefined).toBe(".recordPack()");
		}
	});

	test("Class.method resolves to that class's member", () => {
		expect(resolved("Store.read")).toBe("store_read");
		expect(resolved("Store.read()")).toBe("store_read");
	});

	test("an unknown name offers at most five nearest names, prefix first", async () => {
		const found = findSymbol(chain(), "del");
		if (!("nearest" in found)) throw new Error("resolved");
		expect(found.nearest.length).toBeLessThanOrEqual(5);
		expect(found.nearest[0]).toBe("delta() (src/d.ts:L4)");

		const text = await lookup("del");
		expect(text).toContain('No symbol named "del"');
		expect(text).toContain("delta() (src/d.ts:L4)");
	});

	test("an unknown name with nothing close says so", async () => {
		const text = await lookup("zzzzqqqq");
		expect(text).toContain('No symbol named "zzzzqqqq"');
		expect(text).toContain("no name in the graph is close");
	});

	test("depth 1, the default, is the symbol's own neighbourhood", async () => {
		const of = prepare(graph, 0);
		const found = findSymbol(of, "assemble");
		if (!("node" in found)) throw new Error("not resolved");
		const [around] = neighbourhoods(of, [found.node]);
		if (!around) throw new Error("no neighbourhood");

		const text = await lookup("assemble", {}, of);
		expect(text).toBe(
			`[codebase structure: assemble() (src/assembler.ts:L92)]\n` +
				around.edges.map(describeEdge).join("\n"),
		);
	});

	test("depth 2 adds second hops, each connection once", async () => {
		const one = edgeLines(await lookup("alpha"));
		const two = edgeLines(await lookup("alpha", { depth: 2 }));

		expect(one).toEqual([
			"alpha() (src/a.ts:L1) --calls--> beta() (src/b.ts:L2)",
			"beta() (src/b.ts:L2) --calls--> alpha() (src/a.ts:L1)",
		]);
		expect(two).toEqual([...one, "beta() (src/b.ts:L2) --calls--> gamma() (src/c.ts:L3)"]);
		expect(new Set(two).size).toBe(two.length);
	});

	test("a depth above 3 reaches three hops and no further", async () => {
		const text = await lookup("alpha", { depth: 9 });
		expect(text).toContain("gamma() (src/c.ts:L3) --calls--> delta() (src/d.ts:L4)");
		expect(text).not.toContain("epsilon()");
	});

	test("a result over the cap ends at a whole line with a marker", async () => {
		const whole = await lookup("alpha", { depth: 3, maxTokens: 10_000 });
		const cap = 45;
		const cut = await lookup("alpha", { depth: 3, maxTokens: cap });

		expect(approximateTokens([{ role: "user", content: whole }])).toBeGreaterThan(cap);
		expect(approximateTokens([{ role: "user", content: cut }])).toBeLessThanOrEqual(cap);
		const lines = cut.split("\n");
		const marker = lines.pop() ?? "";
		expect(marker).toMatch(/^… \[pi-chart elided \d+ more lines? of this structure\]$/);
		for (const line of lines) expect(whole.split("\n")).toContain(line);
		const left = Number(/elided (\d+)/.exec(marker)?.[1]);
		expect(lines.length + left).toBe(whole.split("\n").length);
	});

	test("structure older than the codebase says so", async () => {
		const text = await codebaseStructure(chain(), "alpha", {
			maxTokens: 1000,
			older: edited("src/a.ts"),
		});
		expect(text.split("\n")[0]).toBe(
			"[codebase structure: alpha() (src/a.ts:L1) (older than the codebase)]",
		);
		const cut = await codebaseStructure(chain(), "alpha", {
			depth: 3,
			maxTokens: 30,
			older: edited("src/a.ts"),
		});
		expect(cut).toContain("(older than the codebase)");
	});

	test("one result, two ages: only the edited symbol's neighbourhood is marked", async () => {
		// alpha's file is current; beta's, reached at the second hop, is not.
		const text = await codebaseStructure(chain(), "alpha", {
			depth: 2,
			maxTokens: 1000,
			older: edited("src/b.ts"),
		});

		expect(text.split("\n")).toEqual([
			"[codebase structure: alpha() (src/a.ts:L1)]",
			"alpha() (src/a.ts:L1) --calls--> beta() (src/b.ts:L2)",
			"beta() (src/b.ts:L2) --calls--> alpha() (src/a.ts:L1)",
			"beta() (src/b.ts:L2) --calls--> gamma() (src/c.ts:L3) (older than the codebase)",
		]);
	});

	test("the age is asked once, for every symbol whose neighbourhood is held", async () => {
		const asked: string[][] = [];
		await codebaseStructure(chain(), "alpha", {
			depth: 3,
			maxTokens: 1000,
			older: async (files) => {
				asked.push(files);
				return new Set();
			},
		});

		expect(asked).toHaveLength(1);
		expect(new Set(asked[0])).toEqual(new Set(["src/a.ts", "src/b.ts", "src/c.ts"]));
	});
});
