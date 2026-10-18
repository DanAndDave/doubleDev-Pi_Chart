# Design: Budget sweep

## Context

What the archived slices built, which the sweep reuses:

- **`scripts/runs.ts` `runOne(spec, ctx)`** runs one Run. It gives the omp child `{ ...process.env, PICHART_DOC_BUNDLE, PICHART_DATABASE_URL }`, so today a Run's Budgets come only from the shell, and every Run of one process shares them. `RunSpec` is `{ arm, index, label, source, commit? }`. `RunRecord` (`scripts/measures.ts`) has no Budget field. `pool(jobs, width)` runs jobs a fixed number at a time, with no cap.
- **`scripts/gate.ts`** has the Gate's statistics and scheduling:
  - `decide({ look, pairs, history, key })` uses `LOOKS` (5 pairs at α 0.0088 with a $45 cap; 10 pairs at α 0.0467 with a $90 cap), `MARGIN` 1.1 and Holm's correction across the Cost and Lapse fail tests.
  - The module-private `measureTest(current, stored, alpha)` returns the mean, pooled SD, df, SE, t critical value, one-sided bounds and the p-value of P(T ≥ d̄/SE).
  - `costDiff` and `lapseDiff` are also private.
  - `gatherPairs({ want, cap, width, runPair })` handles void pairs and the cap.
  - `gateLapses(measures)` counts Re-fetch Lapses, recall Pulls and failed-Probe Lapses.
  - `pooledBatches(batches, key)` throws, naming `gate.ts --aa [--workload <name>]`, when the key has no A/A batch.
  - `Batch.kind` is `"aa" | "gate"`.
- **`bench/gate/pool.json`** holds one A/A batch: `gate` v1, `anthropic/claude-opus-5-5`, `omp/18.11.0`, 5 pairs.
- **`scripts/bench-tokens.ts`** is a top-level script with no `import.meta.main` guard. Importing it starts a benchmark. `--report <dir>` re-prints `<dir>/bench.json`.
- **`src/config.ts` `loadConfig(env)`** reads each Budget with `count` or `share`, which fall back to the default silently on a value they can't use. The `DEFAULT_*` constants are exported.
- **Gate v1 Runs** cost $4.37 on average (probe Runs $3.83 and $4.91). A `smoke` v2 Run costs about $0.13.
- **The Gate Workload's authoring** (`archive/2026-10-15-gate-workload/design.md`) fixed the pattern the held-out Workload follows: fictional rules in `overlay/notes/`, six Plants and six Revisits across the ≤ 5, 8–12 and ≥ 25 bands, a notes-scoped prompt suffix, checks verified against a throwaway reference solution, a probe gated on bands and evictions, and a README with the measured figures.

## Goals / Non-Goals

**Goals:**

- One command that screens a grid, picks by the Gate's objective, confirms on held-out work, and writes the report a tuning change commits.
- The statistics are the Gate's own code, so a sweep winner and a Gate verdict can't disagree about what counts as cheaper or forgetting more.

**Non-Goals:**

- Running a real sweep or changing any default. That is the job of the tuning changes.
- The held-out A/A batch. The first sweep runs `gate.ts --aa --workload gate-holdout` with the user's go-ahead.
- Sweeping settings outside the nine tunable Budgets, such as `PICHART_PINS`, `PICHART_RECALL_MAX_DISTANCE` and the deadlines.
- Sweeping plain omp, or models other than the reference model.
- Replacing voided screen Runs.

## Decisions

### 1. `scripts/sweep.ts` holds the sweep; `bench-tokens --sweep` dispatches to it

`bench-tokens.ts` runs on import, so nothing in it can be unit-tested. The sweep's logic lives in `scripts/sweep.ts`: its pure functions and its `runSweep(argv)`. `bench-tokens.ts` gains two early branches:
- `--sweep <grid.json>` calls `runSweep`;
- `--report <dir>` re-prints `<dir>/sweep.json` when it exists, and `bench.json` otherwise.

The command keeps the name decision 18 gave it. Its flags:

```
bun scripts/bench-tokens.ts --sweep <grid.json> [--workload gate] [--holdout <name>] [--runs 3]
  [--parallel 3] [--pool bench/gate/pool.json] [--out <dir>] [--turn-timeout 600]
```

