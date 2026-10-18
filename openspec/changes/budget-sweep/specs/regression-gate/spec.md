## MODIFIED Requirements

### Requirement: Variance is pooled across batches with the same key

A batch SHALL be the complete pairs of one A/A run, one Gate, or one Budget sweep's confirm. The pool SHALL keep every batch's per-pair Costs per Run and Lapses per Run, keyed by Workload name and version, model id and omp version. It SHALL be stored in the repository. For each gated Measure, the pooled variance SHALL be computed over every stored batch with the current key and the current Gate's own complete pairs. It is the sum over batches of (pairs − 1) times the batch's sample variance of the differences, divided by the sum of (pairs − 1), and that sum SHALL be the degrees of freedom. A batch of fewer than 2 complete pairs SHALL add nothing. A Gate whose key has no stored A/A batch SHALL stop before starting any Run and SHALL name the command that runs one.

#### Scenario: A batch under another omp version is not pooled

- **WHEN** the pool holds an A/A batch under `omp/18.11.0` and the Gate runs under `omp/18.12.0`
- **THEN** the Gate SHALL start no Run and SHALL state that no A/A batch exists for its key

#### Scenario: Pooled degrees of freedom

- **WHEN** the key has an A/A batch of 5 pairs and an earlier Gate batch of 10 pairs, and the current Gate has 5 complete pairs
- **THEN** the pooled variance SHALL have 4 + 9 + 4 = 17 degrees of freedom

#### Scenario: A sweep's confirm joins the held-out key's pool

- **WHEN** a sweep's confirm ends with 7 complete pairs on `gate-holdout` v1
- **THEN** the pool SHALL gain one confirm batch of 7 pairs under the `gate-holdout` v1 key, and a later confirm under that key SHALL pool it


## ADDED Requirements

### Requirement: A Gate never runs a held-out Workload

A Gate SHALL refuse, before any Run, a Workload whose name ends in `-holdout`. An A/A run SHALL accept one, since a Budget sweep's confirm needs an A/A batch under the held-out key.

#### Scenario: The Gate refuses the held-out Workload

- **WHEN** a Gate is started with `--workload gate-holdout` and without `--aa`
- **THEN** it SHALL start no Run and SHALL state that a held-out Workload is run only by A/A and a sweep's confirm

#### Scenario: A/A seeds the held-out key

- **WHEN** an A/A run is started with `--workload gate-holdout`
- **THEN** it SHALL run its 5 pairs and add an A/A batch under the `gate-holdout` key
