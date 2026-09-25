# The default Thread Store is embedded, with a server as the escape hatch

The Thread Store's runtime only ever needed a connection, not a server the operator ran. Making that connection an embedded database removes the last external dependency of a fresh install. The store is PGlite — real Postgres compiled to WASM with an official pgvector build — running in the extension's own process and persisting to `~/.pi-chart/store`. It is the default, used whenever `PICHART_DATABASE_URL` is unset; a supplied URL selects a Postgres server instead.

PGlite runs the same SQL dialect and the same pgvector index as a server, so the schema, migrations, and queries stay one `PostgresStore` behind an `Sql` interface that both a WASM database and a `bun:SQL` server connection satisfy. The backend moves where content lives, not what can be retrieved.

- A fresh machine needs only Bun: no server, daemon, or container. `docker compose` becomes one way to obtain a server for the escape hatch, not a requirement — this supersedes the Compose assumption in ADR-0002.
- The embedded store is single-writer: one in-process connection, no pool. That removes the pool the store already serialised against, and it means a second live connection to the same store is not a supported read-back path — durability across processes is close-and-reopen, which the store-backed suites exercise directly.
- Those store-backed suites, once skipped without a server, now run on the embedded store under plain `bun test`, so "the schema applies" and "SQL returns turns in order" are checked on every run rather than only where a Postgres was configured.
- A heavier corpus can still point `PICHART_DATABASE_URL` at any pgvector-capable Postgres — a package, Postgres.app, or a hosted Neon/Supabase — with no store-code change.
