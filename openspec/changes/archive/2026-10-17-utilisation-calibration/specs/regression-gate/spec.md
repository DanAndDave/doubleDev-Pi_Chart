## MODIFIED Requirements

### Requirement: Every Gate leaves a record and a report

Every Gate and A/A run SHALL write to its output folder each Run's record, under `runs/base-<i>/` and `runs/candidate-<i>/`, and `gate.json`. `gate.json` SHALL hold both commits, the key, every pair with its Runs' Cost per Run, Lapses per Run and completeness, the spend, each look's figures and the verdict. Once a Gate reaches a verdict, including inconclusive, or an A/A run completes, its complete pairs SHALL be added to the pool, provided there are at least 2. The report SHALL give:
- the verdict, the look it was reached at, and the key;
- for each look: the pairs, the geometric-mean cost ratio exp(*d̄*) with its one-sided bounds exp(*d̄* ± *c* · SE), the mean Lapse difference with its lower bound, both p-values and Holm's decision;
- the spend against the cap;
- for each side over its complete Runs: Pass rate, Cost per Pass, Re-fetches held, left and unknown, Pulls per tool, and Retention per Probe and by distance band;
- for each side, Needed share with its Wilson 95% interval and judged units, plus the Ablation spend, when the Gate ran with `--ablate`; "not measured" otherwise;
- for each side, the PPI Needed share over its complete Runs with its interval, when the key's calibration set has κ of at least 0.4; "uncalibrated" otherwise, whether or not the Gate ran with `--ablate`;
- for each side, the median Utilisation per Run over its complete Runs, labelled with its calibration, recomputed from the Runs' records.

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

#### Scenario: Re-printing a Gate gives each side's Utilisation

- **WHEN** the report is asked for from the output folder of a Gate whose Runs were recorded before Utilisation existed, under a key with no calibration set
- **THEN** it SHALL print each side's median Utilisation per Run, labelled "uncalibrated", recomputed from the Runs' records with no model Call

#### Scenario: A calibrated Gate gives PPI without Ablation

- **WHEN** the report is asked for from a Gate run without `--ablate`, whose key's calibration set has κ 0.52
- **THEN** it SHALL print "not measured" for each side's Needed share, and each side's PPI Needed share with its interval
