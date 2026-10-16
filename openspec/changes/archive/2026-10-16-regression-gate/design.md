## Context

- `scripts/bench-tokens.ts` already runs isolated Gate Workload Runs: `runOne` gives each Run its own workspace copy, bundle and Thread Store database, and `pool` runs jobs a fixed number at a time. It loads pi-chart from the checkout running it (`EXTENSION`, line 100), and migrates and exports each database with that checkout's `PostgresStore`. No Run can load another commit's pi-chart.
- `scripts/measures.ts` gives every figure the Gate needs from a Run record: `cost`, `refetch.left.total`, `recall.recall.total`, `probe.lapse.total`, `complete`, `steps`, `pulls`, and `aggregate()` for Cost per Pass and Retention. The only statistics helper is `median`.
- Each `run.json` records the Workload's name, version and commit, the model id from the Journal (`anthropic/claude-opus-5-5` on the probes) and `omp --version` (`omp/18.11.0`).
- The v1 probe Runs took 12 to 17 minutes and cost $3.83 and $4.91. Their Gate Lapse counts were 25 and 26.
- See `proposal.md` for the verdict rules, and `specs/regression-gate/spec.md` for the requirements.

## Goals / Non-Goals

**Goals:**
- One set of Run machinery, shared by the benchmark and the Gate. The benchmark's behaviour stays as it is.
- Every statistical step is a pure function over numbers, so the verdict logic is tested without a model Call.
- The pool stores raw per-Run figures, so a later fix to the statistics recomputes from the same data.

**Non-Goals:**
- `--ablate`, Needed share and Utilisation (`ablation`, `utilisation`).
- Running the Gate on itself: this change touches only `scripts/`, `bench/` and docs.
- CI or a remote. The Gate stays hand-run.
- Detecting drift in the pooled variance beyond showing each Gate's own standard deviation beside the pooled one.

## Decisions

### 1. The Run machinery moves to `scripts/runs.ts`, parameterised by the pi-chart source

`runOne`, `pool`, `journalsFor`, `headerOf`, `runCheck`, `createDatabase`, `exportAccounting`, `dropDatabase` and `log` move out of `bench-tokens.ts` unchanged, with two new parameters:
- **`source`**: the root of the pi-chart tree a Run loads. The extension is `<source>/src/extension.ts`. `PostgresStore` is imported dynamically from `<source>/src/postgres-store.ts` for `migrate` and `readAccounting`, so each side's database schema is the one its own code expects.
- **`label`**: the record folder's name (`pi-chart-0` for the benchmark, `base-0` / `candidate-0` for the Gate). `RunRecord.arm` stays `pi-chart`.

`bench-tokens.ts` passes the repository root and `${arm}-${index}`, which is what it did before.

Alternatives considered:
- *Rewriting `workload.json`'s commit between sides* changes the workspace, not pi-chart, so it does the wrong thing.
- *Running `bench-tokens.ts` from two clones and pairing their output afterwards* loses the requirement that both Runs of a pair start together.
- *Spawning a migrate subprocess in the side's tree* needs a script that older commits do not have.

### 2. Each side's tree comes from `git archive`, not a worktree

A side's tree is built as `git archive <sha> -- . ':(exclude)bench' | tar -x -C <tmp>`, followed by `bun install --frozen-lockfile`. This is the same pattern `buildWorkspace` uses for the Workload. A killed Gate then leaves only a temporary folder, and no worktree registered in `.git`. Both trees are built before any Run, so a commit whose dependencies do not install stops the Gate at no spend. An A/A run builds one tree and uses it for both sides. The trees are removed in `finally`.

Before any Run, the Gate imports each tree's `PostgresStore` and checks that `connect`, `migrate` and `readAccounting` exist, so a base commit whose store API differs fails before spending anything.

### 3. Scheduling: pairs, looks and the cap in one injected loop

`gatherPairs({ want, cap, spent, width, runPair })` keeps up to `width` pairs in flight (`--parallel`, default 2, so 4 Runs). It starts a pair only while it has fewer than `want` complete pairs and `spent < cap`, and it adds each finished pair's two costs to `spent`. A void pair adds its costs and frees a slot for a replacement. It returns the complete pairs, the spend, and whether the cap stopped it. `runPair` is injected, so tests drive the loop with fake pairs.

The two looks are two calls: `want 5, cap 45`, then, if the first look decided nothing, `want 10, cap 90` with the first look's pairs carried over. Each `runPair` starts its base and candidate `runOne` together under `Promise.all`. Pairs alternate which side's job is created first, so start-order effects fall on both sides alike. After each Run, the Gate compares the recorded model with `REFERENCE_MODEL`. A mismatch throws; in-flight Runs finish, as `pool` already does, and nothing is pooled.

