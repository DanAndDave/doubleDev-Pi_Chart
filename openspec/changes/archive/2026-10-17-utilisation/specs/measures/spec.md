## ADDED Requirements

### Requirement: The units Utilisation judges

Utilisation SHALL judge the units of each main Call's Context Window that lie in its tail or summary. These are the units Ablation lists, restricted to these kinds:

| Kind | Arms | What it is |
| --- | --- | --- |
| tool-call group | both | one earlier tool call with its result, Pull tools excepted |
| Pull result | pi-chart | one earlier tool call of a Pull tool with its result |
| prose | both | one earlier Turn's prompt and its assistant text |
| summary | plain omp | the compaction summary |

The Opening, the Pins, the rest of the system prompt and the Call's own Turn SHALL never be judged. A unit's tokens SHALL be estimated from the record the way Accounting estimates a part's size. The text a unit contributes SHALL be the text the model saw for it: for a tool-call group or Pull result, the rendered call and its result; for prose, the prompt and the assistant's text; for the summary, the summary.

#### Scenario: The Call's own Turn is never judged

- **WHEN** the third Call of Turn 12 is measured
- **THEN** no message of Turn 12 SHALL be among its judged units, including the tool results of its first two Calls

#### Scenario: The Opening and Pins are not judged

- **WHEN** a pi-chart Call carried the Opening of Turn 0, one Pin and Turns 10 to 11 in its tail
- **THEN** its judged units SHALL be the prose, tool-call groups and Pull results of Turns 10 and 11 only

### Requirement: The next action of a Call

A Call's next action SHALL be the arguments of the first tool call its reply made, with a call through omp's tool device taken as the tool it ran. A reply with no tool call SHALL have its visible text as its next action. Thinking SHALL never be part of the next action. A reply with neither a tool call nor visible text SHALL have an empty next action, which makes no unit Used.

#### Scenario: A value only in the thinking makes nothing Used

- **WHEN** a Call's reply holds `PORT-8817` only in its thinking and a tail unit holds `PORT-8817`
- **THEN** that value SHALL not count toward the unit being Used

#### Scenario: The first tool call is the action

- **WHEN** a Call's reply says "Reading the notes" and then calls `read` on `notes/scale.md` and `grep` on `src/`
- **THEN** its next action SHALL be the `read` call's arguments alone

### Requirement: A unit is Used when a lexical signal fires

A unit SHALL be Used by a Call when any of these signals fires, using only text the unit contributes:

| Signal | Fires when |
| --- | --- |
| path | a path in the next action's target appears in the unit |
| copied span | the next action contains at least *s* consecutive tokens that appear consecutively in the unit |
| rare identifiers | the next action shares at least *k* rare items with the unit |

The path signal SHALL use the target the (tool, target) table gives for Ablation: the path of a `read` or `write`, every file an `edit` names, and the path of a `grep` or `glob`. A path SHALL be compared relative to the Run's working directory. It SHALL match only where it is not part of a longer name. A path that names the working directory itself SHALL not fire.

Tokens SHALL be runs of letters, digits and underscores, compared case-sensitively. Items SHALL be code-shaped identifiers, numbers and quoted string literals. Each string argument of a tool-call action SHALL also count as a string literal of the action. An identifier is code-shaped when it holds an underscore, a digit, or a capital after its first character. An item SHALL be rare when it appears in fewer than 5% of the Run's distinct judged units. Three kinds of item SHALL not count toward the rare-identifiers signal:
- an item that appears in the messages the Call's own Turn sent before the Call;
- an item in the Opening the Call carried;
- an item in a Pin the Call carried.

Run records do not hold the rest of the system prompt, and an item found there SHALL not be excluded.

The default *s* SHALL be 8 and the default *k* SHALL be 2. Identical content in two units SHALL make both Used, or neither.

#### Scenario: A path fires

- **WHEN** a Call's next action reads `/work/run-3/src/stats.ts`, the Run's working directory is `/work/run-3`, and a tail unit's result text names `src/stats.ts`
- **THEN** that unit SHALL be Used

#### Scenario: A path inside a longer name does not fire

