# Proposal: The Thread Store Is a Postgres Server, Found or Provisioned by Setup

Triage: ready-for-agent
Blocked by: None

## Why

The embedded PGlite store is single-process, and omp is not: every live session opens `~/.pi-chart/store` in its own process, and PGlite neither locks the directory nor detects a second writer. On this machine five concurrent `omp --resume` sessions left the store with a `pg_control` checkpoint in a zeroed WAL segment; every open since then PANICs (`could not locate a valid checkpoint record`), migration fails with a warning nobody sees, and the failed open re-throws at exit as `Extension … error: Aborted()`. Two Bun processes writing one fresh PGlite directory reproduced the failure class. Nothing short of a server gives concurrent sessions one store, so the runtime store becomes a Postgres server — and setup, not the operator, finds or provisions it.

## What Changes

- **BREAKING** The embedded store is removed from the runtime. The Thread Store is always a pgvector Postgres server; PGlite (`@electric-sql/pglite`, `@electric-sql/pglite-pgvector`, already `devDependencies`) stays only as the test suites' in-process database, moved under `test/`.
- **BREAKING** `PICHART_STORE_DIR` is removed. A session that finds it set says it is not read, the way stale `CM_*` settings are.
- `/pi-chart setup` finds a Postgres: the `PG*` environment, the platform's local sockets, then `localhost:5432` as the current user, then the project's compose server if it is already up. On the first that answers it creates a `pi_chart` database (when missing) and enables `vector` in it.
- When nothing answers and `docker` is on `PATH`, setup starts `compose.yaml` and uses it. Compose gains `restart: unless-stopped`, so the store outlives a reboot.
- Setup saves the URL it settled on to `~/.pi-chart/database.url` (mode `0600`). Every later session reads it whenever `PICHART_DATABASE_URL` is unset; `PICHART_DATABASE_URL` still overrides it, and `""` still declines the store.
- With neither a setting nor a saved URL, the store is unconfigured: the session degrades as a declined store does and says to run `/pi-chart setup`, and `/pi-chart` reports the same.
- A candidate server setup cannot use (no pgvector, no right to create the database or the extension) is named with the command that fixes it, and setup tries the next candidate.
- Concurrent sessions migrating one server serialise on an advisory lock, so two sessions starting at once cannot race the schema.
- A store that failed to open closes without raising, so shutdown never reports a failure the session already reported at start.
- An existing `~/.pi-chart/store` is left in place and named by `/pi-chart` and setup as removable: it holds a derived index the Journals rebuild.
- Docs: Postgres with pgvector is listed as a requirement; Docker as one way to satisfy it. ADR-0008 supersedes ADR-0007.

## Capabilities

### New Capabilities
<!-- none: provisioning is how the existing Thread Store is reached, not a new capability -->

### Modified Capabilities
- `thread-store`: the default embedded store requirement is removed; added requirements cover finding or provisioning a server at setup, persisting its URL, the unconfigured state, and the stranded embedded data directory; the degradation requirement is replaced by one without the embedded default; schema migration gains concurrent-session safety; resource release gains a quiet close for a store that never opened.

## Impact

- Code: `src/config.ts` (store origins, saved URL input, `PICHART_STORE_DIR` retired), `src/install.ts` (discovery, provisioning, compose fallback, saved URL, stranded embedded store), `src/postgres-store.ts` (server-only `open`, advisory-locked `migrate`), `src/sql.ts` (socket-path URLs), `src/extension.ts` (reads the saved URL, unconfigured message, quiet close), `src/pglite-sql.ts` → `test/pglite-sql.ts`.
- Config: `compose.yaml` restart policy.
- Tests: `test/install.test.ts` and `test/postgres-store.test.ts` selection cases rewritten; store suites keep running on PGlite under plain `bun test`.
- Docs: `README.md` requirements, setup, settings table, "Start the Thread Store"; `docs/adr/0008-…`; ADR-0002's consequence line.
- Operators on the embedded store: run `/pi-chart setup` once; recorded Accounting in the old store is not carried over.
