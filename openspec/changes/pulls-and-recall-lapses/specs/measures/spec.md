## ADDED Requirements

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
