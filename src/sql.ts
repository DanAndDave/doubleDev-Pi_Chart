import { SQL } from "bun";
import { join } from "node:path";

/**
 * The slice of Bun's `SQL` that the Thread Store actually uses, named so a
 * second backend can stand behind the same handle. The store is written
 * against this interface; `bunSql` wraps a server connection, and the test
 * suites wrap an in-process PGlite, and neither the store nor its query
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

/** What Bun's `SQL` is constructed from for a Unix-socket connection. */
export interface SocketOptions {
	path: string;
	username: string;
	password: string | undefined;
	database: string;
}

/**
 * The socket file a Postgres server listening on `port` makes in
 * `directory`, which is where libpq's `host=<directory>` points.
 */
export function socketFile(directory: string, port: string | number = 5432): string {
	return join(directory, `.s.PGSQL.${port}`);
}

/**
 * What to hand Bun's `SQL` for a connection string. A saved connection is
 * one string a person can also hand to `psql`, so a Unix socket is written
 * the libpq way, `postgres://me@localhost:5432/pi_chart?host=/run/postgresql`.
 * Bun refuses every socket URL form and accepts a socket path, so a `host`
 * naming a directory becomes that directory's `.s.PGSQL.<port>`; anything
 * else is the URL unchanged.
 */
export function connectionOptions(url: string): string | SocketOptions {
	const parsed = new URL(url);
	const host = parsed.searchParams.get("host");
	if (!host?.startsWith("/")) return url;
	return {
		path: socketFile(host, parsed.port || 5432),
		username: decodeURIComponent(parsed.username),
		password: parsed.password === "" ? undefined : decodeURIComponent(parsed.password),
		database: decodeURIComponent(parsed.pathname.slice(1)),
	};
}

/**
 * A server-backed handle: Bun's `SQL` already implements every member of
 * `Sql` at runtime, so the one cast lives here rather than at each call.
 * `limits` are Bun's own connection options: a probe's short timeout, a
 * shared pool's bound.
 */
export function bunSql(
	url: string,
	limits: { connectionTimeout?: number; max?: number } = {},
): Sql {
	const options = connectionOptions(url);
	return new SQL(
		typeof options === "string" ? { url: options, ...limits } : { ...options, ...limits },
	) as unknown as Sql;
}

/**
 * The most connections one process opens to one Thread Store. One session
 * peaks at four: the tail's two reads, an Accounting write, and an ingest
 * or embedding sweep, which run one at a time per Conversation. Sessions
 * in one process, subagents included, share them; a query past the bound
 * waits for a free connection rather than opening another.
 */
export const STORE_POOL_MAX = 4;

/**
 * The process's pools, by URL. On `globalThis` under a registered symbol
 * rather than in this module's scope, because omp imports the extension
 * afresh for every session it runs, and each import is a new copy of this
 * module: measured, a process held a further pool for every subagent.
 */
const POOLS = Symbol.for("pi-chart.store-pools");

interface SharedPool {
	readonly sql: Sql;
	holders: number;
}

/**
 * A share of the process's one pool for `url`, opened by `open` when no
 * share of it is held. Ending the share gives it back, once however often
 * it is ended, and the last share given back ends the pool. A share given
 * back refuses further queries, as a handle whose pool ended would, so a
 * closed store cannot run on a pool other sessions still hold.
 */
export function sharedSql(
	url: string,
	open: (url: string) => Sql = (at) => bunSql(at, { max: STORE_POOL_MAX }),
): Sql {
	const scope = globalThis as { [POOLS]?: Map<string, SharedPool> };
	const registry = (scope[POOLS] ??= new Map<string, SharedPool>());
	const pool = registry.get(url) ?? { sql: open(url), holders: 0 };
	registry.set(url, pool);
	pool.holders += 1;

	let released = false;
	const live = (): Sql => {
		if (released) throw new Error("Thread Store handle closed: its share of the pool was given back");
		return pool.sql;
	};
	// Both call shapes of `Sql`, a tagged query and an insert fragment, go
	// to the pool as they came; the overloads cannot be spelled as one
	// signature, so the cast is to the interface the pool already meets.
	const share = ((...args: unknown[]) =>
		Reflect.apply(live(), undefined, args)) as unknown as Sql;
	share.unsafe = async (text) => live().unsafe(text);
	share.begin = async (fn) => live().begin(fn);
	share.end = async () => {
		if (released) return;
		released = true;
		pool.holders -= 1;
		if (pool.holders > 0) return;
		if (registry.get(url) === pool) registry.delete(url);
		await pool.sql.end();
	};
	return share;
}
