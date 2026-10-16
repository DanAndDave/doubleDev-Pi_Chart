# Proposal: Gate Workload

Triage: needs-triage
Blocked by: plants-and-retention, revisit-scoring

## Why

The Gate, the Budget sweep, the Ablation calibration set and the comparison report all run one Workload. The existing Workloads cannot serve:
- `read-only-40` grades nothing and never revisits.
- `smoke` is four Turns, so it never evicts.

This change authors and freezes the Workload they share.

Decisions: `context-need-measures/questions/06`, `07`, `10`, `16`.

## What Changes

- **`bench/workloads/gate/`, version 1**:
  - 40 Turns in 6 graded steps that build one small module of this repo, `src/budget-table.ts`, on top of `src/tokens.ts`, `src/turns.ts` and `src/shares.ts`. A seventh, ungraded step is the final Probe.
  - Pinned to the commit at `HEAD` when the draft is written, plus an overlay of read-only `notes/*.md` the steps work from.
  - One hidden `bun test` check per graded step. Each is pure unit: no Postgres, no network.
  - A frozen `graphify-out/` extracted against the pinned commit, and an empty `bundle/`.
- **Carries six Plants.** Each of the three kinds (literal, superseded, constraint) is placed once in a prompt and once in a tool result. Two Plants sit in each distance band (≤ 5, 8–12, ≥ 25 Turns). The final Probe forbids tools and asks for the four Plants that are not constraints.
- **Carries six Revisits** of overlay files, two in each distance band.
- **Agent-drafted, user-reviewed, then frozen.** Every check is shown to pass against a reference solution before any Run. Any later edit is a new version and resets saved reference figures.
- **Probed on both Arms before freezing.** On pi-chart, the Plants and Revisits in the 8–12 and ≥ 25 bands must be evicted when they are needed. The pi-chart cost was planned at $3.75 per Run, so that 20 Runs fit the $75 Gate cap. The probe measured $4.37, the mean of two Runs of the frozen draft, and the user accepted that figure. 20 Runs then cost about $87, which `regression-gate` has to budget for.
- `.gitignore` stops ignoring a Workload's `graphify-out/`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. A Workload is data in the format `benchmark-runs` already fixes, and no code changes, so the change declares `skip_specs: true`.

## Impact

- New `bench/workloads/gate/`, with a README recording its Plants, Revisits, distances and probe figures.
- `.gitignore`: one negation.
- Spend: one probe pair is about $3.75 for pi-chart plus about $4.90 for plain omp. It is repeated each time the draft is revised, with a ceiling of $30 before asking the user.
