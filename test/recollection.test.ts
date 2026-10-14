// What a recalled Turn looks like when it reaches the model, and what the
// verbatim tail refuses to replay. `asRecollection()` and the `assemble()`
// boundary see both and need no container, no model and no harness.

import { describe, expect, test } from "bun:test";

import { asRecollection, assemble } from "../src/assembler.ts";
import { messageText, type HarnessMessage, type Turn } from "../src/messages.ts";
import { approximateTokens } from "../src/tokens.ts";
import { reconstructTurns } from "../src/turns.ts";
import {
	budgets,
	toolCall as call,
	toolResult as answer,
	toolSessionTurn as toolTurn,
} from "./fixtures.ts";

const CURRENT: Turn = {
	prompt: "what did we do with leaf.txt",
	messages: [{ role: "user", content: "what did we do with leaf.txt" }],
};

/** The ids of every tool call a pack part still carries. */
function callIds(messages: HarnessMessage[]): string[] {
	return messages.flatMap((message) =>
		Array.isArray(message.content)
			? message.content.flatMap((block) =>
					block.type === "toolCall" && "id" in block && typeof block.id === "string"
						? [block.id]
						: [],
				)
			: [],
	);
}

describe("a recollection carries the actions its turn took", () => {
	test("a recalled turn shows what it asked for, with its arguments", async () => {
		const text = messageText(asRecollection({ turnIndex: 1, turn: await toolTurn() }));

		expect(text).toContain('write({"path":"leaf.txt"');
		expect(text).toContain('read({"path":"leaf.txt"');
		expect(text).toContain("Successfully wrote 6 bytes");
	});

	test("a message carrying an action and no prose is not dropped", () => {
		const turn: Turn = {
			index: 2,
			prompt: "check the port",
			messages: [
				{ role: "user", content: "check the port" },
				call("read", { path: "config.ts" }, "c1"),
				answer("port = 55432", "c1", "read"),
			],
		};

		const text = messageText(asRecollection({ turnIndex: 2, turn }));

		expect(text).toContain('read({"path":"config.ts"})');
	});

	test("an unanswered action is recorded as made and unanswered", () => {
		const turn: Turn = {
			index: 3,
			prompt: "start the migration",
			messages: [
				{ role: "user", content: "start the migration" },
				call("bash", { command: "migrate" }, "orphan"),
			],
		};

		const text = messageText(asRecollection({ turnIndex: 3, turn }));

		expect(text).toContain('bash({"command":"migrate"})');
		expect(text).toMatch(/no result/i);
	});

	test("shortening a recollection keeps its actions and shortens the output", () => {
		const turn: Turn = {
			index: 4,
			prompt: "read both files",
			messages: [
				{ role: "user", content: "read both files" },
				call("read", { path: "first.ts" }, "c1"),
				answer("first ".repeat(3_000), "c1", "read"),
				call("read", { path: "second.ts" }, "c2"),
				answer("second ".repeat(3_000), "c2", "read"),
				{ role: "assistant", content: "both files define the same symbol" },
			],
		};

		const message = asRecollection({ turnIndex: 4, turn }, 800);
		const text = messageText(message);

		expect(message.piChartShortened).toBe(true);
		expect(approximateTokens([message])).toBeLessThanOrEqual(800);
		expect(text).toContain('read({"path":"first.ts"})');
		expect(text).toContain('read({"path":"second.ts"})');
		expect(text).toContain("both files define the same symbol");
		expect(text).toMatch(/elided/);
	});

	test("a turn whose bulk is its own prose still keeps every action whole", () => {
		// Shortening every output is not enough here, so the prose gives way
		// too. The calls are what say what the Turn did, and the middle of
		// an argument is exactly what a head-and-tail shortening would take,
		// so the needle is in the middle of one.
		const needle = "NEEDLE-IN-THE-ARGUMENTS";
		const path = `${"a".repeat(400)}${needle}${"b".repeat(400)}`;
		const turn: Turn = {
			index: 5,
			prompt: "explain the deadlock",
			messages: [
				{ role: "user", content: "explain the deadlock" },
				call("read", { path }, "c1"),
				answer("connection pool", "c1", "read"),
				{ role: "assistant", content: "reasoning ".repeat(4_000) },
				call("grep", { pattern: "BEGIN" }, "c2"),
				answer("one match", "c2", "grep"),
				{ role: "assistant", content: "more reasoning ".repeat(4_000) },
			],
		};

		const message = asRecollection({ turnIndex: 5, turn }, 500);
		const text = messageText(message);

		expect(approximateTokens([message])).toBeLessThanOrEqual(500);
		expect(text).toContain(needle);
		expect(text).toContain('grep({"pattern":"BEGIN"})');
		expect(text).toMatch(/elided/);
	});

	test("an action too large for the allowance is shortened, not dropped", () => {
		// A call's arguments are unbounded — a `write` carries the file it
		// wrote. Keeping actions whole cannot mean keeping arguments whole,
		// or the Turn that did the biggest thing is the one recall loses.
		const turn: Turn = {
			index: 6,
			prompt: "write the migration",
			messages: [
				{ role: "user", content: "write the migration" },
				call("write", { path: "010.sql", content: "ALTER TABLE ".repeat(4_000) }, "c1"),
				answer("wrote 48000 bytes", "c1", "write"),
				{ role: "assistant", content: "the migration adds the text hash" },
			],
		};

		const message = asRecollection({ turnIndex: 6, turn }, 300);

		expect(approximateTokens([message])).toBeLessThanOrEqual(300);
		expect(messageText(message)).toContain("write(");
	});

	test("a recollection stays one attributed message carrying its position", async () => {
		const message = asRecollection({ turnIndex: 7, turn: await toolTurn() });

		expect(message.role).toBe("user");
		expect(messageText(message)).toContain(
			"[recalled from turn 7 of this conversation]",
		);
	});
});

