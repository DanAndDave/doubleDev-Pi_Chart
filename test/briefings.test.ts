import { describe, expect, test } from "bun:test";

import {
	BRIEFING_ENTRY,
	briefingMessage,
	hashOf,
	placeBriefings,
	replayBriefings,
	type StoredBriefing,
} from "../src/briefings.ts";
import type { BranchEntry } from "../src/harness.ts";
import type { HarnessMessage } from "../src/messages.ts";

function briefing(id: string, parentId: string | null, data: unknown): BranchEntry {
	return { id, parentId, type: "custom", customType: BRIEFING_ENTRY, data };
}

function message(
	id: string,
	parentId: string | null,
	role: string,
	timestamp: number,
): BranchEntry {
	return { id, parentId, type: "message", message: { role, content: id, timestamp } };
}

const follows = (on: string, text: string, inline = true) => ({
	v: 1,
	follows: on,
	hash: hashOf(text),
	...(inline ? { text } : {}),
});

const precedes = (text: string, at?: number) => ({
	v: 1,
	precedes: true,
	hash: hashOf(text),
	text,
	...(at === undefined ? {} : { at }),
});

describe("replaying a Journal's Briefings", () => {
	test("a hash-only entry resolves to the text written earlier in the file", () => {
		const stored = replayBriefings([
			message("u1", null, "user", 1),
			briefing("b1", "u1", follows("u1", "same text")),
			message("t2", "b1", "toolResult", 2),
			briefing("b2", "t2", follows("t2", "same text", false)),
		]);

		expect(stored.get("t2")).toEqual({ hash: hashOf("same text"), text: "same text" });
	});

	test("a hash nothing in the file holds is a missing Briefing", () => {
		const stored = replayBriefings([
			message("u1", null, "user", 1),
			briefing("b1", "u1", follows("u1", "never written", false)),
		]);

		expect(stored.get("u1")).toEqual({ hash: hashOf("never written"), text: undefined });
	});

	test("the entry written last for a message wins", () => {
		const stored = replayBriefings([
			message("u1", null, "user", 1),
			briefing("b1", "u1", follows("u1", "first try")),
			briefing("b2", "b1", follows("u1", "retried")),
		]);

		expect(stored.get("u1")?.text).toBe("retried");
	});

	test("a first Call's entry resolves to the prompt written after it", () => {
		const stored = replayBriefings([
			message("a0", null, "assistant", 1),
			briefing("b1", "a0", precedes("for the prompt", 2)),
			message("u1", "b1", "user", 2),
			message("a1", "u1", "assistant", 3),
		]);

		expect(stored.get("u1")?.text).toBe("for the prompt");
		expect(stored.has("a0")).toBe(false);
		expect(stored.has("a1")).toBe(false);
	});

	test("a retried first Call resolves through the entry written after it", () => {
		const stored = replayBriefings([
			briefing("b1", null, precedes("first try")),
			briefing("b2", "b1", precedes("retried")),
			message("u1", "b2", "user", 2),
		]);

		expect(stored.get("u1")?.text).toBe("retried");
	});

	test("a first Call's entry with no prompt after it resolves to nothing", () => {
		const stored = replayBriefings([
			message("a0", null, "assistant", 1),
			briefing("b1", "a0", precedes("never answered")),
		]);

		expect(stored.size).toBe(0);
	});

	test("malformed entries are skipped and the rest still resolve", () => {
		const stored = replayBriefings([
			message("u1", null, "user", 1),
			briefing("b1", "u1", "not an object"),
			briefing("b2", "b1", { v: 2, follows: "u1", hash: hashOf("x"), text: "x" }),
			briefing("b3", "b2", { v: 1, follows: "u1" }),
			briefing("b4", "b3", { v: 1, follows: "u1", hash: hashOf("y"), text: 7 }),
			briefing("b5", "b4", { v: 1, precedes: "yes", hash: hashOf("z"), text: "z" }),
			message("t1", "b5", "toolResult", 2),
			briefing("b6", "t1", follows("t1", "kept")),
		]);

		expect([...stored.keys()]).toEqual(["t1"]);
		expect(stored.get("t1")?.text).toBe("kept");
	});

	test("entries of another kind are not Briefings", () => {
		const stored = replayBriefings([
			message("u1", null, "user", 1),
			{ id: "p1", parentId: "u1", type: "custom", customType: "pi-chart.pin", data: follows("u1", "x") },
		]);

		expect(stored.size).toBe(0);
	});
});

