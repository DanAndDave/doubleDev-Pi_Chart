// Store-backed: when a Turn arrived, what retention removes, and what a
// session gives back. All three are claims about real rows and real
// connections. Needs CM_DATABASE_URL.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";

import { StubEmbedder } from "../src/embedder.ts";
import type { JournalTurn } from "../src/journal.ts";
import { PostgresStore } from "../src/postgres-store.ts";

const databaseUrl = process.env.CM_DATABASE_URL;
const describeStore = databaseUrl ? describe : describe.skip;

function turn(index: number): JournalTurn {
	return {
		turnIndex: index,
		prompt: `prompt ${index}`,
		messages: [
			{ role: "user", content: `prompt ${index}` },
			{ role: "assistant", content: `answer ${index}` },
		],
		callCount: 1,
		calls: [0, 0],
	};
}

describeStore("when a turn arrived", () => {
	let store: PostgresStore;
	let sql: SQL;

	beforeAll(async () => {
		sql = new SQL(databaseUrl ?? "");
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
		await sql?.end();
	});

	beforeEach(async () => {
		await store.truncate();
	});

	/** What the corpus-wide search reports about a Turn. */
	async function found(index: number) {
		while ((await store.embedPending()) > 0);
		const hits = await store.searchAll(`prompt ${index}`, 10, 2);
		return hits.find((each) => each.turnIndex === index);
	}

	test("an ingested turn carries the time it entered the store", async () => {
		const before = new Date();
		await store.ingest("conv-1", [turn(0)], "/repo");

		const arrived = (await found(0))?.ingestedAt;

		expect(arrived).toBeDefined();
		expect(new Date(arrived ?? 0).getTime()).toBeGreaterThanOrEqual(
			before.getTime() - 1_000,
		);
	});

	test("a later ingest does not restamp a turn", async () => {
		await store.ingest("conv-1", [turn(0)], "/repo");
		const first = (await found(0))?.ingestedAt;

		await store.ingest("conv-1", [turn(0), turn(1)], "/repo");

		expect((await found(0))?.ingestedAt).toBe(first);
	});

	test("a turn stored before arrival times were recorded stays undated", async () => {
		await store.ingest("conv-1", [turn(0)], "/repo");
		// What such a row looks like: the column exists and holds nothing,
		// because the migration filled nothing in.
		await sql`UPDATE turns SET ingested_at = NULL WHERE turn_index = 0`;

		expect((await found(0))?.ingestedAt).toBeUndefined();
	});
});

describeStore("retention", () => {
	let store: PostgresStore;
	let sql: SQL;

	beforeAll(async () => {
		sql = new SQL(databaseUrl ?? "");
		store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
		await store.migrate();
	});

	afterAll(async () => {
		await store?.close();
		await sql?.end();
	});

	beforeEach(async () => {
		await store.truncate();
	});

	/** Turns as they look after sitting in the Store for a while. */
	async function age(turnIndex: number, days: number): Promise<void> {
		await sql`
			UPDATE turns SET ingested_at = now() - ${`${days} days`}::interval
			WHERE turn_index = ${turnIndex}`;
	}

	test("turns past the age go, with their messages, and the count is reported", async () => {
		await store.ingest("conv-1", [turn(0), turn(1)], "/repo");
		await age(0, 90);

		const retired = await store.retire(30);

		expect(retired).toBe(1);
		expect((await store.recentTurns("conv-1", 10)).map((each) => each.index)).toEqual([
			1,
		]);
		const [messages] = await sql`
			SELECT count(*)::int AS left FROM turn_messages WHERE turn_index = 0`;
		expect(messages?.left).toBe(0);
	});

	test("turns within the age stay retrievable, tail and recall alike", async () => {
		await store.ingest("conv-1", [turn(0), turn(1)], "/repo");
		await age(0, 10);
		while ((await store.embedPending("conv-1")) > 0);

		await store.retire(30);

		expect((await store.recentTurns("conv-1", 10)).map((each) => each.index)).toEqual([
			0, 1,
		]);
		const { turns } = await store.similarTurns("conv-1", "prompt 0", 5, 2);
		expect(turns.map((each) => each.turnIndex)).toContain(0);
	});

	test("an undatable turn is left in place", async () => {
		await store.ingest("conv-1", [turn(0)], "/repo");
		await sql`UPDATE turns SET ingested_at = NULL`;

		expect(await store.retire(1)).toBe(0);
		expect(await store.recentTurns("conv-1", 10)).toHaveLength(1);
	});

	test("accounting outlives the turns it describes", async () => {
		await store.ingest("conv-1", [turn(0)], "/repo");
		await store.recordPack(
			"conv-1",
			{ turnIndex: 0, callIndex: 0 },
			{
				messages: [],
				parts: [],
				leadingTokens: 0,
				budgets: { tail: 8, recall: 4, docs: 2, graph: 3 },
				rejected: 0,
				unsearched: 0,
				conceptsUnsearched: 0,
				ceiling: 110_000,
				beforeCeiling: 42,
				approximateTokens: 42,
			},
			"thread-store",
			"off",
		);
		await age(0, 90);

		await store.retire(30);

		const accounting = await store.readAccounting("conv-1");
		expect(accounting[0]?.calls[0]?.approximateTokens).toBe(42);
	});
});

describeStore("what a session gives back", () => {
	test("repeated sessions do not accumulate connections", async () => {
		const watcher = new SQL(databaseUrl ?? "");
		async function connections(): Promise<number> {
			const [row] = await watcher`
				SELECT count(*)::int AS open FROM pg_stat_activity
				WHERE datname = current_database() AND pid <> pg_backend_pid()`;
			return row?.open ?? 0;
		}

		const baseline = await connections();
		let afterFirst = baseline;
		for (let session = 1; session <= 5; session++) {
			const store = PostgresStore.connect(databaseUrl ?? "", new StubEmbedder());
			await store.migrate();
			await store.recentTurns("conv-1", 4);
			await store.close();
			if (session === 1) afterFirst = await settled(baseline);
		}

		// Accumulation is the claim, so the comparison is session to
		// session: a backend the server has not reaped yet is noise that
		// does not grow, while a pool nobody closed grows with every
		// session — 200 of them over the 16.5 hours that prompted this.
		expect(await settled(afterFirst)).toBeLessThanOrEqual(afterFirst);
		await watcher.end();

		/**
		 * The count once the server agrees it is down to `target`, or the
		 * last count read if it never gets there. A closed client and a
		 * reaped backend are not the same instant, so this asks again
		 * rather than waiting on a clock; a pool nobody closed never comes
		 * down however many times it is asked.
		 */
		async function settled(target: number): Promise<number> {
			let open = await connections();
			for (let asked = 0; open > target && asked < 500; asked++) {
				open = await connections();
			}
			return open;
		}
	});
});
