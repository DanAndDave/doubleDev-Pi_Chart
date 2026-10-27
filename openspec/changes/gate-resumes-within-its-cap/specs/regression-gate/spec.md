## MODIFIED Requirements

### Requirement: Spend is capped

The Gate's spend SHALL be the sum of Cost per Run over every Run it started, void pairs included. The cap SHALL be $55 before the first look and $110 in total. A pair SHALL start only when the spend plus the projected cost of that pair and of every pair already in flight stays within the cap: spend + (pairs in flight + 1) × estimate ≤ cap. The estimate SHALL be the median cost, both Runs together, of the Gate's own finished pairs, void ones included. Before the Gate has finished a pair, the estimate SHALL be the median cost of the pairs stored in the pool under the Gate's key. When neither exists, a pair SHALL start only while spend is below the cap. A look that cannot reach its pairs SHALL end the Gate as inconclusive, stating that the cap stopped it. The report SHALL state the spend against the cap, and that a pair costing more than the estimate can still take spend past it.

#### Scenario: A pair that would cross the cap does not start

- **WHEN** before the first look the Gate's finished pairs have a median cost of $9.60, spend is $38.40, and one pair is in flight
- **THEN** no further pair SHALL start, since $38.40 + 2 × $9.60 = $57.60 exceeds $55

#### Scenario: A pair that fits starts beside the one in flight

- **WHEN** before the first look the Gate's finished pairs have a median cost of $9.60, spend is $19.20, and one pair is in flight at `--parallel 2`
- **THEN** a further pair SHALL start, since $19.20 + 2 × $9.60 = $38.40 is within $55

#### Scenario: The pool gives the first estimate

- **WHEN** a Gate has finished no pair and the pool's pairs under its key have a median cost of $9.87
- **THEN** $9.87 SHALL be the estimate, and once the Gate's first pair finishes at $10.50, $10.50 SHALL replace it

#### Scenario: Without an estimate the spend alone is checked

- **WHEN** neither the Gate nor the pool under its key has a finished pair
- **THEN** a pair SHALL start while spend is below the cap

#### Scenario: Voids exhaust the cap

- **WHEN** void pairs bring spend to $55.20 with 4 complete pairs before the first look
- **THEN** no further pair SHALL start, and the verdict SHALL be inconclusive, stopped by the cap

### Requirement: Every Gate leaves a record and a report

Every Gate and A/A run SHALL write to its output folder each Run's record, under `runs/base-<i>/` and `runs/candidate-<i>/`, and `gate.json`. `gate.json` SHALL hold both commits, the key, the Workload's folder, the Options, the turn timeout, the pool, every pair with its Runs' Cost per Run, Lapses per Run and completeness, the spend, the next pair index, each look's figures and the verdict. It SHALL be written once the trees are built, again each time a pair settles, whether complete, void or stopped, and once more when the Gate ends. Each write SHALL replace the file whole, so a crash never leaves part of one. Once a Gate reaches a verdict, including inconclusive, or an A/A run completes, its complete pairs SHALL be added to the pool, provided there are at least 2. The report SHALL give:
- the verdict, the look it was reached at, and the key;
- for each look: the pairs, the geometric-mean cost ratio exp(*d̄*) with its one-sided bounds exp(*d̄* ± *c* · SE), the mean Lapse difference with its lower bound, both p-values and Holm's decision;
- the spend against the cap;
- for each side over its complete Runs: Pass rate, Cost per Pass, Re-fetches held, left and unknown, Pulls per tool, and Retention per Probe and by distance band;
- for each side, Needed share with its Wilson 95% interval and judged units, plus the Ablation spend, when the Gate ran with `--ablate`; "not measured" otherwise;
- for each side, the PPI Needed share over its complete Runs with its interval, when the key's calibration set has κ of at least 0.4; "uncalibrated" otherwise, whether or not the Gate ran with `--ablate`;
- for each side, the median Utilisation per Run over its complete Runs, labelled with its calibration, recomputed from the Runs' records.

The report SHALL be re-printable from the output folder alone, with no Run and no model Call.

#### Scenario: gate.json follows every pair

- **WHEN** a Gate's third pair settles while its fourth is still running
- **THEN** `gate.json` SHALL already hold the three finished pairs, their spend and the next pair index

#### Scenario: A stopping pair is recorded

- **WHEN** pair 4 stops the Gate after pairs 0–3 completed
- **THEN** `gate.json` SHALL hold pairs 0–3, a spend that includes what pair 4's finished Runs cost, a next pair index of 5, and why the Gate stopped

#### Scenario: Re-printing a Gate

- **WHEN** the report is asked for from a finished Gate's output folder
- **THEN** it SHALL print the same verdict and figures, start no Run and leave the pool unchanged

#### Scenario: An inconclusive Gate still adds to the pool

- **WHEN** a Gate ends inconclusive after 10 complete pairs
- **THEN** the pool SHALL gain one Gate batch of 10 pairs under its key

