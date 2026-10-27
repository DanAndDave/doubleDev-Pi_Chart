## 1. The registry

- [x] 1.1 In `test/sql.test.ts`, add `describe("shares of a url's pool")` over `sharedSql(url, open)` with an injected factory that counts pools built and ended. Cover: two handles for one URL build one pool; a second `end()` from one handle leaves the pool open for the other; ending the last handle ends the pool once and the next `sharedSql` builds a fresh one; a returned handle refuses queries; two URLs get two pools; a second import of `src/sql.ts` (`?again`) finds the same pool. Verify red.
- [x] 1.2 In `src/sql.ts`, add `STORE_POOL_MAX = 4` and `sharedSql(url, open?)`: a `Map<url, { sql, holders }>` on `globalThis` under `Symbol.for("pi-chart.store-pools")`, and a handle of the `Sql` shape that forwards to the pool and whose `end()` gives its share back once. The default factory is `bunSql(url, { max: STORE_POOL_MAX })`. Verify green.

## 2. The store

- [x] 2.1 In `test/store-support.ts`, add `serverUrl`, `describeServer` and `scratchDatabase(name)`: a migrated database of the suite's own, with its `pg_stat_activity` count and a wait for the count to settle. In `test/postgres-store.test.ts`, add a server-gated `describe("stores opened in one process")` on one. Two stores from `PostgresStore.open` on one config issue 24 concurrent queries, and the count, sampled every 20 ms, never exceeds `STORE_POOL_MAX`. Closing one store twice leaves the other answering. Closing the last brings the count to 0. Close the stores "a supplied and a saved url each yield a store" opens, so no share outlives its test. Verify red.
- [x] 2.2 In `src/postgres-store.ts`, build `open`'s store on `sharedSql(config.databaseUrl)`, and say in `close`'s doc that it gives back the store's share. Verify green, and that "choosing a store backend" still passes.

## 3. Sessions

- [x] 3.1 In `test/extension.test.ts`, add a server-gated test on a scratch database: `piChart` loaded twice, as a session and its subagent's. The main session starts and fires bursts of 12 concurrent `/pack`s until the database holds `STORE_POOL_MAX` connections. The subagent's session then starts and fires its own burst, and the count stays where it was. After the first shuts down, the second answers `/pack`, and after the second shuts down the count reaches 0. Verify red against the old `open`, then green.
- [x] 3.2 In `src/extension.ts`, update the `close` dependency's comment: it gives back the session's share of the process's pool. Keep `deps.close`, `opened` and the quiet close of a store that never opened as they are.

## 4. Close

- [x] 4.1 Run `bun run typecheck` and the changed test files, with `PICHART_DATABASE_URL` on a scratch database for the server-gated suites, and verify both are green.
- [x] 4.2 Smoke: in a `mktemp -d` scratch directory, start `omp --no-extensions -e src/extension.ts` in a detached tmux session and have it spawn one task subagent that runs `sleep 20`. Count that omp process's connections to the store with `ss -tnp state established '( dport = :55432 )'`, while the subagent runs and after it finishes, and verify both are at most 4. Then kill the session and remove the directory.
