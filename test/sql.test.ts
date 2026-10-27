import { describe, expect, test } from "bun:test";

import { connectionOptions, type Sql, sharedSql } from "../src/sql.ts";

describe("connecting from a saved url", () => {
	test("a TCP url is handed over as it is", () => {
		const url = "postgres://pi_chart:pi_chart@localhost:55432/thread_store";
		expect(connectionOptions(url)).toBe(url);
	});

	test("a socket directory becomes the socket path Bun dials", () => {
		// Bun's client refuses every socket url form, and accepts a path.
		expect(
			connectionOptions("postgres://me@localhost:5433/pi_chart?host=/run/postgresql"),
		).toEqual({
			path: "/run/postgresql/.s.PGSQL.5433",
			username: "me",
			password: undefined,
			database: "pi_chart",
		});
	});

	test("the socket's port defaults to Postgres's own", () => {
		expect(
			connectionOptions("postgres://me:p%40ss@localhost/pi_chart?host=%2Ftmp"),
		).toEqual({
			path: "/tmp/.s.PGSQL.5432",
			username: "me",
			password: "p@ss",
			database: "pi_chart",
		});
	});

	test("a host that names a machine, not a directory, stays a url", () => {
		const url = "postgres://me@localhost/pi_chart?host=db.example";
		expect(connectionOptions(url)).toBe(url);
	});
});

describe("shares of a url's pool", () => {
	/** A pool factory that builds stand-ins and counts what it built and ended. */
	function pools() {
		const built: string[] = [];
		const ended: string[] = [];
		const open = (url: string): Sql => {
			built.push(url);
			const pool = (() => ({ url })) as unknown as Sql;
			pool.unsafe = async () => [url];
			pool.begin = async (fn) => fn(pool);
			pool.end = async () => {
				ended.push(url);
			};
			return pool;
		};
		return { open, built, ended };
	}

	// Each test its own URL: the registry is the process's, shared with
	// every other test in it, as it is shared with every session.
	const url = (name: string) => `postgres://test@localhost/${name}-${process.pid}`;

	test("two holders of one url share one pool", async () => {
		const { open, built } = pools();
		const main = sharedSql(url("shared"), open);
		const subagent = sharedSql(url("shared"), open);

		expect(built).toEqual([url("shared")]);
		expect(await subagent.unsafe("SELECT 1")).toEqual([url("shared")]);
		await main.end();
		await subagent.end();
	});

	test("a second close from one holder gives back one share", async () => {
		const { open, ended } = pools();
		const main = sharedSql(url("twice"), open);
		const subagent = sharedSql(url("twice"), open);

		await subagent.end();
		await subagent.end();

		expect(ended).toEqual([]);
		expect(await main.unsafe("SELECT 1")).toEqual([url("twice")]);
		await main.end();
		expect(ended).toEqual([url("twice")]);
	});

	test("the last holder ends the pool, and the next open builds a fresh one", async () => {
		const { open, built, ended } = pools();
		const first = sharedSql(url("last"), open);
		const second = sharedSql(url("last"), open);
		await first.end();
		await second.end();
		expect(ended).toEqual([url("last")]);

		const later = sharedSql(url("last"), open);
		expect(built).toEqual([url("last"), url("last")]);
		await later.end();
		expect(ended).toEqual([url("last"), url("last")]);
	});

	test("a holder that gave back its share refuses queries", async () => {
		const { open } = pools();
		const kept = sharedSql(url("refused"), open);
		const closed = sharedSql(url("refused"), open);
		await closed.end();

		// The pool is still open for `kept`; a closed store must not run
		// on it all the same, as it could not when it owned its pool.
		expect(() => closed`SELECT 1`).toThrow("closed");
		await expect(closed.unsafe("SELECT 1")).rejects.toThrow("closed");
		await expect(closed.begin(async () => undefined)).rejects.toThrow("closed");
		await kept.end();
	});

	test("two urls are two pools", async () => {
		const { open, built } = pools();
		const one = sharedSql(url("one"), open);
		const other = sharedSql(url("other"), open);

		expect(built).toEqual([url("one"), url("other")]);
		await one.end();
		await other.end();
	});

	test("the extension imported again finds the same pool", async () => {
		// omp loads the extension once per session, subagents included, and
		// a second load is a second copy of every module. Imported at run
		// time because a second copy is the boundary under test: a query
		// string makes Bun load the module afresh.
		const again = "../src/sql.ts?again";
		const copy = (await import(again)) as { sharedSql: typeof sharedSql };
		expect(copy.sharedSql).not.toBe(sharedSql);

		const { open, built, ended } = pools();
		const main = sharedSql(url("reimported"), open);
		const subagent = copy.sharedSql(url("reimported"), open);
		expect(built).toEqual([url("reimported")]);

		await main.end();
		expect(ended).toEqual([]);
		await subagent.end();
		expect(ended).toEqual([url("reimported")]);
	});
});
