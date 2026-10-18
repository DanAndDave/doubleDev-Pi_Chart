# Design: Comparison report

## Context

What the archived slices built, and what this change reuses:

- **Runs.** `runOne(spec, ctx)` (`scripts/runs.ts`) runs one Gate Workload Run on either Arm. `buildTree(sha)` gives a checkout of a commit with dependencies and the store installed. `headerOf(file)` reads a Journal's session id, cwd and model, but not its thinking level. The thinking level reaches `run.json` only when the Run was given one. Under the harness default, the Journal's first `thinking_level_change` entry holds it (`"thinkingLevel":"high"` in every Gate v1 Run).
- **Gate pairing.** `pairRunner(ctx, specOf)` starts a pair's two Runs together and alternates which is created first. It throws `PairStop` (carrying the spend) when a Run throws or is off the reference model. `gatherPairs({want, cap, width, runPair})` runs pairs until `want` are complete, replaces void ones, and stops at the cap. Both are typed on sides `base`/`candidate`. `offModel(record, measures)` checks against the fixed `REFERENCE_MODEL`. `gateLapses(measures)` sums Re-fetch Lapses, recall Pulls and failed-Probe Lapses.
- **EvoCode.** `runTask({task, arm, index, label}, ctx: EvoContext)` (`scripts/evocode.ts`) runs one task through Harbor on either Arm, and the model comes from `ctx.model`. `bench/evocode/subset.json` admits 4 tasks. Their probe Runs, one pi-chart Run each, cost $6.32, $4.67, $6.43 and $4.56, $21.98 in total, with 7–9 rounds. No plain-omp EvoCode Run exists. `runCapped({jobs, width, cap})` (`scripts/sweep.ts`) runs jobs under a cap, but does not count a job that throws.
- **Statistics.** `scripts/stats.ts` has `studentQuantile`, `mean`, `sampleVariance`, `pooledVariance(batches)` (weights by n − 1 and skips batches under 2) and `wilson`. The Gate's `measureTest` is one-sided, and its variance pools the A/A batches. Those are pi-chart against pi-chart and do not describe a plain-omp pair, so this report uses each batch's own variance.
- **Measures.** `measureRun(dir, calibration)` gives `RunMeasures`: `cost`, `steps`, `passes`, `firstFail`, `plants: Score[]` (with `distance`, `right` and `class`), `compactions` (plain omp only), `pulls` and `recall` (pi-chart only), and `utilisation`. Cost per Pass exists only in aggregate, so a per-Run figure is new here.
- **Ablation.** `ablateRun(dir, options)` writes `ablation.json` beside a Run and throws `AblationStop` (carrying the spend) when the replay fails. `summarise(records)` gives a `Summary` per Arm, with the Wilson Needed share, unclear, unstable and spend. Measured spend in the Gate v1 calibration set is about $0.25 per drawn unit on pi-chart and $0.39 on plain omp. `ppiByArm(dirs)` (`scripts/ablate.ts`, not exported) gives each Arm's PPI line or the reason there is none. The committed Gate v1 set has κ = 0.167, below `KAPPA_FLOOR` 0.4.
- **Costs measured on the Gate Workload, reference model.** The pi-chart A/A pairs averaged about $4.5 per Run. The five plain-omp calibration Runs cost $2.34–$2.76 (Journal `usage.cost.total`). In omp's model catalogue, `claude-sonnet-5-5` is priced at half of `claude-opus-5-5` on every token class.

## Goals / Non-Goals

**Goals:**

- Three fixed-n batches of plain-omp/pi-chart pairs, each with its own cap, each started on its own, writing what it ran into one output folder.
- Headline paired differences with two-sided 95% intervals, pooled within tasks.
- Ablation on the reference batch.
- A report and its JSON, rebuilt from the output folder at no model cost.
- The six caveats, with the thinking level read from the Runs.

**Non-Goals:**

- Any verdict, margin or sequential look; this is not a Gate.
- A new calibration. The PPI row stays missing under the Gate v1 set's κ.
- Committing the Run folders. EvoCode Journals quote CC BY-NC tasks; the Gate Workload Runs would add about 1.2 MB each.
- Resuming a stopped batch. A batch restarted from the beginning goes into a new output folder.
- A price table. Cost is the provider's `usage.cost.total`, as everywhere else.

