// Against the real OpenSpec CLI, which the Spec Store delegates to rather
// than reimplements. Gated on PICHART_OPENSPEC=1 because it spawns processes.

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SpecStore } from "../src/spec-store.ts";

const describeReal = process.env.PICHART_OPENSPEC === "1" ? describe : describe.skip;
const TIMEOUT = 120_000;

async function directory(): Promise<string> {
	return mkdtemp(join(tmpdir(), "cm-openspec-"));
}

describeReal("against the real openspec", () => {
	test(
		"a bare codebase initializes to a tree that verifies",
		async () => {
			const root = await directory();
			const store = new SpecStore();
			expect((await store.verify(root)).absent).toBe(true);

			await store.initialize(root);

			expect((await store.verify(root)).conforming).toBe(true);
		},
		TIMEOUT,
	);

	test(
		"initializing leaves existing specs, changes and configuration alone",
		async () => {
			const root = await directory();
			const store = new SpecStore();
			await mkdir(join(root, "openspec", "specs", "billing"), {
				recursive: true,
			});
			await mkdir(join(root, "openspec", "changes", "add-dunning"), {
				recursive: true,
			});
			const spec = join(root, "openspec", "specs", "billing", "spec.md");
			const proposal = join(
				root,
				"openspec",
				"changes",
				"add-dunning",
				"proposal.md",
			);
			const config = join(root, "openspec", "config.yaml");
			await writeFile(spec, "# billing\n\n## Requirements\n");
			await writeFile(proposal, "# Proposal: dunning\n");
			await writeFile(config, "schema: spec-driven\ncontext: |\n  ours\n");

			await store.initialize(root);

			expect(await readFile(spec, "utf8")).toContain("## Requirements");
			expect(await readFile(proposal, "utf8")).toContain("dunning");
			expect(await readFile(config, "utf8")).toContain("ours");
		},
		TIMEOUT,
	);

	test(
		"initializing completes a partial tree",
		async () => {
			const root = await directory();
			const store = new SpecStore();
			await mkdir(join(root, "openspec", "changes"), { recursive: true });
			await writeFile(
				join(root, "openspec", "config.yaml"),
				"schema: spec-driven\n",
			);
			expect((await store.verify(root)).conforming).toBe(false);

			await store.initialize(root);

			expect((await store.verify(root)).conforming).toBe(true);
		},
		TIMEOUT,
	);

	test(
		"a change openspec rejects is diagnosed in its own words",
		async () => {
			const root = await directory();
			const store = new SpecStore();
			await store.initialize(root);
			await mkdir(join(root, "openspec", "changes", "half-done"), {
				recursive: true,
			});
			await writeFile(
				join(root, "openspec", "changes", "half-done", "tasks.md"),
				"- [ ] something\n",
			);

			const report = await store.diagnose(root);

			expect(report.valid).toBe(false);
			expect(report.detail).toContain("half-done");
		},
		TIMEOUT,
	);

	test(
		"a freshly initialized codebase has nothing wrong with its content",
		async () => {
			const root = await directory();
			const store = new SpecStore();
			await store.initialize(root);

			expect((await store.diagnose(root)).valid).toBe(true);
		},
		TIMEOUT,
	);

	test(
		"the shape check catches what openspec's own commands do not",
		async () => {
			// The measurement this design rests on: the CLI reports success
			// on a tree missing `specs/`, so delegating shape to it would
			// miss the failure worth catching.
			const root = await directory();
			const store = new SpecStore();
			await store.initialize(root);
			await Bun.$`rm -rf ${join(root, "openspec", "specs")}`.quiet();

			const tree = await store.verify(root);
			const content = await store.diagnose(root);

			expect(tree.conforming).toBe(false);
			expect(content.valid).toBe(true);
		},
		TIMEOUT,
	);

	test(
		"a missing openspec binary is unknown, not invalid content",
		async () => {
			const root = await directory();
			// Through the real process boundary: whether a missing binary
			// throws or exits nonzero decides whether this Store reports
			// "unknown" or silently claims the content is broken.
			const report = await new SpecStore({
				openspec: "openspec-not-installed-here",
			}).diagnose(root);

			expect(report.valid).toBeUndefined();
			expect(report.detail).toContain("could not be run");
		},
		TIMEOUT,
	);

});
