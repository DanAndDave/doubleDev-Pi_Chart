## Purpose

Running EvoCode-Bench tasks on both Arms, so the comparison report can check pi-chart on multi-round tasks written by people outside this project, and choosing which of those tasks make pi-chart evict.

## ADDED Requirements

### Requirement: Tasks come from a pinned dataset revision and are never committed

EvoCode tasks SHALL be taken from the Hugging Face dataset `UnipatAI/EvoCodeBench` at the revision `bench/evocode/subset.json` names, from the task archive it names. The archive SHALL be accepted only when its SHA-256 equals the one `subset.json` names. Fetched tasks SHALL be kept in a cache outside this repository and reused while the revision and hash are unchanged. Nothing taken from the dataset SHALL be committed to this repository: no task file, and no Run record holding task text. `subset.json` SHALL name the dataset, its revision, its licence (CC BY-NC 4.0) and the paper the dataset comes from.

#### Scenario: A cached revision is reused

- **WHEN** an EvoCode Run starts and the cache already holds the tasks of the pinned revision
- **THEN** nothing SHALL be downloaded

#### Scenario: A changed archive is refused

- **WHEN** the downloaded archive's SHA-256 differs from the one `subset.json` names
- **THEN** no Run SHALL start, and the error SHALL name the expected and the actual hash
- **AND** the cache SHALL hold nothing from that download

### Requirement: An EvoCode Run sends each round as one Turn of one Conversation

An EvoCode Run SHALL run one task on one Arm, in a fresh container built from the task's own environment, through Harbor. Each round SHALL be one Turn whose prompt is the round's instruction, sent byte for byte as the task states it, to every Arm. The second and later Turns SHALL continue the first Turn's Conversation. The workspace SHALL persist from round to round, as the task defines it.

Each round SHALL be a Graded Task, identified by the round's name. After the round's Turn completes, the task's verifier for that round SHALL run, and the round SHALL be a Pass when its reward is 1 and a Fail otherwise. A Fail SHALL NOT stop the Run, and the workspace SHALL NOT be repaired between rounds.

The plain-omp Arm SHALL run omp with no extension. The pi-chart Arm SHALL run the same omp with only this checkout's pi-chart loaded. Both Arms SHALL run the same omp version as the benchmark host, on the model and thinking level the Run is given, with omp's own default settings and none of the user's. No tunable Budget variable SHALL reach the Run, so every EvoCode Run runs pi-chart at its default Budgets.

#### Scenario: Rounds reach both Arms byte for byte

- **WHEN** one Run of each Arm has run the same task
- **THEN** the user message of each Turn in each Arm's main Journal SHALL equal that round's instruction exactly

#### Scenario: Later rounds continue the Conversation

- **WHEN** an EvoCode Run of a task with 8 rounds completes
- **THEN** its main Journal SHALL hold 8 Turns of one Conversation

#### Scenario: A failed round does not stop the Run

- **WHEN** a Run's round 2 verifier gives reward 0
- **THEN** round 3's Turn SHALL be sent in the same workspace
- **AND** the record SHALL hold a Fail for round 2

#### Scenario: The user's omp settings stay out

- **WHEN** an EvoCode Run starts on a host whose omp settings change its defaults
- **THEN** the Run's omp SHALL read none of those settings, and its Journals SHALL be written outside the user's session folder

#### Scenario: A Run limited to fewer rounds

- **WHEN** an EvoCode Run of an 8-round task is limited to 2 rounds
- **THEN** only rounds 1 and 2 SHALL be sent and graded, and the record SHALL hold those 2 prompts and their outcomes

### Requirement: A failed Turn ends an EvoCode Run

A Turn that does not complete SHALL end the Run: omp exiting non-zero, or the round's time limit passing. No later round's Turn SHALL be sent. The record SHALL name that Turn as failed and SHALL hold no outcome for its round or any later round, even when the task's verifier ran for them.

#### Scenario: A round that times out ends the Run

- **WHEN** round 4 of a Run reaches the task's time limit before omp exits
- **THEN** no Turn SHALL be sent for rounds 5 and later
- **AND** the record SHALL name the fourth Turn as failed, and hold outcomes for rounds 1 to 3 only

### Requirement: Admission keeps only tasks that make pi-chart evict

Admission SHALL run one pi-chart Run per candidate task that `subset.json` lists, on the reference model at the default thinking level, at most 2 at a time. It SHALL start no Run once the admission Runs' summed cost reaches $60, and Runs already started SHALL finish. Each candidate SHALL get one status in `subset.json`:
- **admitted**: its Run completed every round, and at least one main Call's Context Window left out an earlier Turn of the Conversation;
- **no eviction**: its Run completed every round, and every main Call's Context Window carried every earlier Turn;
- **failed Turn**: its Run did not complete, naming the Turn;
- **unknown**: its Run completed, and no main Call that could show an Eviction has a window the record can say;
- **not run**: the cap was reached before its Run started.

Beside each status `subset.json` SHALL give the task's round count and, for a task whose Run started, the Run's cost and Passes. Admission SHALL refuse to start, naming the problem, when `src/` has uncommitted changes, when Harbor or Docker cannot run, or when no Thread Store server is configured.

#### Scenario: A task that evicts is admitted

- **WHEN** a candidate's admission Run completes all 8 rounds, and a Call of Turn 3 carried Turn 2 but not Turn 1
- **THEN** `subset.json` SHALL list that task as admitted, with 8 rounds, the Run's cost and its Passes

#### Scenario: A task that never evicts is left out

- **WHEN** a candidate's admission Run completes, and every main Call carried every earlier Turn
- **THEN** `subset.json` SHALL list that task as `no eviction`

#### Scenario: The cap stops further admission Runs

- **WHEN** the first three admission Runs have cost $61 in total, and the fourth candidate's Run has not started
- **THEN** that Run SHALL NOT start, and `subset.json` SHALL list the fourth candidate as `not run`

#### Scenario: A dirty tree is refused

- **WHEN** admission is started with uncommitted changes under `src/`
- **THEN** it SHALL stop before any Run, naming the uncommitted `src/`
