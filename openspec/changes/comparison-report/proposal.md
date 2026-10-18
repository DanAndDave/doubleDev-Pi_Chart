# Proposal: Comparison report

Triage: ready-for-agent
Blocked by: None

## Why

The effort's third job is a comparison with plain omp that holds up to scrutiny. Every instrument it needs now exists: Runs on both Arms (`scripts/runs.ts`), per-Run Measures (`scripts/measures.ts`), Ablation and Utilisation (`scripts/ablate.ts`), and EvoCode Runs through Harbor (`scripts/evocode.ts`). Nothing yet runs the two Arms side by side as pairs, on more than one model and Workload, and reports paired differences with intervals. The figures published so far are medians of 3 unpaired Runs on one model and one Workload (`docs/benchmarks/2026-10-14-token-usage-40-turns-mark-0.2.md`).

Decisions: `context-need-measures/questions/17`, `09`, `05`, `13`.

## What Changes

- **A comparison command**, `scripts/compare.ts`, that runs three batches of pairs. Each pair is one plain-omp Run and one pi-chart Run, started together. It also runs Ablation on the reference batch, and writes the report from what the batches left. Running and reporting are separate steps, so the report can be rebuilt at no model cost.
- **Batches.** Each batch has a fixed n with no sequential looks. The report describes; it gives no verdict.

  | Batch | Model | Workload | Pairs | Cap |
  |---|---|---|---|---|
  | reference | `anthropic/claude-opus-5-5` | Gate Workload | 10 complete | $80 |
  | second model | `anthropic/claude-sonnet-5-5` | Gate Workload | 10 complete | $45 |
  | EvoCode | `anthropic/claude-opus-5-5` | the 4 admitted EvoCode tasks | 2 per task | $125 |

  The second model is `claude-sonnet-5-5`. It has the same provider and request format as the reference, so the Journal, Accounting and caching paths that pi-chart has been tested on carry over, and it costs half the reference's per-token prices. The EvoCode size follows from the probe Runs (`bench/evocode/subset.json`, $22 for one pi-chart Run of each task) and the cap that remains; see `design.md`.
- **Headline Measures.** Each is a paired difference, pi-chart against plain omp, with a two-sided 95% interval:
  - Cost per Run and Cost per Pass, as ratios;
  - Lapses per Run;
  - Retention by distance band.

  Pass counts per step are reported but are not a headline.
- **Ablation.** 20 units on each of 2 Runs per Arm (40 per Arm), on the reference batch only. It gives each Arm's Needed share with a Wilson interval, capped at $10 per Run. Utilisation sits beside it. The PPI row appears only under a calibration with κ ≥ 0.4. The committed Gate v1 calibration has κ = 0.167, so the report states why the row is missing.
- **One-Arm rows** (Pulls, recall Pulls, Compactions per Run) read "n/a" on the Arm that cannot have them, and carry no difference.
- **Six fixed caveats:**
  1. Workload authorship.
  2. Workloads chosen to make pi-chart evict.
  3. Different Lapse routes on the two Arms.
  4. Plain omp's untuned default compaction.
  5. Run isolation, which removes the benefit of earlier Conversations.
  6. Model ids, thinking level, n and interval method.
- **Output**: `docs/benchmarks/<date>-plain-omp-comparison.md`, with its JSON beside it. The JSON holds each Run's figures and identity but no prompt text or Journal, because the EvoCode tasks are CC BY-NC.

## Capabilities

### New Capabilities

- `comparison-report`: the batches and their pairing, model check and caps; the headline Measures and their intervals; one-Arm rows; Ablation and Utilisation; the caveats; the output files; and rebuilding the report from the batches.

### Modified Capabilities

None. The Gate's model check takes the model to check against as a parameter, with no change in Gate behaviour.

## Impact

- New `scripts/compare.ts`. It reuses:
  - `gatherPairs`, `pairRunner` and `gateLapses` from `scripts/gate.ts`;
  - `runCapped` from `scripts/sweep.ts`;
  - `runTask` and `fetchTasks` from `scripts/evocode.ts`;
  - `ablateRun`, `summarise` and `ppiByArm` for Ablation (`ppiByArm` is newly exported from `scripts/ablate.ts`);
  - `buildTree` and `headerOf` from `scripts/runs.ts`. `headerOf` now also returns the Journal's thinking level.
- `scripts/gate.ts`: `offModel` and `pairRunner` check each Run against the model its batch asked for, instead of the fixed `REFERENCE_MODEL`.
- `scripts/stats.ts`: `pairedWithinTasks`, a two-sided paired interval pooled within tasks.
- New tests: `test/compare.test.ts`, plus cases in `test/gate.test.ts` and `test/stats.test.ts`.
- `README.md` (benchmarks section) and the new `docs/benchmarks/` report.
- Spend: at most $250 for the batches and $40 for Ablation, about $290 in total, plus a smoke run of a few dollars.
