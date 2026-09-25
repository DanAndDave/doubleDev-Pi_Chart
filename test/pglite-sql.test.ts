import { describe, expect, test } from "bun:test";

import { makeSql, type PgBackend } from "../src/pglite-sql.ts";

/** A backend that records nothing runs; compile-only tests never execute. */
function inertBackend(): PgBackend {
	return {
		run: async () => [],
		exec: async () => undefined,
		begin: async (fn) => fn(inertBackend()),
		close: async () => undefined,
	};
}

describe("compiling a tagged query", () => {
	test("interpolated values become ascending placeholders", () => {
		const sql = makeSql(inertBackend());
		const { text, params } = sql`SELECT * FROM t WHERE a = ${1} AND b = ${"x"}`.compile();

		expect(text).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
		expect(params).toEqual([1, "x"]);
	});

	test("a nested fragment is spliced inline with its params renumbered", () => {
		const sql = makeSql(inertBackend());
		const scope = sql`AND conversation_id = ${"c-1"}`;
		const { text, params } = sql`SELECT 1 WHERE model = ${"m"} ${scope} LIMIT ${5}`.compile();

		expect(text).toBe("SELECT 1 WHERE model = $1 AND conversation_id = $2 LIMIT $3");
		expect(params).toEqual(["m", "c-1", 5]);
	});

	test("an empty fragment contributes nothing", () => {
		const sql = makeSql(inertBackend());
		const empty = sql``;
		const { text, params } = sql`SELECT 1 ${empty} FROM t`.compile();

		expect(text).toBe("SELECT 1  FROM t");
		expect(params).toEqual([]);
	});

	test("an object helper becomes a single-row insert fragment", () => {
		const sql = makeSql(inertBackend());
		const { text, params } = sql`INSERT INTO schema_migrations ${sql({ version: 5 })}`.compile();

		expect(text).toBe('INSERT INTO schema_migrations ("version") VALUES ($1)');
		expect(params).toEqual([5]);
	});

	test("a rows helper becomes a multi-row insert fragment in column order", () => {
		const sql = makeSql(inertBackend());
		const rows = [
			{ a: 1, b: "x" },
			{ a: 2, b: "y" },
		];
		const { text, params } = sql`INSERT INTO t ${sql(rows)}`.compile();

		expect(text).toBe('INSERT INTO t ("a", "b") VALUES ($1, $2), ($3, $4)');
		expect(params).toEqual([1, "x", 2, "y"]);
	});
});
