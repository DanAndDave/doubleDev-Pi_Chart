## Purpose

Computing Measures after a Run has ended, from its record alone, so that the same code measures every Arm, a Measure can be recomputed on old Runs at no model cost, and the benchmark, the Gate and the comparison report all read the same figures.

## ADDED Requirements

### Requirement: Measures are computed offline from a Run record

Every Measure SHALL be computed from one Run's record folder alone. Computing it SHALL make no model Call and SHALL need neither the Run's workspace nor its Thread Store database. Computing the Measures of the same record twice SHALL give the same figures. The benchmark SHALL compute each Run's Measures with the same code once the Run ends.

#### Scenario: Measures are recomputed from an old record

- **WHEN** the Measures script is run on the record folder of a Run whose workspace and Thread Store database are gone
- **THEN** it SHALL print the same Measures the benchmark reported for that Run

### Requirement: Cost per Run

Cost per Run SHALL be the sum of the cost the provider reported in `usage` over every Call in the Run's main and subagent Journals. The Measures SHALL also give the Run's Call count, uncached input, cache read, cache write and output tokens over the same Calls.

#### Scenario: Subagent Calls count toward the Run's cost

- **WHEN** a Run's main Journal reports Calls costing $1.00 in total and a subagent Journal reports Calls costing $0.25 in total
- **THEN** the Run's Cost per Run SHALL be $1.25

### Requirement: Graded Task outcomes

The Measures SHALL give each graded step's outcome, Pass or Fail, as recorded, the number of Passes, and the first step that failed. Steps with no recorded outcome SHALL be reported as not graded.

#### Scenario: The first failing step is named

- **WHEN** a Run's record holds Pass, Fail, Fail for its three graded steps
- **THEN** the Measures SHALL give 1 Pass and name the second step as the first failing step

### Requirement: Cost per Pass

An Arm's Cost per Pass SHALL be its total Cost per Run over its complete Runs that have at least one graded step, divided by the number of Passes across those Runs. When those Runs have no Pass, Cost per Pass SHALL be reported as having no Pass, not as zero or infinity. When the Workload has no graded step, Cost per Pass SHALL be reported as not applicable.

#### Scenario: Cost per Pass over several Runs

- **WHEN** an Arm has two complete Runs costing $3.00 and $5.00 with 4 and 2 Passes
- **THEN** the Arm's Cost per Pass SHALL be $8.00 / 6

#### Scenario: An ungraded Workload has no Cost per Pass

- **WHEN** the Workload has no check for any step
- **THEN** Cost per Pass SHALL be reported as not applicable

### Requirement: Retention per Plant

For each Probe Turn a Run completed, each Plant that Turn probes SHALL be scored right when the final assistant reply of that Turn in the main Journal contains the Plant's value exactly, and wrong otherwise. An Arm's Retention for a Plant SHALL be the share of its complete Runs that scored that Plant right.

#### Scenario: Each Plant of a Probe is scored separately

- **WHEN** a Probe asks for two Plants and the Turn's final reply contains the first Plant's value and not the second's
- **THEN** the first Plant SHALL be scored right and the second wrong

#### Scenario: A Probe that was never reached is not scored

- **WHEN** a Run failed before its Probe Turn
- **THEN** the Run SHALL contribute no score to any Plant that Probe asks for

### Requirement: Reports exclude incomplete Runs and say so

A report over several Runs SHALL aggregate only Runs that completed every Turn, and SHALL state how many Runs were excluded. It SHALL name the Workload's name and version, the model id and the omp version of the Runs it reports.

#### Scenario: A failed Run is excluded from the aggregate

- **WHEN** three pi-chart Runs are reported and one failed at its fifth Turn
- **THEN** the pi-chart figures SHALL be aggregated over the two complete Runs
- **AND** the report SHALL state that one Run was excluded
