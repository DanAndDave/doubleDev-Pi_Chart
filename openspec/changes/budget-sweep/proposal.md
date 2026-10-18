# Proposal: Budget sweep

Triage: ready-for-agent
Blocked by: regression-gate

## Why

The 2026-10-14 tail × mark sweep chose on cost alone and never tested forgetting. Its $0.10 tie band was also too narrow, as its own $0.46 within-cell spread showed. A Budget can't be tuned against the Gate's objective by hand: bench-tokens takes Budgets only from the shell, so one process can't run two cells, and a Run's record doesn't say which Budgets it ran with. The tuning changes that pick Budget values need an instrument that does three things:
- picks a winner the Gate would pass;
- confirms the winner on a Workload it was not fitted to;
- leaves a report showing the rule as applied.

Decisions: `context-need-measures/questions/18`, `08`.

## What Changes

- **`bench-tokens --sweep <grid.json>`.**
  - Varies at most two Budgets, with at most 9 cells. Every other Budget stays at its default, and the current default is always a cell.
  - The grid names Budgets by their `PICHART_*` variables. Each value must be one pi-chart reads as given.
  - A sweep refuses to start when the shell sets any tunable Budget, or when `src/` has uncommitted changes.
- **Each Run is given its own Budgets.** A Run takes its Budgets from its spec, not only from the shell. Its record names every tunable Budget variable it ran with.
- **Objective (the Gate's two Measures):**
  1. Eligible: Lapses per Run no worse than the default's, by the Gate's one-sided paired test at α 0.05 on the pooled variance. Also, no graded step collapses, meaning the cell passes it on 2 or more fewer Runs than the default does.
  2. Best: the lowest geometric-mean Cost per Run.
  3. Tied: any cell whose paired log-cost ratio against the best has a 95% interval containing 1, on the pooled variance.
  4. Tie-break: the default wins any tie; otherwise the cell with smaller Budgets wins.

  Retention, Utilisation, Re-fetches and Pass per step are reported for every cell. They don't affect the pick.
- **Screen.** The Gate Workload, ≤ 9 cells × 3 Runs, round-robin, capped at $120 (Runs measure $4.37, so 27 Runs cost about $118).
- **Confirm.** The winning cell is paired against the default on the held-out Workload, under the Gate's looks at 5 and 10 pairs, with caps of $70 and $140 sized for the held-out Workload's Runs. A default changes only if the cell is cheaper there, meaning the upper bound of the cost ratio is below 1, and Lapses are no worse. A winner that is the default skips confirm. The confirm's complete pairs join the pool under the held-out key.
- **Cap $260 per sweep:** the screen's $120 plus the confirm's $140.
- **Both keys need an A/A batch.** A sweep stops before any Run unless the pool holds an A/A batch for the Gate Workload's key and for the held-out Workload's key. It names the `gate.ts --aa` command that runs the missing one. The held-out A/A batch (about $44) is paid by the first sweep, not by this change.
- **Held-out Workload `bench/workloads/gate-holdout/`**, authored and frozen like the Gate Workload, with its own theme, Plants and Revisits.
  - The Gate refuses a Workload named `*-holdout` except in A/A mode, so neither the Gate nor the screen ever runs it.
- **Record and report.** `sweep.json` holds every Run's figures and both stages. The report is written to `docs/benchmarks/<date>-<slug>.md`, with the raw JSON beside it. It can be re-printed from the output folder with no Run.

Non-goal: choosing which values ship. That is left to later tuning changes, which run this instrument and pay for their sweeps.

## Capabilities

### New Capabilities

- `budget-sweep`: grid limits, the screen, the objective, the confirm stage, spend caps, and the record and report.

### Modified Capabilities

- `benchmark-runs`: a pi-chart Run's record names the tunable Budget variables it ran with, and a Run's Thread Store address reaches pi-chart alone, never the agent's shell.
- `regression-gate`: a sweep's confirm adds a batch to the pool. A Gate refuses a held-out Workload except in A/A mode.

## Impact

- New `scripts/sweep.ts`. Also changes `scripts/bench-tokens.ts` (`--sweep` dispatch, and `--report` reading `sweep.json`), `scripts/runs.ts` (per-Run Budgets, recorded; the shared workspace template and clean-`src/` check), `scripts/gate.ts` (`decide` takes its margin, the statistics are exported, `confirm` batches, held-out refusal), `scripts/workload.ts` (`isHeldOut`) and `scripts/measures.ts` (`RunRecord.budgets`).
- Probing found that a Workload over pi-chart's own source lets the agent's store tests truncate the Run's own Thread Store, since the agent's shell inherited `PICHART_DATABASE_URL`. `scripts/runs.ts` and `scripts/replay.ts` now hand pi-chart the address through new `scripts/run-url-set.ts` and `scripts/run-url-unset.ts`, which keep it out of the agent's shell (design decision 12).
- New Workload `bench/workloads/gate-holdout/`.
- Spend in this change: smoke sweeps on `smoke` (about $5), and probing the held-out Workload (two pi-chart Runs and one plain-omp Run, estimated at $12 to $15, stopping for the user at $30). The probes spent $27.74, two of them void before the Thread Store fix. Each real sweep costs up to $260 and is paid by the tuning change that runs it. Its first one also pays the held-out A/A batch.