Alternative: *projecting the next pair's cost and refusing to start it if the projection exceeds the cap.* At $4.37 per Run, 5 pairs project to $43.70. A look whose Runs ran 10% dear would then be refused its fifth pair and could never be reached. Checking the actual spend instead caps the overshoot at the pairs in flight, and the report says so.

### 4. Statistics in `scripts/stats.ts`, with no dependency

- `studentCdf(t, df)` uses the regularised incomplete beta function, evaluated by Lentz's continued fraction.
- `studentQuantile(p, df)` finds the quantile by bisection on the CDF, to 1e-10.
- `sampleVariance` and `pooledVariance(batches)` return `{ variance, df }`.
- `holm(pValues, alpha)` returns which hypotheses are rejected.

The repository has no runtime statistics dependency. `jstat` would add one for two functions, and this code is about 60 lines tested against tabled quantiles.

### 5. The verdict is one pure function

`decide({ look, pairs, history, key })` returns each Measure's mean difference, pooled SD and df, standard error, critical value, bounds and p-value, Holm's rejections, the Cost non-inferiority result, and one of `pass | fail | continue | inconclusive`. Constants:

| Constant | Value |
| --- | --- |
| `LOOKS` | `[{ pairs: 5, alpha: 0.0088, cap: 45 }, { pairs: 10, alpha: 0.0467, cap: 90 }]` |
| `MARGIN` | `1.10` |
| `AA_PAIRS` | `5` |
| `REFERENCE_MODEL` | `"anthropic/claude-opus-5-5"` |

`gateLapses(measures)` is `refetch.left.total + (recall?.recall.total ?? 0) + probe.lapse.total`. It lives in `gate.ts`, not `measures.ts`, because the sum is the Gate's and the Measures keep their routes apart.

Using the Student t with the pooled df at the O'Brien–Fleming nominal levels carries the known-variance boundaries over to t. Ticket 13 marks this as an approximation. It is accepted because the pooled df grows with every Gate.

### 6. The pool is a committed JSON file of raw figures

`bench/gate/pool.json` holds `{ "batches": [ { kind: "aa" | "gate", key: { workload: { name, version }, model, omp }, date, base, candidate, out, pairs: [ { base: { cost, lapses }, candidate: { cost, lapses } } ] } ] }`.

- It is written by writing a temporary file and renaming it over the old one, once per Gate or A/A run, after its verdict.
- It is not written when the Gate stops without a verdict, or after fewer than 2 complete pairs.
- The key's `omp` is read with `omp --version` before any Run, and its model is `REFERENCE_MODEL`. Before any Run, the Gate checks that an A/A batch exists for the key.
- `--pool <file>` overrides the path, so smoke runs never touch the committed pool. The file lives outside `bench/workloads/gate/` because that folder is frozen, and any edit to it is a new Workload version.

### 7. CLI

```
bun scripts/gate.ts --base <rev> [--candidate <rev>]   # a Gate; candidate defaults to HEAD
bun scripts/gate.ts --aa [--commit <rev>]              # an A/A batch; commit defaults to HEAD
bun scripts/gate.ts --report <dir>                     # re-print from gate.json
  [--out <dir>] [--parallel <pairs>] [--pool <file>] [--workload <name|path>] [--turn-timeout <s>]
```

- `--workload` defaults to `gate`. It exists so the whole path can be smoked on the cheap `smoke` Workload; the key's Workload name keeps those batches apart.
- The `src/` precondition is `git diff --quiet <base> <candidate> -- src/`, checked before any tree is built. Its exit status 0 means no Gate.
- `--report` reads `gate.json` and the record folders, recomputes each Run's Measures with `measureRun`, and prints the report. It neither runs nor writes anything.

### 8. Report

The report is plain console tables, like `bench-tokens.ts`. It covers the key, the verdict and the look it came at, and one row per look: pairs, ratio and bounds, Lapse difference and lower bound, p-values, Holm's decision, and the pooled SD beside this Gate's own SD. Then come the spend against the cap with the overshoot note, and the reported-only figures for each side. Those use `aggregate()` over each side's complete Runs (Cost per Pass, Retention per Probe and by band), medians of Re-fetches held, left and unknown and of Pulls per tool, and Passes over graded steps. Needed share and Utilisation read "not measured".

### 9. Workflow step

