## Context

`scripts/gate.ts` `main` builds the Workload template and both trees, then runs `LOOKS` in order through `gatherPairs`, the loop shared with a sweep's confirm (`scripts/sweep.ts`) and the plain-omp comparison (`scripts/compare.ts`). `gatherPairs` starts a pair while `complete + inFlight < want` and `spent < cap`. It numbers pairs from the highest finished index, so a pair that threw `PairStop` leaves no trace in the next index. `gate.json` is written once, after the loop, and a thrown `stopped` skips the pool.

Each pi-chart Run (`runOne`, `scripts/runs.ts`) creates `bench_<ctx.stamp>_<label>` with one admin connection, migrates it through its tree's store, and runs omp with that database's URL. omp's Bun SQL pool opens up to 10 connections. Afterwards the Run exports Accounting (one plain connection plus the store's pool) and drops the database with `WITH (FORCE)` on a new admin connection. Every step logs its failure and the Run throws the first.

On the server at the time of writing: `max_connections` 100, `superuser_reserved_connections` 3, `reserved_connections` 0, 51 client backends (50 on `thread_store` with no `application_name`), and 5 background processes that also show in `pg_stat_activity`.

The pool holds, under gate v1 / omp/18.12.6, an A/A batch of 5 pairs (pair cost $6.80–9.21, median $8.78) and a Gate batch of 10 ($8.08–10.50, median $9.87).

## Goals / Non-Goals

**Goals:**

- No Gate spend is lost to a stop: every settled pair is on disk, and the run can be continued.
- A Gate does not start what the server cannot hold, nor a pair its cap cannot pay for.
- Run databases left by crashes do not accumulate.

**Non-Goals:**

- Bounding omp's own pool. A Run's 10 connections belong to the tree it loads.
- Retrying a failed Run step such as the export inside `runOne`.
- Changing caps for a sweep's confirm (`CONFIRM_CAPS`) or the comparison batches.
- Resuming `scripts/compare.ts` or `scripts/sweep.ts` batches through this path.

## Decisions

### The estimate is a function `gatherPairs` asks for, not a number

The estimate has to follow the Gate's own pairs as they finish. `gatherPairs` therefore takes an optional `estimate: (pairs: PairRun[]) => number | undefined` and asks it before each start. Starting is decided by the pure `mayStart({ spent, inFlight, cap, estimate })`: with an estimate, `spent + (inFlight + 1) × estimate ≤ cap`; without one, `spent < cap`. The Gate passes `(pairs) => pairEstimate(pairs, history, key)`. That is the median of `base.cost + candidate.cost` over its finished pairs, else over every pooled pair under the key, else `undefined`.

Void pairs count in the median, since their Runs were spent too. A `PairStop` pair has no `PairRun` and does not count, but its spend does.

`sweep.ts` and `compare.ts` pass no estimate and keep `spent < cap`, so their behaviour and tests are unchanged.

Considered: a fixed per-pair reserve. Rejected, because the pool already measures pair cost per key and a constant would go stale with each omp version.

With the Gate batch's $9.87 median, 5 pairs project to $49.35 and 10 to $98.70. They fit $55 and $110 with room for one void pair's partial cost before the first look.

### `gatherPairs` reports each settled pair and carries the next index

`gatherPairs` gains `next?: number`, the first index to use (at least one past every carried pair), and returns `next` in `Gathered`. Since `main` spreads one look's `Gathered` into the next, the index survives a stopping pair. It also gains `settled?: (state: { pairs, spent, next }) => Promise<void>`. It is awaited after each pair settles, complete, void or stopped, and before the freed slot is refilled. `main` uses it to rewrite `gate.json`. If the write fails, the error is treated as a stop: nothing new starts and the error is returned as `stopped`.

`gate.json` is written by `writeJsonAtomic` (temporary file in the same folder, then `rename`), which `appendToPool` now uses as well.

### Resume reuses the fresh path

`--resume <dir>` reads `gate.json` and checks it with the pure `resumeRefusal(record, { omp, workload })`:

- it refuses on an omp or Workload version that differs from the key, naming both;
- it refuses on a record that ended. The last write of a Gate or A/A run that did not stop sets `ended: true`. A record written before this change has no `next`; it was written once, at the end, so it ended unless it holds `stopped`. A crash mid-run leaves neither `ended` nor `stopped`, and resumes.

Then `main` runs the same sequence as a fresh Gate: preflight, sweep, build, then the look loop. The loop is seeded with `{ pairs, spent, next }`. `next` is the maximum of the recorded `next`, one past every recorded pair, and one past every `runs/<side>-<i>` folder (`nextIndex`). The looks are not read from the record. Each look decides on the first `LOOKS[k].pairs` complete pairs by index, which in a fresh Gate are exactly the pairs present at that look, because `gatherPairs` never lets complete pairs exceed `want`. So a resumed Gate re-derives the looks a fresh one would have reached. Each look is decided against the pool as it is when the resumed run reads it. If a batch under the key was added since the run stopped, the pooled variance and degrees of freedom differ from what the original run would have used, and so can the verdict.

