import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildWorkspace, gradedSteps, loadWorkload } from "../scripts/workload.ts";

/** A commit of this repository, so a Workload pinned to it resolves. */
const PINNED = "c6fe51651936bdcb29d9dd5dc3d46609ad02c359";

async function workloadDir(
	spec: unknown,
	checks: string[] = [],
	overlay: Record<string, string> = {},
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
	for (const [path, text] of Object.entries(overlay)) {
		await mkdir(dirname(join(dir, "overlay", path)), { recursive: true });
		await writeFile(join(dir, "overlay", path), text);
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

	test("a Plant with no kind loads as a literal", async () => {
		const workload = await loadWorkload(await workloadDir(WELL_FORMED));

		expect(workload.plants).toEqual([{ id: "codeword", kind: "literal", value: "PLUM-17" }]);
	});

	test("every kind and placement loads, and a Probe that forbids tools keeps saying so", async () => {
		const dir = await workloadDir(
			{
				...WELL_FORMED,
				plants: [
					{ id: "codeword", value: "PLUM-17" },
					{ id: "port", kind: "superseded", earlier: "PORT-3304", value: "PORT-8817" },
					{ id: "owner", kind: "constraint", value: "owner: QUILL-9", file: "notes/rule.md" },
				],
				steps: [
					{
						id: "setup",
						prompts: [
							"Remember PLUM-17. The port is PORT-3304.",
							"Read notes/rule.md and follow it.",
							"The port is now PORT-8817.",
						],
					},
					{
						id: "ask",
						prompts: [
							{ text: "Codeword and port? Do not use any tools.", probes: ["codeword", "port"], tools: false },
							{ text: "Add src/x.ts.", probes: ["owner"] },
						],
					},
				],
			},
			[],
			{ "notes/rule.md": "Every new file starts with owner: QUILL-9.\n" },
		);

		const workload = await loadWorkload(dir);

		expect(workload.plants).toEqual([
			{ id: "codeword", kind: "literal", value: "PLUM-17" },
			{ id: "port", kind: "superseded", value: "PORT-8817", earlier: "PORT-3304" },
			{ id: "owner", kind: "constraint", value: "owner: QUILL-9", file: "notes/rule.md" },
		]);
		expect(workload.steps[1]?.prompts).toEqual([
			{ text: "Codeword and port? Do not use any tools.", probes: ["codeword", "port"], tools: false },
			{ text: "Add src/x.ts.", probes: ["owner"] },
		]);
	});

	test("every problem with the Plant matrix is named in one rejection", async () => {
		const dir = await workloadDir(
			{
				...WELL_FORMED,
				plants: [
					{ id: "oddkind", kind: "fuzzy", value: "ODD-A" },
					{ id: "noearlier", kind: "superseded", value: "BARE-B" },
					{ id: "equalearlier", kind: "superseded", value: "EQUAL-C", earlier: "EQUAL-C" },
					{ id: "literalearlier", value: "PLAIN-D", earlier: "PLAIN-OLD" },
					{ id: "num4", value: "7341" },
					{ id: "num5", value: "73412" },
					{ id: "twice", value: "TWICE-E" },
					{ id: "nowhere", value: "NOWHERE-F" },
					{ id: "late", kind: "superseded", earlier: "LATE-OLD", value: "LATE-NEW" },
					{ id: "spoken", value: "SPOKEN-G", file: "notes/spoken.md" },
					{ id: "absent", value: "ABSENT-H", file: "notes/absent.md" },
					{ id: "lacking", value: "LACKING-I", file: "notes/lacking.md" },
					{ id: "unnamed", value: "UNNAMED-J", file: "notes/unnamed.md" },
					{
						id: "swapped",
						kind: "superseded",
						value: "SWAP-NEW",
						earlier: "SWAP-OLD",
						file: "notes/new.md",
						earlierFile: "notes/old.md",
					},
					{ id: "early", value: "EARLY-K" },
					{ id: "rule", kind: "constraint", value: "RULE-L" },
				],
				steps: [
					{
						id: "setup",
						prompts: [
							"Remember TWICE-E and 73412. Read notes/spoken.md, notes/absent.md, notes/lacking.md and notes/new.md. RULE-L applies. ODD-A BARE-B EQUAL-C PLAIN-D.",
							"It is LATE-NEW. SPOKEN-G.",
							"Before, it was LATE-OLD. See notes/old.md.",
						],
					},
					{
						id: "ask",
						prompts: [
							{
								text: "Tell me everything, TWICE-E too. Do not use any tools.",
								probes: ["twice", "late", "spoken", "absent", "lacking", "unnamed", "swapped", "early", "rule"],
								tools: false,
							},
							"EARLY-K is the last code.",
						],
					},
				],
			},
			[],
			{
				"notes/spoken.md": "SPOKEN-G\n",
				"notes/lacking.md": "nothing here\n",
				"notes/unnamed.md": "UNNAMED-J\n",
				"notes/new.md": "SWAP-NEW\n",
				"notes/old.md": "SWAP-OLD\n",
			},
		);

		const lines = (await rejection(dir)).split("\n");
		const named = (...fragments: string[]) =>
			lines.some((line) => fragments.every((fragment) => line.includes(fragment)));

		const expected = [
			["oddkind", "fuzzy"],
			["noearlier", "earlier"],
			["equalearlier", "earlier"],
			["literalearlier", "earlier"],
			["num4", "num5"],
			["twice", "more than one prompt"],
			["nowhere", "no prompt"],
			["late", "earlier", "after"],
			["spoken", "notes/spoken.md", "prompt"],
			["absent", "notes/absent.md", "missing"],
			["lacking", "notes/lacking.md", "hold"],
			["unnamed", "notes/unnamed.md"],
			["swapped", "notes/old.md"],
			["ask", "early", "states"],
			["ask", "rule", "tools"],
		];
		expect(expected.filter((fragments) => !named(...fragments))).toEqual([]);
	});
});

describe("gradedSteps", () => {
	test("grades a checked step only once its last prompt is within the Turns sent", async () => {
		const dir = await workloadDir(
			{
				...WELL_FORMED,
				plants: [],
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
