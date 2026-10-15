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

For each Probe Turn a Run completed, each Plant that Turn probes SHALL be scored right or wrong according to its kind:
- **literal**: right when the final assistant reply of that Turn in the main Journal contains the Plant's value exactly.
- **superseded**: right when that reply contains the value and does not contain the earlier value. A wrong score whose reply contains the earlier value SHALL be marked stale.
- **constraint**: right when the arguments of a tool call the main agent made in that Turn contain the value. The reply SHALL NOT count.

When the Probe forbids tools and its Turn made a tool call, each of its scores SHALL be marked as a breach and still count. An Arm's Retention for a Probe SHALL be the share of its complete Runs that scored that Plant right at that Probe Turn.

#### Scenario: Each Plant of a Probe is scored separately

- **WHEN** a Probe asks for two Plants and the Turn's final reply contains the first Plant's value and not the second's
- **THEN** the first Plant SHALL be scored right and the second wrong

#### Scenario: A Probe that was never reached is not scored

- **WHEN** a Run failed before its Probe Turn
- **THEN** the Run SHALL contribute no score to any Plant that Probe asks for

#### Scenario: Giving the superseded value is wrong and stale

- **WHEN** a superseded Plant's earlier value is `PORT-3304`, its value is `PORT-8817`, and the Probe's final reply says `PORT-3304`
- **THEN** that Plant SHALL be scored wrong and marked stale

#### Scenario: Naming both values is wrong

- **WHEN** a Probe's final reply for that superseded Plant contains both `PORT-8817` and `PORT-3304`
- **THEN** that Plant SHALL be scored wrong and marked stale

#### Scenario: A constraint is scored by what the agent did

- **WHEN** a constraint Plant's value is `owner: QUILL-9`, the Probe Turn writes a file whose content contains `owner: QUILL-9`, and the reply does not mention it
- **THEN** that Plant SHALL be scored right

#### Scenario: A tools-forbidden Probe that used a tool is a breach

- **WHEN** a Probe that forbids tools made a `read` call in its Turn and its reply contains the Plant's value
- **THEN** that Plant SHALL be scored right and marked as a breach

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

### Requirement: Where a Plant sat when its Probe ran

For each score, the Measures SHALL give the Plant's Turn, its distance and its position.

- **Plant's Turn**: the first Turn of the main Journal whose prompt or tool result contains the Plant's value. When no Turn before the Probe's has one, the Plant SHALL be unplanted and have no distance.
- **Distance**: the Probe's Turn less the Plant's Turn.
- **Position**: taken from the window of the first Call of the Probe Turn, as the first of these that holds:
  - **Opening**: the Plant entered in the prompt of the Turn whose prompt the Opening carried.
  - **Pin**: a Pin the window carried contains the value.
  - **tail**: the message in which the Plant entered is one the tail carried.
  - **summary**: the window carried a summary that contains the value.
  - **evicted**: none of the above.

The position SHALL be unknown, rather than tail or evicted, when that window is unknown, or when the message in which the Plant entered sits in a tail marked partial. An unplanted Plant's position SHALL be unplanted.

#### Scenario: A Plant carried by the Opening

- **WHEN** a pi-chart Run's Plant entered in Turn 0's prompt, and the Probe at Turn 39 was sent with the Opening of Turn 0 and a tail of Turns 31 to 38
- **THEN** that score's Plant Turn SHALL be 0, its distance 39 and its position Opening

#### Scenario: An evicted Plant

- **WHEN** a pi-chart Run's Plant entered in Turn 2's prompt, and the Probe at Turn 39 was sent with the Opening of Turn 0 and a tail of Turns 31 to 38
- **THEN** that score's distance SHALL be 37 and its position evicted

#### Scenario: A Plant read from a file enters at the read

- **WHEN** a Plant placed in a tool result first appears in a `read` result at Turn 6, and its Probe is at Turn 10 with a tail of Turns 3 to 9
- **THEN** that score's Plant Turn SHALL be 6, its distance 4 and its position tail

#### Scenario: A file never read leaves the Plant unplanted

- **WHEN** no prompt or tool result before the Probe Turn contains a tool-result Plant's value
- **THEN** that score SHALL be unplanted, with no distance

#### Scenario: A plain-omp summary that kept the Plant

- **WHEN** a plain-omp Plant entered at Turn 2, a compaction kept everything from Turn 6 with a summary containing the value, and the Probe is at Turn 9
- **THEN** that score's position SHALL be summary

#### Scenario: An unknown window gives an unknown position

- **WHEN** a pi-chart Probe's first Call has no Accounting
- **THEN** that score's position SHALL be unknown

### Requirement: Each answer has a source

Each score SHALL have a source, the first of these that holds the Plant's value:
1. **A window part** of the first Call of the Probe Turn:
   - the Opening, meaning the prompt of the Turn it carried;
   - a Pin the window carried;
   - the tail, meaning any message of a Turn it carried, counted from the first message it carried;
   - the summary the window carried.