`--holdout` defaults to `<workload>-holdout`. `--workload` and `--holdout` take a name or a path, as everywhere else. `--pool` lets smoke sweeps use a temporary pool.

Alternative considered: a separate `scripts/sweep.ts` CLI. Rejected because the decision and the proposal both name `bench-tokens --sweep`, and the dispatch costs two branches.

### 2. A Run's Budgets come from its spec, and its record names them

- `RunSpec` gains `budgets?: Record<string, string>`. `runOne` sets them on the child's env after `process.env`, so the spec wins.
- `scripts/runs.ts` exports `BUDGET_VARIABLES`, the nine tunable names.
- `RunRecord` gains `budgets?: Record<string, string>`: every tunable variable present in the child's env, whether it came from the spec or the shell. It is omitted when none is set.
- Recording the shell's values too means a hand-run `PICHART_TAIL_TOKENS=40000 bench-tokens …` is no longer silent about its cell.

### 3. The grid file, its cells and its defaults

```json
{ "slug": "tail-mark", "budgets": { "PICHART_TAIL_TOKENS": [25000, 40000, 60000], "PICHART_TAIL_LOW_WATER": [0.2, 0.4, 0.6] } }
```

`cellsOf(grid)` validates the grid and returns the cells, or throws one error that lists every problem (the spec's list):
- **Defaults** come from `loadConfig({})` of the checkout's `src/config.ts`, through a table that maps each variable to its `Config` field. The sweep refuses a dirty `src/`, so the checkout is the commit every Run loads.
- **"Read as given"** means `loadConfig({ [variable]: String(value) })[field] === value`. This is needed because `count` and `share` fall back to the default silently, so 1.5 for a share and -1 for a count would otherwise run as default cells under another name.

The cells are the cartesian product, in the order the file lists the Budgets. Each cell has an `id`, `c0`…`c8`, used in Run labels (`c4-r1`), and its `budgets`. Ranks for the tie-break come from each Budget's values sorted ascending, so the order the file lists values in doesn't matter.

### 4. The screen: rounds, pairs, a capped scheduler

- Jobs are queued round-major. Round *r* lists the cells rotated right by *r*, so the cell first in one round is second in the next, and start-order and drift effects are spread across cells.
- A small `runCapped({ jobs, width, cap })` in `sweep.ts` starts a job only while spend is below the cap, and adds each finished Run's cost. It returns whether the cap left some job unstarted; the screen's spend is summed from the Runs it recorded. `pool` stays uncapped for bench-tokens.
  - Alternative considered: reusing `gatherPairs`. It was rejected because it counts pairs toward a "want" and replaces voids, and the screen does neither.
- A Run that throws, or records a model other than `REFERENCE_MODEL`, stops the screen as the Gate does. Runs in flight finish, and the sweep writes `sweep.json` with `stopped` and adds nothing to the pool.
- The comparison of cell *a* against cell *b* uses `PairFigures`, `{ base: b, candidate: a }`, from each round where both Runs completed. That way `costDiff` and `lapseDiff` read as *a* − *b*.

### 5. The Gate's statistics, exported and given a margin

- `measureTest`, `costDiff` and `lapseDiff` are exported from `gate.ts` unchanged. So are the pieces the sweep shares with the Gate's `main`: `pairRunner` (one pair's two Runs, started in alternating order), `offModel` (the Gate's model check), `referenceOptions` (a Run's Options under `REFERENCE_MODEL`), the pool's `POOL`, `readPool`, `appendToPool` and `completePairs`, and the report's `describeKey`, `fixed`, `pValue` and `lookTable`.
- `scripts/runs.ts` gains `buildContext` (the workspace template built once, and the Context its Runs share) and `srcIsCommitted`, and `scripts/workload.ts` gains `isHeldOut`. bench-tokens, the Gate and the sweep use these, not copies of them.
- `decide` gains a required `margin`. The Gate passes `MARGIN` (1.1) and confirm passes 1. `Decision.nonInferior` keeps its name and its doc comment gains "at `margin`": at a margin of 1, non-inferior means cheaper. A rename would need a read shim for every `gate.json` already written.
- `measureTest` is used in two ways:
  - **Lapse eligibility:** `measureTest(lapseDiffs, storedLapseDiffs, 0.05)`. The cell is rejected when `p ≤ 0.05`. The test is per cell, with no correction across cells. More cells ruled out only moves the pick toward the default, which is the conservative direction.
  - **Tie interval:** `measureTest(costDiffs, storedCostDiffs, 0.025)`. Its one-sided bounds at α 0.025 are the two-sided 95% interval. The cell is tied when `lower ≤ 0 ≤ upper`.
