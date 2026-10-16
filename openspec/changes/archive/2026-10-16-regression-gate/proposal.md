# Proposal: Regression Gate

Triage: ready-for-agent
Blocked by: gate-workload, pulls-through-tool-device

## Why

Changes to `src/` are archived today on unit tests alone. Nothing catches a change that makes pi-chart costlier or makes it forget. The Measures and the frozen Gate Workload (`bench/workloads/gate/`, v1) both exist now. This change runs them as a Gate: a pass / fail / inconclusive verdict on a change's commit against the commit before it.

Decisions: `context-need-measures/questions/08`, `09`, `13`. Two of decision 08's open points were settled while planning this change: the cap, and the role and definition of the Lapse test.

## What Changes

- **Paired fresh Runs.** Pairs of Gate Workload Runs, one of the change's commit and one of the commit before it, run at the same time. Each side's pi-chart is loaded from a checkout of that side's commit. The Gate compares pi-chart with pi-chart; plain omp is not part of it.
- **Two gated Measures, Holm-corrected:**
  - **Cost per Run**: one-sided paired t test on each pair's log cost ratio, non-inferiority margin ×1.10. It can pass the Gate or fail it.
  - **Lapses per Run**: a harm test. It can fail the Gate but never needs to pass for the Gate to pass: a one-sided paired t test on each pair's difference, failing when Lapses rise significantly. The Gate's Lapse count is a Run's Re-fetch Lapses plus its recall Pulls plus its failed-Probe Lapses. Left Revisits are left out because their fetch can also be a Re-fetch, and unknowns are left out too. The two v1 probe Runs counted 25 and 26.
  - Holm's correction covers the two fail tests.
- **Verdict**: pass, fail or inconclusive. There are two looks under O'Brien–Fleming boundaries, at 5 pairs and then at 10.
- **Pooled σ.** A one-time A/A batch of 5 pairs of one commit (about $44) seeds the pool. Every later Gate adds its pairs to it. The pool is keyed by Workload version, model and omp version, and a Gate whose key has no A/A batch does not run.
- **Cost cap**: about $45 at the first look and about $90 per Gate. The $38 / $75 in decision 08 assumed $3.75 per Run; gate-workload measured $4.37 and recorded that this change must budget about $87 for 10 pairs.
- **Reported only:** Re-fetches, Pulls, Retention per Probe and by distance band, Pass rate and Cost per Pass, for each side.
  - Needed share reads "not measured"; `ablation` adds `--ablate`.
  - Utilisation reads "not measured" until `utilisation` lands.
- **No `src/` change, no Gate.** The Gate stops before any Run when the two commits differ nowhere under `src/`.
- **Workflow step.** `docs/agents/workflow.md` makes the Gate a required, hand-run step before `/opsx-archive` for any change that touches `src/`.
- **Measures wording.** Recall Pulls and failed-Probe Lapses are "never added" to the other Lapse routes. That rule now says it holds everywhere except the Gate's Lapse count, which compares pi-chart with pi-chart.

## Capabilities

### New Capabilities

- `regression-gate`: pairing and per-commit Runs, the Lapse count, the gated tests and their correction, looks, the pooled variance and the A/A batch, verdicts, the cap, the report and the `src/` precondition.

### Modified Capabilities

- `measures`: "Recall Lapses per Run by distance band" and "Failed Probes per Run by distance band" permit the Gate's sum of Lapse routes.

## Impact

- `scripts/bench-tokens.ts`: the Run machinery (`runOne`, `pool`, Journal lookup, per-Run database, checks) moves to `scripts/runs.ts`. It gains a parameter for the pi-chart checkout a Run loads and migrates with. The benchmark's behaviour is unchanged.
- New `scripts/stats.ts` (Student t distribution, pooled variance, Holm) and `scripts/gate.ts` (CLI, A/A mode, looks, verdict, report).
- New `bench/gate/pool.json`, committed: every A/A and Gate batch's per-pair figures, keyed.
- `docs/agents/workflow.md`: the Gate step.
- Spend: the A/A batch (about $44) once per key, then up to about $90 per Gate.
