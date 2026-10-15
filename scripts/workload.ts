/**
 * A Workload: the frozen input a benchmark runs. A folder holding
 * `workload.json` (name, version, pinned commit, Plants and steps), and
 * optionally `overlay/`, `checks/<step-id>.check.ts`, `bundle/` and
 * `graphify-out/`. A step is graded when, and only when, it has a check.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

/** This repository: Workloads pin commits of it. */
export const REPO = resolve(import.meta.dir, "..");
export const WORKLOADS = join(REPO, "bench", "workloads");

const CHECK_SUFFIX = ".check.ts";

/** A fact the Workload states once and asks for back later. */
export interface Plant {
	id: string;
	value: string;
}

/** One Turn's prompt, and the Plants it asks for back, if it is a Probe. */
export interface Prompt {
	text: string;
	probes: string[];
}

export interface Step {
	id: string;
	prompts: Prompt[];
	/** Absolute path of the step's check; present only on a Graded Task. */
	check?: string;
}

export interface Workload {
	/** The folder the Workload was loaded from. */
	dir: string;
	name: string;
	version: number;
	/** The full sha the workspace is built from. */
	commit: string;
	plants: Plant[];
	steps: Step[];
}

/** What names a Workload in a record: enough to rebuild the same workspace. */
export type WorkloadId = Pick<Workload, "name" | "version" | "commit">;

/** A prompt in Turn order, with the step it belongs to. */
export interface Turn extends Prompt {
	turn: number;
	step: string;
}

/**
 * Reads and validates the Workload in `dir`. Throws one Error listing every
 * problem found, so a broken Workload is fixed in one pass.
 */
export async function loadWorkload(dir: string): Promise<Workload> {
	const file = join(dir, "workload.json");
	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		throw new Error(`${file}: ${(error as Error).message}`);
	}

	const problems: string[] = [];
	const spec = (raw ?? {}) as Record<string, unknown>;

	const name = spec.name;
	if (typeof name !== "string" || name === "") problems.push("name is missing");
	const version = spec.version;
	if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
		problems.push("version is missing or not a positive integer");
	}

	let commit: string | undefined;
	if (typeof spec.commit !== "string" || spec.commit === "") {
		problems.push("commit is missing");
	} else {
		commit = await resolveCommit(spec.commit);
		if (commit === undefined) problems.push(`commit ${spec.commit} does not resolve in ${REPO}`);
	}

	const plants: Plant[] = [];
	if (spec.plants !== undefined && !Array.isArray(spec.plants)) problems.push("plants is not a list");
	for (const [at, plant] of ((spec.plants ?? []) as unknown[]).entries()) {
		const { id, value } = (plant ?? {}) as Record<string, unknown>;
		if (typeof id !== "string" || id === "" || typeof value !== "string" || value === "") {
			problems.push(`plant ${at} needs a string id and value`);
			continue;
		}
		if (plants.some((known) => known.id === id)) problems.push(`plant ${id} is declared twice`);
		plants.push({ id, value });
	}

	const steps: Step[] = [];
	if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
		problems.push("steps is missing or empty");
	} else {
		for (const [at, step] of (spec.steps as unknown[]).entries()) {
			const { id, prompts } = (step ?? {}) as Record<string, unknown>;
			if (typeof id !== "string" || id === "") {
				problems.push(`step ${at} has no id`);
				continue;
			}
			if (steps.some((known) => known.id === id)) problems.push(`step ${id} is declared twice`);
			if (!Array.isArray(prompts) || prompts.length === 0) {
				problems.push(`step ${id} has no prompts`);
				continue;
			}
			const parsed: Prompt[] = [];
			for (const [index, prompt] of prompts.entries()) {
				if (typeof prompt === "string") {
					parsed.push({ text: prompt, probes: [] });
					continue;
				}
				const { text, probes } = (prompt ?? {}) as Record<string, unknown>;
				if (typeof text !== "string" || !Array.isArray(probes) || probes.some((p) => typeof p !== "string")) {
					problems.push(`step ${id} prompt ${index} is neither text nor { text, probes }`);
					continue;
				}
				for (const probe of probes as string[]) {
					if (!plants.some((plant) => plant.id === probe)) {
						problems.push(`step ${id} probes plant ${probe}, which the Workload does not declare`);
					}
				}
				parsed.push({ text, probes: probes as string[] });
			}
			steps.push({ id, prompts: parsed });
		}
	}

	const checksDir = join(dir, "checks");
	for (const entry of await readdir(checksDir).catch(() => [] as string[])) {
		const step = entry.endsWith(CHECK_SUFFIX) ? steps.find((s) => `${s.id}${CHECK_SUFFIX}` === entry) : undefined;
		if (step === undefined) {
			problems.push(`checks/${entry} names no step`);
			continue;
		}
		step.check = join(checksDir, entry);
	}

	if (problems.length > 0) {
		throw new Error(`Workload ${dir} is malformed:\n- ${problems.join("\n- ")}`);
	}
	return {
		dir,
		name: name as string,
		version: version as number,
		commit: commit as string,
		plants,
		steps,
	};
}

