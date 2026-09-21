// Store-backed: what makes a stored vector valid, and what a
// Conversation-scoped recall guarantees to return. Both are claims about
// real SQL over a real corpus, so a fake would only prove our arithmetic.
// Needs CM_DATABASE_URL.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";

import { embedText } from "../src/embed-text.ts";
import {
	QUERY_INSTRUCTION,
	StubEmbedder,
	type Embedder,
	type EmbedderIdentity,
} from "../src/embedder.ts";
import type { JournalTurn } from "../src/journal.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { PostgresStore } from "../src/postgres-store.ts";

const databaseUrl = process.env.CM_DATABASE_URL;
const describeStore = databaseUrl ? describe : describe.skip;

/** Wide enough to admit everything: these cases are not about relevance. */
const PERMISSIVE = 2;

/**
 * A stand-in for the asymmetry the pinned model has: a query is embedded
 * from different text than a passage, so a derivation applied to the wrong
 * side is visible in the vector rather than invisible.
 */
class AsymmetricEmbedder implements Embedder {
	private readonly inner = new StubEmbedder();

	async identity(): Promise<EmbedderIdentity> {
		return this.inner.identity();
	}

	async embed(texts: string[]): Promise<number[][]> {
		return this.inner.embed(texts);
	}

	async embedQuery(texts: string[]): Promise<number[][]> {
		return this.inner.embed(texts.map((text) => `${QUERY_INSTRUCTION}${text}`));
	}
}

function subject(index: number, prompt: string, answer: string): JournalTurn {
	return {
		turnIndex: index,
		prompt,
		messages: [
			{ role: "user", content: prompt },
			{ role: "assistant", content: answer },
		],
		callCount: 1,
		calls: [0, 0],
	};
}

/** Cosine distance, which is what `<=>` returns and what thresholds mean. */
function distance(a: number[], b: number[]): number {
	let dot = 0;
	for (const [index, value] of a.entries()) dot += value * (b[index] ?? 0);
	return 1 - dot;
}

