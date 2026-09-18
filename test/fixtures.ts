import type { AssemblerConfig } from "../src/assembler.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { loadConfig, type Config } from "../src/config.ts";

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
