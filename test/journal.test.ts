import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readBranch, readJournal } from "../src/journal.ts";
import { PIN_ENTRY } from "../src/pins.ts";
import { journalEntry, journalOf, toolCall, toolResult } from "./fixtures.ts";

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

		// Guarded: `readJournal` answers an unreadable path with no Turns,
		// and `[].every()` is true.
		expect(turns).toHaveLength(3);
		expect(turns.every((turn) => turn.calls.every((call) => call === 0))).toBe(
			true,
		);
	});
});

// One file, two branches: `/tree` moved the leaf back to the first
// answer, and the Conversation continued from there.
const REWOUND = [
	journalEntry("u1", null, "user", "first prompt"),
	journalEntry("a1", "u1", "assistant", "first answer"),
	journalEntry("u2", "a1", "user", "abandoned prompt"),
	journalEntry("a2", "u2", "assistant", "abandoned answer"),
	journalEntry("u3", "a1", "user", "kept prompt"),
	journalEntry("a3", "u3", "assistant", "kept answer"),
];

describe("a Journal the harness rewound", () => {
	test("holds only the branch the harness is on", async () => {
		const turns = await readJournal(await journalOf(REWOUND));

		expect(turns.map((turn) => turn.prompt)).toEqual([
			"first prompt",
			"kept prompt",
		]);
		expect(turns.map((turn) => turn.turnIndex)).toEqual([0, 1]);
	});

	test("follows a leaf the harness names over the file's last entry", async () => {
		const turns = await readJournal(await journalOf(REWOUND), "a2");

		expect(turns.map((turn) => turn.prompt)).toEqual([
			"first prompt",
			"abandoned prompt",
		]);
	});

	test("ends a Turn at a leaf inside it", async () => {
		const turns = await readJournal(await journalOf(REWOUND), "u2");

		expect(turns.at(-1)?.messages.map((message) => message.content)).toEqual([
			"abandoned prompt",
		]);
	});

	test("a leaf the Journal does not hold falls back to the last entry", async () => {
		const turns = await readJournal(await journalOf(REWOUND), "gone");

		expect(turns.map((turn) => turn.prompt)).toEqual([
			"first prompt",
			"kept prompt",
		]);
	});

	test("a Journal without a tree is read in file order", async () => {
		const untreed = REWOUND.map(({ type, message }) => ({ type, message }));

		const turns = await readJournal(await journalOf(untreed));

		expect(turns.map((turn) => turn.prompt)).toEqual([
			"first prompt",
			"abandoned prompt",
			"kept prompt",
		]);
	});
});

describe("a pin written while a turn streams", () => {
	test("sits between a call and its result without splitting the turn", async () => {
		const entries = [
			journalEntry("u1", null, "user", "read it"),
			{ type: "message", id: "a1", parentId: "u1", message: toolCall("read", { path: "a" }, "c1") },
			{
				type: "custom",
				id: "p1",
				parentId: "a1",
				customType: PIN_ENTRY,
				data: { op: "add", id: 1, text: "use tabs" },
			},
			{ type: "message", id: "r1", parentId: "p1", message: toolResult("contents", "c1") },
			journalEntry("a2", "r1", "assistant", "done"),
		];

		const turns = await readJournal(await journalOf(entries));

		expect(turns).toHaveLength(1);
		expect(turns[0]?.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);
	});
});

/**
 * Turns `from`..`to`, each a prompt, a tool call, its result and an answer,
 * chained from `parent`: Turn t's messages are `u<t>`, `a<t>`, `r<t>`, `b<t>`.
 */
function toolTurns(from: number, to: number, parent: string | null) {
	const entries: object[] = [];
	let last = parent;
	for (let t = from; t <= to; t++) {
		entries.push(
			journalEntry(`u${t}`, last, "user", `prompt ${t}`),
			{ type: "message", id: `a${t}`, parentId: `u${t}`, message: toolCall("read", { path: `f${t}` }, `c${t}`) },
			{ type: "message", id: `r${t}`, parentId: `a${t}`, message: toolResult(`contents ${t}`, `c${t}`) },
			journalEntry(`b${t}`, `r${t}`, "assistant", `answer ${t}`),
		);
		last = `b${t}`;
	}
	return entries;
}

const compaction = (id: string, parentId: string, firstKeptEntryId: string) => ({
	type: "compaction",
	id,
	parentId,
	firstKeptEntryId,
	summary: "what came before",
});

describe("readBranch", () => {
	test("places a compaction between Turns and the message it kept part-way through a Turn", async () => {
		const path = await journalOf([...toolTurns(0, 7, null), compaction("k1", "b7", "r6"), ...toolTurns(8, 9, "k1")]);

		const { turns, compactions } = await readBranch(path);

		expect(turns).toHaveLength(10);
		expect(compactions).toEqual([{ id: "k1", before: { turn: 8, message: 0 }, firstKept: { turn: 6, message: 2 } }]);
	});

	test("a compaction mid-Turn comes before the next message of that Turn", async () => {
		const entries = toolTurns(0, 3, null);
		// Compacted between Turn 3's tool result and its answer.
		const answer = entries.pop() as { parentId: string };
		const path = await journalOf([...entries, compaction("k1", "r3", "u2"), { ...answer, parentId: "k1" }]);

		const { compactions } = await readBranch(path);

		expect(compactions).toEqual([{ id: "k1", before: { turn: 3, message: 3 }, firstKept: { turn: 2, message: 0 } }]);
	});

	test("a kept entry that is not a message resolves to the message after it", async () => {
		const path = await journalOf([
			...toolTurns(0, 1, null),
			{ type: "model_change", id: "m1", parentId: "b1", model: "x" },
			...toolTurns(2, 3, "m1"),
			compaction("k1", "b3", "m1"),
		]);

		const { compactions } = await readBranch(path);

		expect(compactions[0]?.firstKept).toEqual({ turn: 2, message: 0 });
	});

	test("a kept entry the branch does not hold leaves the compaction without one", async () => {
		const path = await journalOf([...toolTurns(0, 2, null), compaction("k1", "b2", "gone"), ...toolTurns(3, 3, "k1")]);

		const { compactions } = await readBranch(path);

		expect(compactions).toHaveLength(1);
		expect(compactions[0]?.firstKept).toBeUndefined();
	});

	test("a compaction on an abandoned branch is not returned", async () => {
		const path = await journalOf([
			...toolTurns(0, 2, null),
			compaction("k1", "b2", "u1"),
			journalEntry("x", "k1", "user", "abandoned"),
			...toolTurns(3, 3, "b2"),
		]);

		const { turns, compactions } = await readBranch(path);

		expect(turns.map((turn) => turn.prompt)).toEqual(["prompt 0", "prompt 1", "prompt 2", "prompt 3"]);
		expect(compactions).toEqual([]);
	});
});
