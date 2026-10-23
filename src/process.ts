/**
 * Running a program, as the Stores that shell out see it.
 *
 * A seam rather than a direct `Bun.spawn` so a test can decide what a
 * command did without installing the tool it names.
 */
export interface RunCommand {
	(
		command: string,
		args: string[],
		cwd?: string,
		timeoutMs?: number,
	): Promise<CommandResult>;
}

export interface CommandResult {
	ok: boolean;
	/** Combined output, for reporting a failure precisely. */
	output: string;
}

/**
 * How long a killed child is given to go quietly before it is killed
 * outright. Long enough for a process that flushes on `SIGTERM`, short
 * enough that nobody waits on it twice.
 */
const GRACE_MS = 2_000;

/**
 * Runs a program and, when a deadline is given, stops it at the deadline.
 *
 * A child that outlives its deadline is terminated, then killed if it is
 * still there, and the call returns what the program had printed so far
 * with the timeout named. Failing loudly with partial output is the
 * diagnosis — "graphify printed this much and stopped" — where a promise
 * nobody settles takes the caller's failure report down with it.
 *
 * The program runs in its own process group, and the deadline signals the
 * group rather than the one process, because stopping a program means
 * stopping what it started. A child that inherited the output pipe is a
 * writer on it, so leaving one alive holds the read open long past the
 * deadline: `pip` compiling, `openspec` with a worker, or a `/bin/sh` that
 * forked rather than exec'd the command it was given. Signalling the group
 * ends both the processes and the wait.
 *
 * The group is its own, so the program no longer receives the terminal's
 * SIGINT through this process. Everything run here is a background step
 * whose failure a session reports, not an interactive one.
 */
export async function runProcess(
	command: string,
	args: string[],
	cwd?: string,
	timeoutMs?: number,
): Promise<CommandResult> {
	const spawned = Bun.spawn([command, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		detached: true,
	});

	/**
	 * Signals the program's whole group. A group that has already gone
	 * throws, which is the ordinary case for the kill that follows a
	 * termination the program honoured: it wanted them gone, and they are.
	 */
	const stop = (signal: "SIGTERM" | "SIGKILL") => {
		try {
			process.kill(-spawned.pid, signal);
		} catch {}
	};

	let timedOut = false;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	let hardStop: ReturnType<typeof setTimeout> | undefined;
	if (timeoutMs !== undefined && timeoutMs > 0) {
		deadline = setTimeout(() => {
			timedOut = true;
			stop("SIGTERM");
			hardStop = setTimeout(() => stop("SIGKILL"), GRACE_MS);
			hardStop.unref?.();
		}, timeoutMs);
		deadline.unref?.();
	}

	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(spawned.stdout).text(),
			new Response(spawned.stderr).text(),
			spawned.exited,
		]);
		const output = `${stdout}${stderr}`.trim();
		if (timedOut) {
			return {
				ok: false,
				output: `${command} did not finish within ${timeoutMs}ms and was stopped${
					output ? `; it had printed: ${output}` : ""
				}`,
			};
		}
		return { ok: code === 0, output };
	} finally {
		clearTimeout(deadline);
		clearTimeout(hardStop);
	}
}
