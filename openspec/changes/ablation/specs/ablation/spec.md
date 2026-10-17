## Purpose

Ablation decides whether a part of a recorded Call's Context Window was Needed. It replays the Run through omp, cuts one unit from the finished request, resends the request, and compares the next action with the original's against the noise of a sham. It costs model Calls, so it runs apart from the Measures and under a cap.

## ADDED Requirements

### Requirement: A Run is replayed through omp's own code path

A replay SHALL rebuild every main Call of a recorded Run by running the Run's prompts again through omp, with each Call answered by the reply the Journal recorded and each tool call given the result it recorded. Before the replay, the Run's inputs SHALL be recreated:
- the Run's workspace at its recorded path, from its Workload's commit and overlay;
- a fresh copy of the Workload's bundle;
- for a pi-chart Run, the pi-chart tree at the recorded commit and a fresh Thread Store database, migrated before the first Turn.

The replay SHALL pin the original session id and the original Run's local date into every request. It SHALL refuse to start, naming the reason, when:
- the installed omp version differs from the record's;
- the Workload's version differs from the record's;
- a pi-chart Run names no pi-chart commit and none is given;
- the record holds subagent Journals;
- the recorded path is in use.

A replay SHALL send nothing to the model unless a Call is sampled for Ablation. It SHALL leave no workspace, database or Journal of its own behind.

#### Scenario: A free replay check

- **WHEN** the replay check is run on a complete pi-chart Run of the Gate Workload
- **THEN** it SHALL print, for every main Call, the endpoint's count of the rebuilt request minus the Call's `usage` input total (input + cache read + cache write)
- **AND** it SHALL make no model Call

#### Scenario: A record with no pi-chart commit

- **WHEN** a pi-chart Run's record names no pi-chart commit and no commit is given
- **THEN** the replay SHALL refuse before recreating anything, and say that a commit must be given

### Requirement: Only a faithful Call is ablated

A Call SHALL be faithful when the endpoint's count of its rebuilt, unchanged request minus its `usage` input total falls within the offset band measured for byte-identical requests. A Call outside the band SHALL be counted as unfaithful and SHALL receive no resend.

#### Scenario: A Call rebuilt short

- **WHEN** a sampled Call's rebuilt request counts 69 tokens below the band's lower edge
- **THEN** that Call SHALL be counted unfaithful and no resend of it SHALL be made

### Requirement: The units of a Call

A unit SHALL be one part of a main Call's request that lies outside the Call's own Turn. Each kind applies only to the Arms named:

| Kind | Arms | What it is |
| --- | --- | --- |
| tool-call group | both | one earlier tool call with its result, Pull tools excepted |
| prose | both | one earlier Turn's prompt and its assistant text, with that Turn's tool-call groups and thinking left in place |
| summary | plain omp | the compaction summary |
| Opening | pi-chart | the Opening |
| Pin | pi-chart | one Pin |
| Pull result | pi-chart | one earlier tool call of a Pull tool with its result, a call through omp's tool device included |

The system prompt outside the Opening and Pins, the tool roster and the Call's own Turn SHALL never be units. A unit's tokens SHALL be estimated from the record when sampling.

#### Scenario: The Call's own Turn is never cut

- **WHEN** the units of the third Call of Turn 12 are listed
- **THEN** none of them SHALL be a message of Turn 12

#### Scenario: The Opening on Turn 0

- **WHEN** the units of a pi-chart Call of Turn 0 are listed
- **THEN** the Opening SHALL not be among them, since it carries Turn 0

### Requirement: A unit is cut from the finished request

A unit SHALL be cut from the request after omp and pi-chart built it, and the freed space SHALL not be refilled. The sham SHALL be the same request carrying the same cache breakpoints as the cut request, with the unit kept. What the API drops or refuses because of the cut SHALL go from the sham as well, so that the two differ by the unit alone: the thinking blocks after a cut in the messages, every thinking block in the messages after a cut in the system prompt, and a system message the cut leaves directly after an assistant message. A unit SHALL be flagged duplicated when its whole text appears again elsewhere in the same request outside the unit. A unit that cannot be found in the request SHALL be counted as unlocated and receive no resend.

#### Scenario: A file read twice

- **WHEN** the sampled unit is a tool result whose text a later tool result in the same request repeats
- **THEN** the unit SHALL be flagged duplicated

#### Scenario: The sham loses what the cut loses

- **WHEN** a tool-call group in Turn 3 is cut, and Turns 3 and 4 hold thinking blocks after it
- **THEN** the sham SHALL keep the group and drop those thinking blocks, as the cut does

### Requirement: The count confirms the cut

Before any resend, the counting endpoint SHALL count both the sham and the cut request, and the unit's blocks counted on their own. When sham − cut differs from the unit's own count by more than the tolerance, the unit SHALL be counted as miscounted and receive no resend.

#### Scenario: Thinking blocks dropped with the prefix

- **WHEN** cutting a unit makes the count fall by 400 tokens more than the unit's own count
- **THEN** the unit SHALL be counted miscounted, and no sham or cut resend SHALL be made for it

### Requirement: Calls and units are sampled

A sample SHALL draw Calls uniformly without replacement from a Run's main Calls that hold at least one unit, and pick one unit per drawn Call with probability proportional to its tokens. The seed SHALL be recorded, and the same record, seed and size SHALL draw the same Calls and units. When a drawn Call proves unstable, unfaithful, unlocated or miscounted, another Call SHALL be drawn in its place until the sample is full, the Run has no Call left to draw, or the cap is reached.

#### Scenario: The same seed draws the same sample