- **WHEN** a Call's next action reads `src/a.ts` and a tail unit names only `src/a.tsx`
- **THEN** the path signal SHALL not fire for that unit

#### Scenario: A copied span fires

- **WHEN** a Call's next action writes a file whose content holds 8 consecutive tokens that a tail unit's tool result holds in the same order
- **THEN** that unit SHALL be Used

#### Scenario: A span one token short does not fire

- **WHEN** the longest run of tokens a next action shares in order with a unit is 7 tokens long, and no other signal fires
- **THEN** that unit SHALL not be Used

#### Scenario: Rare identifiers fire

- **WHEN** a Run has 60 judged units, `QUILL_9` and `8817` each appear in 1 of them, and a Call's next action holds both
- **THEN** that unit SHALL be Used

#### Scenario: An item the current Turn holds does not count

- **WHEN** a Call's next action shares `QUILL_9` and `8817` with a tail unit, both rare, and the Call's Turn prompt holds `8817`
- **THEN** only `QUILL_9` SHALL count, and with *k* = 2 the rare-identifiers signal SHALL not fire

#### Scenario: A common item does not count

- **WHEN** an item appears in 10 of a Run's 60 judged units
- **THEN** that item SHALL count toward no unit's rare-identifiers signal

#### Scenario: Identical content makes both units Used

- **WHEN** two tail units hold the same tool result and a Call's next action draws a copied span from it
- **THEN** both units SHALL be Used

### Requirement: Utilisation per Call and per Run

For each main Call, the Measures SHALL give the tokens of its judged units and the tokens of those Used, in total and by unit kind. Utilisation per Call SHALL be Used tokens ÷ judged tokens. A Run's Utilisation SHALL be the sum of Used tokens ÷ the sum of judged tokens over its measured Calls, in total and by unit kind. Three kinds of Call SHALL be counted and excluded from the Run's sums:
- a Call whose window held no judged unit;
- a Call whose window is unknown;
- a subagent Call, which SHALL get no Utilisation at all.

A unit kind with no judged tokens SHALL have no share, rather than zero.

#### Scenario: Utilisation is token-weighted over the Run

- **WHEN** a Run's two measured Calls judged 1,000 tokens with 100 Used and 3,000 tokens with 900 Used
- **THEN** their Utilisation per Call SHALL be 10% and 30%, and the Run's Utilisation SHALL be 25%

#### Scenario: A Call with nothing to judge is counted, not measured

- **WHEN** a Call of Turn 0 has an empty tail and no summary
- **THEN** it SHALL be counted as excluded and add nothing to the Run's sums

#### Scenario: An unknown window is not an empty one

- **WHEN** a pi-chart Call has no Accounting
- **THEN** it SHALL be counted as unknown, apart from the Calls with nothing to judge, and add nothing to the Run's sums

### Requirement: Utilisation is reported raw and uncalibrated

The Measures script SHALL print a Run's Utilisation, in total and by unit kind, with the counts of measured, excluded and unknown Calls. The benchmark report SHALL give, for each Arm, the median Utilisation per Run over its complete Runs, in total and by unit kind. A kind an Arm cannot hold SHALL read "n/a" for that Arm: Pull result on plain omp, summary on pi-chart.

Every report that shows Utilisation SHALL label it "uncalibrated". It SHALL never label Utilisation as Needed, nor put it in a Needed row. It SHALL state two caveats:
- earlier tool results of a Call's own Turn are never measured;
- items found in the system prompt outside the Opening and Pins are not excluded, since the record does not hold that text.

A report read from a record measured before Utilisation existed SHALL show no figure for it, rather than zero.

#### Scenario: Both Arms in one report

- **WHEN** a benchmark of both Arms ends
- **THEN** its report SHALL give each Arm's median Utilisation per Run labelled "uncalibrated", with Pull result reading "n/a" for plain omp and summary reading "n/a" for pi-chart

#### Scenario: An old benchmark is re-printed

- **WHEN** the report is re-printed from a `bench.json` whose Measures predate Utilisation
- **THEN** the Utilisation rows SHALL show no figure, not 0%
