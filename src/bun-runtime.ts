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
function candidates(env: Record<string, string | undefined>): string[] {
	const home = env.HOME ?? homedir();
	const found: string[] = [];

	const configured = env.CM_BUN?.trim();
	if (configured) found.push(configured);

	// The process running us, when that is already a Bun.
	const running = process.execPath;
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
async function runs(path: string): Promise<boolean> {
	try {
		const spawned = Bun.spawn([path, "--version"], {
			stdout: "pipe",
			stderr: "pipe",
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

/** Version directories under a version manager's install root, newest first. */
async function versioned(root: string): Promise<string[]> {
	try {
		if (!(await stat(root)).isDirectory()) return [];
	} catch {
		return [];
	}
	const versions: string[] = [];
	for await (const entry of new Bun.Glob("*/bin/bun").scan({
		cwd: root,
		absolute: true,
		onlyFiles: false,
	})) {
		versions.push(entry);
	}
	return versions.sort().reverse();
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
): Promise<string | undefined> {
	resolved ??= search(env);
	return resolved;
}

async function search(
	env: Record<string, string | undefined>,
): Promise<string | undefined> {
	for (const candidate of candidates(env)) {
		if (candidate.includes("/installs/bun")) {
			for (const version of await versioned(candidate)) {
				if (await runs(version)) return version;
			}
			continue;
		}
		if (await runs(candidate)) return candidate;
	}
	return undefined;
}

/** Forgets the resolved runtime. For tests, which vary the environment. */
export function forgetBun(): void {
	resolved = undefined;
}