2. **A Pull result** received in the Probe Turn before the scored message.
3. **Any other tool result** received in the Probe Turn before the scored message.
4. **None.**

The scored message SHALL be the final reply, or, for a right constraint, the first tool call whose arguments contain the value.

The source SHALL be unknown, ending the search, when the window is unknown, or when the tail holds the value and is marked partial while neither the Opening nor a Pin holds it.

Each score SHALL then be classed:
- **Leak**: right with source none.
- **Wrong despite a source**: wrong with a source other than none or unknown.
- **Failed-Probe Lapse**: wrong with source none and position evicted.
- **Failed Probe unknown**: wrong and not unplanted, with source unknown, or with source none and position unknown.
- **Unplanted**: wrong and unplanted. This SHALL be neither a Lapse nor unknown.

#### Scenario: An answer from the Opening

- **WHEN** a Plant carried by the Opening is answered right with no tool call
- **THEN** its source SHALL be the Opening and it SHALL be no leak

#### Scenario: An answer recovered by a recall Pull

- **WHEN** an evicted Plant's Probe Turn calls `recall_earlier_turns`, the result contains the value, and the final reply is right
- **THEN** its source SHALL be a Pull, naming `recall_earlier_turns`, and it SHALL be no Lapse

#### Scenario: An answer from re-reading the file

- **WHEN** an evicted tool-result Plant's Probe Turn reads the file again, a `read` result contains the value, and the reply is right
- **THEN** its source SHALL be a tool result

#### Scenario: A right answer with nothing behind it is a leak

- **WHEN** a Plant is answered right, no window part of the Probe's first Call holds the value, and no tool result of the Probe Turn holds it
- **THEN** its source SHALL be none and it SHALL be classed as a leak

#### Scenario: A wrong answer with the value in the tail is no Lapse

- **WHEN** the tail of the Probe's first Call holds the Plant's value and the final reply does not
- **THEN** its source SHALL be the tail and it SHALL be classed wrong despite a source, not as a Lapse

#### Scenario: An evicted Plant answered wrong is a Lapse

- **WHEN** an evicted Plant's Probe Turn has no result holding its value and the final reply is wrong
- **THEN** it SHALL be classed as a failed-Probe Lapse at the score's distance

#### Scenario: A value repeated in a later Turn is held by the tail

- **WHEN** the Plant entered at Turn 2, the agent's reply at Turn 35 repeats its value, the Probe at Turn 39 has a tail of Turns 31 to 38, and the final reply is right
- **THEN** its position SHALL be evicted and its source the tail, and it SHALL be no leak

### Requirement: Failed Probes per Run by distance band

A failed-Probe Lapse SHALL be a Lapse that was not recovered. For each Run, on both Arms, the Measures SHALL count failed-Probe Lapses and failed Probes unknown, each in total and in the five distance bands Re-fetches use. These counts SHALL be reported beside Re-fetch Lapses and recall Pulls and never added to them. A Run with no such score SHALL count zero in every band, not be absent.

#### Scenario: Failed Probes are banded

- **WHEN** a Run's failed-Probe Lapses fall at distances 9 and 37
- **THEN** its failed-Probe Lapses SHALL be 1 in 8–12 and 1 in 25 or more, with a total of 2

#### Scenario: A Run whose Probes all pass counts zero

- **WHEN** every score of a complete Run is right
- **THEN** its failed-Probe Lapses and failed Probes unknown SHALL be zero in every band

### Requirement: Retention is reported by Probe, distance and position

A report over several Runs SHALL give, per Arm over complete Runs:
- Retention for each Probe, naming the Plant, its kind, the Probe's Turn and whether it forbids tools;
- Retention by the distance band of each score, and by position;
- for each source, the number of right and wrong scores;
- the number of leaks, of wrong scores despite a source, of stale scores and of breaches.

Scores with no distance SHALL be counted under unplanted, not in a band. The band table SHALL give failed-Probe Lapses and failed Probes unknown on both Arms. Where both Arms are present, the report SHALL state that failed Probes are Lapses neither Arm recovered.

#### Scenario: Retention by position across Runs

- **WHEN** an Arm has three complete Runs whose build Plant sat in the tail and was right in one, and was evicted and wrong in two
- **THEN** that Arm's Retention by position SHALL be 1/1 in tail and 0/2 evicted

#### Scenario: Leaks are counted in the report

- **WHEN** one complete pi-chart Run has a score classed as a leak
- **THEN** the report SHALL give pi-chart one leak

### Requirement: Revisits are scored by whether the agent fetched the file again

For each Revisit whose step's Turns the Run all completed, the Measures SHALL give one Revisit score, computed the same way on both Arms from the main Journal. A tool result SHALL concern the Revisit's file when it is not marked as an error and answers a main-agent tool call one of whose argument strings contains the file's path. Its text SHALL NOT matter, so a read of part of the file concerns it, and a search that never names the file does not.