- **WHEN** the same record is sampled twice with seed 7 and 20 units
- **THEN** both samples SHALL hold the same Calls with the same units

### Requirement: The next action is compared on tool and target

A resend SHALL match the original when one of its tool calls has the tool and target of the original's first tool call. A resend with no tool call matches an original with no tool call. A call through omp's tool device SHALL count as the tool it ran. The target SHALL be:

| Tool | Target |
| --- | --- |
| `read`, `edit`, `write` | the path, without any line selector |
| `grep`, `glob` | the pattern and the path |
| `bash` | the command, whitespace runs collapsed to one space |
| any other tool | none: the tool name alone |

A Probe Call SHALL be the first Call of a Probe Turn when its recorded reply holds no tool call. On a Probe Call the Probe's checker SHALL decide instead: a resend matches when it scores every probed Plant as the original's reply did. Any other Call of a Probe Turn SHALL be compared on tool and target. No judge model SHALL be used.

#### Scenario: A different range of the same file

- **WHEN** the original's first tool call reads `src/a.ts:1-40` and a resend reads `src/a.ts:200-260`
- **THEN** the resend SHALL match

#### Scenario: A Probe answered differently

- **WHEN** the original Probe reply scored a Plant right and a resend answers UNKNOWN for it
- **THEN** that resend SHALL not match

### Requirement: Noise decides the verdict

Each faithful, located, counted unit SHALL first get 4 sham resends. Its Call SHALL be stable when at least 3 of the 4 match. An unstable Call SHALL be counted, SHALL get no cut resends, and SHALL be redrawn. A stable unit SHALL get 4 cut resends. It SHALL be Needed when at most 1 of them matches, unclear when 2 match, and not Needed when 3 or 4 match.

#### Scenario: A unit the next action depends on

- **WHEN** a unit's shams match 4 of 4 and its cut resends match 1 of 4
- **THEN** the unit SHALL be Needed

#### Scenario: An unstable Call costs no cut resend

- **WHEN** a Call's shams match 2 of 4
- **THEN** the Call SHALL be counted unstable, no cut resend SHALL be made, and another Call SHALL be drawn

### Requirement: Needed share is reported with its interval

For each Arm, Needed share SHALL be the Needed units over judged units (Needed, unclear and not Needed), over units not flagged duplicated, with a Wilson 95% interval. Duplicated units SHALL get the same figures, reported apart. Beside them the report SHALL give:
- the unclear share;
- the unstable share of Calls drawn;
- the counts of unfaithful, unlocated, miscounted and capped units;
- the spend.

#### Scenario: Needed share of a small sample

- **WHEN** 6 of 20 judged, non-duplicated units are Needed
- **THEN** Needed share SHALL read 30% with a Wilson 95% interval of 14.5% to 51.9%

### Requirement: Controls test the instrument

The positive control SHALL take every Probe Call whose Plant the window still held (Opening, Pin, verbatim tail or summary) and whose original reply scored it right. It SHALL cut the part holding the Plant: the Plant's whole Turn when it sat in the verbatim tail, else the Opening, the Pin or the summary. At least 80% of the control's judged units SHALL come out Needed, or the report SHALL say the instrument is not trusted.

A null unit SHALL be sampled as an ordinary unit, but its cut resends SHALL be replaced by a second set of 4 shams. Its false Needed rate SHALL be the null units judged Needed over null units judged, reported with its Wilson interval.

#### Scenario: A control below the bar

- **WHEN** 7 of 10 positive-control units come out Needed
- **THEN** the report SHALL state that the instrument is not trusted

### Requirement: Spend is capped per Run

Ablation spend SHALL be priced from each resend's `usage`, at the per-token rates the Run's own Journal shows. No send SHALL start once a Run's Ablation spend has reached its cap, $10 unless set lower. Units planned but not sent SHALL be counted as capped.

#### Scenario: The cap stops a sample

- **WHEN** a Run's Ablation spend reaches $10.02 with 14 of 20 units judged
- **THEN** no further send SHALL start, and the record SHALL count 6 units as capped

### Requirement: Every Ablation leaves a record

Ablation of a Run SHALL write an ablation record beside the Run's record. It SHALL hold:
- the seed, the cap and the offset band;
- each drawn Call, with its fate, its unit (kind, tokens, duplicated, position in the request) and its original next action;
- every resend's next action and match;
- the verdict;
- the spend.

It SHALL refuse to overwrite an existing ablation record. The report SHALL be re-printable from the records alone, with no model Call. An Ablation that stops on a count or send that keeps failing SHALL write no record, and SHALL report what that Run's Ablation had spent and where the stopped pass's results are.

#### Scenario: Ablating a Run twice

- **WHEN** Ablation is asked for on a Run that already has an ablation record
- **THEN** it SHALL refuse before any replay, naming the existing record

#### Scenario: A send that keeps failing

- **WHEN** a send fails on every retry during a Run's second pass
- **THEN** no ablation record SHALL be written for that Run, and the error SHALL state the spend of both passes

### Requirement: A calibration set is frozen per key

A calibration set SHALL hold, for one key (Workload name and version, model, omp version):
- 50 judged units per Arm, each with its content, its Call's original next action, and its verdict;
- 20 null units;
- the positive control.

It SHALL be added to the committed calibration file only when the positive control holds. A key that already has a set SHALL not get a second. A set SHALL never be read for another key.

#### Scenario: A calibration whose control fails

- **WHEN** a calibration's positive control comes out 75% Needed
- **THEN** the calibration file SHALL be left unchanged, and the report SHALL say why
