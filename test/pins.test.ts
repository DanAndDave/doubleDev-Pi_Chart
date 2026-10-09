import { describe, expect, test } from "bun:test";

import type { BranchEntry } from "../src/harness.ts";
import { admit, PIN_ENTRY, pinTokens, renderPin, replayPins } from "../src/pins.ts";

function pinEntry(data: unknown): BranchEntry {
	return { type: "custom", customType: PIN_ENTRY, data };
}

const add = (id: number, text: string) => pinEntry({ op: "add", id, text });
const remove = (...ids: number[]) => pinEntry({ op: "remove", ids });

describe("replaying a conversation's pins", () => {
	test("adds and removes fold in the order they were written", () => {
		const state = replayPins([
			add(1, "use tabs"),
			{ type: "message", message: { role: "user", content: "hello" } },
			add(2, "never push"),
			remove(1),
			add(3, "answer in French"),
		]);

		expect(state.pins).toEqual([
			{ id: 2, text: "never push" },
			{ id: 3, text: "answer in French" },
		]);
	});

	test("an id removed is never given out again", () => {
		const state = replayPins([add(1, "a"), add(2, "b"), remove(2)]);

		expect(state.pins.map((pin) => pin.id)).toEqual([1]);
		expect(state.nextId).toBe(3);
	});

	test("a snapshot replaces what came before it and keeps its counter", () => {
		const state = replayPins([
			add(1, "parent's first"),
			add(2, "parent's second"),
			pinEntry({
				op: "snapshot",
				pins: [{ id: 4, text: "carried" }],
				nextId: 7,
			}),
			add(7, "after"),
		]);

		expect(state.pins).toEqual([
			{ id: 4, text: "carried" },
			{ id: 7, text: "after" },
		]);
		expect(state.nextId).toBe(8);
	});

	test("malformed entries and other extensions' entries are skipped", () => {
		const state = replayPins([
			add(1, "kept"),
			pinEntry({ op: "add", id: "two", text: "bad id" }),
			pinEntry({ op: "add", id: 3 }),
			pinEntry({ op: "remove", ids: "1" }),
			pinEntry({ op: "snapshot", pins: "none", nextId: 9 }),
			pinEntry(null),
			pinEntry({ op: "rename", id: 1 }),
			{ type: "custom", customType: "someone-else", data: { op: "remove", ids: [1] } },
		]);

		expect(state.pins).toEqual([{ id: 1, text: "kept" }]);
		expect(state.nextId).toBe(2);
	});

	test("no entries is no pins, numbered from one", () => {
		expect(replayPins([])).toEqual({ pins: [], nextId: 1 });
	});
});

describe("rendering a pin", () => {
	test("is attributed to the user, by id and position, with the text whole", () => {
		const message = renderPin({ id: 3, text: "line one\nline two" }, 2, 4);

		expect(message).toEqual({
			role: "user",
			content: "[pinned by the user: #3, 2 of 4]\nline one\nline two",
			cmPinned: true,
		});
	});
});

describe("admitting a pin", () => {
	const held = (texts: string[]) => ({
		pins: texts.map((text, index) => ({ id: index + 1, text })),
		nextId: texts.length + 1,
	});

	test("a pin past the count budget is refused naming the budget and the excess", () => {
		const outcome = admit(held(["a", "b"]), "c", { count: 2, tokens: 10_000 });

		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.reason).toContain("2 pins");
		expect(outcome.reason).toContain("2 held");
		expect(outcome.reason).toContain("1 over");
	});

	test("a pin filling the token budget exactly is accepted", () => {
		const state = held(["first"]);
		const after = pinTokens([...state.pins, { id: 2, text: "second" }]);

		const outcome = admit(state, "second", { count: 8, tokens: after });

		expect(outcome).toEqual({
			ok: true,
			pin: { id: 2, text: "second" },
			tokens: after - pinTokens(state.pins),
			total: after,
		});
	});

	test("a pin one token past the budget is refused with the spend and the excess", () => {
		const state = held(["first"]);
		const spent = pinTokens(state.pins);
		const after = pinTokens([...state.pins, { id: 2, text: "second" }]);

		const outcome = admit(state, "second", { count: 8, tokens: after - 1 });

		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.reason).toContain(`${after - 1} tokens`);
		expect(outcome.reason).toContain(`~${spent}`);
		expect(outcome.reason).toContain("1 over");
	});

	test("the new pin takes the next id, never a removed one", () => {
		const outcome = admit({ pins: [{ id: 1, text: "a" }], nextId: 5 }, "b", {
			count: 8,
			tokens: 10_000,
		});

		expect(outcome.ok && outcome.pin.id).toBe(5);
	});
});
