## 1. Configuration

- [x] 1.1 Red: in `test/install.test.ts`, replace the embedded-default cases with `loadConfig(env, saved)` precedence (`""` → `declined`; set → `supplied`; unset + saved → `saved` with that URL; neither → `unset`, no `databaseUrl`) and a set `PICHART_STORE_DIR` producing a `problems` entry; verify they fail
- [x] 1.2 Green: in `src/config.ts` replace `own` with `saved`/`unset`, delete `storeDir`, take `saved` as a second argument, move `PICHART_STORE_DIR` out of `SETTINGS` into a retired-setting problem, restore `PICHART_PG_PORT` to `SETTINGS`, export `SAVED_URL_PATH` and `readSavedUrl()`; verify 1.1 passes and the "settings list is what the code reads" test still passes

## 2. Connections

- [x] 2.1 Red: pure tests for `connectionOptions(url)` in `src/sql.ts`: a TCP URL passes through; `?host=/run/postgresql` yields `{ path: "/run/postgresql/.s.PGSQL.5432", username, password, database }` with the URL's port; verify they fail
- [x] 2.2 Green: implement `connectionOptions` and make `bunSql` use it; verify 2.1 passes and, against the compose server, `bunSql` reaches it by TCP

## 3. Discovery and provisioning

- [x] 3.1 Red: pure tests for `candidates({ env, platform, user, exists })`: order PG env → Linux sockets that exist → `localhost:5432` → compose at `PICHART_PG_PORT ?? 55432`; macOS sockets `/tmp` only; Windows none; duplicates removed; candidates 1–3 target `pi_chart`, compose targets `thread_store`; verify they fail
- [x] 3.2 Green: implement `candidates` in `src/install.ts`; verify 3.1 passes
- [x] 3.3 Red: `Installation.setup` tests with fake `prepare`/`run`/`which`/`save`/`reachable`/`exists` covering every scenario of "Setup finds or provisions a Postgres server" and "The connection setup settles on is used by every later session": first ready candidate saved; earlier `unusable` reported with its fix and passed over; nothing found + `docker` → `compose up -d --wait` then compose candidate saved; nothing found, no `docker` → not ready, requirement named; `supplied` only checked, nothing saved or run; `saved` that answers kept with no `prepare` call; `saved` that does not answer re-discovered; verify they fail
- [x] 3.4 Green: restore the `run: RunCommand` seam and `COMPOSE_MS`, add `prepare`/`which`/`save`/`env`/`platform`/`user` seams, delete `openable`/`storeOpens`, rewrite `provideStore` per design §4; verify 3.3 passes
- [x] 3.5 Implement the default `prepare` per design §3 (maintenance DB, `pg_available_extensions`, `CREATE DATABASE`, `CREATE EXTENSION`, SQLSTATE → fix text, every handle closed) and a server-gated test that prepares a scratch database on the server `PICHART_DATABASE_URL` names and drops it after; verify it passes against the compose server
- [x] 3.6 Default `save` writes `SAVED_URL_PATH` with mode `0600`, creating `~/.pi-chart`; verify with a test against a temp path that the file holds the URL and its mode is `0600`
- [x] 3.7 Add `restart: unless-stopped` to `compose.yaml`; verify `docker compose config` shows it

## 4. Installation check

- [x] 4.1 Red: `check` tests: `unset` → not ok, fix names `pi-chart setup`; `saved`/`supplied` → reachability with the source named; an existing former embedded store directory → a `former embedded store` line naming it removable, and `setup` emitting the same; verify they fail
- [x] 4.2 Green: implement per design §5; verify 4.1 passes

## 5. Store and session

- [x] 5.1 Red: server-gated test in `test/postgres-store.test.ts`: two `PostgresStore`s on one fresh database `migrate()` concurrently, both resolve, each version recorded once; verify it fails (or flakes) on the current `migrate`
- [x] 5.2 Green: wrap `migrate()` in `sql.begin` with `pg_advisory_xact_lock`; verify 5.1 passes against the compose server and every PGlite-backed suite still passes
- [x] 5.3 Server-gated test: two `PostgresStore`s on separate connections ingest different Conversations; each reads the other's Turns back; verify it passes
- [x] 5.4 Make `PostgresStore.open` server-only (`undefined` for `declined` and `unset`); rewrite "choosing a store backend" tests accordingly; verify they pass
- [x] 5.5 Red: extension tests: with nothing configured (child process, empty `HOME`), `session_start` announces "not set up … `/pi-chart setup`" exactly once and no connection is attempted; with an unreachable `PICHART_DATABASE_URL` via `loaded()`, the captured `session_shutdown` handler resolves; verify they fail
- [x] 5.6 Green: in `src/extension.ts` call `loadConfig(process.env, readSavedUrl())`, add the unset announcement, name the fix by origin in the migrate warning, and discard close errors when `ready` failed; verify 5.5 passes

## 6. PGlite leaves the runtime

- [x] 6.1 Move `src/pglite-sql.ts` to `test/pglite-sql.ts`, update `test/store-support.ts`, and reword the "embedded store is single-writer" comments in the store suites to name PGlite as the suites' in-process database; verify `grep -r pglite src/` is empty and `bun test` passes

## 7. Docs

- [x] 7.1 Write `docs/adr/0008-…` superseding ADR-0007 (single-process store vs concurrent sessions, the observed corruption, server + setup discovery), mark ADR-0007 superseded, and update ADR-0002's consequence line; verify the files read consistently
- [x] 7.2 Update `CONTEXT.md` **Thread Store** if its wording no longer holds; verify by reading it
- [x] 7.3 README: Postgres with pgvector listed as a requirement with per-platform install lines; Docker as one way to satisfy it; `/pi-chart setup` discovery order and the saved URL; settings table (`PICHART_DATABASE_URL` overrides the saved URL, `PICHART_STORE_DIR` removed, `PICHART_PG_PORT` read by setup); "Start the Thread Store" rewritten; an upgrade note for operators on the embedded store; verify no README line still says the store is embedded

## 8. Verification

- [x] 8.1 `bun run typecheck` clean; `bun test` green; the server-gated suites green with `PICHART_DATABASE_URL` pointing at the compose server; `openspec validate postgres-server-store --strict` passes
- [x] 8.2 Live: with `~/.pi-chart/database.url` absent and the compose server stopped, `/pi-chart setup` in a real omp session starts compose, saves the URL, and reports ready; two concurrent omp sessions then both record Turns, `/pi-chart` reports the store ok in each, and exiting both shows no extension error