The resumed run keeps the folder and the record, and moves the earlier `stopped` reason into `resumed: string[]`, which the report names. Flags that `gate.json` decides (`--base`, `--candidate`, `--aa`, `--commit`, `--workload`, `--pool`, `--out`) are refused beside `--resume`. `--parallel` and `--turn-timeout` may be given again to override the record, since a retry after "too many clients" may need a narrower Gate.

The Workload is recorded as its folder (`workload`), resolved by `workloadFolder` in `scripts/runs.ts`, the rule `loadNamedWorkload` loads by: a `--workload` value holding a slash is a path, anything else a name under `bench/workloads/`. A resume loads that same folder. A record without it falls back to the key's Workload name.

A resumed run takes a new stamp, so its Run databases never collide with the stopped run's.

### Preflight counts client backends against all reserved slots

`pg_stat_activity` also lists the checkpointer, WAL writer and launchers, which take no connection slot. So the count is `backend_type = 'client backend'`. Free is `max_connections − superuser_reserved_connections − reserved_connections − client backends`. `reserved_connections` is read with `current_setting(…, true)`, since it exists only from Postgres 16. The pure `connectionRefusal(state, parallel)` returns the refusal text or `undefined`. It lists the top 5 holders by `(application_name or "no application name", usename, datname)`.

The need is 12 per Run, 24 per pair: 10 for omp's pool, unbounded on any tree older than a pool bound, and 2 admin connections (create or export plus drop, never both at once). The preflight runs before `buildContext`, so a refusal costs nothing.

Considered: subtracting only `superuser_reserved_connections`. Rejected, because a non-superuser role cannot use `reserved_connections` either, and here that setting is 0.

### The stale sweep matches a strict name and an age

The pure `staleDatabases(names, now)` keeps names matching `^bench_(\d{13})_[a-z0-9_]+$` whose stamp is more than 24 hours before `now`. Thirteen digits cover millisecond stamps from 2001 to 2286. The label part is what `runOne` produces (`base_0`, `pi_chart_0`, `candidate_3`), all safe as unquoted identifiers. `ownDatabases(names, stamp)` keeps the matching names with exactly the Gate's stamp. Both feed `dropDatabase` (`DROP DATABASE IF EXISTS … WITH (FORCE)`).

The sweep runs after the preflight, as specified. The preflight therefore sees connections a stale database still holds, and refuses when they tip the balance; FORCE frees them only afterwards. [INFERENCE] A database left by a crash rarely keeps connections, since its omp process is gone.

The own-database drop runs in `main`'s error path, after `gatherPairs` has let every pair in flight finish, so it drops nothing a live Run uses. A drop that fails is logged and does not mask the Gate's error. The next sweep after 24 hours takes it.

### Caps

`LOOKS` becomes `{ pairs: 5, cap: 55 }` and `{ pairs: 10, cap: 110 }`. The A/A run uses the first look's cap, now $55, which its 5 pairs at the A/A median of $8.78 ($43.90) fit.

## Risks / Trade-offs

- [A pair dearer than the median still crosses the cap] → bounded by one pair's excess over the median per pair in flight. The report says so.
- [The preflight counts connections at one instant] → another session can open connections after it passes. It catches the standing case seen here: 50 connections held by sessions on `thread_store`.
- [The pool grew between the stop and the resume] → the resumed looks pool the larger set, which a fresh Gate started then would pool too; the pool's batches are dated, so the report's figures can be traced.
- [Resume trusts `runs/` folder names] → any `base-<i>` or `candidate-<i>` folder pushes the next index past `i`. A stray folder only skips an index.
- [A crash between the final `gate.json` write and the pool append] → the record holds a verdict, so resume refuses, and the batch is missing from the pool. The window is one file write.

## Testing seams

- **Spend is capped**: `gatherPairs` with an `estimate` function in `describe("gatherPairs")` of `test/gate.test.ts`, covering a pair that would cross not starting, the old rule without an estimate, and the estimate switching from the pool's median to the Gate's own. `mayStart` and `pairEstimate` are tested directly beside it. The `LOOKS` caps are read by the existing cap tests, which move to $55.
- **Every Gate leaves a record**: `gatherPairs`' `settled` callback, which sees each settled pair with its spend and next index, a stopping pair included, in `test/gate.test.ts`. The atomic file write and its use in `main` are checked by the smoke run.
- **A stopped Gate resumes**: `resumeRefusal`, `nextIndex`, and `gatherPairs` seeded with carried `{ pairs, spent, next }`, in `test/gate.test.ts`. `lookPairs` (the first `want` complete pairs by index) is tested for recomputing the looks. Reading `gate.json` and rebuilding trees are exercised by the smoke run's refusals, with no Run.
- **Free connections**: `connectionRefusal` in `test/gate.test.ts`. The live query is smoke-tested with a `--parallel` the server cannot hold.
- **Stale Run databases**: `staleDatabases` and `ownDatabases` in `test/gate.test.ts`. The drop is smoke-tested with `bench_1000000000000_smoke_0` created on the server.
