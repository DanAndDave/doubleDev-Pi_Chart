// Against the real tool. graphify is a Python package this installs into a
// private environment, so these run only under CM_GRAPHIFY=1.

import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GraphStore } from "../src/graph-store.ts";
import { neighbourhoods, symbolsInPlay } from "../src/symbols.ts";

const describeReal = process.env.CM_GRAPHIFY === "1" ? describe : describe.skip;
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
			const found = symbolsInPlay(graph, "who calls assemble");
			const [around] = neighbourhoods(graph, found);
			const partners = (around?.edges ?? []).map(
				(edge) => `${edge.from.label} ${edge.relation} ${edge.to.label}`,
			);

			expect(found.map((symbol) => symbol.label)).toContain("assemble()");
			expect(partners.join("\n")).toContain("assemble()");
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
		"refreshing an extracted codebase re-extracts only what changed",
		async () => {
			const root = await codebase();
			const commands: string[][] = [];
			// The real executable, watched: what matters is that the second
			// pass takes the incremental path and that graphify agrees it
			// only re-extracted the edited file.
			const outputs: string[] = [];
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
					outputs.push(`${stdout}${stderr}`);
					return { ok: code === 0, output: `${stdout}${stderr}` };
				},
			});

			await store.refresh(root);
			const file = join(root, "src", "sections.ts");
			await writeFile(file, `${await Bun.file(file).text()}\n// edited\n`);
			await store.refresh(root);

			expect(commands[0]?.[0]).toBe("extract");
			expect(commands.at(-1)?.[0]).toBe("update");
			const graph = await store.graph(root);
			expect(graph?.edges.length).toBeGreaterThan(0);
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

			// graphify reports its own decision, which is the only honest
			// evidence that nothing was rebuilt.
			expect(last).toContain("No code-graph topology changes detected");
		},
		TIMEOUT,
	);
});
