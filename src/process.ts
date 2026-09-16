/**
 * Running a program, as the Stores that shell out see it.
 *
 * A seam rather than a direct `Bun.spawn` so a test can decide what a
 * command did without installing the tool it names.
 */
export interface RunCommand {
	(command: string, args: string[], cwd?: string): Promise<CommandResult>;
}

export interface CommandResult {
	ok: boolean;
	/** Combined output, for reporting a failure precisely. */
	output: string;
}

export async function runProcess(
	command: string,
	args: string[],
	cwd?: string,
): Promise<CommandResult> {
	const spawned = Bun.spawn([command, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(spawned.stdout).text(),
		new Response(spawned.stderr).text(),
		spawned.exited,
	]);
	return { ok: code === 0, output: `${stdout}${stderr}`.trim() };
}
