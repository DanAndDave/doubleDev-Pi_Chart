import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the embedding worker's Bun comes from.
 *
 * The worker runs out of process because the harness's bundled runtime
 * cannot load the model's native dependencies. That left `CM_BUN` as a
 * setting every user had to get right, and getting it wrong failed in the
 * least helpful way available: recall and curated knowledge went quiet
 * while everything else carried on.
 *
 * So it is found rather than configured. `CM_BUN` still wins when set.
 */

/** Places a Bun ends up, in the order worth trying. */
function candidates(
	env: Record<string, string | undefined>,
	running: string,
): string[] {
	const home = env.HOME ?? homedir();
	const found: string[] = [];

	const configured = env.CM_BUN?.trim();
	if (configured) found.push(configured);

	// The process running us, when that is already a Bun: the cheapest
	// certain answer there is.
	if (running.endsWith("/bun") || running.endsWith("\\bun.exe")) {
		found.push(running);
	}

	found.push(join(home, ".bun", "bin", "bun"));
	// A version manager's own install, rather than its shim: a shim
	// resolves through the manager and fails outside a directory it knows.
	found.push(join(home, ".local", "share", "mise", "installs", "bun"));
	found.push(join(home, ".asdf", "installs", "bun"));
	found.push("/usr/local/bin/bun");
	found.push("/opt/homebrew/bin/bun");
	// Last, because a `bun` on PATH is often a shim.
	found.push("bun");

	return found;
}

/** Whether this path runs as Bun. The only test that means anything. */
async function runs(
	path: string,
	env: Record<string, string | undefined>,
): Promise<boolean> {
	try {
		const spawned = Bun.spawn([path, "--version"], {
			stdout: "pipe",
			stderr: "pipe",
			// The given environment, so a bare `bun` resolves against the
			// PATH the caller meant rather than the process's own.
			env: env as Record<string, string>,
		});
		const [out, code] = await Promise.all([
			new Response(spawned.stdout).text(),
			spawned.exited,
		]);
		return code === 0 && /^\d+\.\d+/.test(out.trim());
	} catch {
		return false;
	}
}

/** Whether a path is a directory, and so a version manager's install root. */
async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/** Version directories under a version manager's install root, newest first. */
async function versioned(root: string): Promise<string[]> {
	if (!(await isDirectory(root))) return [];
	const versions: string[] = [];
	for await (const entry of new Bun.Glob("*/bin/bun").scan({
		cwd: root,
		absolute: true,
		onlyFiles: false,
	})) {
		versions.push(entry);
	}
	// Numerically, per component: lexicographic order puts 1.9.0 above
	// 1.10.0, which would pin a machine to an older Bun than it has.
	return versions.sort((a, b) => compareVersions(versionOf(b), versionOf(a)));
}

/** The version directory in `<root>/<version>/bin/bun`. */
function versionOf(path: string): string {
	return path.split("/").at(-3) ?? "";
}

function compareVersions(a: string, b: string): number {
	const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

/**
 * A Bun that actually runs, or `undefined` when the machine has none.
 *
 * Resolved once per process: the answer cannot change under us, and every
 * embedding batch would otherwise pay for the search.
 */
let resolved: Promise<string | undefined> | undefined;

export function findBun(
	env: Record<string, string | undefined> = process.env,
	/** The running process. A seam: a machine with no Bun is otherwise
	 * unreachable from a test, since the tests run under one. */
	running: string = process.execPath,
): Promise<string | undefined> {
	// Only a success is remembered. A coding session outlives an install,
	// and the error tells the user to install Bun — advice that would
	// otherwise do nothing until they restarted.
	resolved ??= search(env, running).then((found) => {
		if (found === undefined) resolved = undefined;
		return found;
	});
	return resolved;
}

async function search(
	env: Record<string, string | undefined>,
	running: string,
): Promise<string | undefined> {
	for (const candidate of candidates(env, running)) {
		// A directory is an install root to search; anything else is a Bun
		// to try. Deciding by what the path spells rather than what it is
		// discarded a configured `CM_BUN` that happened to live under a
		// version manager — which is most of them.
		if (await isDirectory(candidate)) {
			for (const version of await versioned(candidate)) {
				if (await runs(version, env)) return version;
			}
			continue;
		}
		if (await runs(candidate, env)) return candidate;
	}
	return undefined;
}

/** Forgets the resolved runtime. For tests, which vary the environment. */
export function forgetBun(): void {
	resolved = undefined;
}
