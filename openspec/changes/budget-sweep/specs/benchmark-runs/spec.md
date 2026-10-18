## MODIFIED Requirements

### Requirement: Every Run leaves a self-contained record

Each Run SHALL leave a record folder holding:
- the Arm and Run index;
- the Workload's name, version and commit;
- the model id the Conversation ran on, the thinking level it was given, if any, and the omp version;
- for a pi-chart Run, the commit of the pi-chart tree it loaded, when that tree matched the commit under `src/`;
- the Workload's Plants as declared, with kind, earlier value and files;
- the Workload's Revisits as declared;
- the prompt of each Turn in order, with the Plants it probes and whether it forbids tools;
- each graded step's outcome;
- for each Revisit's file, the first Turn after which the workspace's copy no longer matched `overlay/`, if any;
- the first Turn that failed to complete, if any;
- copies of the Run's main and subagent Journals;
- for a pi-chart Run, the Accounting of every Call.
- every tunable Budget variable in the Run's environment, with its value, whether it came from the Run's spec or from the environment the benchmark was started in.

A Turn that fails to complete SHALL end the Run, and the record SHALL still be written.

#### Scenario: A record outlives the workspace and the store

- **WHEN** a pi-chart Run has ended and its workspace and Thread Store database are gone
- **THEN** its record folder SHALL still hold its Journals, its Accounting, its check outcomes and its model id

#### Scenario: A failed Turn is recorded

- **WHEN** the fifth Turn of a Run exits non-zero
- **THEN** no further Turn of that Run SHALL be sent
- **AND** the record SHALL name the fifth Turn as failed

#### Scenario: The record keeps what Retention is scored by

- **WHEN** a Run of a Workload with a superseded Plant and a Probe that forbids tools has ended
- **THEN** its record SHALL hold that Plant's kind, value and earlier value, and that Probe's tools flag, without the Workload folder being read again

#### Scenario: The record keeps what a Revisit is scored by

- **WHEN** a Run of a Workload with a Revisit of `notes/scale.md` has ended, and the agent changed that file during Turn 2
- **THEN** its record SHALL hold the Revisit as declared, and Turn 2 as the first Turn after which `notes/scale.md` no longer matched `overlay/`, without the Workload folder or the workspace being read again

#### Scenario: An untouched Revisit file records no edit

- **WHEN** a Run ends and no Turn changed a Revisit's file
- **THEN** its record SHALL name no Turn for that file

#### Scenario: A Gate side's Run names its commit

- **WHEN** a Gate's candidate-side pi-chart Run ends
- **THEN** its record SHALL name the candidate commit as the pi-chart commit it loaded

#### Scenario: A benchmark from an edited tree names no commit

- **WHEN** a benchmark's pi-chart Run loads a tree with uncommitted changes under `src/`
- **THEN** its record SHALL name no pi-chart commit

#### Scenario: A sweep Run names its Budgets

- **WHEN** a sweep Run of the cell `PICHART_TAIL_TOKENS=40000`, `PICHART_TAIL_LOW_WATER=0.4` ends
- **THEN** its record SHALL name those two variables with those values, and no other tunable Budget variable

#### Scenario: A Run at the defaults names no Budget

- **WHEN** a benchmark is started with no tunable Budget variable set and its Run ends
- **THEN** its record SHALL name no Budget variable
