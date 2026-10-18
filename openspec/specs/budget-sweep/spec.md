# budget-sweep Specification

## Purpose

A Budget sweep runs a grid of pi-chart Budget settings on the Gate Workload. It picks the cell the Gate's objective prefers and confirms that cell against the default on a held-out Workload, so a tuned default is cheaper without forgetting more and is not fitted to one Workload.

## Requirements

### Requirement: A grid varies at most two Budgets over at most 9 cells

A sweep SHALL read a grid file naming a slug and, for each swept Budget, its `PICHART_*` variable and the values to try. The tunable Budget variables SHALL be:
- `PICHART_TAIL_TOKENS`, `PICHART_TAIL_TURNS` and `PICHART_TAIL_LOW_WATER`;
- `PICHART_OPENING_TOKENS`, `PICHART_PINS_TOKENS`, `PICHART_RECALL_TOKENS`, `PICHART_DOC_TOKENS`, `PICHART_GRAPH_TOKENS` and `PICHART_PACK_TOKENS`.

The cells SHALL be every combination of the swept values. Before any Run, the sweep SHALL refuse the grid, naming each problem, when:
- its slug is missing, or holds anything but lowercase letters, digits and hyphens;
- it sweeps no Budget, or more than two;
- it names a variable outside that list;
- it gives more than 9 cells;
- a Budget's values repeat;
- a Budget's values leave out its current default;
- pi-chart would not read a value as given.

The cell whose every value is its default SHALL be the default cell. Every Budget the grid does not sweep SHALL stay at its default. A sweep SHALL refuse to start when its own environment sets any tunable Budget variable.

#### Scenario: Three Budgets are refused

- **WHEN** a grid sweeps `PICHART_TAIL_TOKENS`, `PICHART_TAIL_LOW_WATER` and `PICHART_RECALL_TOKENS`
- **THEN** the sweep SHALL start no Run and SHALL state that a grid sweeps at most two Budgets

#### Scenario: A grid without the default is refused

- **WHEN** a grid sweeps `PICHART_TAIL_TOKENS` over 40000 and 60000, and its default is 25000
- **THEN** the sweep SHALL start no Run and SHALL state that 25000, the default, is missing

#### Scenario: A value pi-chart would ignore is refused

- **WHEN** a grid gives `PICHART_TAIL_LOW_WATER` the value 1.5
- **THEN** the sweep SHALL start no Run, since pi-chart would read the default instead of 1.5

#### Scenario: A Budget set in the shell is refused

- **WHEN** a sweep is started with `PICHART_DOC_TOKENS=8000` in its environment
- **THEN** it SHALL start no Run and SHALL name `PICHART_DOC_TOKENS`

### Requirement: A sweep checks what it needs before any Run

Before any Run, a sweep SHALL stop, with no Run and no spend, when:
- `src/` has uncommitted changes, since every Run loads the committed `src/` and records the commit;
- the held-out Workload is the screen's Workload;
- the pool holds no A/A batch for the screen's key, or none for the held-out Workload's key. The sweep SHALL name the `gate.ts --aa` command that runs the missing batch.

The screen SHALL run the Gate Workload unless another Workload is named for a smoke test. The held-out Workload SHALL default to the screen Workload's name followed by `-holdout`. Every Run SHALL be a pi-chart Run on the reference model, `anthropic/claude-opus-5-5`. A Run that records another model SHALL stop the sweep and add nothing to the pool.

#### Scenario: No held-out A/A batch

- **WHEN** a sweep starts and the pool has an A/A batch for `gate` v1 but none for `gate-holdout` v1 under the same model and omp version
- **THEN** it SHALL start no Run and SHALL name `bun scripts/gate.ts --aa --workload gate-holdout`

### Requirement: The screen runs every cell round-robin

The screen SHALL run each cell a number of times, 3 by default, in rounds. Each round SHALL start one Run of every cell, with the order of cells rotated by one each round. Each Run SHALL be given its cell's values for the swept Budgets and no other Budget. Runs of the same round SHALL form the pairs the screen compares. An incomplete Run SHALL void every pair it is in, and SHALL NOT be replaced. No Run SHALL start once the screen's spend reaches $120. The screen SHALL add nothing to the pool.

#### Scenario: A round runs every cell once

- **WHEN** a 3 × 3 grid is screened with 3 Runs per cell
- **THEN** each of the 3 rounds SHALL hold one Run of each of the 9 cells
- **AND** the cell first in round 1 SHALL be second in round 2

#### Scenario: A void Run voids its round's pairs

- **WHEN** a cell's Run in round 2 fails at Turn 30
- **THEN** that cell's comparisons SHALL use rounds 1 and 3 only, and its Run's cost SHALL count as spend

### Requirement: A cell is eligible when it forgets no more and no step collapses

The default cell SHALL always be eligible. Any other cell SHALL be eligible only when all three of these hold:
- **Pairs.** It has at least 2 complete pairs with the default.
- **Lapses.** The one-sided paired test of its Lapses per Run against the default's, on the pooled variance at α 0.05, is not rejected. The test SHALL take the Gate's form: Lapses as the Gate counts them, and variance pooled over the screen key's stored batches and this comparison's differences.
- **Pass.** On no graded step does it pass on 2 or more fewer complete Runs than the default.

#### Scenario: A cell that forgets is out

- **WHEN** a cell's Lapse test against the default has p = 0.03
- **THEN** the cell SHALL be ineligible, whatever its cost

#### Scenario: A step collapses

- **WHEN** the default passes step `render` on 3 of 3 complete Runs and a cell on 1 of 3
- **THEN** the cell SHALL be ineligible, naming `render`

#### Scenario: One fewer pass is not a collapse

