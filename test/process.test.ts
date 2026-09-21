// A real child process, because the claim is about what happens to one:
// that it stops, that nothing is left running, and that what it printed
// before it stopped survives.

import { describe, expect, test } from "bun:test";

import { runProcess } from "../src/process.ts";

/** Whether a process id still exists, without signalling it. */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

describe("running a program", () => {
	test("a command that finishes inside its deadline behaves as it always did", async () => {
		const result = await runProcess("echo", ["still here"], undefined, 10_000);

		expect(result).toEqual({ ok: true, output: "still here" });
	});

	test("a command with no deadline is not bounded", async () => {
		const result = await runProcess("echo", ["unbounded"]);

		expect(result).toEqual({ ok: true, output: "unbounded" });
	});

	test("a failing command still reports its output", async () => {
		const result = await runProcess("sh", ["-c", "echo nope >&2; exit 3"]);

		expect(result.ok).toBe(false);
		expect(result.output).toBe("nope");
	});

	test("a command that outlives its deadline is stopped and says so", async () => {
		const started = Date.now();
		const result = await runProcess(
			"sh",
			["-c", "echo working; sleep 30"],
			undefined,
			200,
		);

		expect(result.ok).toBe(false);
		expect(result.output).toContain("did not finish within 200ms");
		// What it printed before it was stopped is the diagnosis.
		expect(result.output).toContain("working");
		// It returned at the deadline rather than at the command's end.
		expect(Date.now() - started).toBeLessThan(10_000);
	});

	test("a stopped command leaves no process behind", async () => {
		// The child writes its own pid and then `exec`s, so the process the
		// deadline kills is the process that was sleeping — and `runProcess`
		// has awaited its exit by the time it returns, so this asks the
		// process table rather than waiting on a clock.
		const file = `/tmp/cm-process-test-${process.pid}-${Date.now()}`;
		await runProcess(
			"sh",
			["-c", `echo $$ > ${file}; exec sleep 30`],
			undefined,
			200,
		);

		const pid = Number((await Bun.file(file).text()).trim());
		expect(Number.isFinite(pid)).toBe(true);
		expect(alive(pid)).toBe(false);
	});
});
