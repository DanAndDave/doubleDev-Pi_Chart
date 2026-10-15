# Budget sweep design

Type: grilling
Status: closed
Blocked by: 08-gate-statistics-and-cost

## Question

Which Budgets are swept, over what grid, on which Workload, and what objective picks the winning cell?

## What's known

- Prior art: `docs/benchmarks/2026-10-14-eviction-defaults.md`, a 3×3 grid of tail size against low-water mark, 3 Runs per cell, objective lowest median cost with a $0.10 tie band. Within-cell spread reached $0.46, so "a future sweep that ranks cells this close needs more runs per cell".
- Tunable Budgets: `PICHART_TAIL_TOKENS`/`TURNS`/`LOW_WATER`, `OPENING_TOKENS`, `PINS_TOKENS`, `RECALL_TOKENS`, `DOC_TOKENS`, `GRAPH_TOKENS`, `PACK_TOKENS` (`src/config.ts:208-229`).
- Ticket 06: a held-out second Workload belongs to the sweep.
- Ticket 08: the Gate gates Cost per Run and Lapses per Run; everything else is reported.

## Resolution

- **Scope:** this effort fixes how a sweep runs; which values ship is left to later tuning changes (map, Out of scope).
- **Budgets:** any tunable Budget may be swept, but one sweep varies at most two, on a grid of at most 9 cells. Every other Budget stays at its default, and the current default is always a cell. Suggested first sweeps: re-run tail × mark (the 2026-10-14 sweep chose on cost alone and never tested forgetting), then `RECALL_TOKENS`, which caps how much a recall Pull can bring back.
- **Objective:** the Gate's two Measures, so a sweep winner cannot then fail the Gate.
  1. Eligible: Lapses per Run no worse than the default's (the Gate's one-sided paired test), and no step's Pass rate collapses.
  2. Best: lowest geometric-mean Cost per Run.
  3. Tied: any cell whose paired log-cost ratio against the best has a 95% interval containing 1, using the pooled σ of ticket 08. This replaces the fixed $0.10 band, which the old sweep's $0.46 within-cell spread showed was too narrow.
  4. Tie-break: the default wins any tie; otherwise the cell with smaller Budgets.
  - Retention, Utilisation and Re-fetches are reported for every cell but do not affect the pick. The rule is written into the tuning change's `design.md` before the sweep runs.
- **Procedure:** two stages, cap ≈ $175 per sweep.
  - Screen: Gate Workload, ≤ 9 cells × 3 Runs, round-robin so cost drift hits every cell alike (≈ $101).
  - Confirm: held-out Workload, winning cell paired against the default under the Gate procedure, looks at 5 and 10 pairs (≤ $75).
  - Changing a default needs the cell to be cheaper on the held-out Workload (upper bound of the cost ratio below 1) with Lapses no worse. Otherwise the default stays and the report says why.
- **Held-out Workload:** `bench/workloads/<name>-holdout/`, authored and frozen like the Gate Workload, with its own Plants and revisits. Neither the Gate nor the screen ever runs it.
- **Instrument:** `bench-tokens --sweep <grid.json>` runs the grid and writes one report at `docs/benchmarks/<date>-<slug>.md` showing the rule as applied, in the eviction-defaults report's format, with raw JSON beside it.
