import { readFile } from "node:fs/promises";

import type { AssemblerConfig } from "../src/assembler.ts";
import type { BranchEntry } from "../src/harness.ts";
import { readJournal } from "../src/journal.ts";
import type { HarnessMessage, Turn } from "../src/messages.ts";
import {
	DEFAULT_DOC_MAX_DISTANCE,
	DEFAULT_EXPLAIN_CANDIDATES,
	DEFAULT_RECALL_MAX_DISTANCE,
	loadConfig,
	type Config,
} from "../src/config.ts";

/**
 * Message arrays captured from real sessions, so tests run against shapes the
 * harness actually produces rather than a guess at them.
 *
 * Each call re-reads and re-parses, so two loads never share references.
 */
export async function fixture(name: string): Promise<HarnessMessage[]> {
	const file = Bun.file(new URL(`./fixtures/${name}.json`, import.meta.url));
	return (await file.json()) as HarnessMessage[];
}

/**
 * An `AssemblerConfig` from the counts a test cares about, with size Budgets
 * generous enough not to bind.
 *
 * Tests that are about counts should not have to state five token numbers to
 * say so; tests that are about sizes state the ones they mean.
 */
export function budgets(counts: Partial<AssemblerConfig>): AssemblerConfig {
	return {
		tailTurns: 0,
		recallTurns: 0,
		docConcepts: 0,
		graphSymbols: 0,
		tailTokens: UNBOUNDED,
		recallTokens: UNBOUNDED,
		docTokens: UNBOUNDED,
		graphTokens: UNBOUNDED,
		packTokens: UNBOUNDED,
		// The real defaults: a test about Budgets should not have to state
		// the thresholds a part records itself as having selected against.
		recallMaxDistance: DEFAULT_RECALL_MAX_DISTANCE,
		docMaxDistance: DEFAULT_DOC_MAX_DISTANCE,
		explainCandidates: DEFAULT_EXPLAIN_CANDIDATES,
		...counts,
	};
}

/** Larger than any pack a test builds, so a size Budget never binds by accident. */
export const UNBOUNDED = 10_000_000;

/**
 * A full `Config` from the fields a test cares about, over the real defaults.
 *
 * Over the real defaults deliberately: a test that does not mention the size
 * Budgets then runs against the numbers production runs against, so a default
 * that is too tight shows up here rather than in a session.
 */
export function settings(fields: Partial<Config>): Config {
	// Assigned key by key rather than spread: spreading a `Partial` over a
	// complete value widens every field it mentions back to optional, and an
	// explicit `undefined` in the override would erase a default rather than
	// leave it alone.
	const config = loadConfig({});
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined) continue;
		(config as unknown as Record<string, unknown>)[key] = value;
	}
	return config;
}

/** A real Journal with a tool-using Turn in it: write, read, conclusion. */
export const JOURNAL_FIXTURE = new URL(
	"./fixtures/journal-tool-session.jsonl",
	import.meta.url,
).pathname;

/**
 * A real-shaped Journal carrying the compaction observed on this machine:
 * epoch 0 either side of a `compaction` entry, then epoch 1, with the
 * reported window sizes it actually had.
 */
export const COMPACTION_FIXTURE = new URL(
	"./fixtures/journal-compaction.jsonl",
	import.meta.url,
).pathname;

/**
 * A Journal as the harness's branch, which is what the extension reads.
 *
 * The branch is the parent chain, and a compaction is a node in it rather
 * than a break: the observed Journal reaches all sixteen of its prompts
 * from the last entry, ten of them from before the compaction.
 */
export async function branchOf(path: string): Promise<BranchEntry[]> {
	const text = await readFile(path, "utf8");
	const branch: BranchEntry[] = [];
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		const entry = JSON.parse(line) as BranchEntry;
		if (entry.message) branch.push({ type: entry.type, message: entry.message });
	}
	return branch;
}

/**
 * The fixture's tool-using Turn, as a Turn.
 *
 * Shared because three suites need the same real Turn — the embed text, the
 * recollection and the tail all have something to say about it — and a Turn
 * loaded two slightly different ways is a difference nobody meant.
 */
export async function toolSessionTurn(): Promise<Turn> {
	const turns = await readJournal(JOURNAL_FIXTURE);
	const turn = turns.find((each) =>
		each.messages.some((message) => message.role === "toolResult"),
	);
	if (!turn) throw new Error("fixture no longer holds a tool-using turn");
	return { index: turn.turnIndex, prompt: turn.prompt, messages: turn.messages };
}

/** An assistant message that makes one tool call. */
export function toolCall(
	name: string,
	args: Record<string, unknown>,
	id: string,
): HarnessMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: args }],
	};
}

/** The result that answers a tool call. */
export function toolResult(
	text: string,
	id: string,
	toolName = "read",
): HarnessMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName,
		content: [{ type: "text", text }],
	};
}
