## ADDED Requirements

### Requirement: A Harbor task's Run leaves the same record as a Workload Run

A Run of a Harbor task SHALL leave a record folder in the same format as a Workload Run's, so the Measures are computed from it with no step of their own. In that record:
- the Workload SHALL be the task, named `evocode-<task id>` for an EvoCode task, at version 1, with the dataset revision as its commit;
- each round SHALL be one prompt, belonging to a step named after the round, and probing no Plant;
- each graded round's outcome SHALL be a check outcome for that step;
- there SHALL be no Plants and no Revisits;
- the working directory SHALL be the one the Conversation ran in inside the container;
- the record SHALL also name the Harbor version that ran the task.

Every other field SHALL be as for a Workload Run: Arm, Run index, model id, thinking level, omp version, pi-chart commit, Journals, Accounting and the first failed Turn.

A Harbor task's Run SHALL be isolated as a Workload Run is. A pi-chart Run SHALL use its own Thread Store database, created and migrated before its first Turn, reached by its address alone, and dropped after its Accounting is in its record. Each Run SHALL use its own empty doc bundle. Each Run SHALL start in a fresh container that holds no other Run's files and none of the user's omp sessions, settings or Journals. No command the agent runs SHALL find the Thread Store's address in its environment.

#### Scenario: Measures read a Harbor task's Run unchanged

- **WHEN** a pi-chart Run of an EvoCode task has ended
- **THEN** `bun scripts/measures.ts <its record folder>` SHALL report its Cost per Run, its Pass or Fail per round, and its Lapses and Re-fetches per Run, with Retention reading that no Probe was reached

#### Scenario: The record names the task as its Workload

- **WHEN** a Run of the EvoCode task `theme_d10_w8_ml_ai_mlops_security_patch_hardening` ends
- **THEN** its record SHALL name the Workload `evocode-theme_d10_w8_ml_ai_mlops_security_patch_hardening`, version 1, with the dataset revision as its commit, and the Harbor version

#### Scenario: A Harbor task's store is the Run's own

- **WHEN** a pi-chart Run of an EvoCode task ends, whether or not every round completed
- **THEN** its record SHALL hold the Accounting of every Call the Run made
- **AND** its Thread Store database SHALL no longer exist, and the user's Thread Store database SHALL be unchanged
