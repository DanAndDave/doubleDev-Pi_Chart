# The Thread Store is a Postgres server that setup finds or provisions

Supersedes ADR-0007.

The embedded store was single-process: PGlite holds its data directory with no cross-process lock. omp runs one extension process per session, so concurrent sessions each opened `~/.pi-chart/store` from their own process, wrote over each other's WAL, and corrupted it until every open aborted (`Aborted()` at session start and exit). A store every session shares has to be one that arbitrates between processes, which is a server.

So the Thread Store is a Postgres server with pgvector. `/pi-chart setup` finds one — libpq's environment, local Unix sockets, `localhost:5432`, then the project's compose server if it is up — creates a `pi_chart` database and the `vector` extension where it may, and otherwise starts `compose.yaml` when Docker is available. It saves the URL it settled on to `~/.pi-chart/database.url` (mode 0600); sessions read that, and `PICHART_DATABASE_URL` overrides it. Schema migration runs under a Postgres advisory transaction lock, so concurrent sessions migrate once.

- Postgres with pgvector is a requirement again, met by a system package, a hosted server, or Docker. Setup reports what is missing with the command that fixes it, but never runs a package manager or `sudo`.
- A machine with neither Postgres nor Docker runs unconfigured: the session says the store is not set up, and the tail comes from the harness's own history.
- The old `~/.pi-chart/store` is no longer read and never deleted automatically. Turns re-ingest from the Journals (ADR-0002); Accounting recorded there does not carry over.
- Tests stay on PGlite in-process, behind the same `Sql` interface, so `bun test` needs no server; suites that need a real server are gated on `PICHART_DATABASE_URL`.
