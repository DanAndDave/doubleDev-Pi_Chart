import type { HarnessMessage } from "../src/messages.ts";

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
