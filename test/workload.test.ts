import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildWorkspace, gradedSteps, loadWorkload } from "../scripts/workload.ts";

/** A commit of this repository, so a Workload pinned to it resolves. */
const PINNED = "c6fe51651936bdcb29d9dd5dc3d46609ad02c359";

async function workloadDir(
	spec: unknown,
	checks: string[] = [],
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pichart-workload-"));
	await writeFile(
		join(dir, "workload.json"),
		typeof spec === "string" ? spec : JSON.stringify(spec),
	);
	if (checks.length > 0) {
		await mkdir(join(dir, "checks"));
		for (const check of checks) {
			await writeFile(join(dir, "checks", check), "");
		}
	}
	return dir;
}

const WELL_FORMED = {
	name: "tiny",
	version: 1,
	commit: PINNED,
	plants: [{ id: "codeword", value: "PLUM-17" }],
	steps: [
		{ id: "edit", prompts: ["Remember PLUM-17. Add src/x.ts."] },
		{
			id: "probe",
			prompts: [
				"Read src/pins.ts.",
				{ text: "What codeword did I give you?", probes: ["codeword"] },
			],
		},
	],
};

async function rejection(dir: string): Promise<string> {
	try {
		await loadWorkload(dir);
	} catch (error) {
		return (error as Error).message;
	}
	throw new Error("the Workload was accepted");
}

describe("loadWorkload", () => {
	test("a well-formed Workload loads with only its checked step graded", async () => {
		const dir = await workloadDir(WELL_FORMED, ["edit.check.ts"]);

		const workload = await loadWorkload(dir);

		expect(workload.name).toBe("tiny");
		expect(workload.version).toBe(1);
		expect(workload.commit).toBe(PINNED);
		expect(workload.steps.map((step) => [step.id, step.check !== undefined])).toEqual([
			["edit", true],
			["probe", false],
		]);
		expect(workload.steps[1]?.prompts[1]).toEqual({
			text: "What codeword did I give you?",
			probes: ["codeword"],
		});
	});

	test("a Probe of an undeclared Plant is rejected, naming the step and the Plant", async () => {
		const dir = await workloadDir({
			...WELL_FORMED,
			steps: [{ id: "ask", prompts: [{ text: "Build number?", probes: ["build"] }] }],
		});

		const message = await rejection(dir);

		expect(message).toContain("ask");
		expect(message).toContain("build");
	});

	test("a check that names no step is rejected, naming it", async () => {
		const dir = await workloadDir(WELL_FORMED, ["step-9.check.ts"]);

		expect(await rejection(dir)).toContain("step-9.check.ts");
	});

	test("missing name, version, commit and steps are reported together", async () => {
		const dir = await workloadDir({ plants: [] });

		const message = await rejection(dir);

		for (const field of ["name", "version", "commit", "steps"]) {
			expect(message).toContain(field);
		}
	});

	test("duplicate ids, a step with no prompts and an unresolvable commit are reported together", async () => {
		const dir = await workloadDir({
			...WELL_FORMED,
			commit: "0000000000000000000000000000000000000000",
			steps: [
				{ id: "twice", prompts: ["one"] },
				{ id: "twice", prompts: ["two"] },
				{ id: "hollow", prompts: [] },
			],
		});

		const message = await rejection(dir);

		expect(message).toContain("twice");
		expect(message).toContain("hollow");
		expect(message).toContain("0000000000000000000000000000000000000000");
	});

	test("a workload.json that is not JSON is rejected", async () => {
		const dir = await workloadDir("{ not json");

		expect(await rejection(dir)).toContain("workload.json");
	});
});

describe("gradedSteps", () => {
	test("grades a checked step only once its last prompt is within the Turns sent", async () => {
		const dir = await workloadDir(
			{
				...WELL_FORMED,
				steps: [
					{ id: "first", prompts: ["a", "b"] },
					{ id: "second", prompts: ["c"] },
					{ id: "third", prompts: ["d", "e"] },
				],
			},
			["first.check.ts", "third.check.ts"],
		);
		const workload = await loadWorkload(dir);

		const ids = (turns: number) => gradedSteps(workload, turns).map((step) => step.id);

		expect(ids(1)).toEqual([]);
		expect(ids(2)).toEqual(["first"]);
		expect(ids(4)).toEqual(["first"]);
		expect(ids(5)).toEqual(["first", "third"]);
	});
});

/** Every file under `root`, relative path to contents, skipping `.git/`. */
async function tree(root: string): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	for await (const path of new Bun.Glob("**/*").scan({ cwd: root, dot: true })) {
		if (path.startsWith(".git/")) continue;
		files.set(path, await Bun.file(join(root, path)).text());
	}
	return files;
}

describe("buildWorkspace", () => {
	test("builds the pinned tree with the overlay over it, the same every time", async () => {
		const dir = await workloadDir(WELL_FORMED, ["edit.check.ts"]);
		await mkdir(join(dir, "overlay", "src"), { recursive: true });
		await writeFile(join(dir, "overlay", "src", "tokens.ts"), "export const OVERLAID = true;\n");
		await writeFile(join(dir, "overlay", "NEW.md"), "added by the overlay\n");
		const workload = await loadWorkload(dir);
		const first = await mkdtemp(join(tmpdir(), "pichart-ws-"));
		const second = await mkdtemp(join(tmpdir(), "pichart-ws-"));

		try {
			await buildWorkspace(workload, first);
			await buildWorkspace(workload, second);

			const a = await tree(first);
			const b = await tree(second);
			expect(a).toEqual(b);
			expect(a.get("src/tokens.ts")).toBe("export const OVERLAID = true;\n");
			expect(a.get("NEW.md")).toBe("added by the overlay\n");
			expect(a.has("src/pins.ts")).toBe(true);
			expect([...a.keys()].filter((path) => path.startsWith("bench/") || path.endsWith(".check.ts"))).toEqual([]);
			expect(await Bun.file(join(first, ".git", "HEAD")).exists()).toBe(true);
		} finally {
			await Promise.all([first, second, dir].map((path) => rm(path, { recursive: true, force: true })));
		}
	});
});
