## Context

See proposal.md — Why. The runtime constraint that makes this cheap: `PostgresStore` already takes its database handle by injection (`constructor(private readonly sql: SQL, …)`; `connect(url)` just does `new SQL(url)`), and every one of its ~35 query sites speaks Bun's `SQL` tagged-template API. Nothing above the store knows a URL; the extension constructs the store and calls interface methods.

The store's use of Bun's `SQL` is a bounded surface, enumerated from `src/postgres-store.ts`:

1. Tagged template returning rows — `` sql`SELECT … ${p}` `` (the dominant form, ~30 sites).
2. `sql.unsafe(text)` — raw DDL, run per migration statement.
3. `sql(object)` — a single-row insert fragment: `` sql`INSERT INTO t ${sql({ version })}` ``.
4. `sql(rows[])` — a multi-row insert fragment: `` tx`INSERT INTO turn_messages ${tx(rows)}` ``.
5. `sql.begin(async (tx) => …)` — a transaction whose `tx` has the same shape.
6. `sql.end()` — close (via `PostgresStore.close`).
7. Fragment composition — a `sql` fragment interpolated into another template and flattened, at line 552: `` ${conversationId ? sql`AND conversation_id = ${conversationId}` : sql``} ``.
8. Text params cast in SQL — `${embedding}::vector`, `${JSON.stringify(vector)}::vector`. Verified to work under PGlite's `vector` extension.

PGlite's native API is `db.query(text, params)` / `db.exec(text)` / `db.transaction(fn)` — parameterized `$1…$n`, no tagged template. The gap between (1)–(8) and PGlite's API is the whole cost of this change.

Store contract tests today are gated: `const describeStore = process.env.PICHART_DATABASE_URL ? describe : describe.skip`. Without a server they skip (the ~203 skips in the suite). An embedded default lets them run with no server.

## Goals / Non-Goals

**Goals:**
- Embedded store is the default; a fresh machine needs only Bun.
- Zero change to `PostgresStore`'s query sites — the backend swaps behind the handle it already receives.
- A supplied `PICHART_DATABASE_URL` keeps the existing Bun `SQL` server path unchanged.
- The store's existing contract suites run against the embedded backend without a server.

**Non-Goals:**
- No change to the schema, migrations, SQL, or any store interface method's behavior.
- No new pooling, sharding, or concurrency model — embedded is single-writer by nature.
- Not removing `compose.yaml` or the server path; they remain the supplied-store escape hatch.
- No performance work; the audit's worst reads (48–81 ms) are within budget for WASM.

## Decisions

### A narrow `Sql` interface, satisfied by both backends

Introduce an interface capturing exactly surface items (1)–(6) — a callable tagged-template with `.unsafe`, `.begin`, `.end`, plus the `(object)` and `(rows[])` fragment overloads. Type `PostgresStore`'s handle as `Sql` instead of Bun's `SQL`. Bun's `SQL` already satisfies it structurally, so the server path is unchanged; the PGlite adapter is a second implementation. This is the seam: the store depends on the interface, `connect` chooses the implementation.

Alternative considered — rewrite the store's query sites onto PGlite's `query(text, params)` directly (no adapter). Rejected: it churns ~35 call sites and forks the server path, for no behavioral gain. The adapter localizes all backend knowledge in one file.

### The adapter reproduces the tagged-template engine, narrowly

The PGlite adapter implements the tagged-template by walking template strings and pushing interpolated values into a `$1…$n` parameter list, with two special cases matching Bun:
- A value that is itself an adapter fragment (item 7) is spliced inline — its text merged and its params renumbered into the surrounding query — not bound as a parameter.
- `sql(object)` and `sql(rows[])` (items 3–4) build `(cols) VALUES (…)` fragments with the values as parameters.

`.begin` maps to PGlite's `transaction`, wrapping the same tagged-template factory over the transaction handle so `tx` behaves identically. `.unsafe` maps to `db.exec`/`db.query` without parameters. `.end` maps to `db.close`.

Alternative — reuse a postgres.js-compatible shim. Rejected: none targets PGlite, and the surface we need is small and fully enumerated above; a focused adapter is less code than adapting a general one, and every behavior it must have is testable in isolation.

### Backend selection lives in `connect`, keyed by `storeOrigin`