The score SHALL give:
- **the earlier read**: the most recent result concerning the file received before the step's first Turn, and its Turn;
- **the distance**: the step's first Turn less the earlier read's Turn;
- **the fetch**: the first result concerning the file received during the step's Turns, and its Turn;
- **the position**: where the earlier read sat in the window of the first Call of the step's first Turn: **tail** when the tail carried it; **summary** when it did not, and the window's summary came from a compaction that kept only what followed it; **evicted** otherwise; **unknown** when that window is unknown, or the tail is marked partial and carried the read's Turn;
- **the Pull**: the Pull tool, when a recall Pull made during the step's Turns held the earlier read's Turn;
- **the step's outcome**: Pass, Fail or not graded, as the Run recorded it.

The score's class SHALL be the first that applies:
1. **unread**: no result concerning the file came before the step;
2. **edited**: the record names a Turn at or before the step's last Turn after which the file no longer matched `overlay/`;
3. **held**, **left** or **unknown**, when the step fetched the file: classified from the window of the Call that made the fetch, as a Re-fetch is against its earlier result;
4. **unfetched**: the step never fetched the file, so it answered from its window or from a Pull.

A score that is unread SHALL have no distance and the position unread. A Revisit classified left SHALL be a recovered Lapse. It SHALL be reported apart from Re-fetch Lapses, recall Pulls and failed-Probe Lapses and never added to them, since the same fetch can also be a Re-fetch.

#### Scenario: A file fetched after it left the window

- **WHEN** a pi-chart Run read `notes/scale.md` at Turn 1, the Revisit's step is Turn 6, that Turn's first Call carried only Turns 4 and 5 in its tail, and that Call read `notes/scale.md` again, and the step's check passed
- **THEN** the Revisit score SHALL be left, at distance 5, position evicted, fetched at Turn 6, Pass

#### Scenario: A file fetched while the window still held it

- **WHEN** a plain-omp Run that never compacted read the file at Turn 1 and read it again in the Revisit's step at Turn 3
- **THEN** the Revisit score SHALL be held, at distance 2, position tail

#### Scenario: A ranged read is a fetch

- **WHEN** the Revisit's step reads lines 1 to 3 of the file, whose text differs from the earlier whole-file read
- **THEN** that read SHALL be the Revisit's fetch

#### Scenario: A search that never names the file is not a fetch

- **WHEN** the Revisit's step's only tool call is a search over the whole workspace that returns a line of the file
- **THEN** the Revisit score SHALL be unfetched

#### Scenario: A file answered from the window

- **WHEN** the Revisit's step makes no tool call concerning the file and its check fails
- **THEN** the Revisit score SHALL be unfetched, with the step's outcome Fail

#### Scenario: A file read before a compaction's cut sits in the summary

- **WHEN** a plain-omp Run read the file at Turn 2, a compaction later kept everything from Turn 5, and the Revisit's step at Turn 8 does not fetch it
- **THEN** the Revisit score SHALL be unfetched with position summary

#### Scenario: A file recovered by recall

- **WHEN** a pi-chart Run read the file at Turn 1, and the Revisit's step at Turn 9 makes a `recall_earlier_turns` call whose result holds Turn 1 and never fetches the file
- **THEN** the Revisit score SHALL be unfetched, position evicted, with the Pull `recall_earlier_turns`

#### Scenario: An edited file is excluded

- **WHEN** the record names Turn 2 as the first after which the Revisit's file no longer matched `overlay/`, and the Revisit's step is Turn 4
- **THEN** the Revisit score SHALL be edited, and SHALL count neither as held, left nor unfetched

#### Scenario: A file never read before the step

- **WHEN** no result concerning the file came before the Revisit's step
- **THEN** the Revisit score SHALL be unread, with no distance

#### Scenario: A step the Run never finished is not scored

- **WHEN** a Run failed during the Revisit's step
- **THEN** the Measures SHALL give no score for that Revisit

#### Scenario: A record with no Revisits

- **WHEN** a Run's record declares no Revisits, or was written before Revisits existed
- **THEN** the Measures SHALL give no Revisit score

### Requirement: Revisits are reported by class and position

A report over several Runs SHALL give, per Arm over complete Runs:
- for each Revisit, naming its file and step, the number of scores in each class;
- for each class, the Passes over the scores of that class that were graded;
- for each position, the Passes over the scores at that position that were graded.

A row SHALL appear only where some Arm has a score. The report SHALL state that left Revisits are recovered Lapses, reported apart from every other Lapse count. A report over Runs recorded before Revisits were scored SHALL show those cells as having no figure, not as zero.

#### Scenario: Direct answers and fetches are both scored by the check

- **WHEN** three complete pi-chart Runs score one Revisit left and Pass, unfetched and Pass, and unfetched and Fail
- **THEN** the report SHALL give pi-chart left 1/1 and unfetched 1/2 Passes, and one score each of left and two of unfetched for that Revisit

#### Scenario: An incomplete Run is left out of the Revisit tables

- **WHEN** a Run failed after the Revisit's step had completed
- **THEN** its Revisit score SHALL NOT count in the report