## Decisions

### 1. One command, one output folder, steps run separately

```
bun scripts/compare.ts --out <dir> --batch reference|second|evocode [--parallel n] [--workload <name> --pairs n]
bun scripts/compare.ts --out <dir> --ablate
bun scripts/compare.ts --out <dir> --report [--date YYYY-MM-DD]
```

`--out` is required, so three invocations days apart write to the same folder. Each batch writes `<out>/<batch>/batch.json` and `<out>/<batch>/runs/<label>/`. A batch whose `batch.json` already exists is refused, so a finished batch is never overwritten. `--workload` and `--pairs` exist for the smoke run only (`smoke`, 1 pair). The report names any batch that ran on another Workload or at another n, so a smoke run cannot pass for the real one.

`batch.json`:

```ts
interface BatchRecord {
  batch: "reference" | "second" | "evocode";
  model: string;
  workload: { name: string; version: number } | { tasks: string[]; revision: string };
  omp: string;
  commit: string;           // HEAD the pi-chart Runs loaded
  cap: number;
  spent: number;
  capped: boolean;
  stopped?: string;
  pairs: { index: number; task?: string; vanilla: string; piChart: string; complete: boolean }[];
}
```

Labels are `${arm}-${index}` for Gate Workload batches and `${task}-${arm}-${replica}` for EvoCode, as `bench-tokens` and `evocode.ts` already name them.

### 2. Before any Run: clean `src/`, one tree

A batch first checks `git diff --quiet HEAD -- src/` and refuses with the paths when it fails. Gate Workload batches then load pi-chart from `buildTree(HEAD)`, as the Gate does, and record its sha as `commit`. EvoCode Runs mount the repository itself (`evocode.ts`), so the clean-`src/` check is what makes their recorded commit true.

### 3. Gate Workload batches reuse the Gate's pair machinery

Side `base` is plain omp and side `candidate` is pi-chart, so every Gate difference (candidate − base) already reads pi-chart against plain omp. `specOf(side, i)` gives `{arm, index: i, label: \`${arm}-${i}\`, source: tree, commit: sha}`. The Context is `buildContext(gate workload, turnsOf(...), { options: { ...referenceOptions(workload, omp), model }, out: <out>/<batch>, ... })`, with `model` being `anthropic/claude-opus-5-5` or `anthropic/claude-sonnet-5-5`. `gatherPairs({want: 10, cap, width: --parallel (default 2), runPair})` replaces void pairs, as the spec requires. A `PairStop` ends the batch with `stopped` set and its spend counted.

`offModel(record, measures, model)` takes the expected model. `pairRunner` passes `ctx.options.model`, which `referenceOptions` sets to `REFERENCE_MODEL` for every Gate and sweep context, so their behaviour is unchanged. The sweep's own `offModel` call passes `REFERENCE_MODEL`.

### 4. The EvoCode batch: 2 pairs per task, fixed jobs, no replacement

Sizing from the probe Runs: one pi-chart round of the 4 tasks cost $22. Plain omp has no EvoCode figure. On the Gate's held-out Workload it cost 1.44× pi-chart, and on the 40-Turn Workload 1.3×. Taking 1.5× as the planning figure, one pair per task costs about $22 + $33 = $55. Two pairs per task cost about $110, which fits the $125 that remains of the $250 after the Gate Workload batches ($80 + $45). That gives 8 pairs and 4 pooled degrees of freedom. A third pair per task (about $165) would not fit.

Jobs are ordered replica-major (all 4 tasks for replica 0, then replica 1), so a cap stop leaves whole tasks with one pair rather than one task with none. Each job runs both Arms' `runTask` concurrently, creating plain omp first on even job indices. It returns the pair's summed cost. `runCapped({jobs, width: --parallel (default 1), cap: 125})` runs them. A void pair is recorded and not replaced: a replacement would have to target the same task, which `runCapped` cannot express, and fixed jobs keep the per-task design balanced on purpose.

`runCapped` does not count a thrown job's cost. Each job therefore appends its finished Runs' costs to the batch record before it settles, and `spent` is that sum. A Run that throws or is off-model throws out of its job after recording what its pair spent. `runCapped` then rethrows, and the batch record gets `stopped`. `EvoContext` comes from `evocode.ts`'s own preconditions and `fetchTasks`, with `model: REFERENCE_MODEL` and no thinking.