- In both uses, `stored` is the screen key's batches from `pooledBatches`, so the pooled variance includes the Gate Workload's A/A and Gate batches.

### 6. Eligibility and the pick are one pure function

`screen({ cells, runs, history, key })` returns, for each cell:
- its complete Runs, its geometric-mean cost, and its Pass count per graded step;
- its comparison with the default (pairs and the Lapse test);
- its eligibility and reasons: `too few pairs`, `forgets more (p = …)`, `<step> collapsed (a of n against b of m)`;
- its tie test against the best.

It also returns the best cell, the tied cells and the winner.

The tie-break order is the spec's: the default first, then the lowest rank sum, then the lowest rank on the first Budget.

A collapse compares Pass counts over complete Runs, cell against default: the cell collapses on a step when it has 2 or more fewer passes. The default with fewer than 2 complete Runs has no comparisons, so every other cell is ineligible for `too few pairs` and the default wins.

### 7. Confirm reuses the Gate's loop with a margin of 1

- `confirm({ winner, defaultCell, history, key, width, runPair })` runs the Gate's two looks: `gatherPairs` with `LOOKS[look].pairs` and `CONFIRM_CAPS[look]`, then `decide({ …, margin: 1 })`. `runPair` is injected, as in `gatherPairs`, so the loop is tested without Runs.
  - Base is the default cell and candidate is the winner. Labels are `confirm-base-<i>` and `confirm-candidate-<i>`, and start order alternates by index.
- The outcome follows from the verdict:
  - `pass` gives **adopt**;
  - `fail` gives **keep the default**, with the reason `costlier` or `forgets more` from whichever test Holm rejected;
  - `inconclusive`, or stopped by the cap, gives **keep the default**, with the reason `not shown cheaper`.
- The confirm's complete pairs, if at least 2, are appended to the pool as `{ kind: "confirm", key: heldOutKey, base: commit, candidate: commit, budgets: { base, candidate }, … }`. `Batch.kind` gains `"confirm"`, and `Batch` gains an optional `budgets`.
  - Pooling is within a key, the way Gate batches of different commits already pool. The A/A batch is still required.

### 8. Preconditions, in order, all before any spend

1. Grid valid (decision 3), and no tunable Budget variable set in `process.env`.
2. `git diff --quiet HEAD -- src/`. The commit is `HEAD`, and the source is the checkout itself, as in bench-tokens.
3. Screen Workload loads, and its name doesn't end in `-holdout`. Held-out Workload loads, with a different name from the screen's.
4. `pooledBatches(history, screenKey)` and `pooledBatches(history, heldOutKey)`, which throw with the `--aa` command.
5. A Thread Store server is available.

Only then are the two templates built: the screen's now, the held-out one only when confirm runs.

### 9. The Gate refuses held-out Workloads

`gate.ts main` checks the loaded Workload's name right after loading it: a name ending in `-holdout` throws unless `--aa` is given. This is the whole mechanism. A held-out Workload is recognised by name only, which keeps the rule visible in `bench/workloads/`.

### 10. Record and report

- `<out>/sweep.json` is a `SweepRecord`: `{ grid, commit, keys: { screen, heldOut }, options, cells, runs: [{ cell, round, label, cost, lapses, complete, steps }], screen: { spent, cap, capped, result }, confirm?: { pairs, looks, spent, cap, capped, outcome, reason }, stopped? }`.
- The record is written after the screen and again after confirm, so a confirm that throws still leaves the screen on disk.
- `report(record, measures)` prints Markdown in the eviction-defaults report's shape. Its sections, in order:
  - a title with the date and slug;
  - the outcome paragraph;
  - **All cells**;
  - **The rule, as applied**: per cell, eligible or not with reasons, the Lapse test, and the tie interval and ratio against the best;
  - **Noise**: each cell's per-Run costs;
  - **Confirm**: the per-look table, in the Gate's columns;
  - **Spend**;
  - **Method**: commit, grid JSON, both keys, the command.
