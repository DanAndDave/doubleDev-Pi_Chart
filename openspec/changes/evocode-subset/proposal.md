# Proposal: EvoCode-Bench subset

Triage: needs-triage
Blocked by: plants-and-retention

## Why

The Gate Workload was written by people who know how pi-chart works, and chosen to make it evict. The comparison report needs an outside check: multi-step tasks from a published suite, run on both Arms and measured by the same Measures script.

Decisions: `context-need-measures/questions/06`, `11`.

## What Changes

- **An omp agent for Harbor.** It runs EvoCode-Bench's multi-step tasks on either Arm, with pi-chart loaded through `-e`. Each step's test outcome is recorded as a Graded Task.
- **The Run record keeps the existing format**, including Journals, Accounting and `run.json`, so `scripts/measures.ts` reads it unchanged. Runs are isolated as in `benchmark-runs`.
- **Probed subset.** A probe Run admits only tasks that make pi-chart evict. The subset's size is set by the probe Run under the comparison report's budget.
- **Licence.** The dataset is CC-BY-NC. `design.md` decides whether it is fetched at run time or vendored, and records the terms.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-runs`: Runs driven by Harbor tasks produce the same Run record as Workload Runs.

## Impact

- New Harbor agent adapter, plus a subset list naming its admitted tasks.
- Harbor and EvoCode-Bench become benchmark-only dependencies.
- Spend: the probe Run, sized in `design.md`.
