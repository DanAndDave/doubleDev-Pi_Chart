// Against the real tool. graphify is a Python package this installs into a
// private environment, so these run only under PICHART_GRAPHIFY=1.

import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GraphStore } from "../src/graph-store.ts";
import { neighbourhoods, symbolsInPlay } from "../src/symbols.ts";

const describeReal = process.env.PICHART_GRAPHIFY === "1" ? describe : describe.skip;
const TIMEOUT = 600_000;

/** This repository's own source, in a directory the test may write to. */
async function codebase(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "cm-graphify-"));
	await cp(new URL("../src", import.meta.url).pathname, join(root, "src"), {
		recursive: true,
	});
	return root;
}

describeReal("against the real graphify", () => {
	test(
		"extracts this repository and finds a real caller",
		async () => {
			const root = await codebase();
			const store = new GraphStore();

			await store.refresh(root);
			const graph = await store.graph(root);
			if (!graph) throw new Error("no graph after extraction");

			// `assemble` is called from the extension; that is a fact a
			// parser can establish, and the whole point of this Store.
			const found = symbolsInPlay(graph, {
				prompt: "who calls assemble",
				messages: [],
			});
			const [around] = neighbourhoods(graph, found);
			const partners = (around?.edges ?? []).map(
				(edge) => `${edge.from.label} ${edge.relation} ${edge.to.label}`,
			);

			expect(found.map((symbol) => symbol.label)).toContain("assemble()");
			// The counterpart, not the symbol itself: every edge here names
			// `assemble()` by construction, so only an edge arriving from
			// something else proves a caller was found.
			expect(
				(around?.edges ?? []).some(
					(edge) =>
						edge.to.label === "assemble()" &&
						edge.from.label !== "assemble()",
				),
			).toBe(true);
			expect(partners.length).toBeGreaterThan(1);
		},
		TIMEOUT,
	);

	test(
		"carries nothing graphify had to guess at",
		async () => {
			const root = await codebase();
			const store = new GraphStore();
			await store.refresh(root);

			const graph = await store.graph(root);
			const raw = JSON.parse(
				await Bun.file(join(root, "graphify-out", "graph.json")).text(),
			) as { links: { confidence?: string; relation?: string }[] };

			// The measurement this design rests on: --code-only still emits
			// inferred edges, so the adapter must drop them itself.
			const inferred = raw.links.filter(
				(link) => link.confidence !== "EXTRACTED",
			);
			expect(inferred.length).toBeGreaterThan(0);
			expect(graph?.edges.length).toBeLessThan(raw.links.length);
			expect(graph?.edges.every((edge) => edge.relation !== "cites")).toBe(true);
		},
		TIMEOUT,
	);

	test(
		"refreshing after an edit brings the graph up to date",
		async () => {
			const root = await codebase();
			const commands: string[][] = [];
			// The real executable, watched, so the test can see which
			// commands ran as well as what they left behind.
			const store = new GraphStore({
				run: async (command, args) => {
					commands.push(args);
					const spawned = Bun.spawn([command, ...args], {
						stdout: "pipe",
						stderr: "pipe",
					});
					const [stdout, stderr, code] = await Promise.all([
						new Response(spawned.stdout).text(),
						new Response(spawned.stderr).text(),
						spawned.exited,
					]);
					return { ok: code === 0, output: `${stdout}${stderr}` };
				},
			});

			await store.refresh(root);
			const before = await store.graph(root);
			const file = join(root, "src", "sections.ts");
			await writeFile(
				file,
				`${await Bun.file(file).text()}\nexport function probeAfterEdit() {\n\treturn splitConcept;\n}\n`,
			);
			await store.refresh(root);

			// The graph must actually have moved: asserting the command ran
			// would pass even if refreshing did nothing.
			const after = await store.graph(root);
			expect(
				before?.symbols.some((each) => each.label.includes("probeAfterEdit")),
			).toBe(false);
			expect(
				after?.symbols.some((each) => each.label.includes("probeAfterEdit")),
			).toBe(true);
			// Only the graphify invocations: `run` also carries the version
			// check and, on a machine without the venv, the install.
			const extractions = commands.filter((args) => args[0] === "extract");
			expect(extractions).toHaveLength(2);
		},
		TIMEOUT,
	);

	test(
		"refreshing a codebase nothing changed re-extracts nothing",
		async () => {
			const root = await codebase();
			let last = "";
			const store = new GraphStore({
				run: async (command, args) => {
					const spawned = Bun.spawn([command, ...args], {
						stdout: "pipe",
						stderr: "pipe",
					});
					const [stdout, stderr, code] = await Promise.all([
						new Response(spawned.stdout).text(),
						new Response(spawned.stderr).text(),
						spawned.exited,
					]);
					last = `${stdout}${stderr}`;
					return { ok: code === 0, output: last };
				},
			});

			await store.refresh(root);
			await store.refresh(root);

			// graphify reports its own cache decision, which is the only
			// honest evidence that the corpus was not re-parsed.
			expect(last).toContain("0 re-extracted");
		},
		TIMEOUT,
	);

	test(
		"refreshing after one edit costs that edit, not the corpus",
		async () => {
			const root = await codebase();
			let last = "";
			const store = new GraphStore({
				run: async (command, args) => {
					const spawned = Bun.spawn([command, ...args], {
						stdout: "pipe",
						stderr: "pipe",
					});
					const [stdout, stderr, code] = await Promise.all([
						new Response(spawned.stdout).text(),
						new Response(spawned.stderr).text(),
						spawned.exited,
					]);
					last = `${stdout}${stderr}`;
					return { ok: code === 0, output: last };
				},
			});

			await store.refresh(root);
			const file = join(root, "src", "sections.ts");
			await writeFile(
				file,
				`${await Bun.file(file).text()}\nexport function probeCost() {\n\treturn 1;\n}\n`,
			);
			await store.refresh(root);

			// The refresh that follows every Turn is affordable only
			// because it costs the edit: this is that claim, against the
			// tool's own report.
			const summary = /(\d+) files cached\/unchanged, (\d+) re-extracted/.exec(last);
			if (!summary) throw new Error(`no incremental summary in: ${last}`);
			const cached = Number(summary[1]);
			const again = Number(summary[2]);
			expect(again).toBeLessThanOrEqual(3);
			expect(cached).toBeGreaterThan(again * 10);
		},
		TIMEOUT,
	);
});
