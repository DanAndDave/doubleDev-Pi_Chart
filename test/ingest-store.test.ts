// Store-backed: what a sweep writes, and what it refuses to write again.
// Both are claims about real SQL — statements issued, rows left alone — so a
// fake would only prove our arithmetic. Needs CM_DATABASE_URL.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";

import { StubEmbedder } from "../src/embedder.ts";
import type { JournalTurn } from "../src/journal.ts";
import type { HarnessMessage } from "../src/messages.ts";
import { PostgresStore } from "../src/postgres-store.ts";

const databaseUrl = process.env.CM_DATABASE_URL;
const describeStore = databaseUrl ? describe : describe.skip;

const HERE = "/repo";
const BELOW = "/repo/packages/inner";

function turn(index: number, messages = 2): JournalTurn {
	const content: HarnessMessage[] = [
		{ role: "user", content: `prompt ${index}` },
	];
	for (let extra = 1; extra < messages; extra++) {
		content.push({ role: "assistant", content: `answer ${index}.${extra}` });
	}
	return {
		turnIndex: index,
		prompt: `prompt ${index}`,
		messages: content,
		callCount: 1,
		calls: content.map(() => 0),
	};
}

/**
 * A `sql` tag that counts the statements the Store asks it to run, so "the
 * work is proportional to what is new" is a measurement rather than a claim.
 */
function counting(inner: SQL): { sql: SQL; since: () => number } {
	let statements = 0;
	const run = inner as unknown as (
		strings: TemplateStringsArray,
		...values: unknown[]
	) => unknown;
	const tag = ((strings: TemplateStringsArray, ...values: unknown[]) => {
		statements++;
		return run(strings, ...values);
	}) as unknown as SQL;
	for (const key of ["unsafe", "begin", "end", "close", "reserve"] as const) {
		const method = (inner as unknown as Record<string, unknown>)[key];
		if (typeof method === "function") {
			(tag as unknown as Record<string, unknown>)[key] = method.bind(inner);
		}
	}
	let mark = 0;
	return {
		sql: tag,
		since: () => {
			const spent = statements - mark;
			mark = statements;
			return spent;
		},
	};
}

describeStore("where a turn happened", () => {
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

	/** What the corpus-wide search reports a Turn's Codebase as. */
	async function codebaseOf(index: number): Promise<string | undefined> {
		const found = await store.searchAll(`prompt ${index}`, 10, 2);
		return found.find((each) => each.turnIndex === index)?.codebase;
	}

	test("a turn keeps the codebase it was first stored with", async () => {
		await store.ingest("conv-1", [turn(0)], HERE);
		while ((await store.embedPending("conv-1")) > 0);

		await store.ingest("conv-1", [turn(0), turn(1)], BELOW);

		expect(await codebaseOf(0)).toBe(HERE);
	});

	test("a turn stored for the first time records where that ingest ran", async () => {
		await store.ingest("conv-1", [turn(0)], HERE);

		await store.ingest("conv-1", [turn(0), turn(1)], BELOW);
		while ((await store.embedPending("conv-1")) > 0);

		expect(await codebaseOf(1)).toBe(BELOW);
	});

	test("a turn stored without a codebase is not backfilled with one", async () => {
		await store.ingest("conv-1", [turn(0)]);

		await store.ingest("conv-1", [turn(0), turn(1)], BELOW);
		while ((await store.embedPending("conv-1")) > 0);

		expect(await codebaseOf(0)).toBeUndefined();
	});
});

describeStore("what a sweep costs", () => {
	let store: PostgresStore;
	let sql: SQL;
	let counter: { sql: SQL; since: () => number };

	beforeAll(async () => {
		sql = new SQL(databaseUrl ?? "");
		counter = counting(sql);
		store = new PostgresStore(counter.sql, new StubEmbedder());
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
	});

	beforeEach(async () => {
		await store.truncate();
	});

	test("re-ingesting an unchanged conversation writes nothing", async () => {
		const conversation = [turn(0), turn(1), turn(2)];
		await store.ingest("conv-1", conversation, HERE);
		const before = await sql`SELECT max(xmin::text::bigint) AS mark FROM turns`;
		counter.since();

		const stored = await store.ingest("conv-1", conversation, HERE);

		// One read to find the head, and nothing else.
		expect(stored).toBe(0);
		expect(counter.since()).toBe(1);
		const after = await sql`SELECT max(xmin::text::bigint) AS mark FROM turns`;
		expect(after[0]?.mark).toBe(before[0]?.mark);
	});

	test("a conversation that grew costs only what is new", async () => {
		const conversation = [turn(0), turn(1), turn(2)];
		await store.ingest("conv-1", conversation, HERE);
		counter.since();

		const stored = await store.ingest("conv-1", [...conversation, turn(3)], HERE);

		expect(stored).toBe(1);
		// The head read, then one transaction of two statements for the new
		// Turn — not one per message of the Conversation.
		expect(counter.since()).toBeLessThanOrEqual(4);
		const [head] = await store.recentTurns("conv-1", 1);
		expect(head?.index).toBe(3);
	});

	test("a turn left unflushed at the last sweep is stored complete", async () => {
		// What `readJournal` hands over when the final line was still being
		// written: the Turn, one message short.
		await store.ingest("conv-1", [turn(0), turn(1, 2)], HERE);

		const stored = await store.ingest("conv-1", [turn(0), turn(1, 4)], HERE);

		expect(stored).toBe(1);
		const [, head] = await store.recentTurns("conv-1", 2);
		expect(head?.messages.map((message) => message.content)).toEqual([
			"prompt 1",
			"answer 1.1",
			"answer 1.2",
			"answer 1.3",
		]);
	});

	test("a sweep interrupted between turns leaves whole turns behind", async () => {
		const conversation = [turn(0), turn(1), turn(2)];
		// The third Turn cannot be written: its prompt is not a string the
		// column will take, so its transaction fails where the first two
		// have already committed.
		const broken = [...conversation];
		broken[2] = { ...turn(2), prompt: undefined as unknown as string };

		await expect(store.ingest("conv-1", broken, HERE)).rejects.toThrow();

		expect((await store.recentTurns("conv-1", 10)).map((each) => each.index)).toEqual([
			0, 1,
		]);
		expect(await store.ingest("conv-1", conversation, HERE)).toBe(1);
		expect((await store.recentTurns("conv-1", 10)).map((each) => each.index)).toEqual([
			0, 1, 2,
		]);
	});
});
