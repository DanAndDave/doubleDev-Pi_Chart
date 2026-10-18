## ADDED Requirements

### Requirement: The Used rule is calibrated against Needed per key

A calibration SHALL give every tail and summary unit of a calibration set judged Needed or not Needed a Used verdict at each cell of *s* ∈ {6, 8, 12} × *k* ∈ {1, 2, 3}, judged on the unit's own Run and Call exactly as the Measures judge that Run. It SHALL compare those verdicts with the units' Needed verdicts, pooled across Arms, over units judged Needed or not Needed. Unclear units SHALL be excluded, and duplicated units SHALL be kept. Opening, Pin and null units SHALL never be compared.

For each cell it SHALL give Cohen's κ pooled, and per Arm κ, precision (Needed among Used), recall (Used among Needed) and the counts behind them. The chosen cell SHALL be the one with the highest pooled κ. Ties SHALL go to the smaller *s*, then the smaller *k*. A cell whose κ is undefined, because Used or Needed holds a single value across the units, SHALL never be chosen while another cell has a κ.

The chosen cell and its κ SHALL be stored with the set, and SHALL be replaced only when the calibration is run again. A calibration SHALL need no model Call and SHALL run again on the same set at no cost.

The Measures of a Run SHALL use the cell of the set frozen for the Run's key when that cell's κ is at least 0.4. Otherwise, including when the key has no set or the Run's record names no model, they SHALL use *s* = 8 and *k* = 2.

#### Scenario: κ, precision and recall of one cell

- **WHEN** a cell's 100 compared units hold 8 both Used and Needed, 2 Used only, 2 Needed only and 88 neither
- **THEN** its κ SHALL read 0.78, its precision 80% and its recall 80%

#### Scenario: Unclear units are not compared

- **WHEN** a set holds 47 units judged Needed or not Needed and 1 unclear unit, all tool-call groups
- **THEN** each cell's κ SHALL be over 47 units

#### Scenario: A tie goes to the smaller cell

- **WHEN** cells (*s* 8, *k* 1) and (*s* 6, *k* 2) share the highest κ
- **THEN** the chosen cell SHALL be *s* 6, *k* 2

#### Scenario: A calibrated key's Runs use its cell

- **WHEN** a Run's key has a set whose chosen cell is *s* 6, *k* 1 with κ 0.52
- **THEN** the Run's Utilisation SHALL be judged at *s* 6, *k* 1

#### Scenario: A weak calibration keeps the defaults

- **WHEN** a Run's key has a set whose best κ is 0.31 at *s* 12, *k* 3
- **THEN** the Run's Utilisation SHALL be judged at *s* 8, *k* 2

#### Scenario: Calibrating twice changes nothing

- **WHEN** the calibration runs twice on the same set with no change to the rule
- **THEN** the second run SHALL store the same verdicts, cell and κ

### Requirement: The PPI Needed share

For one Arm, the PPI Needed share SHALL estimate Ablation's Needed share over tail and summary units, duplicated units included, from Utilisation and the calibration set of the reported Runs' key:
- **The prediction term:** each reported main Call with a known window and at least one tail or summary unit gives its Used tail-and-summary tokens and its tail-and-summary tokens, each over the tokens of all its units. The term SHALL be the sum of the first over the sum of the second. This is the Used share of a unit drawn the way Ablation draws: a uniform Call, then a unit in proportion to its tokens, kept only when it is a tail or summary unit. A Call with no tail or summary unit would add 0 to both sums, so it is left out.
- **The correction:** the mean of (Used − Needed) over the Arm's compared calibration units at the set's chosen cell, with Used and Needed as 1 or 0.
- **The estimate:** the prediction term minus the correction, with a 95% interval from the variance of both terms, each clamped to 0–100%.

It SHALL be given only when the set's κ is at least 0.4, and the reported Runs all hold the set's key, and the Arm has at least 2 compared calibration units, and the reported Runs have at least 2 such Calls. It SHALL be labelled "PPI" and never shown as Ablation's own Needed share.

#### Scenario: The prediction term is weighted the way Ablation draws

- **WHEN** an Arm's two reported Calls hold 2,000 and 1,000 tokens of units, of which 1,000 and 1,000 are tail, with 500 and 0 Used
- **THEN** the prediction term SHALL be 16.7%, not the 25% of Used over tail tokens

#### Scenario: The correction is subtracted

- **WHEN** an Arm's prediction term is 30% and its compared calibration units have a mean (Used − Needed) of 0.10
- **THEN** its PPI Needed share SHALL read 20%

#### Scenario: No PPI share below the κ floor

- **WHEN** the reported Runs' key has a set whose κ is 0.31
- **THEN** no PPI Needed share SHALL be given

## RENAMED Requirements

- FROM: `### Requirement: Utilisation is reported raw and uncalibrated`
- TO: `### Requirement: Utilisation is reported raw and labelled by its calibration`

## MODIFIED Requirements

### Requirement: Utilisation is reported raw and labelled by its calibration

The Measures script SHALL print a Run's Utilisation, in total and by unit kind, with the counts of measured, excluded and unknown Calls. The benchmark report SHALL give, for each Arm, the median Utilisation per Run over its complete Runs, in total and by unit kind. A kind an Arm cannot hold SHALL read "n/a" for that Arm: Pull result on plain omp, summary on pi-chart.

Every Run's Measures SHALL record the *s* and *k* its Utilisation was judged at, and the κ when the cell came from a set with κ of at least 0.4. Every report that shows Utilisation SHALL label it with that κ and cell, as `κ 0.52, s 6, k 1`, when every Run it covers was judged at the same calibrated cell. Otherwise it SHALL label it "uncalibrated". It SHALL never label Utilisation as Needed, nor put it in a Needed row. It SHALL state three caveats:
- Utilisation is lexical, so Used is not Needed;
- earlier tool results of a Call's own Turn are never measured;
- items found in the system prompt outside the Opening and Pins are not excluded, since the record does not hold that text.

A report read from a record measured before Utilisation existed SHALL show no figure for it, rather than zero. A record measured before calibration existed SHALL count as judged at *s* = 8, *k* = 2, uncalibrated.

#### Scenario: Both Arms in one report

- **WHEN** a benchmark of both Arms ends, on a Workload with no calibration set
- **THEN** its report SHALL give each Arm's median Utilisation per Run labelled "uncalibrated", with Pull result reading "n/a" for plain omp and summary reading "n/a" for pi-chart

#### Scenario: A calibrated Run is labelled with its κ

- **WHEN** the Measures script prints a Run whose key has a set with chosen cell *s* 6, *k* 1 and κ 0.52
- **THEN** its Utilisation SHALL be labelled `κ 0.52, s 6, k 1`, not "uncalibrated"

#### Scenario: An old benchmark is re-printed

- **WHEN** the report is re-printed from a `bench.json` whose Measures predate Utilisation
- **THEN** the Utilisation rows SHALL show no figure, not 0%

#### Scenario: A benchmark measured before calibration is re-printed

- **WHEN** the report is re-printed from a `bench.json` whose Utilisation records no *s* and *k*
- **THEN** its Utilisation SHALL be labelled "uncalibrated"
