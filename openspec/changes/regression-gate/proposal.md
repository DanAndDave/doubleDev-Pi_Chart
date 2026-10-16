# Proposal: Regression Gate

Triage: needs-triage
Blocked by: gate-workload, pulls-through-tool-device

## Why

Changes to `src/` are archived today on unit tests alone. Nothing catches a change that makes pi-chart costlier or makes it forget. The Measures exist; this change turns them into a pass / fail / inconclusive verdict against the previous commit.

Decisions: `context-need-measures/questions/08`, `09`, `13`.

## What Changes

- **Paired fresh Runs.** The change's commit and the previous commit run the Gate Workload as pairs, alternated in time. The Gate compares pi-chart with pi-chart; plain omp is not part of it.
- **Two gated Measures, Holm-corrected:**
  - **Cost per Run**: one-sided paired t test on each pair's log cost ratio, non-inferiority margin ×1.10;
  - **Lapses per Run**: one-sided paired test, so the Gate cannot pass on cost by forgetting.
- **Verdict**: pass, fail or inconclusive, with two looks under O'Brien–Fleming boundaries, at 5 pairs and then at 10.
- **Pooled σ.** A one-time A/A batch of about 10 Runs (about $38) seeds it, and every later Gate adds to it. The pool resets when the Workload version, the model or omp changes.
- **Reported only:** Utilisation, Needed share, Re-fetches, Pulls, Retention by Plant cell, Pass rate and Cost per Pass.
  - Needed share reads "not measured" unless `--ablate`, which `ablation` adds.
  - Utilisation reads "not measured" until `utilisation` lands.
- **Cost cap** about $38 at the first look and about $75 per Gate.
- **Workflow step.** `docs/agents/workflow.md` makes the Gate a required, hand-run step before `/opsx-archive` for any change that touches `src/`. Docs, spec and tooling changes skip it.

## Capabilities

### New Capabilities

- `regression-gate`: pairing, the gated tests and their correction, looks, pooled variance, verdicts, the cap, and the report.

### Modified Capabilities

None.

## Impact

- `scripts/bench-tokens.ts` or a new `scripts/gate.ts`, decided in `design.md`.
- A stored pooled-variance file keyed by Workload version, model id and omp version.
- `docs/agents/workflow.md`: the Gate step.
- Spend: the A/A batch (about $38) once, then up to $75 per Gate.