`docs/agents/workflow.md` §6 gains a step before `/opsx-archive`, for a change whose commits touch `src/`. Run `bun scripts/gate.ts --base <the commit before the change's first commit>`, and record the verdict and output folder in the archive commit message. The verdict decides what happens next:
- **pass**: archive.
- **fail**: fix the change and run the Gate again.
- **inconclusive**: the user decides.

If no A/A batch exists for the key, the Gate names `--aa`, and the user approves that spend first.

## Testing seams

Every requirement is tested through pure functions over numbers or Measures. Only the `src/` precondition reads git, and nothing calls a model.

| Requirement | Seam | Test |
| --- | --- | --- |
| The Gate's Lapse count adds three routes | `gateLapses(measures)` | `test/gate.test.ts`: a `RunMeasures` with 13 left Re-fetches, 6 recall Pulls, 6 failed-Probe Lapses, 2 left Revisits and 1 recall unknown gives 25. A plain `RunMeasures` with no `recall` counts the other two. |
| Each look tests both Measures | `decide`; `holm`; `studentCdf` / `studentQuantile` | `test/stats.test.ts`: t quantiles against tabled values (`t₀.₉₅,₄ = 2.1318`, `t₀.₉₅,₉ = 1.8331`, `t₀.₉₇₅,₉ = 2.2622`), CDF symmetry, Holm with 0.030 / 0.040 at 0.0467 rejecting neither. `test/gate.test.ts`: constructed pairs that give fail by Lapses while Cost is non-inferior, pass at look 1 (bound 1.06), continue at look 1, inconclusive at look 2 (bound 1.14), and a zero standard error. |
| Variance is pooled across batches with the same key | `pooledVariance`; the key filter in `decide` | 17 df from batches of 5 and 10 pairs plus 5 current; a batch under another omp ignored; a batch of 1 pair adds nothing; no A/A batch for the key refuses. |
| Each complete pair gives two differences; Spend is capped | `gatherPairs` with an injected `runPair` | A void third pair is replaced and its costs counted. Voids reaching $45.20 at 4 complete pairs stop the look, flagged as stopped by the cap. Never more than `width` pairs are in flight. A `runPair` that throws (the model-mismatch stop) lets in-flight pairs finish, starts no further pair, and rejects. |
| A Gate needs a change under src/ | `changesSource(base, candidate)` | Real commits of this repository: `7ef6898` → `3b4304b` changes nothing under `src/`, so false. `352b5d1~1` → `352b5d1` changes `src/`, so true. |
| A Gate pairs Runs of two commits; An A/A batch seeds the pool; Every Gate leaves a record and a report | smoke, not unit tests | Run `--aa` and then a Gate on `--workload smoke --pool <tmp>`, with a base and candidate that differ under `src/`. Inspect `gate.json`, the record folders, the `--report` re-print, and the extension path in a candidate Run's process arguments. |

`bench-tokens.ts` has no tests. Its move onto `scripts/runs.ts` is verified by typecheck and by one cheap `bun scripts/bench-tokens.ts --workload smoke --runs 1 --arm pi-chart`, whose record folder must be `runs/pi-chart-0/` as before.

## Risks / Trade-offs

- **[A base commit's `PostgresStore` lacks a method the Gate calls]** → it is checked before any Run, and the Gate stops at no spend and names the missing method.
- **[The pooled variance assumes the per-pair noise is the same across commits]** → the pool resets on a change of key, and each look shows this Gate's own SD beside the pooled one for a person to compare.
- **[Spend overshoots the cap by the pairs in flight]** → at `--parallel 2` that is at most about $17. The report states it, and `--parallel 1` halves it.
- **[A Gate takes time]** → about 15 minutes per round of pairs. With `--parallel 2`, the first look is 3 rounds (about 45 minutes) and a full Gate is 5 rounds.
- **[Disk: four Runs in flight hold four workspace copies, about 1 GB each, plus two pi-chart trees with dependencies]** → this is the same footprint per Run as the benchmark.
- **[`--model anthropic/claude-opus-5-5` may not be the form omp's `--model` accepts]** → the smoke run settles it. If omp needs the bare id, the Gate passes that and still compares the recorded id with `REFERENCE_MODEL`.

## Migration Plan

`bench/gate/pool.json` starts as `{ "batches": [] }`. The first real A/A batch (5 pairs on the `gate` Workload, about $44) runs only with the user's go-ahead. Its pool entry is committed with this change. Rollback means deleting `scripts/gate.ts`, `scripts/stats.ts` and the workflow step. `bench-tokens.ts` behaves the same with or without them.
