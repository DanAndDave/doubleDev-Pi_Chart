# Proposal: Gate Workload

Triage: needs-triage
Blocked by: plants-and-retention, revisit-scoring

## Why

The Gate, the Budget sweep, the Ablation calibration set and the comparison report all run one Workload. The existing Workloads cannot serve:
- `read-only-40` grades nothing and never revisits.
- `smoke` never evicts.

This change authors and freezes the Workload they share.

Decisions: `context-need-measures/questions/06`, `07`, `10`, `16`.

## What Changes

- **Gate Workload v1** under `bench/workloads/<name>/`; the name is chosen at `/opsx-propose`:
  - about 40 Turns in about 6 graded steps of real work on this repo;
  - a pinned commit plus an overlay;
  - one hidden `bun test` check per step, pure unit, with no Postgres and no network;
  - a frozen `bundle/` and `graphify-out/`.
- **Carries the Plants**: all three kinds (literal, superseded, constraint), half in prompts and half in tool results, across the three distance bands, plus the final tools-forbidden Probe.
- **Carries about 6 revisits** of read-only overlay files, placed in the same distance bands.
- **Agent-drafted, user-reviewed, then frozen.** Any later edit is a new version and resets saved reference figures.
- **Probed on both Arms before freezing.** It must make pi-chart evict, and it must cost at most $3.75 per pi-chart Run, so 20 Runs fit the $75 Gate cap.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None expected. A Workload is data in the format `benchmark-runs` already fixes, so this change likely declares `skip_specs: true`; `/opsx-propose` confirms.

## Impact

- New `bench/workloads/<name>/`.
- Spend: probe Runs, about $3.75 per pi-chart Run and about $4.90 per plain-omp Run, repeated as the draft is revised.
