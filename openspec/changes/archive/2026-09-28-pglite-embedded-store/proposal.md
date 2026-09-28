# Proposal: PGlite as the Default Embedded Thread Store

Triage: ready-for-agent
Blocked by: None (the Docker-optional change lands first; this reframes its `storeOrigin`)

## Why

A fresh machine cannot run pi-chart's stores without standing up Postgres — today that means Docker, a daemon the plan is retiring. The store's runtime only ever wanted a connection, so the dependency can move in-process: PGlite is real Postgres compiled to WASM with an official pgvector build, verified to run under this project's Bun (1.4.2) with `vector` columns, parameterized `<=>` cosine ordering, and jsonb decode. Making it the default means a fresh install needs nothing but Bun, while an operator with a heavier corpus can still point at a server.

## What Changes

- Add an embedded PGlite backend (`@electric-sql/pglite` + `@electric-sql/pglite-pgvector`) behind the existing `PostgresStore` shape: the same migrations, queries, and interfaces (`TurnSource`/`TurnSink`/`TurnRecall`/`CorpusSearch`/`ConceptSearch`/`AccountingStore`), driven through a thin adapter that maps the store's tagged-template SQL to PGlite's `query(text, params)`/`exec` API.
- Make the embedded store the **default**: with no `PICHART_DATABASE_URL` set, the store opens a PGlite database under a data directory (default `~/.pi-chart/store`) instead of dialing a server. No server, no daemon, no Docker.
- Keep `PICHART_DATABASE_URL` as the escape hatch: a supplied URL selects the server-backed `bun:SQL` path unchanged. `docker compose` becomes one optional way to produce such a URL, not a requirement.
- Reframe `storeOrigin` (added in the Docker-optional change): `own` now means the embedded PGlite store rather than the compose Postgres. `pi-chart setup` provisions `own` by ensuring the data directory exists — it no longer runs Docker for the default. `supplied` and `declined` are unchanged.
- **BREAKING** for operators who relied on `pi-chart setup` starting Docker implicitly: the default no longer touches Docker. A compose Postgres is now reached only by setting `PICHART_DATABASE_URL`.
- The embedded backend also backs the Concept index (doc-store), the codebase graph, cross-conversation search, and Accounting, since all share one database; their behavior is unchanged.

## Capabilities

### New Capabilities
<!-- none: the backend swap changes how an existing capability is satisfied, not the set of capabilities -->

### Modified Capabilities
- `thread-store`: the default store is embedded and needs no external server; schema-forward, safe-degradation, and connection-release requirements are restated to hold for the embedded backend as well as a supplied server.

## Impact

- Dependencies: adds `@electric-sql/pglite` and `@electric-sql/pglite-pgvector` (runtime); Docker drops from the required path.
- BREAKING: two settings change meaning. `pi-chart setup` no longer starts Docker — with no `PICHART_DATABASE_URL` the store is embedded, so operators who relied on setup bringing up the compose Postgres must set `PICHART_DATABASE_URL` to reach it. And `PICHART_PG_PORT` is removed from the settings the extension reads (it only ever shaped the compose default URL); `compose.yaml` still honours it for the port it publishes.
- Code: `src/postgres-store.ts` (backend selection + adapter), `src/config.ts` (`storeOrigin` semantics, a store data-directory setting), `src/install.ts` (`setup`/`check` provision the embedded store for `own`), and the extension's store construction site.
- Docs: `README.md` requirements/setup/"Start the Thread Store" — Bun-only default, Docker/hosted Postgres as the escape hatch.
- Tests: store behavior currently exercised against Postgres must run against the embedded backend; the compose file and its container-backed tests remain for the supplied path.
- Verified prerequisite: Bun 1.4.2 + PGlite 0.5.8 + `@electric-sql/pglite-pgvector` 0.0.9 run `CREATE EXTENSION vector`, `vector(N)` columns, and parameterized cosine-distance ordering.