async function resolveCommit(commit: string): Promise<string | undefined> {
	const proc = Bun.spawn(["git", "-C", REPO, "rev-parse", "--verify", "--quiet", `${commit}^{commit}`], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	return code === 0 ? out.trim() : undefined;
}

/** Every prompt in Turn order: a Turn's index is its position here. */
export function turnsOf(workload: Workload): Turn[] {
	return workload.steps.flatMap((step) => step.prompts.map((prompt) => ({ ...prompt, step: step.id }))).map(
		(prompt, turn) => ({ ...prompt, turn }),
	);
}

/**
 * The Graded Tasks a benchmark of the first `turns` prompts checks: steps
 * with a check whose last prompt falls within those Turns.
 */
export function gradedSteps(workload: Workload, turns: number): Step[] {
	const graded: Step[] = [];
	let end = 0;
	for (const step of workload.steps) {
		end += step.prompts.length;
		if (step.check !== undefined && end <= turns) graded.push(step);
	}
	return graded;
}

/** The step whose last prompt is Turn `turn`, if any. */
export function stepEndingAt(workload: Workload, turn: number): Step | undefined {
	let end = -1;
	for (const step of workload.steps) {
		end += step.prompts.length;
		if (end === turn) return step;
	}
	return undefined;
}

/**
 * Builds a Run's workspace in the empty folder `dir`: the tracked files of
 * the Workload's commit except `bench/`, the overlay copied over them, the
 * frozen `graphify-out/` at the root (pi-chart reads it there and, with
 * `PICHART_GRAPH` unset, never extracts again), then a fresh git repository.
 * Checks never enter it: they live outside `overlay/`.
 */
export async function buildWorkspace(workload: Workload, dir: string): Promise<void> {
	const archive = Bun.spawn(["git", "-C", REPO, "archive", workload.commit, "--", ".", ":(exclude)bench"], {
		stdout: "pipe",
	});
	const extract = Bun.spawn(["tar", "-x", "-C", dir], { stdin: archive.stdout });
	if ((await archive.exited) !== 0 || (await extract.exited) !== 0) {
		throw new Error(`could not extract ${workload.commit} into ${dir}`);
	}
	const overlay = join(workload.dir, "overlay");
	if (await isDirectory(overlay)) await run(["cp", "-a", `${overlay}/.`, `${dir}/`]);
	const graph = join(workload.dir, "graphify-out");
	if (await isDirectory(graph)) await run(["cp", "-a", graph, join(dir, "graphify-out")]);
	await run(["git", "init", "-q"], dir);
}

/** Installs the workspace's dependencies from its own lockfile. */
export async function installDependencies(dir: string): Promise<void> {
	await run(["bun", "install", "--frozen-lockfile"], dir);
}

async function isDirectory(path: string): Promise<boolean> {
	return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

/** Runs a program to completion; its stdout, or an Error with the tail of its output. */
export async function run(args: string[], cwd?: string): Promise<string> {
	const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) throw new Error(`${args.join(" ")} exited ${code}:\n${(out + err).slice(-2000)}`);
	return out;
}
