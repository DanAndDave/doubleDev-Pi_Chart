# measures Specification

## Purpose
Computing Measures after a Run has ended, from its record alone, so that the same code measures every Arm, a Measure can be recomputed on old Runs at no model cost, and the benchmark, the Gate and the comparison report all read the same figures.

## Requirements

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

### Requirement: Window parts per Call

For each Call of the main Journal, the Measures SHALL give the Context Window that Call sent, as the same parts on both Arms: system prompt, Opening, Pin, summary, tail and current Turn. A part an Arm does not have SHALL be empty on that Arm. Each part SHALL identify what it carried: the Opening by its Turn, Pins by their ids, the summary by the compaction it came from, the tail by the Turns it carried and, where it began part-way through a Turn, the first message it carried.

For a pi-chart Run the window SHALL come from the Accounting recorded for that Call, joined to the Journal by Turn and Call index. The tail SHALL be marked partial when Accounting records that it was carried shortened or with messages dropped. A Call recorded as unassembled was sent the harness's own history, and SHALL be given the plain-omp window. A Call with no Accounting, or whose Accounting does not identify the Turns its tail carried, SHALL be given an unknown window rather than an empty one.

For a plain-omp Run the window SHALL be the Journal's active branch up to that Call. Where a compaction precedes the Call on that branch, the latest such compaction SHALL be the summary, and the tail SHALL begin at the first message that compaction kept. A compaction whose first kept message cannot be found on the branch SHALL give an unknown window to every later Call up to the next compaction.

Subagent Calls SHALL be given no window.

#### Scenario: A pi-chart Call's tail is the Turns Accounting says it carried

- **WHEN** Accounting records that a pi-chart Call at Turn 13 carried Turns 11 and 12 in its tail and the Opening of Turn 0
- **THEN** that Call's window SHALL hold Turn 0 as its Opening, Turns 11 and 12 as its tail, Turn 13 as its current Turn, and an empty summary

#### Scenario: A plain-omp Call after a compaction

- **WHEN** a plain-omp Journal holds a compaction that kept everything from the third message of Turn 6, and a Call of Turn 9 comes after it
- **THEN** that Call's window SHALL hold that compaction as its summary and a tail beginning at the third message of Turn 6

#### Scenario: A plain-omp Call before any compaction holds the whole branch

- **WHEN** a plain-omp Call of Turn 9 comes before every compaction in its Journal
- **THEN** that Call's window SHALL hold Turns 0 to 8 as its tail and an empty summary

#### Scenario: Missing Accounting gives an unknown window

- **WHEN** a pi-chart Run's record holds no Accounting for one of its Calls
- **THEN** that Call's window SHALL be reported as unknown, not as empty

### Requirement: Re-fetches are classified held, left or unknown

A Re-fetch SHALL be a tool result in the main Journal whose text is identical to the text of the most recent earlier tool result with that text, when that earlier result was received in an earlier Turn of the same Run. The tool that produced either result SHALL NOT matter. A result that is empty or marked as an error SHALL NOT be a Re-fetch, nor be the earlier result of one. A result identical only to an earlier result of its own Turn SHALL NOT be a Re-fetch.

Each Re-fetch SHALL be classified from the window of the Call that made the tool call:
- **held** when that window held the earlier result;
- **left** when that window did not hold it;
- **unknown** when that window is unknown, when no Call of the Turn holds the tool call the result answers, or when the earlier result's Turn sat in a tail marked partial.

A Re-fetch's distance SHALL be its Turn's index less the earlier result's Turn index.

#### Scenario: A Re-fetch of a Turn the tail had evicted is left

- **WHEN** a pi-chart Run read a file at Turn 4, its Call at Turn 13 carried only Turns 11 and 12 in its tail, and that Call read the same file and received an identical result
- **THEN** the Measures SHALL record one Re-fetch, classified left, at distance 9

#### Scenario: A Re-fetch of a Turn still in the window is held

- **WHEN** a plain-omp Run with no compaction received a result at Turn 2 and an identical result at Turn 4
- **THEN** the Measures SHALL record one Re-fetch, classified held, at distance 2

#### Scenario: A Re-fetch from before a compaction's cut is left

- **WHEN** a plain-omp Run received a result at Turn 3, a compaction later kept everything from Turn 6, and a Call of Turn 9 received an identical result
- **THEN** the Measures SHALL record one Re-fetch, classified left

