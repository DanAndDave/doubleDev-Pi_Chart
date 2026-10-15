# Proposal: Budget sweep

Triage: needs-triage
Blocked by: regression-gate

## Why

The 2026-10-14 tail × mark sweep chose on cost alone, never tested forgetting, and used a $0.10 tie band that its own $0.46 within-cell spread showed was too narrow. Tuning a Budget needs the Gate's objective, so a sweep winner cannot then fail the Gate. It also needs a held-out confirmation, so the winner is not fitted to one Workload.

Decisions: `context-need-measures/questions/18`, `08`.

## What Changes

- **`bench-tokens --sweep <grid.json>`.** At most two Budgets, at most 9 cells, every other Budget at its default, and the current default always a cell.
- **Objective (the Gate's):**
  1. Eligible: Lapses per Run no worse than the default's, and no step's Pass rate collapses.
  2. Best: the lowest geometric-mean Cost per Run.
  3. Tied: any cell whose paired log-cost ratio against the best has a 95% interval containing 1, on the pooled σ.
  4. Tie-break: the default wins any tie; otherwise the cell with smaller Budgets.
  
  Retention, Utilisation and Re-fetches are reported per cell but do not affect the pick.
- **Screen.** Gate Workload, ≤ 9 cells × 3 Runs, round-robin (about $101).
- **Confirm.** A held-out Workload, with the winning cell paired against the default under the Gate procedure (≤ $75). A default changes only if the cell is cheaper there, with an upper bound of the cost ratio below 1, and Lapses are no worse.
- **Held-out Workload** `bench/workloads/<name>-holdout/`, authored and frozen like the Gate Workload, with its own Plants and revisits. Neither the Gate nor the screen ever runs it.
- **Report** at `docs/benchmarks/<date>-<slug>.md`, showing the rule as applied, with raw JSON beside it.
- Cap about $175 per sweep.

Non-goal: choosing which values ship. That is left to later tuning changes that use this instrument.

## Capabilities

### New Capabilities

- `budget-sweep`: the grid limits, the objective, the screen and confirm stages, and the report.

### Modified Capabilities

None.

## Impact

- `scripts/bench-tokens.ts`, reusing the Gate's paired tests and pooled σ.
- New held-out Workload under `bench/workloads/`.
- Spend: probing the held-out Workload. Each sweep then costs up to $175 and is paid by the tuning change that runs it.
