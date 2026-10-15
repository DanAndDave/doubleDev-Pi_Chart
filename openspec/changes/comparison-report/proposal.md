# Proposal: Comparison report

Triage: needs-triage
Blocked by: regression-gate, utilisation-calibration, evocode-subset

## Why

The effort's third job is a comparison with plain omp that holds up to scrutiny. That needs:
- paired differences with intervals, not single Runs;
- an outside Workload;
- a second model;
- a fixed statement of what the comparison cannot show.

Decisions: `context-need-measures/questions/17`, `09`, `05`.

## What Changes

- **Headline Measures**, each a paired difference with a 95% interval: Cost per Run, Cost per Pass, Lapses per Run, and Retention by distance band. Pass counts are given per step but are not a headline.
- **Batches** (fixed n, no sequential looks; descriptive, not a verdict):

  | Model | Workload | Pairs |
  |---|---|---|
  | reference | Gate Workload | 10 |
  | reference | EvoCode subset | sized by its probe Run |
  | second model | Gate Workload | 10 |

  Which second model is used is decided at `/opsx-propose`.
- **Ablation**: 40 units per Arm (20 on each of 2 Runs), reference model only, giving Needed share. Utilisation sits beside it, with the PPI row when κ ≥ 0.4.
- **One-Arm rows** read "n/a" on the plain-omp side.
- **Six fixed caveats**:
  1. Workload authorship.
  2. Workloads chosen to make pi-chart evict.
  3. Different Lapse routes on the two Arms.
  4. Plain omp's untuned default compaction.
  5. Run isolation, which removes the benefit of earlier Conversations.
  6. Model ids, thinking level, n and interval method.
- **Output** `docs/benchmarks/<date>-plain-omp-comparison.md`, with raw JSON beside it.
- **Cap** about $250, plus about $49 for Ablation.

## Capabilities

### New Capabilities

- `comparison-report`: batches, headline Measures and their intervals, one-Arm rows, the caveats section, and the cap.

### Modified Capabilities

None.

## Impact

- A report command that reuses the Gate's paired statistics without its sequential looks.
- New `docs/benchmarks/` report.
- Spend: about $300 in total.