#### Scenario: A file fetched again after an edit is not a Re-fetch

- **WHEN** a file was read at Turn 2, edited at Turn 3 and read again at Turn 4, and the two reads differ
- **THEN** the Measures SHALL record no Re-fetch

#### Scenario: A repeat within one Turn is not a Re-fetch

- **WHEN** a result received at Turn 4 is received again, identically, later in Turn 4, and no earlier Turn received it
- **THEN** the Measures SHALL record no Re-fetch

#### Scenario: Error and empty results are never Re-fetches

- **WHEN** two Turns each receive the same error result, or each receive an empty result
- **THEN** the Measures SHALL record no Re-fetch

#### Scenario: An unknown window gives an unknown Re-fetch

- **WHEN** a Re-fetch's tool call was made by a Call whose window is unknown
- **THEN** that Re-fetch SHALL be classified unknown, and SHALL count neither as held nor as left

### Requirement: Lapses and Re-fetches per Run by distance band

A Re-fetch classified left SHALL be a Lapse. For each Run, the Measures SHALL count Re-fetches held, Re-fetches left (Lapses) and Re-fetches unknown, each in total and in each of five distance bands: 1–5, 6–7, 8–12, 13–24 and 25 or more Turns. The bands of each class SHALL sum to its total. A report over several Runs SHALL give each count per Arm over complete Runs only, and SHALL give the Re-fetches unknown alongside, never folded into held or left.

#### Scenario: Bands sum to the total

- **WHEN** a Run's Lapses fall at distances 3, 7, 9 and 30
- **THEN** its Lapses SHALL be 1 in 1–5, 1 in 6–7, 1 in 8–12, 0 in 13–24 and 1 in 25 or more, with a total of 4

#### Scenario: A Run with no Re-fetch counts zero

- **WHEN** no tool result of a complete Run is a Re-fetch
- **THEN** its Re-fetches held, Lapses and Re-fetches unknown SHALL each be zero in every band, not absent

### Requirement: Measures that exist on one Arm only

A Measure that exists on one Arm only SHALL be reported as "n/a" for the other Arm, and SHALL contribute no ratio or difference between the Arms. Compactions per Run SHALL be such a Measure: the number of compactions on a plain-omp Run's active branch, and "n/a" for pi-chart, which suppresses compaction.

#### Scenario: Compactions read n/a on pi-chart

- **WHEN** a report covers plain-omp Runs that each compacted once and pi-chart Runs
- **THEN** the compactions row SHALL give 1 for plain omp and "n/a" for pi-chart, with no ratio between them

#### Scenario: A plain-omp Run that never compacted counts zero

- **WHEN** a plain-omp Run's Journal holds no compaction
- **THEN** its compactions per Run SHALL be 0, not "n/a"

### Requirement: Pulls per Run

For a pi-chart Run, the Measures SHALL count the Pulls of the main Journal for each of the five Pull tools: `recall_earlier_turns`, `recall_across_conversations`, `search_documentation`, `walk_documentation` and `codebase_structure`. Each count SHALL give the calls made and the tokens their results returned, estimated the way Accounting estimates a part's size. Every call SHALL count, including one whose result reports a failure. A tool the Run never called SHALL count zero, not be absent. Calls to `write_documentation` SHALL be counted apart and never as a Pull. Pulls and `write_documentation` calls SHALL be Measures that exist on pi-chart only, and read "n/a" for plain omp.

#### Scenario: Pulls are counted per tool with tokens returned

- **WHEN** a pi-chart Run calls `search_documentation` twice and `codebase_structure` once
- **THEN** its Pulls SHALL be 2 `search_documentation` calls and 1 `codebase_structure` call, each with the estimated tokens of its results summed, and 0 calls for the other three tools

#### Scenario: A write to the bundle is not a Pull

- **WHEN** a pi-chart Run calls `write_documentation` once
- **THEN** its `write_documentation` count SHALL be 1, and no Pull count SHALL include that call

#### Scenario: Pulls read n/a on plain omp

- **WHEN** a report covers plain-omp Runs and pi-chart Runs
- **THEN** every Pull row and the `write_documentation` row SHALL read "n/a" for plain omp, with no ratio between the Arms

### Requirement: Recall Pulls

