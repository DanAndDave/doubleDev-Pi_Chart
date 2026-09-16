// Store-backed: ranking by distance is the database's job, so a fake would
// only prove our arithmetic. Needs `docker compose up -d` and CM_DATABASE_URL.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { assemble } from "../src/assembler.ts";
import { StubEmbedder } from "../src/embedder.ts";
import type { JournalTurn } from "../src/journal.ts";
import { PostgresStore } from "../src/postgres-store.ts";

const databaseUrl = process.env.CM_DATABASE_URL;
const describeStore = databaseUrl ? describe : describe.skip;

/** Wide enough to admit everything: these cases are about ranking, not relevance. */
const PERMISSIVE = 2;

function subject(index: number, prompt: string, answer: string): JournalTurn {
	return {
		turnIndex: index,
		prompt,
		messages: [
			{ role: "user", content: prompt },
			{ role: "assistant", content: answer },
		],
		callCount: 1,
	};
}

const CONVERSATION: JournalTurn[] = [
	subject(0, "how should we cache parsed config", "keep the parsed config in memory"),
	subject(1, "what colour should the banner be", "a muted green banner"),
	subject(2, "when do we run migrations", "migrations run forward on connect"),
];

describeStore("recall against a real store", () => {
	let store: PostgresStore;

	beforeAll(async () => {
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
	});

	beforeEach(async () => {
		await store.truncate();
	});

	test("an ingested turn becomes retrievable once embedded", async () => {
		await store.ingest("conv-1", CONVERSATION);

		expect((await store.similarTurns("conv-1", "caching", 3, PERMISSIVE)).turns).toHaveLength(0);
		while ((await store.embedPending("conv-1")) > 0);

		expect((await store.similarTurns("conv-1", "caching", 3, PERMISSIVE)).turns.length).toBeGreaterThan(0);
	});

	test("the turn on the matching subject ranks first", async () => {
		await store.ingest("conv-1", CONVERSATION);
		while ((await store.embedPending("conv-1")) > 0);

		const [closest] = (
			await store.similarTurns("conv-1", "cache the parsed config", 3, PERMISSIVE)
		).turns;

		expect(closest?.turnIndex).toBe(0);
	});

	test("a recalled turn comes back whole", async () => {
		await store.ingest("conv-1", CONVERSATION);
		while ((await store.embedPending("conv-1")) > 0);

		const [closest] = (await store.similarTurns("conv-1", "migrations", 1, PERMISSIVE)).turns;

		expect(closest?.turn.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
	});

	test("retrieval never reaches into another conversation", async () => {
		await store.ingest("conv-1", CONVERSATION);
		await store.ingest("conv-2", [subject(0, "how should we cache parsed config", "theirs")]);
		while ((await store.embedPending()) > 0);

		const { turns: found } = await store.similarTurns("conv-2", "cache the parsed config", 10, PERMISSIVE);

		expect(found).toHaveLength(1);
		expect(found[0]?.turn.messages[1]?.content).toBe("theirs");
	});

	test("backfill embeds only what still lacks a vector", async () => {
		await store.ingest("conv-1", CONVERSATION);
		while ((await store.embedPending("conv-1")) > 0);

		await store.ingest("conv-1", [...CONVERSATION, subject(3, "one more", "answered")]);

		expect(await store.embedPending("conv-1")).toBe(1);
		expect(await store.embedPending("conv-1")).toBe(0);
	});

	test("a conversation with no vectors retrieves nothing rather than failing", async () => {
		await store.ingest("conv-1", CONVERSATION);

		expect((await store.similarTurns("conv-1", "anything", 5, PERMISSIVE)).turns).toEqual([]);
	});

	test("equally similar turns come back in a stable order", async () => {
		// Identical text: the distance is the same, so only the tie-break
		// keeps the order from wandering between queries.
		await store.ingest("conv-1", [
			subject(0, "the same words exactly", "one"),
			subject(1, "the same words exactly", "two"),
			subject(2, "the same words exactly", "three"),
		]);
		while ((await store.embedPending("conv-1")) > 0);

		const { turns: first } = await store.similarTurns("conv-1", "the same words exactly", 3, PERMISSIVE);
		const { turns: second } = await store.similarTurns("conv-1", "the same words exactly", 3, PERMISSIVE);

		expect(first.map((each) => each.turnIndex)).toEqual([0, 1, 2]);
		expect(second.map((each) => each.turnIndex)).toEqual(
			first.map((each) => each.turnIndex),
		);
	});

	test("a wrongly sized embedder is an error, not a bad neighbour", async () => {
		const mismatched = PostgresStore.connect(
			databaseUrl ?? "",
			new StubEmbedder(128),
		);
		await store.ingest("conv-1", CONVERSATION);

		await expect(mismatched.embedPending("conv-1")).rejects.toThrow(/dimensions/);
		await mismatched.close();
	});
});

describeStore("per-part detail round-trips", () => {
	let store: PostgresStore;

	beforeAll(async () => {
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
	});

	beforeEach(async () => {
		await store.truncate();
	});

	test("a recalled part's turns and budget survive a round trip", async () => {
		const pack = assemble(
			{
				turns: [
					{ index: 1, prompt: "recent", messages: [{ role: "user", content: "recent" }] },
					{ prompt: "current", messages: [{ role: "user", content: "current" }] },
				],
				recalled: [
					{ turnIndex: 7, turn: { index: 7, prompt: "older", messages: [] } },
					{ turnIndex: 9, turn: { index: 9, prompt: "oldest", messages: [] } },
				],
			},
			{ tailTurns: 2, recallTurns: 1 },
		);
		await store.recordPack("conv-1", { turnIndex: 0, callIndex: 0 }, pack, "thread-store");

		const [turn] = await store.readAccounting("conv-1");
		const recalledPart = turn?.calls[0]?.parts.find(
			(part) => part.source === "recalled",
		);
		expect(recalledPart?.turnIndices).toEqual([7]);
		expect(recalledPart?.budget).toBe(1);
		expect(recalledPart?.candidates).toBe(2);
	});

	test("a call recorded without the detail still reads back", async () => {
		// Written the way an earlier version wrote it: source and size only.
		await store["sql"]`
			INSERT INTO call_accounting
				(conversation_id, turn_index, call_index, parts, approximate_tokens)
			VALUES ('conv-1', 0, 0,
				'[{"source":"verbatim-tail","approximateTokens":12}]'::jsonb, 12)`;

		const [turn] = await store.readAccounting("conv-1");

		const part = turn?.calls[0]?.parts[0];
		expect(part?.source).toBe("verbatim-tail");
		expect(part?.turnIndices).toBeUndefined();
		expect(part?.approximate).toBe(true);
	});
});

describeStore("the relevance threshold", () => {
	let store: PostgresStore;

	beforeAll(async () => {
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
	});

	beforeEach(async () => {
		await store.truncate();
		await store.ingest("conv-1", CONVERSATION);
		while ((await store.embedPending("conv-1")) > 0);
	});

	test("a turn below the threshold is absent even when nothing ranks above it", async () => {
		// Nothing can be this near: the floor, not the ranking, decides.
		const { turns } = await store.similarTurns("conv-1", "caching", 3, 0.01);

		expect(turns).toEqual([]);
	});

	test("rejections are counted from the turns that would have competed", async () => {
		// Only the nearest `limit` are contenders, so the count describes
		// this retrieval rather than the length of the Conversation.
		const { rejected } = await store.similarTurns("conv-1", "caching", 2, 0.01);

		expect(rejected).toBe(2);
	});

	test("a threshold that admits everything does not disturb the ranking", async () => {
		// A probe sharing wording with one Turn, so the order is meaningful
		// rather than a tie-break; 1.0 admits this whole corpus without being
		// the maximum, so the comparison is against a different query.
		const probe = "cache the parsed config";
		const withThreshold = await store.similarTurns("conv-1", probe, 3, 1);
		const wideOpen = await store.similarTurns("conv-1", probe, 3, 2);

		expect(withThreshold.turns.map((each) => each.turnIndex)).toEqual(
			wideOpen.turns.map((each) => each.turnIndex),
		);
		expect(withThreshold.turns.length).toBeGreaterThan(1);
		expect(withThreshold.turns[0]?.turnIndex).toBe(0);
	});

	test("retrieval reports how many it refused", async () => {
		const strict = await store.similarTurns("conv-1", "caching", 3, 0.01);
		const permissive = await store.similarTurns("conv-1", "caching", 3, 2);

		expect(strict.rejected).toBe(CONVERSATION.length);
		expect(permissive.rejected).toBe(0);
	});

	test("the floor applies before the limit, so over-fetching stays relevant", async () => {
		// Asking for more than exists must not drag in rejected Turns.
		const { turns } = await store.similarTurns("conv-1", "caching", 100, 0.01);

		expect(turns).toEqual([]);
	});
});
