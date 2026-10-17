# regression-gate Specification

## Purpose

The Gate decides whether a change to pi-chart may be archived. It runs paired Gate Workload Runs of the change's commit and the commit before it, then gives pass, fail or inconclusive on Cost per Run and Lapses per Run.

## Requirements

### Requirement: A Gate pairs Runs of two commits

A Gate SHALL compare a candidate commit, the change's, with a base commit, the one before it. Both SHALL be given as revisions that resolve to commits; the candidate SHALL default to `HEAD`. The Gate SHALL run the Gate Workload, unless another Workload is named for a smoke test, as pairs, each one Run of the base and one Run of the candidate, with both Runs of a pair started together. Every Run SHALL be a pi-chart Run with the reference model, `anthropic/claude-opus-5-5`, at the harness's default thinking level. Each Run SHALL load pi-chart's extension, and migrate its own Thread Store database, from a checkout of its side's commit with dependencies installed from that commit's lockfile. Changes in the working tree that are not committed SHALL reach neither side. The Gate SHALL stop without a verdict when a Run records a model other than the reference model.

#### Scenario: Each side runs its own commit

- **WHEN** a Gate runs with base `B` and candidate `C`, and the working tree has uncommitted edits under `src/`
- **THEN** every base Run SHALL load the extension as committed at `B`, and every candidate Run as committed at `C`
- **AND** neither side SHALL carry the uncommitted edits

#### Scenario: A Run on another model stops the Gate

- **WHEN** a Run of the Gate records a model other than `anthropic/claude-opus-5-5`
- **THEN** the Gate SHALL stop without a verdict and SHALL add nothing to the pool

### Requirement: A Gate needs a change under src/

Before starting any Run, the Gate SHALL compare the two commits' trees under `src/`. When they are identical, it SHALL state that the change does not touch `src/` and stop, with no Run, no spend and no change to the pool.

#### Scenario: A docs-only change is not gated

- **WHEN** the base and candidate commits differ only outside `src/`
- **THEN** the Gate SHALL start no Run and SHALL state that no Gate is needed

### Requirement: The Gate's Lapse count adds three routes

A Run's Lapses per Run, in the Gate, SHALL be the sum of its Re-fetch Lapses, its recall Pulls and its failed-Probe Lapses, each in total. Left Revisits SHALL NOT be added, because the fetch that makes a Revisit left can also be a Re-fetch. Re-fetches unknown, recall Pulls unknown and failed Probes unknown SHALL NOT be added.

#### Scenario: Three routes add up

- **WHEN** a complete Run has 13 Re-fetch Lapses, 6 recall Pulls, 6 failed-Probe Lapses, 2 left Revisits and 1 recall Pull unknown
- **THEN** its Lapses per Run in the Gate SHALL be 25

### Requirement: Each complete pair gives two differences

For each pair whose two Runs both completed every Turn, the Gate SHALL compute:
- the cost difference, the natural log of the candidate's Cost per Run minus the natural log of the base's;
- the Lapse difference, the candidate's Lapses per Run minus the base's.

A pair with an incomplete Run SHALL be void. Its Runs SHALL count toward the Gate's spend but not toward the pairs of a look, and another pair SHALL replace it while the cap allows.

#### Scenario: A void pair is replaced

- **WHEN** the base Run of the third pair fails at Turn 12 during the first look
- **THEN** that pair SHALL contribute no difference, its two Runs' cost SHALL count as spend, and a further pair SHALL be started

### Requirement: Variance is pooled across batches with the same key

A batch SHALL be the complete pairs of one A/A run or one Gate. The pool SHALL keep every batch's per-pair Costs per Run and Lapses per Run, keyed by Workload name and version, model id and omp version. It SHALL be stored in the repository. For each gated Measure, the pooled variance SHALL be computed over every stored batch with the current key and the current Gate's own complete pairs. It is the sum over batches of (pairs − 1) times the batch's sample variance of the differences, divided by the sum of (pairs − 1), and that sum SHALL be the degrees of freedom. A batch of fewer than 2 complete pairs SHALL add nothing. A Gate whose key has no stored A/A batch SHALL stop before starting any Run and SHALL name the command that runs one.

#### Scenario: A batch under another omp version is not pooled

- **WHEN** the pool holds an A/A batch under `omp/18.11.0` and the Gate runs under `omp/18.12.0`
- **THEN** the Gate SHALL start no Run and SHALL state that no A/A batch exists for its key

#### Scenario: Pooled degrees of freedom

- **WHEN** the key has an A/A batch of 5 pairs and an earlier Gate batch of 10 pairs, and the current Gate has 5 complete pairs
- **THEN** the pooled variance SHALL have 4 + 9 + 4 = 17 degrees of freedom

### Requirement: An A/A batch seeds the pool

The Gate SHALL offer an A/A mode that runs 5 complete pairs of one commit, the same commit on both sides, under the Gate's cap for its first look. It SHALL add them to the pool as an A/A batch and report each Measure's sample standard deviation of differences, and the cost difference's as a coefficient of variation. It SHALL give no verdict.

#### Scenario: An A/A batch is stored

- **WHEN** an A/A run of commit `X` completes 5 pairs
- **THEN** the pool SHALL gain one A/A batch of 5 pairs under the current key, with `X` on both sides

### Requirement: Each look tests both Measures