#### Scenario: Re-printing a Gate that ran Ablation

- **WHEN** the report is asked for from the output folder of a Gate run with `--ablate`
- **THEN** it SHALL print each side's Needed share from the Runs' ablation records, with no model Call

#### Scenario: Re-printing a Gate gives each side's Utilisation

- **WHEN** the report is asked for from the output folder of a Gate whose Runs were recorded before Utilisation existed, under a key with no calibration set
- **THEN** it SHALL print each side's median Utilisation per Run, labelled "uncalibrated", recomputed from the Runs' records with no model Call

#### Scenario: A calibrated Gate gives PPI without Ablation

- **WHEN** the report is asked for from a Gate run without `--ablate`, whose key's calibration set has κ 0.52
- **THEN** it SHALL print "not measured" for each side's Needed share, and each side's PPI Needed share with its interval

## ADDED Requirements

### Requirement: A stopped Gate resumes from its output folder

The Gate SHALL offer a resume mode that continues a Gate or A/A run from its output folder's `gate.json`. A resumed run SHALL take its kind, both commits, its key, its Options, its Workload, its pool and its turn timeout from the record. Before anything is built, it SHALL refuse, naming both values, when the installed omp version or the Workload's version differs from the recorded key. It SHALL also refuse when the record already ended: a Gate with a verdict, or an A/A run that completed or was stopped by the cap. A resumed run SHALL carry over the recorded pairs and spend. It SHALL start its next pair at an index past every recorded pair, the recorded next index and every pair index that has a folder under `runs/`. It SHALL recompute the looks from the pairs, then gather, decide, add to the pool and report as a fresh Gate would. The earlier stop SHALL be kept in the record and named in the report.

#### Scenario: An A/A run that stopped resumes

- **WHEN** an A/A run stopped because pair 1's base Run could not export its Accounting, after pair 0 completed and $19.20 was spent, and it is resumed from its output folder
- **THEN** it SHALL carry pair 0 and $19.20, start its next pair at index 2, and add an A/A batch to the pool once it has 5 complete pairs

#### Scenario: A resumed Gate recomputes its first look

- **WHEN** a Gate that stopped during its second look, with 7 complete pairs, is resumed
- **THEN** its first look SHALL be decided again from the first 5 complete pairs before any further pair starts, and the second look SHALL be reached as in a fresh Gate

#### Scenario: A new omp version refuses a resume

- **WHEN** `gate.json` records `omp/18.12.6` and the installed omp is `omp/18.13.0`
- **THEN** the resume SHALL start no Run and SHALL name both versions

#### Scenario: A finished Gate is not resumed

- **WHEN** `gate.json` holds a verdict
- **THEN** the resume SHALL start no Run and SHALL state that the Gate already ended

### Requirement: A Gate checks the server's free connections first

Before building anything or starting any Run, a Gate or A/A run, fresh or resumed, SHALL read the Thread Store server's `max_connections`, `superuser_reserved_connections` and `reserved_connections` and count its client connections. The free connections SHALL be `max_connections` less both reserved settings and the client connections. The Gate SHALL need 12 connections per Run, 24 per pair: 10 for the Run's pool and 2 for its database's creation, export and drop. When fewer are free than `--parallel` × 24, it SHALL refuse with no spend, naming how many are free, how many are needed, and the largest holders of client connections by application, user and database.

#### Scenario: A busy server refuses the Gate

- **WHEN** the server allows 100 connections with 3 reserved for superusers, 51 client connections are open, 50 of them on `thread_store` with no application name, and a Gate starts at `--parallel 2`
- **THEN** it SHALL refuse before building any tree, stating that 46 connections are free and 48 are needed, and naming the 50 on `thread_store`

#### Scenario: A narrower Gate fits

- **WHEN** the same server has 46 free connections and a Gate starts at `--parallel 1`
- **THEN** the preflight SHALL let it continue, since it needs 24

### Requirement: Stale Run databases are dropped

After the connection check, every Gate and A/A run SHALL drop each database on the server whose name is `bench_`, a 13-digit millisecond timestamp, `_` and a Run label, and whose timestamp is more than 24 hours old. It SHALL log each drop. It SHALL NOT drop any other database, nor a Run database 24 hours old or younger, which another Gate may still be using. A Gate that ends with an error SHALL drop each database of its own Runs that is still on the server. Every drop SHALL end the database's open connections.

#### Scenario: Only old Run databases go

- **WHEN** a Gate starts at 2026-10-27 21:20 UTC and the server holds `bench_1792117753912_pi_chart_0` (2026-10-16), `bench_1793132400000_base_0` (1 hour old), `thread_store` and `pcval_1793135880353`
- **THEN** it SHALL drop `bench_1792117753912_pi_chart_0`, log the drop, and leave the other three

#### Scenario: A failed Gate drops its own Run databases

- **WHEN** a Gate stops because a Run could not drop its database, and `bench_<the Gate's stamp>_base_0` is still on the server
- **THEN** the Gate SHALL drop it before it exits