### 5. The paired interval, pooled within tasks

`pairedWithinTasks(groups: number[][])` in `scripts/stats.ts` takes per-task lists of pair differences and returns `{ pairs, tasks, mean, df, se, lower?, upper? }`:

- mean = the mean of the task means, so every task weighs the same;
- variance s² = `pooledVariance(groups)`, with df = Σ(nₜ − 1);
- se = √(s² · Σ(1/nₜ)) / T, over the T tasks with at least one pair;
- bounds = mean ± `studentQuantile(0.975, df)` · se, absent when df = 0.

With one task this is the ordinary paired t. Pooling within tasks targets the mean over these four tasks, not over EvoCode-Bench, and caveat 6 says so. The alternative, a t over the 4 task means with df 3, would be valid for the wider population but gives intervals too wide to read at this n (ticket 13). An empty group list returns `pairs: 0` and the report shows no figure.

### 6. Headline rows from per-Run summaries

`summaryOf(record, measures, thinking)` reduces a Run to what the JSON keeps and the headline needs:

```ts
interface RunSummary {
  label: string; arm: Arm; index: number; task?: string;
  model?: string; thinking?: string; complete: boolean;
  cost: number; steps: { id: string; outcome: Outcome }[]; passes: number; firstFail?: string;
  lapses: number;                      // gateLapses
  plants: Score[];                     // no prompt or value text in a Score
  compactions?: number; pulls?: RunMeasures["pulls"]; recall?: RunMeasures["recall"];
  utilisation?: RunUtilisation;
}
```

`headline(pairs: { task: string; vanilla: RunSummary; piChart: RunSummary }[])` takes complete pairs only and returns rows. Each row is `{ measure, vanilla, piChart, diff: PairedFigure, excluded }`.

- **Cost per Run**: the difference per pair is `ln(pi.cost) − ln(van.cost)`. Arm figures are geometric means. The ratio and its bounds are `exp` of the difference and its bounds.
- **Cost per Pass**: the same on `cost / passes`, with pairs where either side has `passes === 0` counted in `excluded`.
- **Lapses per Run**: `pi.lapses − van.lapses`. Arm figures are means.
- **Retention**, one row per `BANDS` entry: per Run, scores with `distance` in the band (unplanted scores have none) give `right / scored`. A pair counts only when both sides have at least one such score. Arm figures are pooled `right/of` over the counted pairs. A batch whose first record states no Plants gives a single "n/a: no Plants" row.

Grouping for the interval is by `task` (`pairs[].task`, or the Workload name for Gate Workload batches).

Pass counts per step and first failing steps come from the same summaries, with complete Runs only. One-Arm rows are the mean per Run of `compactions` (plain omp), `pulls[tool].calls` per tool and `recall.recall` per band (pi-chart). The other Arm reads "n/a".

### 7. Thinking level from the Journal

`headerOf` also returns `thinking`, the `thinkingLevel` of the first `thinking_level_change`. Caveat 6 gives the record's `thinking` when the Run was given one, else the Journal's. When a batch's Runs disagree, it lists each level with its count. This adds a field to `headerOf`'s result. `run.json` stays as it is, because the benchmark-runs spec records only a level that was given.

### 8. Ablation

`--ablate` reads `reference/batch.json`, takes the 2 lowest-indexed complete pairs, and runs `ablateRun` on each of the 4 Runs one at a time. Each call uses `{ units: 20, nulls: 0, controls: false, cap: 10, seed: random, commit: sha, tree: buildTree(sha) }`, the Gate's `ablateSide` settings with the per-Run cap from ticket 05. An `AblationStop` logs the reason, counts its spend, and moves on. The expected spend is about 20 × ($0.25 + $0.39) × 2 ≈ $26. The hard limit is 4 × $10.

The report summarises the `ablation.json` records per Arm with `summarise`, and gives the Utilisation share and `utilisationLabel` from the batch's Run summaries. The PPI line per Arm comes from `ppiByArm` over the reference batch's complete Run folders, which this change exports from `ablate.ts`. Under Gate v1 that line is the "uncalibrated (…)" reason.

### 9. Report and JSON

