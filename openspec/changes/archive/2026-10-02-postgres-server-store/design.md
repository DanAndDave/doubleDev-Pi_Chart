# Design: The Thread Store Is a Postgres Server, Found or Provisioned by Setup

## Context

See proposal.md — Why. Current state the approach depends on:

- `loadConfig(env)` (`src/config.ts`) is pure over the environment and derives `storeOrigin: "own" | "supplied" | "declined"` from `PICHART_DATABASE_URL`; `own` opens PGlite at `storeDir`.
- `PostgresStore.open(config, embedder)` picks `openPglite(storeDir)` or `bunSql(url)`; `bunSql` is `new SQL(url)`.
- `Installation` (`src/install.ts`) has seams `exists`, `reachable`, `openable`, `bun`, `root`. Before ADR-0007 it also had `run: RunCommand` (`src/process.ts`) for `docker compose up -d --wait`, removed in `5660a8a`.
- `migrate()` runs `CREATE TABLE IF NOT EXISTS schema_migrations`, reads applied versions, then applies the rest statement by statement, outside a transaction. No migration uses `CONCURRENTLY` or anything else a transaction forbids.
- `piChart()` is synchronous; `ready = store.migrate().catch(warn)` reports only through `pi.logger.warn`.
- `@electric-sql/pglite*` are `devDependencies` but imported by runtime code (`src/postgres-store.ts`, `src/install.ts`).
- Observed under Bun 1.4.2: `new SQL(url)` rejects every Unix-socket URL form (`?host=/dir` → "Failed to connect", `postgres://u@/db?host=` → "Invalid URL", `unix://` → unsupported); `new SQL({ path: "<dir>/.s.PGSQL.5432", username, database })` connects. `end()` on a handle that never connected resolves. Connection errors carry `code` `ERR_POSTGRES_CONNECTION_REFUSED`; server errors carry `ERR_POSTGRES_SERVER_ERROR` with the SQLSTATE in `errno` (`28P01`, `3D000`, …). PGlite implements `pg_advisory_xact_lock`.
- `pgvector/pgvector:pg17`'s `vector.control` does not declare `trusted`, so `CREATE EXTENSION vector` needs a superuser; a database owner without superuser cannot enable it.

## Goals / Non-Goals

**Goals:** one server shared by every session; zero manual URL entry on a machine with a local Postgres or Docker; nothing guessed at session start.

**Non-Goals:**
- Installing Postgres or pgvector packages. Setup names the package command; it never runs a package manager or `sudo`.
- Migrating rows out of an existing `~/.pi-chart/store`. It is derived (ADR-0002); Turns re-ingest from Journals. Recorded Accounting is not carried over.
- Reading `DATABASE_URL` or `~/.pgpass`. `DATABASE_URL` usually belongs to another application; `.pgpass` is a password source for a server we would still have to find.
- Making the store's start-of-session migration failure visible in the UI. Today it goes only to `pi.logger.warn`; that is a separate reporting gap.
- Hot-swapping the store into the session that ran setup. The saved connection takes effect in sessions started afterwards, and setup says so.

## Decisions

### 1. Store origins: `supplied`, `saved`, `unset`, `declined`

`loadConfig(env, saved?: string)` stays pure: the caller passes the saved file's contents. Precedence: `PICHART_DATABASE_URL=""` → `declined`; non-empty → `supplied`; else non-empty `saved` → `saved`; else `unset`. `databaseUrl` is set for `supplied` and `saved`. `storeDir` and `own` are deleted. `PICHART_STORE_DIR` leaves `SETTINGS`; a set value produces a `problems` entry ("PICHART_STORE_DIR is not read: the Thread Store is a Postgres server now; run `/pi-chart setup`."). `PICHART_PG_PORT` returns to `SETTINGS`, read only by discovery for the compose candidate's port.

`src/config.ts` exports `SAVED_URL_PATH = ~/.pi-chart/database.url` and `readSavedUrl(path = SAVED_URL_PATH): string | undefined` (sync, trimmed, `undefined` when absent or empty). `piChart()` calls `loadConfig(process.env, readSavedUrl())`.

*Alternative:* `loadConfig` reads the file itself. Rejected: every test calling `loadConfig({})` would read the operator's real file.

### 2. Socket connections are URLs in the libpq form

The saved connection is one string a person can also hand to `psql`: `postgres://user@localhost:5432/pi_chart?host=/run/postgresql`. `bunSql(url)` parses it; when `host` names a directory it constructs `new SQL({ path: join(host, ".s.PGSQL." + port), username, password, database })`, otherwise `new SQL(url)`. One parser, in `src/sql.ts`, used by runtime, setup, and tests.

