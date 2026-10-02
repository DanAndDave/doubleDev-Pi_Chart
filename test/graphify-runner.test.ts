// The runner as a real process, against a fake graphify: a shell script whose
// behaviour each test decides. The claims are about what the kernel enforces
// (one run per Codebase, a lock that outlives a killed runner, a process
// group that is gone at the deadline), so nothing here is simulated.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RUNNER = join(import.meta.dir, "../src/graphify-runner.py");

/**
 * Whether a process id still exists, without signalling it. An orphan whose
 * reaper has not collected it yet is a zombie: it holds no files and runs
 * nothing, so on Linux it counts as gone.
 */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
	} catch {
		return false;
	}
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		// The state letter follows the command name, which is in parentheses.
		return stat[stat.lastIndexOf(")") + 2] !== "Z";
	} catch {
		return true;
	}
}

/**
 * Wait for a condition, failing at a deadline rather than hanging. The
 * conditions are other processes' files and lifetimes, which no fake clock
 * can advance, so this polls.
 */
async function until(condition: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!(await condition())) {
		if (Date.now() > deadline) throw new Error("condition not met before the deadline");
		await Bun.sleep(20);
	}
}

interface Scene {
	dir: string;
	codebase: string;
	state: string;
	graphify: string;
	/** A file the fake can wait for, so a run lasts as long as the test wants. */
	go: string;
	/** One line per graphify invocation: each argument bracketed, then its directory. */
	calls: string;
}

const dirs: string[] = [];

afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A Codebase, a state dir, and a fake graphify running `body` after recording its call. */
async function scene(body: string): Promise<Scene> {
	const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-chart-runner-")));
	dirs.push(dir);
	// A space in the path: an invocation built as one string would split here.
	const codebase = join(dir, "the codebase");
	await Bun.$`mkdir -p ${codebase}`.quiet();
	const s: Scene = {
		dir,
		codebase,
		state: join(dir, "state"),
		graphify: join(dir, "graphify"),
		go: join(dir, "go"),
		calls: join(dir, "calls"),
	};
	await writeFile(
		s.graphify,
		[
			"#!/bin/sh",
			`printf '[%s]' "$@" >> '${s.calls}'`,
			`echo " @ $(pwd -P)" >> '${s.calls}'`,
			body.replaceAll("$GO", `'${s.go}'`).replaceAll("$DIR", `'${dir}'`),
			"",
		].join("\n"),
	);
	await chmod(s.graphify, 0o755);
	return s;
}

const WAIT_FOR_GO = 'while [ ! -e $GO ]; do sleep 0.02; done';

async function request(s: Scene): Promise<void> {
	await Bun.$`mkdir -p ${s.state}`.quiet();
	await writeFile(join(s.state, "requested"), "");
}

function runner(s: Scene, deadlineMs = 0, env: Record<string, string | undefined> = process.env) {
	return Bun.spawn(
		[
			"python3",
			RUNNER,
			"run",
			s.state,
			"--codebase",
			s.codebase,
			"--graphify",
			s.graphify,
			"--deadline-ms",
			String(deadlineMs),
		],
		{ stdout: "inherit", stderr: "inherit", env },
	);
}

async function status(s: Scene): Promise<{ running: { runId: string | null; since: number } | null; last: Record<string, unknown> | null }> {
	const child = Bun.spawn(["python3", RUNNER, "status", s.state], { stdout: "pipe", stderr: "inherit" });
	const text = await new Response(child.stdout).text();
	expect(await child.exited).toBe(0);
	return JSON.parse(text);
}

async function calls(s: Scene): Promise<string[]> {
	if (!existsSync(s.calls)) return [];
	return (await readFile(s.calls, "utf8")).split("\n").filter(Boolean);
}

async function outcome(s: Scene): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(join(s.state, "outcome.json"), "utf8"));
}

