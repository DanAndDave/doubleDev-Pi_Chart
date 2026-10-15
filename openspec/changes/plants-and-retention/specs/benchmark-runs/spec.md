## MODIFIED Requirements

### Requirement: A Workload is a versioned folder

A Workload SHALL be a folder `bench/workloads/<name>/` whose `workload.json` gives its name, a version, the commit its workspace is built from, the Plants it states, and an ordered list of steps. Each step SHALL have an id unique within the Workload and one or more prompts. A prompt SHALL be text, optionally naming the Plants it probes and optionally declaring that it forbids tools. The folder MAY also hold an `overlay/` tree, a `checks/` folder with at most one `<step-id>.check.ts` per step, a `bundle/` folder and a `graphify-out/` folder.

Each Plant SHALL have an id, a value and a kind. The kind SHALL be one of three:
- **literal**: the value is the answer. A Plant that declares no kind SHALL be a literal.
- **superseded**: the value is the answer, and the Plant also declares the earlier value it replaces.
- **constraint**: the value is what the agent must later put into its own actions.

A Plant SHALL be placed in one of two ways:
- **In a prompt**: when it declares no file.
- **In a tool result**: when it declares a file under `overlay/` holding its value. A superseded Plant placed in a tool result SHALL also declare a file holding its earlier value.

A Workload SHALL be rejected, naming the problem, before any Run starts when:
- its `workload.json` is missing a name, version, commit or steps, or is not valid JSON;
- two steps share an id, or a step has no prompts;
- a prompt probes a Plant the Workload does not declare;
- a check file names no step;
- the commit does not resolve in this repository;
- a Plant's kind is not one of the three, a superseded Plant declares no earlier value or one equal to its value, or a Plant of another kind declares one;
- one Plant's value or earlier value contains, or is contained in, another value or earlier value of the Workload;
- a Plant placed in a prompt has its value in no prompt or in more than one;
- a superseded Plant placed in a prompt has its earlier value first in no prompt before the one holding its value, or in any prompt after that one;
- a Plant placed in a tool result has its value or earlier value in any prompt, a declared file is missing from `overlay/` or lacks the value it is declared to hold, or no prompt before the Plant's first Probe names that file;
- a superseded Plant placed in a tool result has no prompt naming its earlier value's file before the first prompt naming its value's file;
- a Probe comes before or at the prompt that states the Plant it probes;
- a prompt that forbids tools probes a constraint Plant.

#### Scenario: A well-formed Workload loads

- **WHEN** a benchmark is started with a Workload whose `workload.json` declares a name, version, commit, one Plant and two steps, one prompt of which probes that Plant, and `checks/` holds a check for the first step
- **THEN** the benchmark SHALL start its Runs with the first step graded and the second not graded

#### Scenario: A Probe of an undeclared Plant is rejected

- **WHEN** a prompt probes a Plant id the Workload does not declare
- **THEN** the benchmark SHALL stop before any Run starts, naming the step and the unknown Plant id

#### Scenario: An orphan check is rejected

- **WHEN** `checks/` holds `step-9.check.ts` and no step has the id `step-9`
- **THEN** the benchmark SHALL stop before any Run starts, naming the orphan check

#### Scenario: A Plant with no kind is a literal

- **WHEN** a Workload declares a Plant with only an id and a value, and one prompt holds that value
- **THEN** the Workload SHALL load with that Plant as a literal placed in that prompt

#### Scenario: Every kind and placement loads

- **WHEN** a Workload declares a literal in a prompt, a superseded Plant whose earlier value is in one prompt and whose value is in a later prompt, and a constraint in an overlay file that an earlier prompt names, and each is probed after it is stated
- **THEN** the Workload SHALL load

#### Scenario: A value that leaks into a Probe is rejected

- **WHEN** a prompt-placed Plant's value appears in the prompt that states it and again in a later Probe
- **THEN** the benchmark SHALL stop before any Run starts, naming the Plant and saying its value is in more than one prompt

#### Scenario: A tool-result Plant whose file lacks the value is rejected

- **WHEN** a Plant declares the file `notes/ports.md`, and `overlay/notes/ports.md` does not hold the Plant's value
- **THEN** the benchmark SHALL stop before any Run starts, naming the Plant and the file

#### Scenario: Overlapping values are rejected

- **WHEN** one Plant's value is `7341` and another's is `73412`
- **THEN** the benchmark SHALL stop before any Run starts, naming both Plants

#### Scenario: A constraint cannot be probed without tools

- **WHEN** a prompt that forbids tools probes a constraint Plant
- **THEN** the benchmark SHALL stop before any Run starts, naming the step and the Plant

### Requirement: Every Run leaves a self-contained record

Each Run SHALL leave a record folder holding:
- the Arm and Run index;
- the Workload's name, version and commit;
- the model id the Conversation ran on and the omp version;
- the Workload's Plants as declared, with kind, earlier value and files;
- the prompt of each Turn in order, with the Plants it probes and whether it forbids tools;
- each graded step's outcome;
- the first Turn that failed to complete, if any;
- copies of the Run's main and subagent Journals;
- for a pi-chart Run, the Accounting of every Call.

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
