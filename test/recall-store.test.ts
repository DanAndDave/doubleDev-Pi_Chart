// Store-backed: ranking by distance is the database's job, so a fake would
// only prove our arithmetic. Needs `docker compose up -d` and CM_DATABASE_URL.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { StubEmbedder } from "../src/embedder.ts";
import type { JournalTurn } from "../src/journal.ts";
import { PostgresStore } from "../src/postgres-store.ts";

const databaseUrl = process.env.CM_DATABASE_URL;
const describeStore = databaseUrl ? describe : describe.skip;

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

		expect(await store.similarTurns("conv-1", "caching", 3)).toHaveLength(0);
		while ((await store.embedPending("conv-1")) > 0);

		expect((await store.similarTurns("conv-1", "caching", 3)).length).toBeGreaterThan(0);
	});

	test("the turn on the matching subject ranks first", async () => {
		await store.ingest("conv-1", CONVERSATION);
		while ((await store.embedPending("conv-1")) > 0);

		const [closest] = await store.similarTurns(
			"conv-1",
			"cache the parsed config",
			3,
		);

		expect(closest?.turnIndex).toBe(0);
	});

	test("a recalled turn comes back whole", async () => {
		await store.ingest("conv-1", CONVERSATION);
		while ((await store.embedPending("conv-1")) > 0);

		const [closest] = await store.similarTurns("conv-1", "migrations", 1);

		expect(closest?.turn.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
	});

	test("retrieval never reaches into another conversation", async () => {
		await store.ingest("conv-1", CONVERSATION);
		await store.ingest("conv-2", [subject(0, "how should we cache parsed config", "theirs")]);
		while ((await store.embedPending()) > 0);

		const found = await store.similarTurns("conv-2", "cache the parsed config", 10);

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

		expect(await store.similarTurns("conv-1", "anything", 5)).toEqual([]);
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

		const first = await store.similarTurns("conv-1", "the same words exactly", 3);
		const second = await store.similarTurns("conv-1", "the same words exactly", 3);

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
