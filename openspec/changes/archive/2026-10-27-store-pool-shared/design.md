## Context

`PostgresStore.open(config, embedder)` builds `new PostgresStore(bunSql(config.databaseUrl))`. `bunSql` wraps Bun's `SQL`, whose pool opens up to 10 connections when no `max` is given. Bun keeps a connection it opened until `end()`, since `idleTimeout` defaults to none.

`piChart(pi)` runs once per extension load. omp loads the extension again, in the same process, for every task subagent, so each subagent's session gets its own `PostgresStore` and its own pool. The session's `session_shutdown` calls `deps.close`, which awaits `ready` and then `store.close()`, swallowing the close error of a store that never opened.

Measured:

| Where | Connections to the Thread Store |
| --- | ---: |
| omp pid 3270598, before a subagent | 10 |
| the same, while one subagent ran | 20 |
| the same, after it finished | 20 |
| a game-factory omp process | 39 |
| four sessions together, of the server's 100 | 69 |

At 69 the Gate's Runs, which create a database per Run on the same server, failed with "too many clients".

What one session runs against the store at once:

- **Each Call:** the context handler reads the tail as `recentTurns` and `turnSizes` together (2 queries). Accounting's `recordPack` is written in the background (1).
- **Each Turn's end:** the ingest and embedding sweeps are serialized per Conversation (`sweeping`), and each holds one connection at a time: ingest runs one transaction per Turn, and embedding one `UPDATE` per Turn.
- **Session start:** `migrate` runs one transaction. Doc Store indexing waits for it and then runs one statement at a time.

So one session peaks at 4 connections: 2 tail reads, an Accounting write and a sweep. Sessions in one process overlap only where their Calls do. A subagent's Call and its parent's are rarely concurrent, because the parent's Turn waits on the task tool. A query takes milliseconds and a Call seconds.

## Goals / Non-Goals

**Goals:**

- A process holds one pool per store URL, whatever the number of sessions it runs or how often the extension is imported.
- That pool opens at most a fixed, small number of connections.
- A session's shutdown gives back only its own share. The pool ends with the last share.

**Non-Goals:**

- Idle timeouts: a pool keeps the connections it opened until its last share is returned.
- Retrying a query refused with "too many clients".
- `PostgresStore.connect` and `scripts/`: a script or test that connects owns the pool it opens, and ends it with `close()`.
- Sharing pools across processes. The server's own limit is the bound there.

## Decisions

### The registry lives on `globalThis` under `Symbol.for("pi-chart.store-pools")`

A module-level `Map` would not do, because omp may import the extension more than once in a process, and each import has its own module scope. `Symbol.for` returns the same symbol to every realm in the process, so every copy of `src/sql.ts` finds the same `Map<url, { sql, holders }>`.

The key is the URL string as configured. Two spellings of one server get two pools, and that is still bounded by the number of spellings. Normalising URLs would need a parser for the one case that never occurs: every session reads the same saved file or the same environment variable.

Considered: a module-level `Map`. Rejected because the measured growth happens exactly when the module is loaded again.

### A share is a handle of the `Sql` shape

`sharedSql(url)` returns an `Sql` that forwards each query, `unsafe` and `begin` to the shared pool. Its `end()` gives the share back. `PostgresStore` and its `close()` do not change: the store still calls `this.sql.end()`, and only `open` chooses `sharedSql` over `bunSql`.

- **A second `end()` from the same handle does nothing.** The handle remembers it has given its share back, so it cannot drop the count to zero under another session.
- **A returned handle refuses queries.** A query through it throws, and every store method is `async`, so the caller sees a rejection. That is what a store whose own pool had ended did before. Without it, a closed session's late query would quietly run on a pool it no longer holds.
- **The last share ends the pool.** It ends it and removes it from the registry, so the next `open` in the process builds a fresh pool.

Considered: counting in `PostgresStore` and keeping `bunSql` handles in a static. Rejected because the count would live in a class each import duplicates, and the handle that knows it was released would have to be the store.

### `max: 4`

The bound is one session's peak from Context: 2 tail reads, an Accounting write and an ingest or embedding sweep. A process running one session never waits for a connection. A process running several waits only where their Calls overlap, and then for a few milliseconds of query.

At 4 per process, the server's 100 connections serve 25 omp processes. Before, they served 10 sessions with a full pool, or 5 processes with one subagent each. The four sessions measured at 69 hold at most 16.

Considered:

- **`max: 1`.** Rejected: the tail reads would serialize on every Call, and a migration waiting on the advisory lock held by another process would hold the session's only connection, so nothing else could run.
- **`max: 10` with sharing alone.** Rejected: one process could still take a tenth of the server.

### Migration keeps its lock, and the bound cannot deadlock it

Concurrent sessions in one process each run `migrate`: one transaction that first takes `pg_advisory_xact_lock`. The lock holder runs every statement on its own transaction handle, and so does each ingest transaction. No transaction waits on the pool while holding a connection, so `max` connections each in a transaction always include the lock holder, and it always finishes. Migrations already applied take the lock, read `schema_migrations` and commit.

## Risks / Trade-offs

- **Sessions in one process share 4 connections.** A subagent's burst of queries can delay its parent's tail read. Each query takes milliseconds, and the tail read already runs under its own deadline, which degrades to the harness's history if it is missed.
- **A migration held up in another process.** Every session waiting on the advisory lock holds one of the 4 connections. A slow migration elsewhere can therefore stall this process's queries until it commits. The same was true per session before, with a bigger pool.
- **A share never given back** keeps the pool open for the rest of the process, as a pool never ended did before. That pool is now at most 4 connections, not 10 per session.

## Testing seams

- **The registry** (`sharedSql` in `src/sql.ts`), through `describe("shares of a url's pool")` in `test/sql.test.ts`, with an injected pool factory and no server. It covers:
  - "A repeated close gives back one share": a second `end()` from one handle leaves the other handle's pool open.
  - Ending the last share ends the pool, and the next `sharedSql` builds a fresh one.
  - A returned handle refuses queries.
  - A second import of `src/sql.ts` in the same process finds the same pool.
- **The bound** ("The bound holds under concurrent queries"), through `PostgresStore.open` in `test/postgres-store.test.ts`, `describe("stores opened in one process")`. It is server-gated and counts `pg_stat_activity` on a scratch database, sampled every 20 ms. Two stores opened from one config issue 24 concurrent queries, and the count stays at `STORE_POOL_MAX` or below. Closing one twice leaves the other answering. Closing the last brings the count to 0.
- **Sessions sharing the pool** ("A subagent's session reuses the pool", "The pool closes only when the last session ends", the MODIFIED "Session shutdown closes the database client" and "Repeated sessions do not accumulate connections"), through `piChart` loaded twice in `test/extension.test.ts`. It is server-gated, on a scratch database.
  - The main session starts and fires bursts of 12 concurrent `/pack`s, which read Accounting from the store, until the database holds `STORE_POOL_MAX` connections.
  - The subagent's session then starts and fires its own burst, and the count stays exactly where it was. A second pool would open at least one more connection for the subagent's migration.
  - After the main session shuts down, the subagent's still answers `/pack`. After it shuts down too, the count is 0.
- The scratch database, its connection count and the settling wait live in `test/store-support.ts` (`scratchDatabase`, `describeServer`), shared by both server-gated suites.
- The existing extension test "a store that never opened shuts down without raising" keeps covering the quiet close.