- **WHEN** the default passes a step on 3 of 3 complete Runs and a cell on 2 of 3
- **THEN** that step SHALL NOT make the cell ineligible

### Requirement: The screen picks the cheapest eligible cell, and the default wins ties

The best cell SHALL be the eligible cell with the lowest geometric-mean Cost per Run over its complete Runs. An eligible cell SHALL be tied with the best when the two-sided 95% interval of its paired log-cost ratio against the best contains 0. That interval is the mean difference ± the Student t quantile at 0.975 times the standard error, on the pooled variance. A comparison with fewer than 2 complete pairs SHALL count as tied. The best is tied with itself. The winner SHALL be:
- the default, when it is tied;
- otherwise, the tied cell with smaller Budgets: the lowest sum, over swept Budgets, of its value's rank in that Budget's ascending values, then the lowest rank of the first swept Budget.

#### Scenario: The default wins a tie

- **WHEN** the cheapest eligible cell's paired cost ratio against the default is 0.94 with a 95% interval of [0.86, 1.03]
- **THEN** the winner SHALL be the default

#### Scenario: Smaller Budgets win a tie without the default

- **WHEN** the default is not tied with the best, and cells (40000, 0.2) and (60000, 0.4) of a `PICHART_TAIL_TOKENS` × `PICHART_TAIL_LOW_WATER` grid are both tied with it
- **THEN** the winner SHALL be (40000, 0.2)

### Requirement: The winner is confirmed on the held-out Workload

When the winner is not the default, the sweep SHALL confirm it on the held-out Workload. Each pair SHALL be one Run of the default cell and one Run of the winner, started together, with the start order alternating. It SHALL use the Gate's two looks, levels, Holm's correction and Lapse count, with caps of $70 before the first look and $140 in total. Variance SHALL be pooled under the held-out key. The cost test SHALL use a margin of 1: the winner is cheaper when exp(*d̄* + *c* · SE) < 1. The confirm outcome SHALL be:
- **adopt**, when at a look neither fail test is rejected and the winner is cheaper;
- **keep the default**, when either fail test is rejected, or when the second look or the cap leaves it undecided. The reason SHALL be stated.

When the winner is the default, no confirm SHALL run and the outcome SHALL be keep the default. Once confirm ends with at least 2 complete pairs, they SHALL be added to the pool as one confirm batch under the held-out key.

#### Scenario: A cheaper winner is adopted at the first look

- **WHEN** at the first look of confirm neither fail test is rejected and the winner's upper cost ratio bound is 0.93
- **THEN** the outcome SHALL be adopt, and no further pair SHALL start

#### Scenario: A winner that is only no worse keeps the default

- **WHEN** at the second look neither fail test is rejected and the upper cost ratio bound is 1.04
- **THEN** the outcome SHALL be keep the default, because the winner was not shown cheaper

#### Scenario: The default wins the screen

- **WHEN** the screen's winner is the default
- **THEN** no held-out Run SHALL start, and the outcome SHALL be keep the default

### Requirement: A sweep's spend is capped at $260

A sweep's spend SHALL be the sum of Cost per Run over every Run it started, void ones included. The screen's cap SHALL be $120. The confirm's caps SHALL be $70 at its first look and $140 at its second, counted over confirm Runs alone. The report SHALL state each stage's spend against its cap, and that spend may exceed a cap by the Runs already running when the cap was reached.

#### Scenario: The screen stops at its cap

- **WHEN** the screen's spend reaches $120.30 with 26 of 27 Runs started
- **THEN** the last Run SHALL NOT start, and the cells SHALL be compared over the Runs that finished

### Requirement: Every sweep leaves a record and a report

Every sweep SHALL write to its output folder each Run's record, under `runs/`, and `sweep.json`. `sweep.json` SHALL hold:
- the grid, the commit and both keys;
- every cell with its Budgets;
- every Run with its cell, round, Cost per Run, Lapses per Run, completeness and step outcomes;
- the screen's spend, each cell's eligibility with its reasons and tests, the best cell, the tied cells and the winner;
- when confirm ran, every pair, each look's figures, the spend and the outcome;
- when a Run threw or recorded another model, why the sweep stopped.

When the sweep ends with an outcome, it SHALL write the report to `docs/benchmarks/<date>-<slug>.md` and `sweep.json` beside it as `<date>-<slug>.json`. A sweep stopped by a Run SHALL write neither, and SHALL add nothing to the pool. The report SHALL give:
- the outcome and the winner;
- a table of every cell with its geometric-mean Cost per Run, Lapses per Run, Pass per step, Retention, median Utilisation per Run labelled with its calibration, and Re-fetches held, left and unknown;
- the rule as applied, with each cell's eligibility and reasons, its Lapse test, and its tie interval against the best;
- each cell's per-Run costs;
- the confirm's looks, when it ran;
- the spend against each cap;
- the method: commit, grid, keys and command.

The report SHALL be re-printable from the output folder alone, with no Run and no model Call.

#### Scenario: Re-printing a sweep

- **WHEN** the report is asked for from a finished sweep's output folder
- **THEN** it SHALL print the same outcome and figures, start no Run and leave the pool unchanged

### Requirement: The held-out Workload is never fitted to

The held-out Workload SHALL be a Workload folder named `<screen Workload>-holdout`, authored and frozen like the Gate Workload. It SHALL have its own Plants and Revisits, in the Gate Workload's distance bands, over different files and a different theme. A sweep SHALL refuse, before any Run, a screen Workload whose name ends in `-holdout`. Only a sweep's confirm and an A/A run SHALL run a held-out Workload.

#### Scenario: The screen refuses a held-out Workload

- **WHEN** a sweep is started with `--workload gate-holdout`
- **THEN** it SHALL start no Run and SHALL state that a held-out Workload is never screened
