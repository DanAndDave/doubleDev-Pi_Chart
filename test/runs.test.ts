import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { journalsIn } from "../scripts/runs.ts";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "journals-in-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/** A Journal at `path` under the root whose session header names `cwd`. */
async function journal(path: string, cwd: string): Promise<string> {
	const file = join(root, path);
	await mkdir(join(file, ".."), { recursive: true });
	await writeFile(file, `${JSON.stringify({ type: "session", id: path, cwd })}\n`);
	return file;
}

describe("journalsIn", () => {
	test("the main Journal is the top-level one whose header names the cwd, and subagents sit one deeper", async () => {
		const main = await journal("-w-run-1-/2026_a.jsonl", "/w/run-1");
		const sub = await journal("-w-run-1-/2026_a/Pong.jsonl", "/w/run-1");

		expect(await journalsIn(root, "/w/run-1")).toEqual({ main, subagents: [sub] });
	});

	test("a Journal of another cwd is ignored, even in a folder whose name holds this one's", async () => {
		await journal("-w-run-10-/2026_b.jsonl", "/w/run-10");
		await journal("-w-run-10-/2026_b/Sub.jsonl", "/w/run-10");
		const main = await journal("-w-run-1-/2026_a.jsonl", "/w/run-1");

		expect(await journalsIn(root, "/w/run-1")).toEqual({ main, subagents: [] });
	});

	test("a root with no Conversation in the cwd has no main Journal", async () => {
		await journal("-w-other-/2026_c.jsonl", "/w/other");

		expect(await journalsIn(root, "/w/run-1")).toEqual({ subagents: [] });
		expect(await journalsIn(join(root, "missing"), "/w/run-1")).toEqual({ subagents: [] });
	});
});
