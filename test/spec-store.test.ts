import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CommandResult } from "../src/process.ts";
import { describeTree, SpecStore } from "../src/spec-store.ts";

/** A Codebase on a real filesystem: the thing being checked is paths. */
async function codebase(
	build: (root: string) => Promise<void>,
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "cm-spec-"));
	await build(root);
	return root;
}

async function conforming(root: string): Promise<void> {
	await mkdir(join(root, "openspec", "specs"), { recursive: true });
	await mkdir(join(root, "openspec", "changes", "archive"), { recursive: true });
	await writeFile(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
}

/** Every path under a directory, with its contents, for comparing before and after. */
async function snapshot(root: string): Promise<Record<string, string>> {
	const seen: Record<string, string> = {};
	const walk = async (at: string, prefix: string): Promise<void> => {
		for (const entry of await readdir(at, { withFileTypes: true })) {
			const path = join(at, entry.name);
			const key = join(prefix, entry.name);
			if (entry.isDirectory()) {
				seen[key] = "<directory>";
				await walk(path, key);
			} else {
				seen[key] = await readFile(path, "utf8");
			}
		}
	};
	await walk(root, "");
	return seen;
}

describe("verifying a codebase's tree", () => {
	test("a conforming codebase is reported as such", async () => {
		const root = await codebase(conforming);

		const report = await new SpecStore().verify(root);

		expect(report.conforming).toBe(true);
		expect(report.absent).toBe(false);
		expect(describeTree(report)).toContain("as expected");
	});

	test("a codebase with no tree is reported as absent, not incomplete", async () => {
		const root = await codebase(async () => {});

		const report = await new SpecStore().verify(root);

		// A Codebase never set up is a different fact from one set up
		// wrongly, and the answer to each is different.
		expect(report.absent).toBe(true);
		expect(report.conforming).toBe(false);
		expect(describeTree(report)).toContain("No OpenSpec tree");
	});

	test("each absent part is named", async () => {
		for (const missing of [
			join("openspec", "specs"),
			join("openspec", "changes"),
			join("openspec", "changes", "archive"),
			join("openspec", "config.yaml"),
		]) {
			const root = await codebase(async (at) => {
				await conforming(at);
				await Bun.$`rm -rf ${join(at, missing)}`.quiet();
			});

			const report = await new SpecStore().verify(root);

			expect(report.conforming).toBe(false);
			expect(report.absent).toBe(false);
			expect(describeTree(report)).toContain(`${missing} is missing`);
		}
	});

	test("a part of the wrong kind is not counted as present", async () => {
		const root = await codebase(async (at) => {
			await conforming(at);
			await Bun.$`rm -rf ${join(at, "openspec", "specs")}`.quiet();
			await writeFile(join(at, "openspec", "specs"), "not a directory");
		});

		const report = await new SpecStore().verify(root);

		expect(report.conforming).toBe(false);
		expect(describeTree(report)).toContain("is not a directory");
	});

	test("a part that cannot be read is not reported as missing", async () => {
		const root = await codebase(conforming);
		// Through the real inspection: the whole content of this rule is
		// which errno means absent and which means something else.
		await Bun.$`chmod 000 ${join(root, "openspec")}`.quiet();
		try {
			const report = await new SpecStore().verify(root);

			// Telling someone to create what is already there would send
			// them after the wrong problem.
			expect(describeTree(report)).toContain("cannot be read");
			expect(describeTree(report)).not.toContain("is missing");
		} finally {
			await Bun.$`chmod 755 ${join(root, "openspec")}`.quiet();
		}
	});

	test("verification changes nothing, whatever the state", async () => {
		const states: ((root: string) => Promise<void>)[] = [
			conforming,
			async () => {},
			// Partial.
			async (at) => {
				await conforming(at);
				await Bun.$`rm -rf ${join(at, "openspec", "specs")}`.quiet();
			},
			// Wrong kind.
			async (at) => {
				await conforming(at);
				await Bun.$`rm -rf ${join(at, "openspec", "changes")}`.quiet();
				await writeFile(join(at, "openspec", "changes"), "not a directory");
			},
		];

		for (const build of states) {
			const root = await codebase(build);
			const before = await snapshot(root);

			await new SpecStore().verify(root);

			expect(await snapshot(root)).toEqual(before);
		}
	});
});

describe("diagnosing content", () => {
	function store(result: CommandResult | Error): {
		store: SpecStore;
		ran: string[][];
	} {
		const ran: string[][] = [];
		return {
			ran,
			store: new SpecStore({
				run: async (_command, args) => {
					ran.push(args);
					if (result instanceof Error) throw result;
					return result;
				},
			}),
		};
	}

	test("asks openspec, and repeats its words", async () => {
		const { store: specStore, ran } = store({
			ok: false,
			output: "✗ [ERROR] file: Change must have at least one delta.",
		});

		const report = await specStore.diagnose("/work/project");

		expect(ran[0]).toEqual(["validate", "--all", "--strict"]);
		expect(report.valid).toBe(false);
		// Its words, not a paraphrase that will drift from them.
		expect(report.detail).toContain("at least one delta");
	});

	test("conforming content reports nothing wrong", async () => {
		const { store: specStore } = store({ ok: true, output: "All items valid" });

		const report = await specStore.diagnose("/work/project");

		expect(report.valid).toBe(true);
	});

	test("an unavailable openspec is unknown, not conformance", async () => {
		const { store: specStore } = store(new Error("openspec: not found"));

		const report = await specStore.diagnose("/work/project");

		// Reporting "nothing wrong" here is the most useful-looking lie
		// this Store could tell.
		expect(report.valid).toBeUndefined();
		expect(report.detail).toContain("not found");
	});

	test("an openspec that hangs is bounded", async () => {
		const bounds: (number | undefined)[] = [];
		const specStore = new SpecStore({
			run: async (_command, _args, _cwd, timeoutMs) => {
				bounds.push(timeoutMs);
				return { ok: true, output: "All items valid" };
			},
		});

		await specStore.diagnose("/work/project");
		await specStore.initialize("/work/project");

		// Both commands, because either one hanging holds up a session
		// start with nothing to say about why.
		expect(bounds).toHaveLength(2);
		for (const bound of bounds) expect(bound).toBeGreaterThan(0);
	});
});

describe("initializing", () => {
	test("runs openspec's own command in the codebase", async () => {
		const ran: { args: string[]; cwd?: string }[] = [];
		const specStore = new SpecStore({
			run: async (_command, args, cwd) => {
				ran.push({ args, cwd });
				return { ok: true, output: "" };
			},
		});

		await specStore.initialize("/work/project");

		expect(ran[0]?.args).toEqual(["init", ".", "--tools", "none"]);
		expect(ran[0]?.cwd).toBe("/work/project");
	});

	test("a failure to initialize says why", async () => {
		const specStore = new SpecStore({
			run: async () => ({ ok: false, output: "permission denied" }),
		});

		await expect(specStore.initialize("/work/project")).rejects.toThrow(
			/permission denied/,
		);
	});
});
