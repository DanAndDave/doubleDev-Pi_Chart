import { SQL } from "bun";

/**
 * The slice of Bun's `SQL` that the Thread Store actually uses, named so a
 * second backend can stand behind the same handle. The store is written
 * against this interface; `bunSql` wraps a server connection and
 * `pglite-sql` wraps an embedded one, and neither the store nor its query
 * sites know which they hold.
 */
export interface Sql {
	/** A tagged query. Awaiting it runs it; interpolating it splices it. */
	// Rows are dynamically shaped and cast at each call site, as with Bun's
	// own `SQL`; `any` keeps every existing query site compiling unchanged.
	// biome-ignore lint/suspicious/noExplicitAny: database result boundary
	<Row = any>(
		strings: TemplateStringsArray,
		...values: unknown[]
	): SqlQuery<Row>;
	/** A single row as an `(cols) VALUES (…)` insert fragment. */
	(row: Record<string, unknown>): SqlFragment;
	/** Many rows as one multi-row insert fragment, in first-row column order. */
	(rows: readonly Record<string, unknown>[]): SqlFragment;
	/** Run raw SQL with no parameters — schema DDL that has nothing to bind. */
	unsafe(text: string): Promise<unknown[]>;
	/** Run `fn` in a transaction, on a handle of the same shape. */
	begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
	/** Release the connection. */
	end(): Promise<void>;
}

/** A composable piece of SQL: text plus the params it binds. */
export interface SqlFragment {
	/** The literal string segments around each interpolated value. */
	readonly strings: readonly string[];
	/** The interpolated values, one fewer than there are segments plus one. */
	readonly values: readonly unknown[];
}

/** A tagged query: a fragment that also runs and resolves to its rows. */
// biome-ignore lint/suspicious/noExplicitAny: database result boundary
export interface SqlQuery<Row = any>
	extends SqlFragment,
		PromiseLike<Row[]> {
	/** The parameterised text and ordered params this query would run. */
	compile(): { text: string; params: unknown[] };
}

/**
 * A server-backed handle: Bun's `SQL` already implements every member of
 * `Sql` at runtime, so the one cast lives here rather than at each call.
 */
export function bunSql(url: string): Sql {
	return new SQL(url) as unknown as Sql;
}