*Alternative:* save a JSON connection object. Rejected: `PICHART_DATABASE_URL` is a URL, and two formats for the same thing is two parsers.

### 3. Discovery is an ordered candidate list, then one `prepare` per candidate

`candidates({ env, platform, user, exists })` is pure and returns, in order, de-duplicated:

1. **PG environment**, when any of `PGHOST`, `PGPORT`, `PGUSER` is set: built from `PGHOST` (directory → socket form), `PGPORT ?? 5432`, `PGUSER ?? user`, `PGPASSWORD`.
2. **Local sockets** whose `.s.PGSQL.5432` exists: Linux `/run/postgresql`, `/var/run/postgresql`, `/tmp`; macOS `/tmp`; none on Windows. User = OS user (peer auth).
3. **`localhost:5432`** as the OS user, no password.
4. **Compose server** `pi_chart:pi_chart@localhost:${PICHART_PG_PORT ?? 55432}`, database `thread_store`.

Candidates 1–3 target database `pi_chart`; candidate 4 targets compose's own `thread_store` — the server is the project's, and its volume already holds that database.

`prepare(candidate): Promise<Prepared>` where `Prepared` is `{ kind: "ready", url }` | `{ kind: "absent" }` (nothing answering) | `{ kind: "unusable", detail, fix }`. The default `prepare` (Bun `SQL`):

1. Connect to the candidate's maintenance database (`postgres`, then `template1` on `3D000`). Any connection error (refused, no socket, unknown host, timeout: Bun's `ERR_POSTGRES_CONNECTION_*`) → `absent`. `28P01`/`28000` → `unusable`, fix `sudo -u postgres createuser --createdb <user>` (or the auth method for TCP).
2. `SELECT 1 FROM pg_available_extensions WHERE name = 'vector'`; missing → `unusable`, fix names the platform package (`pacman -S pgvector`, `apt install postgresql-<major>-pgvector`, `brew install pgvector`), major read from `server_version_num`.
3. `CREATE DATABASE pi_chart` unless present; `42501` → `unusable`, fix `sudo -u postgres createdb -O <user> pi_chart`.
4. Connect to the target database; `CREATE EXTENSION IF NOT EXISTS vector`; `42501` → `unusable`, fix `sudo -u postgres psql -d pi_chart -c 'CREATE EXTENSION vector'`.
5. Return `ready` with the target URL.

Every handle opened by `prepare` is closed in `finally`. Its connections and `reachable`'s are probes: one connection, a 5 s connect timeout, so a server slow to accept reads as not reachable rather than hanging setup.

Reports show connection strings with the password masked (`me:***@host`); only the saved file, mode `0600`, holds it.

`Installation` gains seams `prepare`, `run` (restored `RunCommand`), `which: (cmd) => string | undefined` (default `Bun.which`), `save: (url) => Promise<void>` (default writes `SAVED_URL_PATH` with `mode: 0o600`, creating the parent), `env`, `platform`, `user`. `reachable` stays for `supplied`/`saved`; `openable` is deleted.

*Alternative:* probe at every session start (no saved file). Rejected with the operator: sessions could land on different servers.

### 4. `setup` by origin

- `declined`: unchanged.
- `supplied`: `reachable(url)` only — never prepare, start, or save.
- `saved`: `reachable(url)` once → keep, report `ok`. Not reachable → fall through to discovery.
- `unset` (or `saved` that fell through): for each candidate, `prepare`; collect `unusable` results as their own checks (`ok: false`, with fix); stop at the first `ready`. If none and `which("docker")`: `run("docker", ["compose", "up", "-d", "--wait"], root, COMPOSE_MS = 120_000)` then `prepare(compose candidate)`. On `ready`: `save(url)`, report `ok` with the URL and "used by sessions started from now on". Otherwise report `ok: false`, detail "no pgvector Postgres found", fix "install Postgres with pgvector, or Docker, then run `pi-chart setup` again".

`compose.yaml` gains `restart: unless-stopped`.

### 5. `check` by origin

`supplied`/`saved` → `reachable`, same wording as today with the source named ("saved by setup" vs `PICHART_DATABASE_URL`). `unset` → `ok: false`, "not set up; turns are not recorded and nothing is recalled", fix "run `pi-chart setup`". Plus, when `~/.pi-chart/store` exists, a `former embedded store` check: `ok: true`, "no longer read; it holds only what the Journals rebuild", fix `rm -rf ~/.pi-chart/store`. `setup` emits the same line.

### 6. Session wiring

