## ADDED Requirements

### Requirement: A Gate measures Needed share only when asked

With `--ablate`, once the Gate has its verdict, Ablation SHALL run on each side's complete Runs, drawing 10 units per side spread across them. Each side SHALL have its own cap of $10. Ablation spend SHALL be reported apart from the Gate's spend and SHALL not count toward the Gate's cap. Needed share SHALL never change the verdict. Without `--ablate`, no Ablation SHALL run.

#### Scenario: A Gate with Ablation

- **WHEN** a Gate run with `--ablate` passes after 5 pairs
- **THEN** each side SHALL get up to 10 judged units from its 5 complete Runs
- **AND** the verdict SHALL be the one reached before Ablation ran

#### Scenario: Ablation spend stays outside the Gate's cap

- **WHEN** a Gate's Runs cost $44 and its Ablation costs $6
- **THEN** the report SHALL state $44 against the Gate's cap and $6 of Ablation apart

## MODIFIED Requirements

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
