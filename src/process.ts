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
	});

	let timedOut = false;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	let hardStop: ReturnType<typeof setTimeout> | undefined;
	if (timeoutMs !== undefined && timeoutMs > 0) {
		deadline = setTimeout(() => {
			timedOut = true;
			spawned.kill("SIGTERM");
			hardStop = setTimeout(() => spawned.kill("SIGKILL"), GRACE_MS);
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