describe("the flush-order guard", () => {
	// Captured from `evidence/entry-ext.ts` on omp 18.10.4: the hook's entry
	// on a Turn's first Call lands before the prompt it belongs to.
	const captured: BranchEntry[] = [
		{ type: "session", id: "s" },
		{ type: "model_change", id: "m0", parentId: null },
		briefing("c1", "m0", precedes("first call", 1_000)),
		message("u1", "c1", "user", 1_000),
		message("a1", "u1", "assistant", 1_001),
		message("t1", "a1", "toolResult", 1_002),
		briefing("c2", "t1", follows("t1", "second call")),
		message("a2", "c2", "assistant", 1_003),
	];

	test("an entry written before its prompt resolves to the prompt", () => {
		const stored = replayBriefings(captured);

		expect(stored.get("u1")?.text).toBe("first call");
		expect(stored.get("t1")?.text).toBe("second call");
	});

	test("an entry written after its prompt still resolves to the prompt", () => {
		const reversed: BranchEntry[] = [
			{ type: "model_change", id: "m0", parentId: null },
			message("u1", "m0", "user", 1_000),
			briefing("c1", "u1", precedes("first call", 1_000)),
			message("a1", "c1", "assistant", 1_001),
		];

		const stored = replayBriefings(reversed);

		expect(stored.get("u1")?.text).toBe("first call");
		expect(stored.has("a1")).toBe(false);
	});
});

describe("placing stored Briefings in a Pack", () => {
	const prompt: HarnessMessage = { role: "user", content: "p", timestamp: 1 };
	const call: HarnessMessage = { role: "assistant", content: "c", timestamp: 2 };
	const result: HarnessMessage = { role: "toolResult", content: "r", timestamp: 3 };
	const answer: HarnessMessage = { role: "assistant", content: "a", timestamp: 4 };
	const ids = new Map<HarnessMessage, string>([
		[prompt, "u1"],
		[call, "a1"],
		[result, "t1"],
		[answer, "a2"],
	]);
	const keyOf = (each: HarnessMessage) => ids.get(each);
	const kept = (text: string): StoredBriefing => ({ hash: hashOf(text), text });

	test("each stored Briefing goes directly after its message, cleared", () => {
		const placed = placeBriefings(
			[prompt, call, result, answer],
			keyOf,
			new Map([
				["u1", kept("first")],
				["t1", kept("second")],
			]),
		);

		expect(placed.messages).toEqual([
			prompt,
			briefingMessage("first", 1),
			call,
			result,
			briefingMessage("second", 3),
			answer,
		]);
		expect(placed.messages[1]).toMatchObject({
			role: "developer",
			content: [{ type: "text", text: "first" }],
			providerPayload: { type: "anthropicMessage", clearAt: "next_user_message" },
		});
		expect(placed.resent).toBe(2);
		expect(placed.resentBytes).toBe(
			Buffer.byteLength("first") + Buffer.byteLength("second"),
		);
		expect(placed.missing).toBe(0);
	});

	test("a Briefing whose message the Pack does not carry is not sent", () => {
		const placed = placeBriefings(
			[result, answer],
			keyOf,
			new Map([["u1", kept("left with its prompt")]]),
		);

		expect(placed.messages).toEqual([result, answer]);
		expect(placed.resent).toBe(0);
		expect(placed.missing).toBe(0);
	});

	test("a Briefing with no stored text is counted missing and nothing takes its place", () => {
		const placed = placeBriefings(
			[prompt, call],
			keyOf,
			new Map([["u1", { hash: hashOf("lost"), text: undefined }]]),
		);

		expect(placed.messages).toEqual([prompt, call]);
		expect(placed.resent).toBe(0);
		expect(placed.resentBytes).toBe(0);
		expect(placed.missing).toBe(1);
	});

	test("placing twice sends the same bytes", () => {
		const stored = new Map([["t1", kept("ünïcode text")]]);

		const once = placeBriefings([prompt, call, result], keyOf, stored);
		const twice = placeBriefings([prompt, call, result], keyOf, stored);

		expect(JSON.stringify(twice.messages)).toBe(JSON.stringify(once.messages));
		expect(once.resentBytes).toBe(Buffer.byteLength("ünïcode text"));
	});
});
