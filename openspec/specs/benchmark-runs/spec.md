# benchmark-runs Specification

## Purpose
Running a frozen Workload against an Arm so that every Run starts from the same bytes, shares nothing with another Run or with the user's own stores, and leaves a self-contained record that Measures can be computed from after the fact.

## Requirements

### Requirement: A Workload is a versioned folder

A Workload SHALL be a folder `bench/workloads/<name>/` whose `workload.json` gives its name, a version, the commit its workspace is built from, the Plants it states, the Revisits it makes, and an ordered list of steps. Each step SHALL have an id unique within the Workload and one or more prompts. A prompt SHALL be text, optionally naming the Plants it probes and optionally declaring that it forbids tools. The folder MAY also hold an `overlay/` tree, a `checks/` folder with at most one `<step-id>.check.ts` per step, a `bundle/` folder and a `graphify-out/` folder.

Each Plant SHALL have an id, a value and a kind. The kind SHALL be one of three:
- **literal**: the value is the answer. A Plant that declares no kind SHALL be a literal.
- **superseded**: the value is the answer, and the Plant also declares the earlier value it replaces.
- **constraint**: the value is what the agent must later put into its own actions.

A Plant SHALL be placed in one of two ways:
- **In a prompt**: when it declares no file.
- **In a tool result**: when it declares a file under `overlay/` holding its value. A superseded Plant placed in a tool result SHALL also declare a file holding its earlier value.

Each Revisit SHALL have an id unique among the Workload's Revisits, and SHALL name:
- the file it revisits, as a path under `overlay/`;
- the earlier step whose prompts first send the agent to that file;
- the step that needs the file's content again.

A Workload that declares no Revisits SHALL make none.

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
- a prompt that forbids tools probes a constraint Plant;
- a Revisit lacks an id, a file, an earlier step or a step, or two Revisits share an id;
- a Revisit names a step the Workload does not declare, or its earlier step does not come before its step;
- a Revisit's step has no check;
- a Revisit's file is missing from `overlay/`;
- no prompt of a Revisit's earlier step names its file.

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

#### Scenario: A Revisit loads

- **WHEN** a Workload declares a Revisit of `notes/scale.md` with earlier step `add-scale` and step `add-shift`, `add-scale` comes first and has a prompt naming `notes/scale.md`, `overlay/notes/scale.md` exists, and `checks/` holds `add-shift.check.ts`
- **THEN** the Workload SHALL load with that Revisit

#### Scenario: A Revisit of an ungraded step is rejected

- **WHEN** a Revisit's step has no check in `checks/`
- **THEN** the benchmark SHALL stop before any Run starts, naming the Revisit and its step

#### Scenario: A Revisit whose earlier step never names the file is rejected

- **WHEN** no prompt of a Revisit's earlier step contains the Revisit's file path
- **THEN** the benchmark SHALL stop before any Run starts, naming the Revisit and its file

#### Scenario: A Revisit out of order is rejected

- **WHEN** a Revisit's earlier step comes after its step, or is its step
- **THEN** the benchmark SHALL stop before any Run starts, naming the Revisit and both steps

### Requirement: Every Run starts from the Workload's pinned workspace

Each Run SHALL get a fresh workspace built from the Workload's commit, with every tracked file except those under `bench/`. The Workload's `overlay/` tree SHALL then be copied over it, and its `graphify-out/` folder, if any, SHALL be placed at the workspace root. The workspace's dependencies SHALL be installed from its own lockfile. Every Run of one Workload SHALL therefore start from the same bytes whichever Arm it belongs to and whatever this repository's `HEAD` is. The pi-chart under test SHALL be the extension from the checkout running the benchmark, not the one in the workspace.

#### Scenario: Both Arms start from the same tree

- **WHEN** one Run of each Arm is started on the same Workload
- **THEN** both workspaces SHALL hold the same files with the same contents before the first Turn

#### Scenario: Overlay files replace pinned ones

- **WHEN** the Workload's `overlay/src/x.ts` differs from `src/x.ts` at the Workload's commit
- **THEN** the workspace SHALL hold the overlay's version of `src/x.ts`

#### Scenario: Workloads and checks stay out of the workspace

- **WHEN** a Run's workspace has been built
- **THEN** it SHALL hold no `bench/` folder and none of the Workload's check files

### Requirement: Runs are isolated from each other and from the user's stores

Each pi-chart Run SHALL use its own Thread Store database, created and migrated before the Run's first Turn and dropped only after the Run's Accounting has been written to its record. Each Run SHALL use its own copy of the Workload's `bundle/` folder as the doc bundle, empty when the Workload has none. No Run SHALL read or write the user's own Thread Store database or bundle. The address of a Run's Thread Store database SHALL reach pi-chart alone: no command the agent runs SHALL find it in its environment.

#### Scenario: A pi-chart Run's store is migrated before it starts

- **WHEN** a pi-chart Run starts
- **THEN** its Thread Store database SHALL already be migrated when the first Turn's first Call is made

#### Scenario: A Run's store is dropped after its Accounting is kept

- **WHEN** a pi-chart Run ends, whether or not every Turn completed
- **THEN** its record SHALL hold the Accounting of every Call the Run made
- **AND** its Thread Store database SHALL no longer exist

#### Scenario: Bundle writes stay inside the Run

- **WHEN** a Run's Conversation writes a Concept to the doc bundle
- **THEN** the Workload's `bundle/` folder and the user's bundle SHALL be unchanged

#### Scenario: The agent's store tests cannot reach the Run's store

- **WHEN** a pi-chart Run's agent runs pi-chart's own store tests, which truncate the database `PICHART_DATABASE_URL` names
- **THEN** the Run's Thread Store database SHALL be untouched, and its record SHALL hold the Accounting of every Call the Run made

### Requirement: Every prompt is sent as written

Each Turn SHALL send its prompt's text exactly as the Workload states it, with nothing appended or removed, to every Arm. A Run SHALL be one Conversation: the second and later Turns SHALL continue the first Turn's Conversation.

#### Scenario: Prompts reach both Arms byte for byte

- **WHEN** a Workload prompt ends with "Do not modify any files and do not spawn subagents."
- **THEN** the user message of that Turn in each Arm's Journal SHALL equal the prompt text exactly

### Requirement: A graded step is checked after its last prompt

A step whose id has a check in `checks/` SHALL be a Graded Task. After the Turn of the step's last prompt completes, the check SHALL be copied into the workspace, run with `bun test`, and removed again before the next Turn starts. The step SHALL be a Pass when the check exits zero within its time limit, and a Fail otherwise. A Fail SHALL NOT stop the Run, and the workspace SHALL NOT be repaired between steps. A step whose last prompt was not reached SHALL not be checked.

#### Scenario: A failing check does not stop the Run

- **WHEN** a Run's first graded step fails its check
- **THEN** the Run SHALL continue with the next step's prompts in the same workspace
- **AND** the record SHALL hold a Fail for the first step

#### Scenario: A check is invisible to the Conversation

- **WHEN** any Turn of a Run is running
- **THEN** no check file SHALL be present in the workspace

#### Scenario: A step cut short is not graded

- **WHEN** a benchmark is limited to fewer Turns than a graded step's last prompt needs
- **THEN** the record SHALL hold no outcome for that step

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
- for a pi-chart Run, every tunable Budget variable in the Run's environment, with its value, whether it came from the Run's spec or from the environment the benchmark was started in.

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
