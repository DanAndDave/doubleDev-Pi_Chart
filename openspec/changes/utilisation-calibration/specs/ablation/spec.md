## MODIFIED Requirements

### Requirement: Needed share is reported with its interval

For each Arm, Needed share SHALL be the Needed units over judged units (Needed, unclear and not Needed), over units not flagged duplicated, with a Wilson 95% interval. Duplicated units SHALL get the same figures, reported apart. Beside them the report SHALL give:
- the unclear share;
- the unstable share of Calls drawn;
- the counts of unfaithful, unlocated, miscounted and capped units;
- the spend;
- when the Arm has a PPI Needed share: Ablation's own Needed share over tail and summary units judged Needed or not Needed, duplicated included, with its Wilson 95% interval, and beside it the PPI Needed share with its interval, labelled "PPI".

#### Scenario: Needed share of a small sample

- **WHEN** 6 of 20 judged, non-duplicated units are Needed
- **THEN** Needed share SHALL read 30% with a Wilson 95% interval of 14.5% to 51.9%

#### Scenario: PPI beside the measured share

- **WHEN** an Ablation report covers pi-chart Runs whose key has a set with κ 0.52
- **THEN** the pi-chart line SHALL give the tail-and-summary Needed share of the Runs' judged units and, beside it, the PPI Needed share over the same Runs

#### Scenario: No PPI line without a calibrated set

- **WHEN** an Ablation report covers Runs whose key has no calibration set
- **THEN** it SHALL give no PPI Needed share, and SHALL say the key is uncalibrated

### Requirement: A calibration set is frozen per key

A calibration set SHALL hold, for one key (Workload name and version, model, omp version):
- 50 judged units per Arm, each with its content, its Call's original next action, its verdict, and the folder of the Run it came from;
- 20 null units, each with the folder of its Run;
- the positive control.

The records of every Run a set draws from SHALL be committed beside the calibration file, one folder per Run, so that the set's units can be judged again with no model Call. A unit's Arm and Run index SHALL never be used to find its Run.

Once calibrated, each of a set's tail and summary units judged Needed or not Needed SHALL also carry its Used verdict at every cell of the Used rule's grid. The set SHALL carry the chosen cell and its κ.

It SHALL be added to the committed calibration file only when the positive control holds. A key that already has a set SHALL not get a second. A set SHALL never be read for another key.

#### Scenario: A calibration whose control fails

- **WHEN** a calibration's positive control comes out 75% Needed
- **THEN** the calibration file SHALL be left unchanged, no Run folder SHALL be committed, and the report SHALL say why

#### Scenario: Two Runs share an Arm and index

- **WHEN** a set draws from two pi-chart Runs that both have index 0, from different output folders
- **THEN** each of their units SHALL name its own Run's folder, and each SHALL be judged on that Run

#### Scenario: A new set is calibrated when it is made

- **WHEN** a calibration's positive control holds and its set is written
- **THEN** its Runs' records SHALL be copied beside the calibration file, and the set SHALL carry its units' Used verdicts and its chosen cell
