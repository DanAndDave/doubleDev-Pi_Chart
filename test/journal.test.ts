import { describe, expect, test } from "bun:test";

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readJournal } from "../src/journal.ts";

const FIXTURE = new URL(
	"./fixtures/journal-tool-session.jsonl",
	import.meta.url,
).pathname;

describe("readJournal", () => {
	test("groups a recorded session into its turns", async () => {
		const turns = await readJournal(FIXTURE);

		expect(turns.map((turn) => turn.turnIndex)).toEqual([0, 1, 2]);
		expect(turns[0]?.prompt).toBe("Say: one");
		expect(turns[2]?.prompt).toBe("Say: three");
	});

	test("keeps a tool-using turn whole, with its calls and results", async () => {
		const turns = await readJournal(FIXTURE);

		const toolTurn = turns[1];
		expect(toolTurn?.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
			"toolResult",
			"assistant",
		]);
	});

	test("addresses each call within its turn", async () => {
		const turns = await readJournal(FIXTURE);

		// The tool turn answered over three calls; the simple turns took one each.
		expect(turns.map((turn) => turn.callCount)).toEqual([1, 3, 1]);
	});

	test("ignores journal entries that are not messages", async () => {
		const turns = await readJournal(FIXTURE);

		const roles = turns.flatMap((turn) =>
			turn.messages.map((message) => message.role),
		);
		expect(roles).not.toContain("title");
		expect(roles.every((role) => role.length > 0)).toBe(true);
	});

	test("a journal that does not exist yields no turns", async () => {
		expect(await readJournal("/nonexistent/journal.jsonl")).toEqual([]);
	});
});

describe("which call produced a message", () => {
	test("a tool loop gives its messages rising call numbers", async () => {
		const turns = await readJournal(FIXTURE);
		const loop = turns[1];
		if (!loop) throw new Error("fixture turn missing");

		// A message belongs to the Call in progress, and the message
		// carrying a snapshot ends it — the direction the accounting counts
		// in, so ingest and accounting cannot disagree.
		expect(loop.calls).toEqual([0, 0, 1, 1, 2, 2]);
		expect(loop.calls.length).toBe(loop.messages.length);
	});

	test("a turn answered without a tool loop is all one call", async () => {
		const turns = await readJournal(FIXTURE);

		expect(turns[0]?.calls).toEqual([0, 0]);
	});

	test("a journal with no snapshots at all is call zero throughout", async () => {
		const plain = await Bun.file(FIXTURE)
			.text()
			.then((text) =>
				text
					.split("\n")
					.filter(Boolean)
					.map((line) => {
						const entry = JSON.parse(line) as {
							message?: { contextSnapshot?: unknown };
						};
						if (entry.message) delete entry.message.contextSnapshot;
						return JSON.stringify(entry);
					})
					.join("\n"),
			);
		// In a temporary directory: a test must not write into the
		// fixtures it reads.
		const path = join(await mkdtemp(join(tmpdir(), "cm-journal-")), "j.jsonl");
		await Bun.write(path, plain);

		const turns = await readJournal(path);

		expect(turns.every((turn) => turn.calls.every((call) => call === 0))).toBe(
			true,
		);
	});
});
