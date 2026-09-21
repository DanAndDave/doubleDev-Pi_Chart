import { describe, expect, test } from "bun:test";

import { EMBED_CHARACTERS, embedText, SHORTEST_SHARE } from "../src/embed-text.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { toolCall as call, toolResult as result, toolSessionTurn } from "./fixtures.ts";

describe("what a turn is embedded as", () => {
	test("every message of a tool-using turn contributes", async () => {
		const text = embedText((await toolSessionTurn()).messages);

		expect(text).toContain("Create a file leaf.txt");
		expect(text).toContain('write({"path":"leaf.txt"');
		expect(text).toContain('read({"path":"leaf.txt"');
		expect(text).toContain("Successfully wrote 6 bytes");
		expect(text).toContain("1:maple");
		expect(text).toContain("contains `maple`. done");
	});

	test("one large message does not crowd out the rest of its turn", () => {
		const messages: HarnessMessage[] = [
			{ role: "user", content: "why is the cache empty on a cold start" },
			call("read", { path: "cache.ts" }, "c1"),
			result("x".repeat(EMBED_CHARACTERS * 20), "c1"),
			{ role: "assistant", content: "the cache is seeded lazily, so a cold start finds it empty" },
		];

		const text = embedText(messages);

		expect(text).toContain("why is the cache empty on a cold start");
		expect(text).toContain('read({"path":"cache.ts"})');
		expect(text).toContain("the cache is seeded lazily");
	});

	test("an oversized message is shortened head and tail, and says so", () => {
		const body = `START${"y".repeat(EMBED_CHARACTERS * 4)}END`;
		const messages: HarnessMessage[] = [
			{ role: "user", content: "what did the file say" },
			result(body, "c1"),
		];

		const text = embedText(messages);

		expect(text).toContain("START");
		expect(text).toContain("END");
		expect(text).toMatch(/elided ~\d+ tokens from the middle/);
		// The marker's figure is the size of the gap, not of the message.
		const elided = Number(/elided ~(\d+) tokens/.exec(text)?.[1]);
		expect(elided).toBeGreaterThan(body.length / 4 - EMBED_CHARACTERS);
		expect(elided).toBeLessThan(body.length / 4);
	});

	test("the same turn composes to the same text twice, unanswered call and all", () => {
		const messages: HarnessMessage[] = [
			{ role: "user", content: "check the config" },
			call("read", { path: "config.ts" }, "answered"),
			result("port = 55432", "answered"),
			{ role: "assistant", content: "reading the defaults next" },
			call("read", { path: "defaults.ts" }, "never-answered"),
		];

		const once = embedText(messages);

		expect(embedText(messages)).toBe(once);
		expect(once).toContain('read({"path":"defaults.ts"})');
	});

	test("an allowance too small to seat everything keeps the prompt and the conclusion", () => {
		const messages: HarnessMessage[] = [
			{ role: "user", content: "which port does the store listen on" },
			result("a".repeat(5_000), "c1"),
			result("b".repeat(5_000), "c2"),
			result("c".repeat(5_000), "c3"),
			{ role: "assistant", content: "it listens on 55432" },
		];

		const text = embedText(messages, SHORTEST_SHARE * 2);

		expect(text).toContain("which port does the store listen on");
		expect(text).toContain("it listens on 55432");
	});
});