describe("the verbatim tail refuses an orphan", () => {
	const interrupted: Turn = {
		index: 1,
		prompt: "write both files",
		messages: [
			{ role: "user", content: "write both files" },
			call("write", { path: "first.ts" }, "answered"),
			answer("wrote first.ts", "answered", "write"),
			{ role: "assistant", content: "first done, second next" },
			call("write", { path: "second.ts" }, "never-answered"),
		],
	};

	test("a call whose result was never recorded is not carried", () => {
		const pack = assemble(
			{ turns: [interrupted, CURRENT] },
			budgets({ tailTurns: 4 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");
		const ids = callIds(tail?.messages ?? []);

		expect(ids).toEqual(["answered"]);
	});

	test("the rest of an interrupted turn survives", () => {
		const pack = assemble(
			{ turns: [interrupted, CURRENT] },
			budgets({ tailTurns: 4 }),
		);
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");
		const texts = (tail?.messages ?? []).map((message) => messageText(message));

		expect(texts).toContain("write both files");
		expect(texts).toContain("wrote first.ts");
		expect(texts).toContain("first done, second next");
	});

	test("a turn with every call answered is untouched", async () => {
		const turn = await toolTurn();

		const pack = assemble({ turns: [turn, CURRENT] }, budgets({ tailTurns: 4 }));
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");

		expect(tail?.messages).toEqual(turn.messages);
	});

	test("the same pairing applies to a turn reconstructed from the live array", () => {
		const live = reconstructTurns([
			{ role: "user", content: "write both files" },
			call("write", { path: "first.ts" }, "answered"),
			answer("wrote first.ts", "answered", "write"),
			call("write", { path: "second.ts" }, "never-answered"),
			{ role: "user", content: "what happened" },
		]);

		const pack = assemble({ turns: live }, budgets({ tailTurns: 4 }));
		const tail = pack.parts.find((part) => part.source === "verbatim-tail");
		expect(callIds(tail?.messages ?? [])).toEqual(["answered"]);
		expect(tail?.messages.map((message) => messageText(message))).toContain(
			"wrote first.ts",
		);
	});

	test("an unanswered call in the turn being answered now is left alone", () => {
		// The current Turn is what the model is in the middle of; nothing may
		// be withheld from it, and its last call is answered by the Call this
		// pack is being built for.
		const current: Turn = {
			prompt: "run the migration",
			messages: [
				{ role: "user", content: "run the migration" },
				call("bash", { command: "migrate" }, "in-flight"),
			],
		};

		const pack = assemble({ turns: [current] }, budgets({ tailTurns: 4 }));
		const part = pack.parts.find((each) => each.source === "current-turn");

		expect(part?.messages).toEqual(current.messages);
	});
});

