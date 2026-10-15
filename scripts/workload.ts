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

/**
 * What a Plant's value is: the answer (`literal`), the answer replacing an
 * earlier value the Workload stated first (`superseded`), or what the agent
 * must later put into its own actions (`constraint`).
 */
export type PlantKind = "literal" | "superseded" | "constraint";
const KINDS: readonly string[] = ["literal", "superseded", "constraint"] satisfies PlantKind[];

/**
 * A fact the Workload states once and asks for back later. Placed in the
 * prompt holding its value, or, with `file`, in the tool result of reading
 * that file. Where it is stated is found from the prompts, not declared.
 */
export interface Plant {
	id: string;
	/** `workload.json` may omit it: a Plant without one is a literal. */
	kind: PlantKind;
	value: string;
	/** Superseded only: the value it replaces. */
	earlier?: string;
	/** Path under `overlay/` holding `value`. */
	file?: string;
	/** Superseded and `file` only: path under `overlay/` holding `earlier`. */
	earlierFile?: string;
}

/** One Turn's prompt, the Plants it asks for back if it is a Probe, and whether it forbids tools. */
export interface Prompt {
	text: string;
	probes: string[];
	/** Present only on a prompt that forbids tools; its text must say so too. */
	tools?: false;
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
	// Plants whose declaration is wrong: where they sit is not checked, as it would mean nothing.
	const flawed = new Set<string>();
	if (spec.plants !== undefined && !Array.isArray(spec.plants)) problems.push("plants is not a list");
	for (const [at, plant] of ((spec.plants ?? []) as unknown[]).entries()) {
		const { id, value, kind = "literal", earlier, file, earlierFile } = (plant ?? {}) as Record<string, unknown>;
		if (typeof id !== "string" || id === "" || typeof value !== "string" || value === "") {
			problems.push(`plant ${at} needs a string id and value`);
			continue;
		}
		if (plants.some((known) => known.id === id)) problems.push(`plant ${id} is declared twice`);
		const fault = (problem: string) => {
			problems.push(`plant ${id} ${problem}`);
			flawed.add(id);
		};
		const parsed: Plant = { id, kind: kind as PlantKind, value };
		if (typeof kind !== "string" || !KINDS.includes(kind)) {
			fault(`has kind ${JSON.stringify(kind)}, not literal, superseded or constraint`);
		}
		for (const [field, given] of [
			["earlier", earlier],
			["file", file],
			["earlierFile", earlierFile],
		] as const) {
			if (given === undefined) continue;
			if (typeof given !== "string" || given === "") fault(`has a ${field} that is not a non-empty string`);
			else parsed[field] = given;
		}
		if (kind === "superseded") {
			if (earlier === undefined) fault("is superseded but declares no earlier value");
			else if (earlier === value) fault("declares an earlier value equal to its value");
			if (file !== undefined && earlierFile === undefined) {
				fault("is superseded and placed in a file but declares no earlierFile holding its earlier value");
			}
		} else if (earlier !== undefined) {
			fault(`declares an earlier value but is ${String(kind)}, not superseded`);
		}
		if (earlierFile !== undefined && (kind !== "superseded" || file === undefined)) {
			fault("declares an earlierFile but is not a superseded Plant placed in a file");
		}
		plants.push(parsed);
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
				const { text, probes, tools } = (prompt ?? {}) as Record<string, unknown>;
				if (
					typeof text !== "string" ||
					!Array.isArray(probes) ||
					probes.some((p) => typeof p !== "string") ||
					(tools !== undefined && tools !== false)
				) {
					problems.push(`step ${id} prompt ${index} is neither text nor { text, probes, tools?: false }`);
					continue;
				}
				for (const probe of probes as string[]) {
					if (!plants.some((plant) => plant.id === probe)) {
						problems.push(`step ${id} probes plant ${probe}, which the Workload does not declare`);
					}
				}
				parsed.push({ text, probes: probes as string[], ...(tools === false ? { tools } : {}) });
			}
			steps.push({ id, prompts: parsed });
		}
	}

	problems.push(...(await plantProblems(dir, plants, flawed, steps)));

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

/**
 * Everything wrong with where the Plants sit. Scoring is a substring test,
 * so no value may contain another, and each Plant must enter the
 * Conversation once, at a Turn found from the prompts, before any Probe of it.
 */
