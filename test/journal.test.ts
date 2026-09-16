import { describe, expect, test } from "bun:test";

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