`--report` reads every `<out>/<batch>/batch.json` that exists, recomputes each Run with `measureRun(dir, readCalibration())`, builds summaries and headlines, and writes both files under `docs/benchmarks/`. The Markdown follows the existing reports: a title with the date, a bold paragraph of the headline ratios, then a bullet list (commit, omp, models, Workloads, n, caps and spend, and how to reproduce). Then come one section per batch (headline table, Pass counts, one-Arm rows), an Ablation section, and the caveats. The JSON is `{ date, batches: [{ ...BatchRecord, runs: RunSummary[], headline: Row[] }], ablation: { arm: Summary } }`. A `RunSummary` holds no prompt, reply or Journal text. A test checks this over an EvoCode-shaped record, because a record's `prompts` hold the task's instruction text. A batch with no `batch.json` gets a "not run" section.

## Risks / Trade-offs

- **[Risk]** The plain-omp cost on EvoCode is unknown, and 1.5× is a guess. → The $125 cap stops the batch. Replica-major order means a cap stop still leaves one pair per task, reported with 0 degrees of freedom for the affected tasks.
- **[Risk]** Sonnet may use more tokens than opus, or fail steps more often, which would raise the number of void pairs. → The $45 cap stops the batch, and the report gives the complete and void pair counts.
- **[Risk]** Pooling within the 4 tasks does not generalise to EvoCode-Bench. → Caveat 6 states the interval method and the four task ids.
- **[Trade-off]** The batches use their own variance, not the A/A pool, so the reference batch's df is 9 rather than 13. The A/A pairs measure pi-chart against pi-chart and have a different variance from a plain-omp pair.
- **[Trade-off]** The headline is one family of about 9 intervals with no multiplicity correction. The report is descriptive and says so (spec: no correction). A reader must not read one excluded zero as a finding.
- **[Risk]** Retention rows are thin. Each Gate Workload Run scores a fixed set of Probes per band, so a band's per-Run share takes only a few values. The interval is computed regardless, and the pooled `right/of` beside it shows how few Probes back it.

## Migration Plan

None. The report is new. `offModel`'s new parameter is passed at its two call sites.

## Testing seams

| Requirement | Seam | Cases |
| --- | --- | --- |
| Headline Measures are paired differences with 95% intervals | `pairedWithinTasks(groups)` | One task `[0.1, 0.2, 0.3]`: mean 0.2, df 2, bounds 0.2 ± 4.303·0.1/√3. Two tasks `[[0,0.2],[1,1.2]]`: mean 0.6, df 2, se √(0.02·1)/2. A task of one pair: in the mean, no df. All tasks of one pair: no bounds. No groups: `pairs: 0`. |
| Headline Measures; Pass counts; one-Arm rows | `headline(pairs)` over hand-built `RunSummary`s | Cost ratio equals exp(mean log difference). A pair with 0 Passes on one side is excluded from Cost per Pass, and counted. A band with scores on one side only is excluded. A band with no pair shows no figure. Unplanted scores never count. No Plants gives the "n/a: no Plants" row. Compactions read n/a for pi-chart; Pulls read n/a for plain omp. |
| Every Run is on its batch's model | `offModel(record, measures, model)` and `pairRunner` | A sonnet record passes under the sonnet model and fails under the reference model. Existing Gate cases still pass with `REFERENCE_MODEL` passed. |
| EvoCode pairs: 2 per task, no replacement, spend counted | `evocodeBatch({ tasks, perTask, runPair, cap, width })` with an injected `runPair` | Jobs are replica-major. A void pair is not rerun. A cap reached after 5 pairs leaves 3 unstarted, with `capped` true. A pair whose Run throws stops the batch, and its finished Run's cost is in `spent`. |
| Thinking level from the Runs | `headerOf(file)` over a fixture Journal | Returns `high` from `thinking_level_change`. A Journal with none returns no thinking. |
| No task text reaches the repository | `summaryOf(record, measures, thinking)` | Over a record whose `prompts` hold a sentinel string, `JSON.stringify(summary)` does not contain it. |
| Refuses with uncommitted source; batch never overwritten; report rebuilt; missing batch "not run" | smoke | `--batch reference --workload smoke --pairs 1` into a tmp folder. A second identical call is refused. Editing `src/` refuses a batch. `--report` with only that batch prints the other two as not run, and its JSON holds no prompt text. |
