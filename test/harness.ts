// Runs a real headless agent session so that claims which are only true when
// the harness and the provider agree can be asserted: that a replacement pack
// reaches the model, that the journal keeps the original, and that usage is
// reported.

import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface JournalEntry {
	type: string;
	customType?: string;
	message?: {
		role: string;
		content: unknown;
		usage?: Record<string, unknown>;
	};
	[key: string]: unknown;
}

export interface HeadlessRun {
	stdout: string;
	stderr: string;
	exitCode: number;
	cwd: string;
	journalPath: string;
	journal: JournalEntry[];
}

export interface HeadlessOptions {
	prompt: string;
	/** Extension module paths passed to the agent with `-e`. */
	extensions?: string[];
	env?: Record<string, string>;
	/** Files to create in the scratch working directory before running. */
	files?: Record<string, string>;
	/** Reuse an existing scratch directory instead of making a new one. */
	cwd?: string;
	/** Continue the previous session in that directory rather than starting one. */
	continueSession?: boolean;
	timeoutMs?: number;
}

const SESSION_ROOT = join(
	process.env.HOME ?? "/root",
	".omp",
	"agent",
	"sessions",
);

async function sessionFiles(): Promise<Map<string, number>> {
	const found = new Map<string, number>();
	let dirs: string[];
	try {
		dirs = await readdir(SESSION_ROOT);
	} catch {
		return found;
	}
	for (const dir of dirs) {
		const full = join(SESSION_ROOT, dir);
		let entries: string[];
		try {
			entries = await readdir(full);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".jsonl")) continue;
			const path = join(full, entry);
			const info = await stat(path).catch(() => undefined);
			if (info) found.set(path, info.mtimeMs);
		}
	}
	return found;
}

function parseJournal(text: string): JournalEntry[] {
	const entries: JournalEntry[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line) as JournalEntry);
		} catch {
			// A partially flushed final line is not a parse failure worth failing on.
		}
	}
	return entries;
}

export async function runHeadless(options: HeadlessOptions): Promise<HeadlessRun> {
	const cwd = options.cwd ?? (await mkdtemp(join(tmpdir(), "cm-harness-")));
	for (const [name, contents] of Object.entries(options.files ?? {})) {
		await Bun.write(join(cwd, name), contents);
	}

	const before = await sessionFiles();

	const args = ["-p", "--no-title"];
	for (const extension of options.extensions ?? []) {
		args.push("-e", extension);
	}
	if (options.continueSession) args.push("-c");
	args.push(options.prompt);

	const proc = Bun.spawn(["omp", ...args], {
		cwd,
		env: { ...process.env, ...options.env },
		stdout: "pipe",
		stderr: "pipe",
	});

	const timeout = setTimeout(() => proc.kill(), options.timeoutMs ?? 180_000);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	clearTimeout(timeout);

	const after = await sessionFiles();
	let journalPath = "";
	let newest = -1;
	for (const [path, mtime] of after) {
		const previous = before.get(path);
		if (previous !== undefined && previous === mtime) continue;
		if (mtime > newest) {
			newest = mtime;
			journalPath = path;
		}
	}

	const journal = journalPath
		? parseJournal(await readFile(journalPath, "utf8"))
		: [];

	return { stdout, stderr, exitCode, cwd, journalPath, journal };
}

/** The text of every message the journal recorded for a role. */
export function journalText(run: HeadlessRun, role: string): string[] {
	const texts: string[] = [];
	for (const entry of run.journal) {
		if (entry.type !== "message" || entry.message?.role !== role) continue;
		const content = entry.message.content;
		if (typeof content === "string") {
			texts.push(content);
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (
				block &&
				typeof block === "object" &&
				"text" in block &&
				typeof block.text === "string"
			) {
				texts.push(block.text);
			}
		}
	}
	return texts;
}