`PostgresStore.connect(url, embedder)` becomes backend-aware: a supplied server URL builds a Bun `SQL`; the embedded default builds the PGlite adapter over a data directory. Selection reuses the `storeOrigin` taxonomy already added for the Docker-optional change — `own` now means embedded PGlite, `supplied` means the server URL, `declined` means no store. `install.ts` `setup` provisions `own` by ensuring the data directory exists rather than running Docker; `check` reports the embedded store as ready when its directory is present.

### Data directory is a config setting

Add a store data-directory setting (default `~/.pi-chart/store`, beside the existing `~/.pi-chart/bundle`), resolved in `loadConfig` alongside `databaseUrl`. The embedded adapter persists there; discarding it and re-ingesting rebuilds the store, preserving the "derived and rebuildable" requirement.

### jsonb decoding already tolerates both shapes

PGlite returns `jsonb` columns as JS objects; Bun's `SQL` returns them as text. The store's `decode()` helper already branches on `typeof value !== "string"`, returning the value as-is when it is not a string. No store change is needed; a test asserts a `jsonb`-bearing row (e.g. accounting `parts`) round-trips through the embedded backend.

## Risks / Trade-offs

- Faithful reproduction of Bun's fragment composition and row-builder (items 3, 4, 7) is the highest-risk part → unit-test the adapter directly against those exact shapes before wiring the store; if a shape proves fragile, the fallback is to rewrite that single site (line 552, the two insert fragments) to explicit parameterized SQL, which the adapter already supports.
- WASM is slower than native Postgres → acceptable per proposal (tens-of-turns-per-conversation work, worst reads 48–81 ms); embedding, not query latency, dominates.
- Single connection → the store already serializes writes and the spec requires connections return to baseline; single-writer satisfies it trivially and sidesteps the known pool leak.
- New runtime dependencies (`@electric-sql/pglite`, `@electric-sql/pglite-pgvector`) ship WASM → size cost accepted for a zero-server default; the pgvector build is official.
- Bun + PGlite + pgvector compatibility → already verified empirically (Bun 1.4.2, PGlite 0.5.8, pgvector 0.0.9: extension, `vector(N)`, `<=>` ordering, jsonb decode).

## Migration Plan

1. Add dependencies; introduce the `Sql` interface and re-type the store's handle (no behavior change; server path stays green).
2. Build the PGlite adapter; unit-test its tagged-template, fragment composition, and row builders.
3. Make `connect` backend-aware and add the data-directory setting; point `install.ts` `own` provisioning at the directory.
4. Run the existing store contract suites against the embedded backend (unset `PICHART_DATABASE_URL`); they must pass without a server.
5. Update README and `check`/`setup` copy. `compose.yaml` and the server path remain for supplied stores.

Rollback: setting `PICHART_DATABASE_URL` restores the exact prior server path; the embedded code is inert when a URL is supplied.

## Testing seams

Per `docs/agents/workflow.md`, each requirement is verified through a named seam; prefer the highest existing seam.

- **The default store is embedded and needs no external server** → the `PostgresStore` public-interface seam. Run the existing gated contract suites (`test/postgres-store.test.ts`, `test/ingest-store.test.ts`, `test/doc-index.test.ts`, and the shared `test/turn-source-contract.ts`) against an embedded `PostgresStore.connect` with no `PICHART_DATABASE_URL`. "Embedded and server retrieve equivalently" is the same contract run against both handles.
- **The embedded store persists across sessions** → the same store seam: ingest, `close`, re-`connect` from the same data directory, retrieve. An integration test over a temp directory.
- **A configured connection selects the server-backed store** → the `connect`/`loadConfig` seam: assert selection by `storeOrigin`, without needing a live server (the server branch constructs a Bun `SQL`, unexercised when no URL is set).
- **An unreachable store degrades safely / the embedded default does not degrade** → the extension context-handler seam already used by `test/extension.test.ts` ("the verbatim tail", "a store that misses its deadline"): the embedded default serves the tail from the store; a supplied-but-unreachable store degrades.
- **Adapter fragment/row-builder behavior** (implementation risk, not a spec requirement) → a focused unit seam on the adapter, asserting fragment composition and the `(object)`/`(rows[])` builders emit the intended SQL and parameters.

Highest seam for the capability is the store interface; the adapter unit seam exists only because faithful tagged-template reproduction is the change's real risk.