describeStore("a stored vector's validity", () => {
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

	test("a changed turn is not recalled on the content it lost", async () => {
		await store.ingest("conv-1", [
			subject(0, "where do migrations run", "migrations run forward on connect"),
		]);
		while ((await store.embedPending("conv-1")) > 0);

		await store.ingest("conv-1", [
			subject(0, "where do migrations run", "migrations now run from the installer"),
		]);

		const { turns } = await store.similarTurns(
			"conv-1",
			"forward on connect",
			5,
			PERMISSIVE,
		);
		expect(turns).toEqual([]);
	});

	test("a changed turn becomes findable by its new content once embedding runs", async () => {
		await store.ingest("conv-1", [
			subject(0, "where do migrations run", "migrations run forward on connect"),
		]);
		while ((await store.embedPending("conv-1")) > 0);
		await store.ingest("conv-1", [
			subject(0, "where do migrations run", "migrations now run from the installer"),
		]);

		while ((await store.embedPending("conv-1")) > 0);

		const { turns } = await store.similarTurns(
			"conv-1",
			"run from the installer",
			5,
			PERMISSIVE,
		);
		expect(turns).toHaveLength(1);
	});

	test("an unchanged turn is not embedded a second time", async () => {
		const conversation = [subject(0, "one subject", "one answer")];
		await store.ingest("conv-1", conversation);
		while ((await store.embedPending("conv-1")) > 0);

		await store.ingest("conv-1", conversation);

		expect(await store.embedPending("conv-1")).toBe(0);
	});

	test("an embedding pass for one conversation embeds only that one", async () => {
		// This session's Conversation goes first, so a scoped pass that
		// reached into others would spend the batch on the wrong Turns.
		await store.ingest("conv-1", [subject(0, "ours", "our answer")]);
		await store.ingest("conv-2", [
			subject(0, "theirs", "their answer"),
			subject(1, "theirs again", "their other answer"),
		]);

		expect(await store.embedPending("conv-1")).toBe(1);
		expect(await store.embedPending("conv-1")).toBe(0);
		// The other Conversation's Turns are untouched: recall finds none of
		// them, and they are still waiting for the unscoped pass.
		expect(
			(await store.similarTurns("conv-2", "theirs", 5, PERMISSIVE)).turns,
		).toEqual([]);
		expect(await store.embedPending()).toBe(2);
	});

	test("a turn awaiting re-embedding is still part of the conversation", async () => {
		await store.ingest("conv-1", [subject(0, "a subject", "an answer")]);
		while ((await store.embedPending("conv-1")) > 0);

		await store.ingest("conv-1", [subject(0, "a subject", "a different answer")]);

		const [turn] = await store.recentTurns("conv-1", 5);
		expect(turn?.messages[1]?.content).toBe("a different answer");
		expect(await store.embedPending("conv-1")).toBe(1);
	});

	test("a vector from another model is never a hit", async () => {
		const other = PostgresStore.connect(
			databaseUrl ?? "",
			new StubEmbedder(384, "another-model"),
		);
		await other.ingest("conv-1", [subject(0, "caching", "keep it in memory")]);
		while ((await other.embedPending("conv-1")) > 0);

		const { turns } = await store.similarTurns("conv-1", "caching", 5, PERMISSIVE);

		expect(turns).toEqual([]);
		await other.close();
	});

	test("a vector from another model is pending work, and is re-embedded", async () => {
		const other = PostgresStore.connect(
			databaseUrl ?? "",
			new StubEmbedder(384, "another-model"),
		);
		await other.ingest("conv-1", [subject(0, "caching", "keep it in memory")]);
		while ((await other.embedPending("conv-1")) > 0);

		expect(await store.embedPending("conv-1")).toBe(1);

		const { turns } = await store.similarTurns("conv-1", "caching", 5, PERMISSIVE);
		expect(turns).toHaveLength(1);
		await other.close();
	});

	test("vectors of another model are reported, with both models named", async () => {
		const other = PostgresStore.connect(
			databaseUrl ?? "",
			new StubEmbedder(384, "another-model"),
		);
		await other.ingest("conv-1", [
			subject(0, "caching", "keep it in memory"),
			subject(1, "migrations", "forward on connect"),
		]);
		while ((await other.embedPending("conv-1")) > 0);

		expect(await store.vectorModels()).toEqual({
			inUse: "stub",
			others: [{ model: "another-model", turns: 2 }],
		});
		await other.close();
	});

	test("a stored vector is of the turn's text, not of a query for it", async () => {
		// A model that treats a query differently from a passage, which is
		// what the pinned one does: if the derivation ever reached the
		// storing side, the stored vector would stop being the text's.
		const asymmetric = new AsymmetricEmbedder();
		const store = PostgresStore.connect(databaseUrl ?? "", asymmetric);
		const turn = subject(0, "where do migrations run", "forward on connect");
		await store.ingest("conv-1", [turn]);
		while ((await store.embedPending("conv-1")) > 0);

		const sql = new SQL(databaseUrl ?? "");
		const [row] = (await sql`
			SELECT embedding::text AS embedding FROM turns
			WHERE conversation_id = 'conv-1' AND turn_index = 0`) as {
			embedding: string;
		}[];
		const stored = JSON.parse(row?.embedding ?? "[]") as number[];
		const text = embedText(turn.messages);
		const [passage] = await asymmetric.embed([text]);
		const [asQuery] = await asymmetric.embedQuery([text]);

		// float4 in the column, so identity is a distance rather than an
		// equality; the query-side vector of the same text is far enough
		// away that storing one instead of the other could not hide here.
		expect(distance(stored, passage ?? [])).toBeLessThan(1e-6);
		expect(distance(stored, asQuery ?? [])).toBeGreaterThan(0.01);
		await sql.end();
		await store.close();
	});
});

