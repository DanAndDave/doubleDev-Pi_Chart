# Proposal: The Gate resumes, and stays within its cap

Triage: ready-for-agent
Blocked by: None

## Why

An A/A run (`bun scripts/gate.ts --aa`) ran all 40 Turns of its 4 Runs, then base-0 failed to export its Accounting with Postgres "too many clients". The pair threw `PairStop` and `gatherPairs` stopped. `gate.json` is written only once `main` reaches its end, so that spend produced no batch, and nothing could pick the run up where it stopped. The failed Run's database `bench_<stamp>_base_0` stayed on the server, because its drop failed the same way. An older `bench_1792117753912_pi_chart_0`, from 2026-10-16, had been left by an earlier crash.

The server allows 100 connections. Each pi-chart Run's omp process opens a pool of up to 10, plus short-lived admin connections to create, export and drop its database. At the time of writing, 51 client backends were connected, 50 of them to `thread_store` with no application name. That leaves 46 free once the 3 superuser-reserved slots are set aside. A Gate at `--parallel 2` can need 48.

The last Gate spent $94.79 against its $90 cap. `gatherPairs` checks only `spent < cap` before it starts a pair, and at `--parallel 2` two pairs are in flight when the cap is reached. Pair costs (both Runs) ranged over $8.08–10.50, median $9.87, in the 10-pair Gate batch under omp/18.12.6. At that cost, 5 pairs come to about $49 and 10 to about $99, so the $45 and $90 caps cannot hold the looks' pairs even with no void pair.

## What Changes

- **`gate.json` is written after every pair.** It is replaced whole (temporary file, then rename) once the Gate's trees are built and again each time a pair settles, complete, void or stopped. It holds the pairs, the spend, the next pair index, the Workload's folder, the turn timeout and everything else a resume needs.
- **`--resume <output folder>`** continues a Gate or A/A run that stopped. It reads `gate.json` and takes the kind, commits, key, Options, pool and Workload from it. It refuses when the installed omp version or the Workload's version no longer matches the recorded key, and when the record already ended. It rebuilds both trees, carries over the pairs and spend, and never reuses a pair index whose `runs/` folders exist. It recomputes the looks from the pairs, then ends exactly as a fresh Gate would: verdict, pool append and report.
- **Connection preflight.** Before anything is built or spent, the Gate reads `max_connections`, `superuser_reserved_connections`, `reserved_connections` and the client backends in `pg_stat_activity`. It refuses when the free connections are fewer than `parallel × 2 Runs × 12`: 10 for a Run's pool, because a base tree may predate any bound on it, and 2 for its admin connections. The refusal names how many are free and how many are needed, and lists the largest holders by application, user and database.
- **Caps are $55 before the first look and $110 in total** (was $45 and $90). A pair starts only when `spent + (inFlight + 1) × estimate ≤ cap`. The estimate is the median pair cost (both Runs) of this Gate's finished pairs. Before the Gate has any, it is the median over the pool's stored pairs under the current key. With neither, the old rule `spent < cap` applies. The report states the rule instead of "spend may exceed the cap by the pairs already running".
- **Stale Run databases are swept.** After the preflight, every Gate and A/A run drops each database named `bench_<13-digit ms stamp>_<label>` whose stamp is more than 24 hours old, logging each drop. Nothing else is dropped, and no younger database either, since another Gate may be running. A Gate that ends with an error drops the databases of its own Runs (`bench_<its stamp>_…`) that are still there. Drops use `DROP DATABASE … WITH (FORCE)`.
- Unchanged: the looks' pair counts and levels, `gatherPairs`' behaviour for its other callers (`scripts/sweep.ts`, `scripts/compare.ts`), which pass no estimate, the pool's format, and `--report`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `regression-gate`: "Spend is capped" moves to $55 and $110 with a projected start rule. "Every Gate leaves a record and a report" writes `gate.json` after every pair. New requirements cover resuming a stopped Gate, the connection preflight, and sweeping stale Run databases.

## Impact

- `scripts/gate.ts`: `LOOKS` caps; `gatherPairs` gains an optional estimate, a starting index and a per-pair callback; new pure functions `pairEstimate`, `mayStart`, `lookPairs`, `nextIndex`, `resumeRefusal`, `connectionRefusal`, `staleDatabases` and `ownDatabases`; the look loop moves out of `main` into `runLooks`; `main` gains `--resume`, the preflight, the sweep, per-pair `gate.json` writes, and the own-database drop on error; the header comment and the report's cap line.
- `scripts/runs.ts`: `workloadFolder`, the `--workload` path rule `loadNamedWorkload` and `gate.json` share.
- `scripts/sweep.ts`: the `CONFIRM_CAPS` comment cites the Gate's new caps; the confirm caps themselves are unchanged.
- `test/gate.test.ts`: the projected-cap rule, the per-pair callback, resume's carried state, the preflight decision and the database selection.
- `docs/agents/workflow.md`: a full Gate costs up to about $110, and `--resume` continues a stopped one.
- `scripts/sweep.ts` and `scripts/compare.ts` call `gatherPairs` with no estimate and keep the old rule. `CONFIRM_CAPS` and the compare caps are unchanged.
- An existing `gate.json` without `next`, `workload` or `turnTimeout` resumes with the next index taken from its pairs and `runs/` folders, the Workload taken from its key's name, and the default turn timeout.