async function plantProblems(dir: string, plants: Plant[], flawed: Set<string>, steps: Step[]): Promise<string[]> {
	const problems: string[] = [];
	const prompts = steps.flatMap((step) => step.prompts.map((prompt, index) => ({ ...prompt, step: step.id, index })));
	const label = (at: number) => `step ${prompts[at]?.step} prompt ${prompts[at]?.index}`;
	const holding = (value: string) => prompts.flatMap((prompt, at) => (prompt.text.includes(value) ? [at] : []));
	const named = (path: string) => prompts.findIndex((prompt) => prompt.text.includes(path));

	const values = plants.flatMap((plant) => [
		{ id: plant.id, what: "value", text: plant.value },
		...(plant.earlier === undefined ? [] : [{ id: plant.id, what: "earlier value", text: plant.earlier }]),
	]);
	for (const [at, a] of values.entries()) {
		for (const b of values.slice(at + 1)) {
			// A Plant whose earlier value equals its value is already reported.
			if (a.id === b.id && a.text === b.text) continue;
			if (!a.text.includes(b.text) && !b.text.includes(a.text)) continue;
			problems.push(
				a.id === b.id
					? `plant ${a.id}'s value and earlier value overlap: one contains the other`
					: `plants ${a.id} and ${b.id} overlap: ${a.id}'s ${a.what} "${a.text}" and ${b.id}'s ${b.what} "${b.text}"`,
			);
		}
	}

	for (const plant of plants) {
		const probes = prompts.flatMap((prompt, at) => (prompt.probes.includes(plant.id) ? [at] : []));
		if (plant.kind === "constraint") {
			for (const at of probes.filter((at) => prompts[at]?.tools === false)) {
				problems.push(`step ${prompts[at]?.step} forbids tools but probes constraint plant ${plant.id}`);
			}
		}
		if (flawed.has(plant.id)) continue;

		if (plant.file === undefined) {
			const held = holding(plant.value);
			if (held.length === 0) problems.push(`plant ${plant.id}'s value is in no prompt`);
			if (held.length > 1) {
				problems.push(`plant ${plant.id}'s value is in more than one prompt: ${held.map(label).join(", ")}`);
			}
			const stated = held.length === 1 ? (held[0] as number) : undefined;
			if (stated === undefined) continue;
			if (plant.earlier !== undefined) {
				const earlier = holding(plant.earlier);
				if (!earlier.some((at) => at < stated)) {
					problems.push(`plant ${plant.id}'s earlier value is in no prompt before the one holding its value`);
				}
				const after = earlier.filter((at) => at > stated);
				if (after.length > 0) {
					problems.push(
						`plant ${plant.id}'s earlier value is in a prompt after the one holding its value: ${after.map(label).join(", ")}`,
					);
				}
			}
			for (const at of probes.filter((at) => at <= stated)) {
				problems.push(`step ${prompts[at]?.step} probes plant ${plant.id} at or before the prompt that states it`);
			}
			continue;
		}

		const files: [string, string, string][] = [[plant.file, "value", plant.value]];
		if (plant.earlierFile !== undefined && plant.earlier !== undefined) {
			files.push([plant.earlierFile, "earlier value", plant.earlier]);
		}
		for (const [file, what, value] of files) {
			const held = holding(value);
			if (held.length > 0) {
				problems.push(`plant ${plant.id} is placed in ${file} but its ${what} is in a prompt: ${held.map(label).join(", ")}`);
			}
			const text = await readFile(join(dir, "overlay", file), "utf8").catch(() => undefined);
			if (text === undefined) problems.push(`plant ${plant.id}'s file ${file} is missing from overlay/`);
			else if (!text.includes(value)) problems.push(`plant ${plant.id}'s file ${file} does not hold its ${what}`);
		}
		const stated = named(plant.file);
		const first = probes[0];
		if (first !== undefined && (stated === -1 || stated >= first)) {
			problems.push(`plant ${plant.id}'s file ${plant.file} is named by no prompt before its first Probe`);
		}
		if (plant.earlierFile !== undefined && stated !== -1) {
			const earlier = named(plant.earlierFile);
			if (earlier === -1 || earlier >= stated) {
				problems.push(
					`plant ${plant.id}'s earlier file ${plant.earlierFile} is named by no prompt before the first naming ${plant.file}`,
				);
			}
		}
	}
	return problems;
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