describe("the graphify runner", () => {
	test("graphify is invoked as `extract <codebase> --code-only` from inside the codebase, exactly once for two runners started together", async () => {
		const s = await scene("sleep 0.3");
		await request(s);

		const first = runner(s);
		const second = runner(s);
		expect(await first.exited).toBe(0);
		expect(await second.exited).toBe(0);

		expect(await calls(s)).toEqual([`[extract][${s.codebase}][--code-only] @ ${s.codebase}`]);
	});

	test("a request made during a run gives exactly one follow-up run", async () => {
		const s = await scene(WAIT_FOR_GO);
		await request(s);
		const holder = runner(s);
		await until(async () => (await calls(s)).length === 1);

		// What `refresh` does: record the request, then launch a runner.
		await request(s);
		expect(await runner(s).exited).toBe(0);
		await writeFile(s.go, "");

		expect(await holder.exited).toBe(0);
		expect(await calls(s)).toHaveLength(2);
	});

	test("three requests made during one run still give exactly one follow-up run", async () => {
		const s = await scene(WAIT_FOR_GO);
		await request(s);
		const holder = runner(s);
		await until(async () => (await calls(s)).length === 1);

		for (let i = 0; i < 3; i++) {
			await request(s);
			expect(await runner(s).exited).toBe(0);
		}
		await writeFile(s.go, "");

		expect(await holder.exited).toBe(0);
		expect(await calls(s)).toHaveLength(2);
	});

	test("a runner killed mid-run keeps the codebase locked until its graphify exits, then blocks nothing", async () => {
		const s = await scene(`echo $$ > $DIR/pid\n${WAIT_FOR_GO}`);
		await request(s);
		const killed = runner(s);
		await until(() => existsSync(join(s.dir, "pid")));
		const graphifyPid = Number((await readFile(join(s.dir, "pid"), "utf8")).trim());

		killed.kill("SIGKILL");
		await killed.exited;
		// Its graphify still holds the lock, so a second run cannot start
		// underneath it; the request waits.
		await request(s);
		expect(await runner(s).exited).toBe(0);
		expect(await calls(s)).toHaveLength(1);

		await writeFile(s.go, "");
		await until(() => !alive(graphifyPid));

		expect(await runner(s).exited).toBe(0);
		expect(await calls(s)).toHaveLength(2);
	});

	test("at the deadline graphify and its children are stopped and the outcome says so", async () => {
		const s = await scene(
			"sleep 30 &\necho $! > $DIR/child\necho $$ > $DIR/pid\necho working\nsleep 30",
		);
		await request(s);
		const started = Date.now();

		expect(await runner(s, 1000).exited).toBe(0);

		expect(Date.now() - started).toBeLessThan(10_000);
		const pid = Number((await readFile(join(s.dir, "pid"), "utf8")).trim());
		const child = Number((await readFile(join(s.dir, "child"), "utf8")).trim());
		expect(alive(pid)).toBe(false);
		// The orphaned child is reaped by whoever adopted it, not the runner.
		await until(() => !alive(child), 5_000);
		const result = await outcome(s);
		expect(result.stopped).toBe("deadline");
		expect(result.deadlineMs).toBe(1000);
		// What it printed before it was stopped is the diagnosis.
		expect(result.output).toContain("working");
		expect(result.exitCode).toBeLessThan(0);
	}, 20_000);

	test("GRAPHIFY_MAX_GRAPH_BYTES in the runner's environment reaches graphify", async () => {
		const s = await scene('echo "cap=$GRAPHIFY_MAX_GRAPH_BYTES" > $DIR/env');
		await request(s);

		expect(await runner(s, 0, { ...process.env, GRAPHIFY_MAX_GRAPH_BYTES: "12345" }).exited).toBe(0);

		expect((await readFile(join(s.dir, "env"), "utf8")).trim()).toBe("cap=12345");
	});

	test("status reports a run in progress and since when, then the outcome once it ends", async () => {
		const s = await scene(`${WAIT_FOR_GO}\necho broken\nexit 3`);
		await request(s);
		const before = Date.now();
		const holder = runner(s);
		await until(async () => (await calls(s)).length === 1);

		const during = await status(s);
		const current = JSON.parse(await readFile(join(s.state, "current.json"), "utf8"));
		expect(during.running).toEqual({ runId: current.runId, since: current.startedAt });
		expect(during.running?.since).toBeGreaterThanOrEqual(before);
		expect(during.running?.since).toBeLessThanOrEqual(Date.now());
		expect(during.last).toBeNull();

		await writeFile(s.go, "");
		await holder.exited;

		const after = await status(s);
		expect(after.running).toBeNull();
		expect(after.last).toEqual(await outcome(s));
		expect(after.last?.exitCode).toBe(3);
	});

	test("status of a codebase never extracted reports nothing and creates nothing", async () => {
		const s = await scene("");

		expect(await status(s)).toEqual({ running: null, last: null });
		expect(existsSync(s.state)).toBe(false);
	});

	test("a failed run records its exit code and output tail, and clears claims on older outcomes only", async () => {
		const s = await scene(
			"head -c 10000 /dev/zero | tr '\\0' a\necho\necho the actual error\nexit 4",
		);
		await request(s);
		await writeFile(join(s.state, "reported.0123456789ab"), "");

		expect(await runner(s).exited).toBe(0);

		const result = await outcome(s);
		expect(result.exitCode).toBe(4);
		expect(result.stopped).toBeUndefined();
		expect(result.output).toEndWith("the actual error\n");
		expect((result.output as string).length).toBe(4096);
		expect(result.endedAt as number).toBeGreaterThanOrEqual(result.startedAt as number);
		// The old claim is stale; the new failure is unclaimed so a session reports it.
		const left = readdirSync(s.state);
		expect(left.filter((name) => name.startsWith("reported."))).toEqual([]);
		expect(left).not.toContain("current.json");
	});

	test("a graphify that cannot be launched is recorded as exit 127 with the reason", async () => {
		const s = await scene("");
		await rm(s.graphify);
		await request(s);

		expect(await runner(s).exited).toBe(0);

		const result = await outcome(s);
		expect(result.exitCode).toBe(127);
		expect(result.output).toContain(s.graphify);
		expect(existsSync(join(s.state, "requested"))).toBe(false);
	});
});