describeStore("what a turn is findable by", () => {
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

	test("a turn is findable by what it did, not only by what it said", async () => {
		// The subject is in the call's arguments and nowhere else in the
		// Turn, which is the case a text-blocks-only embed text lost.
		await store.ingest("conv-1", [
			{
				turnIndex: 0,
				prompt: "check that file",
				messages: [
					{ role: "user", content: "check that file" },
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "c1",
								name: "read",
								arguments: { path: "ledger/sharding.md" },
							},
						],
					},
					{
						role: "toolResult",
						toolCallId: "c1",
						toolName: "read",
						content: [{ type: "text", text: "nothing surprising" }],
					},
					{ role: "assistant", content: "it is as expected" },
				],
				callCount: 1,
				calls: [0, 0, 0, 0],
			},
		]);
		while ((await store.embedPending("conv-1")) > 0);

		// A strict minimum, so this asks whether the subject is in the
		// vector at all rather than whether it is the only Turn there.
		const { turns } = await store.similarTurns("conv-1", "ledger sharding", 3, 0.8);

		expect(turns.map((each) => each.turnIndex)).toEqual([0]);
	});

	test("a turn is findable by what it concluded, past everything it read", async () => {
		// Twenty results ahead of the conclusion: the Turn must still be
		// reachable by the sentence it ended on.
		const messages: HarnessMessage[] = [
			{ role: "user", content: "work out where the deadlock comes from" },
		];
		for (let index = 0; index < 20; index++) {
			messages.push({
				role: "toolResult",
				toolCallId: `c${index}`,
				toolName: "read",
				content: [{ type: "text", text: `unremarkable file ${index} `.repeat(200) }],
			});
		}
		messages.push({
			role: "assistant",
			content: "the deadlock is the migration lock taken twice on one connection",
		});
		await store.ingest("conv-1", [
			{
				turnIndex: 0,
				prompt: "work out where the deadlock comes from",
				messages,
				callCount: 1,
				calls: messages.map(() => 0),
			},
			subject(1, "something else entirely", "a muted green banner"),
		]);
		while ((await store.embedPending("conv-1")) > 0);

		const { turns } = await store.similarTurns(
			"conv-1",
			"migration lock taken twice on one connection",
			1,
			PERMISSIVE,
		);

		expect(turns.map((each) => each.turnIndex)).toEqual([0]);
	});
});

describeStore("a conversation-scoped recall", () => {
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

	/** Turns of other Conversations, nearer the probe than ours will be. */
	async function crowd(conversations: number, each: number): Promise<void> {
		for (let index = 0; index < conversations; index++) {
			await store.ingest(
				`crowd-${index}`,
				Array.from({ length: each }, (_, turn) =>
					subject(turn, "cache the parsed config", "cache the parsed config exactly"),
				),
			);
		}
		while ((await store.embedPending()) > 0);
	}

	test("every qualifying turn is returned though other conversations dominate", async () => {
		await store.ingest(
			"conv-1",
			Array.from({ length: 4 }, (_, turn) =>
				subject(turn, "cache the parsed config", `answer ${turn}`),
			),
		);
		while ((await store.embedPending("conv-1")) > 0);
		await crowd(40, 5);

		const { turns } = await store.similarTurns(
			"conv-1",
			"cache the parsed config",
			4,
			PERMISSIVE,
		);

		expect(turns.map((each) => each.turnIndex)).toEqual([0, 1, 2, 3]);
	});

	test("a growing corpus does not change one conversation's recall", async () => {
		await store.ingest(
			"conv-1",
			Array.from({ length: 4 }, (_, turn) =>
				subject(turn, `subject ${turn} about caching`, `answer ${turn}`),
			),
		);
		while ((await store.embedPending("conv-1")) > 0);
		const before = await store.similarTurns("conv-1", "caching", 4, PERMISSIVE);

		await crowd(40, 5);
		const after = await store.similarTurns("conv-1", "caching", 4, PERMISSIVE);

		expect(after.turns.map((each) => each.turnIndex)).toEqual(
			before.turns.map((each) => each.turnIndex),
		);
	});

	test("coming back short reads differently from nothing being relevant", async () => {
		await store.ingest("conv-1", [
			subject(0, "caching", "keep it in memory"),
			subject(1, "migrations", "forward on connect"),
			subject(2, "banners", "a muted green"),
		]);
		while ((await store.embedPending("conv-1")) > 0);
		// A Turn ingested and not yet embedded: the search cannot see it.
		await store.ingest("conv-1", [subject(3, "deadlines", "per store")]);

		const short = await store.similarTurns("conv-1", "caching", 4, PERMISSIVE);
		const irrelevant = await store.similarTurns("conv-1", "caching", 4, 0.01);

		expect(short.turns.length).toBeLessThan(4);
		expect(short.unsearched).toBe(1);
		expect(short.rejected).toBe(0);
		expect(irrelevant.turns).toEqual([]);
		expect(irrelevant.rejected).toBe(3);
		expect(irrelevant.unsearched).toBe(1);
	});
});
