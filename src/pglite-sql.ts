import { mkdir } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

import type { Sql, SqlFragment, SqlQuery } from "./sql.ts";

/**
 * What the adapter needs from a database: run parameterised SQL, run raw
 * DDL, open a transaction on a handle of the same shape, and close. PGlite
 * and a PGlite transaction both provide this; keeping it this narrow is
 * what lets `makeSql` build its queries without a live connection.
 */
export interface PgBackend {
	run(text: string, params: unknown[]): Promise<Record<string, unknown>[]>;
	exec(text: string): Promise<void>;
	begin<T>(fn: (tx: PgBackend) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

/** A single row or many, tagged so `buildQuery` emits an insert fragment. */
interface InsertHelper {
	readonly __insert: readonly Record<string, unknown>[];
}

function isFragment(value: unknown): value is SqlFragment {
	return (
		typeof value === "object" &&
		value !== null &&
		"strings" in value &&
		"values" in value &&
		Array.isArray(value.strings) &&
		Array.isArray(value.values)
	);
}

function isInsert(value: unknown): value is InsertHelper {
	return (
		typeof value === "object" &&
		value !== null &&
		"__insert" in value &&
		Array.isArray(value.__insert)
	);
}

/** A Postgres identifier, double-quoted so case and keywords are safe. */
function ident(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/** `("a", "b") VALUES ($n, …), …` for one or more rows, in column order. */
function buildInsert(
	rows: readonly Record<string, unknown>[],
	start: number,
): { text: string; params: unknown[] } {
	const columns = Object.keys(rows[0] ?? {});
	const params: unknown[] = [];
	let n = start;
	const tuples = rows.map((row) => {
		const placeholders = columns.map((column) => {
			params.push(row[column]);
			n += 1;
			return `$${n}`;
		});
		return `(${placeholders.join(", ")})`;
	});
	const header = columns.map(ident).join(", ");
	return { text: `(${header}) VALUES ${tuples.join(", ")}`, params };
}

/**
 * Flatten a tagged template into parameterised text: literal segments pass
 * through, a nested fragment is spliced with its params renumbered, an
 * insert helper expands to its tuples, and every other value binds as the
 * next `$n`. `start` is the highest placeholder already used, so a spliced
 * fragment continues the outer numbering rather than restarting it.
 */
export function buildQuery(
	strings: readonly string[],
	values: readonly unknown[],
	start = 0,
): { text: string; params: unknown[] } {
	let text = "";
	const params: unknown[] = [];
	let n = start;
	for (let i = 0; i < strings.length; i++) {
		text += strings[i];
		if (i >= values.length) continue;
		const value = values[i];
		if (isFragment(value)) {
			const inner = buildQuery(value.strings, value.values, n);
			text += inner.text;
			params.push(...inner.params);
			n += inner.params.length;
		} else if (isInsert(value)) {
			const inner = buildInsert(value.__insert, n);
			text += inner.text;
			params.push(...inner.params);
			n += inner.params.length;
		} else {
			n += 1;
			text += `$${n}`;
			params.push(value);
		}
	}
	return { text, params };
}

/** A tagged query over a backend: fragment data plus lazy execution. */
class Query implements SqlQuery {
	constructor(
		private readonly backend: PgBackend,
		readonly strings: readonly string[],
		readonly values: readonly unknown[],
	) {}

	compile(): { text: string; params: unknown[] } {
		return buildQuery(this.strings, this.values);
	}

	then<Resolved = unknown[], Rejected = never>(
		onfulfilled?: ((rows: unknown[]) => Resolved | PromiseLike<Resolved>) | null,
		onrejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
	): PromiseLike<Resolved | Rejected> {
		const { text, params } = this.compile();
		return this.backend.run(text, params).then(onfulfilled, onrejected);
	}
}

/**
 * Build an `Sql` handle over a backend. The same call is a tagged template
 * (a `TemplateStringsArray` first argument) or an insert helper (a plain
 * object or array of them), matching how Bun's `SQL` overloads itself.
 */
export function makeSql(backend: PgBackend): Sql {
	function sql(
		first: TemplateStringsArray | Record<string, unknown> | readonly Record<string, unknown>[],
		...values: unknown[]
	): unknown {
		if (isTemplate(first)) {
			return new Query(backend, first, values);
		}
		const rows = Array.isArray(first)
			? (first as readonly Record<string, unknown>[])
			: [first as Record<string, unknown>];
		return { __insert: rows } satisfies InsertHelper;
	}
	sql.unsafe = async (text: string): Promise<unknown[]> => {
		await backend.exec(text);
		return [];
	};
	sql.begin = <T>(fn: (tx: Sql) => Promise<T>): Promise<T> =>
		backend.begin((tx) => fn(makeSql(tx)));
	sql.end = (): Promise<void> => backend.close();
	return sql as unknown as Sql;
}

function isTemplate(value: unknown): value is TemplateStringsArray {
	return Array.isArray(value) && "raw" in value;
}

/** The query surface a PGlite connection and a transaction both expose. */
interface Queryable {
	query: (
		text: string,
		params?: unknown[],
	) => Promise<{ rows: Record<string, unknown>[] }>;
	exec: (text: string) => Promise<unknown>;
}

/**
 * Wrap a live PGlite connection as a backend. `begin` opens a real
 * transaction; the transaction handle it hands back cannot itself open
 * another, which the store never asks it to.
 */
function backendOf(db: Queryable & {
	transaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
	close: () => Promise<void>;
}): PgBackend {
	return {
		run: async (text, params) => (await db.query(text, params)).rows,
		exec: async (text) => {
			await db.exec(text);
		},
		begin: (fn) => db.transaction((tx) => fn(txBackendOf(tx))),
		close: () => db.close(),
	};
}

/** Wrap a transaction handle; nesting a further transaction is unsupported. */
function txBackendOf(tx: Queryable): PgBackend {
	return {
		run: async (text, params) => (await tx.query(text, params)).rows,
		exec: async (text) => {
			await tx.exec(text);
		},
		begin: () => Promise.reject(new Error("nested transaction is not supported")),
		close: () => Promise.resolve(),
	};
}

/**
 * Open an embedded store at directory `dataDir`, with pgvector loaded and
 * its extension created. Returns an `Sql` handle synchronously; the WASM
 * database opens on first use, so construction never blocks and every call
 * sees a ready store. The directory and any missing parents are created.
 */
export function openPglite(dataDir: string): Sql {
	return makeSql(deferredBackend(openDb(dataDir)));
}

async function openDb(dataDir: string): Promise<PgBackend> {
	// PGlite's own `mkdir` is not recursive, so a nested default like
	// `~/.pi-chart/store` throws on a machine that has never run it.
	await mkdir(dataDir, { recursive: true });
	const db = await PGlite.create(dataDir, { extensions: { vector } });
	await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
	return backendOf(db);
}

/** A backend that forwards each call to one still being opened. */
function deferredBackend(opened: Promise<PgBackend>): PgBackend {
	return {
		run: async (text, params) => (await opened).run(text, params),
		exec: async (text) => (await opened).exec(text),
		begin: async (fn) => (await opened).begin(fn),
		close: async () => (await opened).close(),
	};
}