The Gate SHALL look after 5 complete pairs and, if the first look decides nothing, after 10. At look *k* with *n* complete pairs, the one-sided level α*k* SHALL be 0.0088 at the first look and 0.0467 at the second (O'Brien–Fleming, overall one-sided α = 0.05). For each gated Measure, with mean difference *d̄*, pooled standard deviation *s* and degrees of freedom *df*, the standard error SHALL be *s* / √*n*, and the critical value *c* SHALL be the Student t quantile at 1 − α*k* with *df* degrees of freedom.

- **Fail tests.** Cost's fail test SHALL have p-value P(T*df* ≥ *d̄* / SE). The Lapse fail test SHALL have the same form. Holm's correction SHALL apply across the two: the smaller p-value is rejected when at most α*k* / 2, and the larger, only after the smaller is rejected, when at most α*k*. The Gate SHALL fail when either is rejected.
- **Pass test.** Cost SHALL be non-inferior when exp(*d̄* + *c* · SE) < 1.10. The Gate SHALL pass when it does not fail and Cost is non-inferior. The Lapse test SHALL never be needed for a pass.
- **Neither.** At the first look, the Gate SHALL go on to the second. At the second, the verdict SHALL be inconclusive.

A standard error of zero SHALL give a p-value of 0 when *d̄* > 0, and 1 otherwise.

#### Scenario: Forgetting fails a cheaper change

- **WHEN** at a look Cost is non-inferior, and the Lapse fail test is rejected under Holm's correction
- **THEN** the verdict SHALL be fail

#### Scenario: Holm's correction holds back two marginal rises

- **WHEN** at the second look the Cost fail test has p = 0.030 and the Lapse fail test p = 0.040
- **THEN** neither SHALL be rejected, since 0.030 exceeds 0.0467 / 2, and the Gate SHALL NOT fail

#### Scenario: A clear pass stops at the first look

- **WHEN** at the first look neither fail test is rejected and exp(*d̄* + *c* · SE) for Cost is 1.06
- **THEN** the verdict SHALL be pass, and no further pair SHALL start

#### Scenario: Undecided after both looks

- **WHEN** at the second look neither fail test is rejected and exp(*d̄* + *c* · SE) for Cost is 1.14
- **THEN** the verdict SHALL be inconclusive

### Requirement: Spend is capped

The Gate's spend SHALL be the sum of Cost per Run over every Run it started, void pairs included. No pair SHALL start once spend has reached $45 before the first look, or $90 in total. A look that cannot reach its pairs SHALL end the Gate as inconclusive, stating that the cap stopped it. The report SHALL state that spend may exceed the cap by the pairs already running when it was reached.

#### Scenario: Voids exhaust the cap

- **WHEN** void pairs bring spend to $45.20 with 4 complete pairs before the first look
- **THEN** no further pair SHALL start, and the verdict SHALL be inconclusive, stopped by the cap

### Requirement: A Gate measures Needed share only when asked

With `--ablate`, once the Gate has its verdict, Ablation SHALL run on each side's complete Runs, drawing 10 units per side spread across them. Each side SHALL have its own cap of $10. Ablation spend SHALL be reported apart from the Gate's spend and SHALL not count toward the Gate's cap. Needed share SHALL never change the verdict. Without `--ablate`, no Ablation SHALL run.

#### Scenario: A Gate with Ablation

- **WHEN** a Gate run with `--ablate` passes after 5 pairs
- **THEN** each side SHALL get up to 10 judged units from its 5 complete Runs
- **AND** the verdict SHALL be the one reached before Ablation ran

#### Scenario: Ablation spend stays outside the Gate's cap

- **WHEN** a Gate's Runs cost $44 and its Ablation costs $6
- **THEN** the report SHALL state $44 against the Gate's cap and $6 of Ablation apart

### Requirement: Every Gate leaves a record and a report

Every Gate and A/A run SHALL write to its output folder each Run's record, under `runs/base-<i>/` and `runs/candidate-<i>/`, and `gate.json`. `gate.json` SHALL hold both commits, the key, every pair with its Runs' Cost per Run, Lapses per Run and completeness, the spend, each look's figures and the verdict. Once a Gate reaches a verdict, including inconclusive, or an A/A run completes, its complete pairs SHALL be added to the pool, provided there are at least 2. The report SHALL give:
- the verdict, the look it was reached at, and the key;
- for each look: the pairs, the geometric-mean cost ratio exp(*d̄*) with its one-sided bounds exp(*d̄* ± *c* · SE), the mean Lapse difference with its lower bound, both p-values and Holm's decision;
- the spend against the cap;
- for each side over its complete Runs: Pass rate, Cost per Pass, Re-fetches held, left and unknown, Pulls per tool, and Retention per Probe and by distance band;
- for each side, Needed share with its Wilson 95% interval and judged units, plus the Ablation spend, when the Gate ran with `--ablate`; "not measured" otherwise;
- Utilisation as "not measured".

The report SHALL be re-printable from the output folder alone, with no Run and no model Call.

#### Scenario: Re-printing a Gate

- **WHEN** the report is asked for from a finished Gate's output folder
- **THEN** it SHALL print the same verdict and figures, start no Run and leave the pool unchanged

#### Scenario: An inconclusive Gate still adds to the pool

- **WHEN** a Gate ends inconclusive after 10 complete pairs
- **THEN** the pool SHALL gain one Gate batch of 10 pairs under its key

#### Scenario: Re-printing a Gate that ran Ablation

- **WHEN** the report is asked for from the output folder of a Gate run with `--ablate`
- **THEN** it SHALL print each side's Needed share from the Runs' ablation records, with no model Call
