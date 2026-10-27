# Proposal: One bounded pool per process per Thread Store

Triage: ready-for-agent
Blocked by: None

## Why

Every extension load opens its own connection pool, and omp loads the extension again, in the same process, for every task subagent. `piChart(pi)` (`src/extension.ts`) calls `PostgresStore.open(config, embedder)`, which calls `bunSql(config.databaseUrl)` with no `max`, so each load may hold up to Bun's default of 10 connections.

Measured on the user's machine:

- In omp pid 3270598 the Thread Store connections went from 10 to 20 while one subagent ran, and stayed at 20 after it finished.
- A game-factory omp process held 39 connections.
- Four sessions held 69 of the server's 100, and the Gate's Runs then failed with "too many clients".

A subagent's session stays loaded after its work ends, so a process's connections grow with the number of subagents it has ever run rather than the work it is doing.

## What Changes

- **One pool per process per store URL.** Every session in a process, main or subagent, that opens the Thread Store at the same URL shares one pool. The registry lives on `globalThis` under a `Symbol.for` key, so it survives the extension module being imported again.
- **Reference-counted.** `PostgresStore.open` takes a share of the pool, and the store's `close()` gives that share back. The pool ends when the last share in the process is returned. A second `close()` from the same store returns nothing more, so it cannot end a pool another session still uses. A store whose share is returned refuses further queries, as a store whose pool ended did before.
- **Bounded at 4 connections.** The pool is built with `max: 4`, so a process holds at most 4 connections to a store, whatever the number of sessions it runs. Queries past the bound wait for a free connection.
- Unchanged: `session_shutdown` cleanup (`deps.close`, the quiet close of a store that never opened), migration in one transaction under the advisory lock, `PostgresStore.connect` (scripts and tests own the pool they open), and the probes `src/install.ts` makes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `thread-store`: ADDED "A process holds one bounded pool per store", with scenarios for a subagent's session reusing the pool, the pool closing only when the last session ends, and the bound holding under concurrent queries. MODIFIED "Store resources are released when a session ends": a session gives back its share of the pool, and the pool closes when no session in the process holds one. Its scenario "Repeated sessions do not accumulate connections" now bounds a process's connections by the pool and returns them to the baseline only when the last session ends.

## Impact

- `src/sql.ts`: `sharedSql(url)` and `STORE_POOL_MAX`, the per-process registry.
- `src/postgres-store.ts`: `PostgresStore.open` takes its handle from `sharedSql`; the `close` doc says it gives back a share.
- `src/extension.ts`: the `close` dependency's comment. The wiring is otherwise unchanged.
- Tests: `test/sql.test.ts` (the registry), `test/postgres-store.test.ts` and `test/extension.test.ts` (server-gated, counting `pg_stat_activity` on a scratch database).
- A process now holds at most 4 connections to the Thread Store, so 100 server connections serve 25 omp processes, against 10 sessions before. Queries of concurrent sessions in one process can wait on each other for a free connection. Each takes milliseconds against Calls of seconds.
- Out of scope: idle timeouts (a pool keeps the connections it opened until its last share is returned), retries on "too many clients", and `scripts/`.
