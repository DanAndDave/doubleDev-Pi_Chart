## 1. Dependencies and the store handle interface

- [x] 1.1 Add `@electric-sql/pglite` and `@electric-sql/pglite-pgvector` to `package.json` (under `devDependencies`, the project's single dependency list) and verify `bun install` succeeds and both resolve under Bun.
- [x] 1.2 Define an `Sql` interface in `src/sql.ts` capturing exactly the `bun:SQL` surface the store uses (tagged-template call returning rows, `unsafe`, `begin`, `end`, and the `(object)` / `(rows[])` insert helper), plus `bunSql(url)` wrapping a server connection.

## 2. The PGlite adapter

- [x] 2.1 Build `src/pglite-sql.ts`: a tagged-template adapter over PGlite reproducing parameterised queries, fragment composition, the insert-row builder, `unsafe`, `begin`, and `end`, exposed as `Sql`.
- [x] 2.2 Expose `openPglite(dataDir)` returning an `Sql` synchronously via a deferred backend (WASM opens lazily on first use), with pgvector loaded and its extension created; `:memory:` / `memory://` give an ephemeral store.
- [x] 2.3 Unit-test the adapter's query building (placeholders, fragment composition, `(object)` / `(rows[])` builders) and a live round-trip (vectors, jsonb, transaction, raw DDL) in `test/pglite-sql.test.ts`.

## 3. Backend selection and configuration

- [x] 3.1 Config: `databaseUrl` is supplied-only (undefined by default), add `storeDir` (default `~/.pi-chart/store`, `PICHART_STORE_DIR`), keep `storeOrigin` (`own` = embedded, `supplied`, `declined`). Drop `PICHART_PG_PORT` from the settings the extension reads; it stays a `compose.yaml` concern.
- [x] 3.2 `PostgresStore` constructor takes `Sql`; add `PostgresStore.open(config, embedder)` selecting embedded / server / none by `storeOrigin`.
- [x] 3.3 Wire `extension.ts` to `PostgresStore.open`; declined → memory fallback; degradation message differs by origin.

## 4. Setup and check for the embedded store

- [x] 4.1 `install.ts`: `own` opens the embedded store at `storeDir` (no Docker); `supplied` checks reachability; `declined` is left alone. Remove the docker-compose provisioning path and its `run` seam; add an `openable` seam.
- [x] 4.2 Update `install.test.ts`: embedded-default config, embedded/supplied/declined setup and check behaviour; drop the docker-specific tests.

## 5. The store contract on the embedded backend

- [x] 5.1 Add `test/store-support.ts`: `storeLocation()` yields an `Sql` handle to the embedded temp dir by default, or the supplied server when `PICHART_DATABASE_URL` is set.
- [x] 5.2 Migrate `postgres-store.test.ts`, `ingest-store.test.ts`, `doc-index.test.ts` to run on the embedded store by default (was `describe.skip` without a server). Single-writer: blocks using a store plus a raw handle, or two stores, share one connection; "later process" reads go through the same store.

## 6. Durability and equivalence

- [x] 6.1 Equivalence is the same contract suites running on both backends (embedded by default, server when configured).
- [x] 6.2 Add a durability test: what one process ingested, a later process reads (close then reopen the same data directory).

## 7. Docs and verification

- [x] 7.1 README: the store is embedded by default (needs only Bun); `PICHART_DATABASE_URL` is the server escape hatch; `PICHART_STORE_DIR` documented; Docker reframed as one way to a server. ADR-0007 records the decision; ADR-0002's Compose bullet updated.
- [x] 7.2 Full suite (`bun test`) and `bun run typecheck` green (632 pass, 0 fail). The supplied-server path is structurally unchanged (`bunSql` wraps the same `bun:SQL` the store used before) and runs the same suites when `PICHART_DATABASE_URL` is set.