- Per-cell Retention, Utilisation and Re-fetches come from `aggregate()` over each cell's complete Runs, re-measured from the records with the committed calibration, the way `gate.ts --report` does.
- At the end of a sweep with an outcome, the same text is written to `docs/benchmarks/<YYYY-MM-DD>-<slug>.md`, and `sweep.json` is copied to `<YYYY-MM-DD>-<slug>.json`. Neither file is overwritten if it exists: the sweep then names both paths and leaves them alone. A sweep stopped by a Run writes only `<out>/sweep.json`, whose report `--report` still prints.
- `bench-tokens --report <dir>` prints the report to stdout and writes nothing.

### 11. The held-out Workload `gate-holdout` v1

The Gate Workload's design decisions 1–6 carry over, with these differences:

- **Theme:** a pure `src/concept-card.ts` (and `src/concept-card-render.ts` for the render step) that renders a one-screen card for a doc-store Concept. It is built on `parseConcept` (`src/concept.ts`) and `splitConcept` (`src/sections.ts`), which are files the Gate Workload never reads. The rules come from fictional `overlay/notes/*.md`: status and trust badges, section numbering, preview truncation, tag order and weights, the card layout and a footer. The checks build Concepts from Markdown strings through `parseConcept`, so they need no store.
- **Shape:** 40 Turns, six graded steps and a tools-forbidden recap at Turn 40, the same suffix rules, six Plants (2 literal, 2 superseded, 2 constraint; one prompt-placed and one file-placed of each kind) and six Revisits.
- **Bands:** the same three bands as the Gate Workload, with the same count of Plants and Revisits per band. The Turns differ wherever the theme allows.
- **Values** are fictional and disjoint from every Gate Workload value, so no answer carries over between the two.
- **Commit:** `HEAD` when the draft is written.
- **Probe:** two pi-chart Runs and one plain-omp Run with `bench-tokens --workload gate-holdout`, judged as in the Gate Workload's decision 6. The cost target was a mean of at most $4.50 per pi-chart Run, so 20 confirm Runs fit the Gate's $90 cap. Probe spend stops at $30 for the user. The clean probe cost $6.80 (`gate`'s own A/A Runs average $4.57, so the target was tight), driven by pi-chart's recall Pulls in Turns 30–38. The user chose to keep the Workload and give confirm its own caps, `CONFIRM_CAPS` $70 and $140, rather than reshape the held-out Workload around pi-chart's recall cost or confirm on about 13 Runs.
- **The user reviews the draft before any Run,** as with the Gate Workload.

Alternative considered: a second version of `gate` with shuffled values. It was rejected because shared notes and shared code would fit a winner to the same work, which defeats the purpose of holding a Workload out.

### 12. A Run's Thread Store reaches pi-chart alone

`gate-holdout`'s agent works on pi-chart's own source, so it runs pi-chart's tests, and the store tests truncate whatever database `PICHART_DATABASE_URL` names. `runOne` gave that variable to omp, and so to every shell the agent opened: the first probes truncated their own Run's database mid-Run.

- `runOne` and `scripts/replay.ts` start omp with `ompEnv(env, database)`: the environment without `PICHART_DATABASE_URL`, and with the Run's database as `BENCH_RUN_DATABASE_URL`, which nothing in pi-chart reads.
- `piChartExtensions(extension)` loads `scripts/run-url-set.ts` before the extension and `scripts/run-url-unset.ts` after it. omp calls extension factories in `-e` order, so the first sets `PICHART_DATABASE_URL` for pi-chart's factory, which reads it once, and the second removes it before any tool runs.
- The variable is `BENCH_*`, not `PICHART_*`: every `PICHART_*` variable is a user setting, and this one is internal to the benchmark.

Alternative considered: a Workload rule forbidding the store tests. It was rejected because any Workload over pi-chart's source could hand the URL to a command the agent chose, and only the environment closes that route.

## Risks / Trade-offs

- **[Three pairs per comparison give wide intervals, so many cells tie, and the default wins most screens]** → This is intended. The default moves only on evidence. The report shows each interval, so a tuning change can run more Runs per cell with `--runs`, within the cap.
- **[No multiplicity correction across up to 8 Lapse tests]** → Any false rejections fall on the side of keeping the default. Confirm re-tests Lapses on held-out work with Holm's correction.
- **[Budget changes may change variance, while the pool assumes one σ per key]** → Each comparison's own differences enter the pool, and the report prints the cell's own SD beside the pooled one, as the Gate does.
- **[A grid that varies `PICHART_TAIL_TURNS` can change which Turns evict, so the Lapse counts depend on the Workload's band placement]** → This is what the held-out Workload's separate placement is for.
- **[`docs/benchmarks/` gets written by a script]** → Only at the end of a sweep, never over an existing file. Smoke sweeps delete their two files.
- **[Recording the shell's Budgets changes `run.json` for Runs started with `PICHART_*` set]** → The field is optional and additive, so older records still read.
- **[A held-out Workload recognised by name can be bypassed by renaming it]** → It is a guard against accidents, not against intent. The README states the rule.

## Migration Plan

Additive. `RunRecord.budgets`, `Batch.kind: "confirm"` and `Batch.budgets` are optional. `decide`'s new `margin` parameter is passed at its one caller in `gate.ts main` and in its tests. Rollback deletes `scripts/sweep.ts`, the `--sweep` branch and `bench/workloads/gate-holdout/`.

## Testing seams

| Requirement | Seam | Cases |
| --- | --- | --- |
| A grid varies at most two Budgets over at most 9 cells | `cellsOf(grid, defaults)` | Three Budgets refused. An unknown variable refused. 4 × 3 refused. A repeated value refused. The default missing refused. 1.5 for `PICHART_TAIL_LOW_WATER` and -1 for a count refused, through the read-as-given check. Several problems in one error. A 3 × 3 grid gives 9 cells, with the default cell found and ranks independent of value order. |
| A Budget set in the shell is refused | `shellBudgets(env)` | `PICHART_DOC_TOKENS` named. Unrelated `PICHART_*` settings (`PICHART_DATABASE_URL`) ignored. |
| The screen runs every cell round-robin; spend capped | `roundRobin(cells, runs)`, `runCapped` with injected jobs | Rotation by one per round. The cap stops the next start at $120.30. Never more than `width` in flight. A throwing job lets in-flight jobs finish and rejects. |
| A cell is eligible…; the screen picks… | `screen(...)` over synthetic Run figures and a stored batch | Lapse p = 0.03 ineligible. 3/3 vs 1/3 collapsed, 3/3 vs 2/3 not. A void round drops one pair. Fewer than 2 pairs: ineligible against the default, tied against the best. The default tied wins. Without the default, the lowest rank sum wins, then the first Budget's rank. |
| The winner is confirmed | `confirm` with injected `runPair` | An upper bound of 0.93 at look 1 adopts and stops. 1.04 at look 2 keeps the default with `not shown cheaper`. A rejected Lapse test keeps the default with `forgets more`. Capped keeps the default. Winner = default starts no pair. |
| Each look tests both Measures (margin) | existing `decide` tests | Gate cases pass `MARGIN`. One case at margin 1 shows 1.04 not within margin. |
| A Run names its Budgets | smoke | A sweep Run's `run.json` names exactly its cell's variables. A plain `bench-tokens --workload smoke --runs 1` Run names none. |
| Preconditions; the Gate refuses a held-out Workload | smoke | Dirty `src/`, `--workload gate-holdout`, a missing held-out A/A batch, `PICHART_DOC_TOKENS` set, and `gate.ts --workload <smoke copy named smoke-holdout>` without `--aa`. Each stops with its message and creates no Run folder. |
| Every sweep leaves a record and a report | smoke | A `smoke` screen with `smoke-holdout` confirm on a temporary pool. `sweep.json`, Run folders, the two `docs/benchmarks/` files, and a `--report` re-print identical to the end-of-sweep text. |
| The held-out Workload | `loadWorkload`; checks in a `buildWorkspace` workspace; `measures.ts` over probe Runs | As in the Gate Workload's testing seams. |

Smoke confirm is made deterministic with a hand-written temporary pool: one A/A batch per smoke key, 20 pairs of identical figures. The pooled SD is then close to the comparison's own, which is small. Any consistent cost gap between a cheap cell and the default then decides the screen, so confirm runs without spending on A/A batches.