`PostgresStore.open(config)` returns `undefined` for `declined` and `unset`, else `new PostgresStore(bunSql(databaseUrl))`. In `piChart()`, the no-store branch is shared; for `unset` the session registers a one-time `session_start` announcement through `announce` (UI notify + report): "The Thread Store is not set up, so nothing is recorded or recalled. Run `/pi-chart setup`." `declined` stays silent as now.

The migrate-failure fix text names the origin: `supplied` → "Check PICHART_DATABASE_URL …", `saved` → "Run `/pi-chart setup` to find a server again."

### 7. Migration under an advisory lock

`migrate()` runs inside `sql.begin(tx => …)`: `SELECT pg_advisory_xact_lock(<constant key>)`, then the existing body on `tx`. The lock is released at commit; a second session blocks, then sees every version applied and does nothing. All existing migration statements are transaction-safe (no `CONCURRENTLY`). Rolling back on failure is a behaviour improvement: a half-applied version no longer exists.

*Alternative:* `pg_advisory_lock` session-level. Rejected: a crash between lock and unlock on a pooled connection leaks the lock.

### 8. A store that never opened closes quietly

`close` in `piChart()` records whether `ready` failed; if it did, `store.close()` errors are discarded. A store that opened keeps propagating close errors. (With PGlite gone the original re-throw path disappears, but the requirement holds for any backend whose close re-raises a failed connect.)

### 9. PGlite moves to the test tree

`src/pglite-sql.ts` → `test/pglite-sql.ts` unchanged; `test/store-support.ts` imports it. Runtime no longer imports `@electric-sql/pglite*`, which matches their existing `devDependencies` placement. Comments in store suites that justify one shared handle by "the embedded store is single-writer" now say "PGlite, the suites' in-process database, is single-writer".

## Risks / Trade-offs

- [A found server is the operator's general-purpose Postgres] → setup only creates `pi_chart` and the extension inside it; never touches other databases; the URL it chose is printed.
- [Peer/socket auth succeeds as the OS user only if a role exists] → the `28000` path names `createuser`; discovery then falls to compose.
- [Saved password in `~/.pi-chart/database.url`] → mode `0600`, like `.pgpass`; only the compose and `PGPASSWORD` candidates carry one.
- [A machine with no Postgres and no Docker is now unconfigured where it used to work] → documented requirement; the session says so at start and `/pi-chart` names the fix. This is the price of correctness under concurrent sessions.
- [Tests run on PGlite, production on a server] → same SQL and pgvector (ADR-0007's equivalence argument still holds); the concurrency and `prepare` tests run only against a server, gated on `PICHART_DATABASE_URL` as the other server-only suites are.
- [Docker image pull on first setup can exceed 120 s] → `run` reports the timeout with partial output, as before `5660a8a`.

## Migration Plan

1. Ship; operators on the embedded store see "not set up" at the next session start.
2. `/pi-chart setup` finds or starts a server and saves its URL.
3. New sessions ingest Journals into it (resumable ingest re-reads everything absent).
4. Optional: `rm -rf ~/.pi-chart/store` as the check suggests.

Rollback: revert; `~/.pi-chart/store` is left in place by this change, and `~/.pi-chart/database.url` is ignored by the old code.

## Testing seams

- **Config precedence, unset state, retired setting** → `loadConfig(env, saved)`, pure (`test/install.test.ts`).
- **Discovery order, platform sockets, PG environment, de-duplication** → `candidates(...)`, pure.
- **Setup scenarios (found, in order, unusable passed over, compose fallback, nothing found, supplied only checked, saved kept / re-discovered, URL saved, stranded store named)** → `Installation.setup`/`check` with fake `prepare`, `run`, `which`, `save`, `exists`, `reachable` — the target seam; every requirement of discovery is visible through it.
- **Real `prepare` (database created, extension enabled, unusable on missing privilege)** → `prepare` against the server `PICHART_DATABASE_URL` names, creating and dropping a scratch database; skipped without a server.
- **Socket URL parsing** → `bunSql` option derivation, pure (exported `connectionOptions(url)`).
- **Concurrent migration, concurrent sessions sharing one store** → `PostgresStore` over two server connections; server-gated.
- **A store that never opened shuts down quietly** → `piChart()` loaded as the harness loads it (the existing `loaded()` helper in `test/extension.test.ts`) with an unreachable `PICHART_DATABASE_URL`: the captured `session_shutdown` handler resolves.
- **Unset announcement** → `piChart()` in a child Bun process whose `HOME` holds no saved connection, since `piChart()` reads `~/.pi-chart/database.url` and `os.homedir()` is fixed per process: `session_start`, called twice, announces setup exactly once.
- **Store contract on PGlite** → existing suites via `test/store-support.ts`, unchanged in behaviour.