A Pull SHALL be a recall Pull when its result holds a Turn of the Run's own Conversation that the Context Window of the Call making it did not carry. A window carries a Turn when its tail carried that Turn or it is the Call's own Turn; an Opening carries only a prompt and does not carry its Turn. The Pull is classified as follows:

- A `recall_earlier_turns` result that returned at least one Turn SHALL be a recall Pull, whatever the window: the tool returns only Turns from before the tail of the Call that made it.
- A `recall_across_conversations` result SHALL be classified from the Turn identities it records:
  - It SHALL be a recall Pull when one of its own-Conversation Turns was not carried.
  - It SHALL NOT be a recall Pull when it holds no own-Conversation Turn, or when the window carried every one it holds.
  - It SHALL be a recall Pull unknown when it holds an own-Conversation Turn and either the Call's window is unknown or no Call of the Turn holds the tool call.
  - A result that returned Turns but records no Turn identities SHALL also be a recall Pull unknown.
- A `search_documentation`, `walk_documentation` or `codebase_structure` Pull SHALL never be a recall Pull.

A recall Pull's distance SHALL be the Call's Turn minus the nearest Turn its result held that the window did not carry. The distance of a recall Pull unknown SHALL be measured to the nearest own-Conversation Turn its result held. Where no Turn identities are recorded, that distance SHALL be absent.

#### Scenario: Recalling earlier Turns is a recall Pull at the nearest distance

- **WHEN** a Call at Turn 9 calls `recall_earlier_turns` and the result holds Turns 2 and 5
- **THEN** that Pull SHALL be a recall Pull at distance 4

#### Scenario: A cross-conversation result holding an evicted Turn of the Run is a recall Pull

- **WHEN** a Call at Turn 8 whose tail carried Turns 6 and 7 calls `recall_across_conversations`, and the result holds Turn 7 and Turn 2 of the Run's Conversation and Turn 4 of another Conversation
- **THEN** that Pull SHALL be a recall Pull at distance 6

#### Scenario: A cross-conversation result from other Conversations only is not a recall Pull

- **WHEN** every Turn a `recall_across_conversations` result holds belongs to another Conversation
- **THEN** that Pull SHALL count as a Pull and SHALL NOT be a recall Pull

#### Scenario: A cross-conversation result the window already carried is not a recall Pull

- **WHEN** every own-Conversation Turn a `recall_across_conversations` result holds was in the Call's tail
- **THEN** that Pull SHALL NOT be a recall Pull

#### Scenario: An unknown window leaves a cross-conversation result unknown

- **WHEN** a `recall_across_conversations` result holds a Turn of the Run's Conversation and the Call has no Accounting
- **THEN** that Pull SHALL be a recall Pull unknown, not a recall Pull

#### Scenario: Documentation and structure Pulls never count toward Lapse

- **WHEN** a Call calls `search_documentation`, `walk_documentation` or `codebase_structure`
- **THEN** that Pull SHALL count as a Pull and SHALL NOT be a recall Pull or a recall Pull unknown

### Requirement: Recall Lapses per Run by distance band

Each recall Pull SHALL be a recovered Lapse. For each pi-chart Run, the Measures SHALL count recall Pulls and recall Pulls unknown, each in total and in the five distance bands Re-fetches use. A recall Pull unknown with no distance SHALL count in its total and in no band. These counts SHALL be reported beside the Re-fetch Lapses and never added to them. They SHALL read "n/a" for plain omp, which has no recall tool. A report covering both Arms SHALL state that the Arms recover Lapses by different routes, so that zero recall Pulls on plain omp does not read as zero Lapses.

#### Scenario: Recall Pulls are banded

- **WHEN** a pi-chart Run's recall Pulls fall at distances 4 and 9
- **THEN** its recall Pulls SHALL be 1 in 1–5 and 1 in 8–12, with a total of 2, and zero in every other band

#### Scenario: A pi-chart Run with no recall Pull counts zero

- **WHEN** a complete pi-chart Run makes no recall Pull
- **THEN** its recall Pulls and recall Pulls unknown SHALL each be zero in every band, not absent

#### Scenario: Plain omp reads n/a and the routes are named

- **WHEN** a report covers plain-omp and pi-chart Runs
- **THEN** the recall Pull counts SHALL read "n/a" for plain omp
- **AND** the report SHALL state that plain omp recovers Lapses only through Re-fetches, and pi-chart through Re-fetches and recall Pulls
