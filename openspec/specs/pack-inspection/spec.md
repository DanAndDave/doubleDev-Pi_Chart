# pack-inspection Specification

## Purpose
Making a Context Window something that can be examined rather than inferred: what each part contributed, how much of its Budget it spent, how it compares with the Floor, and how one Call's pack differs from another's.

## Requirements

### Requirement: A call's pack can be examined

The system SHALL report, for a given Call, each part of its Context Pack, what that part contributed, its size, and its Budget. The Floor SHALL be reported alongside, so the share of the window the Assembler controls is visible rather than inferred.

#### Scenario: A pack is itemised by part

- **WHEN** a Call whose pack carried a verbatim tail and recalled Turns is examined
- **THEN** each part SHALL be listed separately with its size and its Budget

#### Scenario: The floor is shown beside the pack

- **WHEN** a Call with reported window sizes is examined
- **THEN** the Floor and the pack size SHALL both be reported, with the Floor's share of the window

#### Scenario: A part names what it contributed

- **WHEN** a pack carried recalled Turns
- **THEN** the report SHALL identify which Turns were recalled, so an unhelpful recollection can be recognised

#### Scenario: An unmeasured call is reported as such

- **WHEN** a Call has no reported window size yet
- **THEN** it SHALL be reported without invented figures

### Requirement: A part reports how much of its budget it spent

The system SHALL report each part's contribution against the Budget that bounded it, including when a part was trimmed to fit. Where content was excluded for being insufficiently relevant rather than for exceeding a Budget, the report SHALL distinguish the two, so that a part which carried little is recognisable as having found little worth carrying. That distinction SHALL hold for every part that selects from candidates, not for recalled Turns alone: a part with a relevance threshold SHALL report what it refused against that threshold, and a part with no threshold SHALL be reported as having none rather than as having refused nothing. A part that contributed nothing SHALL be reported with the reason it contributed nothing — nothing met its threshold, it had no candidates, retrieval failed, its Budget was zero, or its Store was not configured — and SHALL NEVER be silently omitted.

#### Scenario: A trimmed part is visible as trimmed

- **WHEN** more Turns matched than the recall Budget allowed
- **THEN** the report SHALL show the part at its Budget and say how many candidates were dropped

#### Scenario: A part under its budget is not reported as full

- **WHEN** a part contributed less than its Budget allowed
- **THEN** its spend SHALL be reported as less than its Budget

#### Scenario: Irrelevance is distinguished from a budget

- **WHEN** a part carried less than its Budget because candidates fell below the relevance minimum
- **THEN** the report SHALL say how many were excluded as irrelevant, and SHALL NOT report the part as trimmed

#### Scenario: A part that found nothing relevant says so

- **WHEN** every candidate fell below the minimum
- **THEN** the report SHALL show the part absent or empty with the count it rejected, rather than silently omitting the fact

#### Scenario: Curated knowledge reports its own irrelevance

- **WHEN** a Call carried no curated knowledge because every Concept fell outside the curated relevance threshold
- **THEN** the report SHALL show the curated part with the count refused and the threshold it was measured against

#### Scenario: A too-tight threshold reads differently from an unwired store

- **WHEN** one Call refused every Concept against a tight threshold and another ran with no Doc Store configured
- **THEN** the two reports SHALL differ, and neither SHALL be rendered as an empty corpus

#### Scenario: A part without a relevance threshold is not reported as finding nothing relevant

- **WHEN** a part whose candidates carry no distance contributed less than its Budget
- **THEN** the report SHALL attribute the shortfall to its Budget or its supply and SHALL NOT report refusals for irrelevance

### Requirement: Any recorded call of a conversation can be examined

The system SHALL allow any Call the Conversation has recorded to be examined by its address — its Turn and, within that Turn, its Call — and SHALL NOT restrict examination to the most recent Calls. Where only a Turn is given, the last recorded Call of that Turn SHALL be examined. Comparison SHALL accept two addresses rather than only the two latest Calls. An address that was never recorded SHALL be refused, stating what is recorded, and SHALL NEVER be answered with a different Call.

#### Scenario: An older call is examined

- **WHEN** a Call several Turns back is examined by its address
- **THEN** its own parts, Budgets and figures SHALL be reported

#### Scenario: A turn without a call number resolves to its last call

- **WHEN** a Turn with several Calls is examined without naming a Call
- **THEN** the last recorded Call of that Turn SHALL be reported

#### Scenario: An address that never existed is refused

- **WHEN** an address beyond what the Conversation recorded is examined
- **THEN** the request SHALL be refused, naming what is recorded, and no other Call SHALL be reported in its place

#### Scenario: Two named calls can be compared

- **WHEN** two Calls are named for comparison
- **THEN** the difference between those two packs SHALL be reported, whether or not either is the most recent

### Requirement: An absence can be explained by name

The system SHALL answer, for a subject a user names, why content matching it was not carried by a Call: a ranked list of the candidates that were excluded, each named by identity, with its distance or size and the threshold or Budget that excluded it, nearest first. Where a Call's record holds only a count of exclusions and no identities, the answer SHALL say so rather than report that nothing was excluded. Where the named subject matched no recorded candidate at all, the answer SHALL distinguish that from a candidate that was considered and refused.

#### Scenario: A near miss is named with its distance

- **WHEN** a user asks why the Turn where something was decided was not recalled, and that Turn was refused as too distant
- **THEN** the answer SHALL name that Turn's position, its distance, and the threshold it failed, ranked among the other near misses

#### Scenario: Budget exclusions are explained alongside refusals

- **WHEN** a candidate was relevant enough but excluded because a Budget was exhausted
- **THEN** the answer SHALL name it and attribute its exclusion to that Budget rather than to irrelevance

#### Scenario: A subject that was never a candidate says so

- **WHEN** a user asks about a subject no recorded candidate matches
- **THEN** the answer SHALL say that nothing matching it was considered, rather than reporting no exclusions

#### Scenario: An unexplainable call says it is unexplainable

- **WHEN** a Call recorded before candidate identities were retained is asked about
- **THEN** the answer SHALL say the Call holds no candidate detail rather than report that nothing was excluded

### Requirement: A harness compaction is visible in the record

Where a Call was recorded as following a harness compaction of the Conversation, examining that Call SHALL report the compaction, so that a Conversation whose earlier Calls were assembled against a window the harness has since rewritten is visible rather than inferred. A Conversation summary SHALL report the compactions it contains.

#### Scenario: The affected call reports the compaction

- **WHEN** a Call recorded as following a compaction is examined
- **THEN** the report SHALL state that a compaction occurred at that Call

#### Scenario: A conversation summary names its compactions

- **WHEN** a Conversation containing a compaction is summarised
- **THEN** the summary SHALL report that a compaction occurred and at which Call

#### Scenario: An uncompacted conversation reports none

- **WHEN** a Conversation the harness never compacted is examined or summarised
- **THEN** no compaction SHALL be reported

### Requirement: The estimate is reconciled against the reported window

Where a Call carries both the system's own estimate of its Context Pack and the size the harness reported for the Context Window that carried it, examining that Call SHALL report both figures and their relationship, so that the estimate's bias is visible at the point the estimate is used. A Conversation summary SHALL report that relationship across its measured Calls. The estimate SHALL NEVER be presented as the reported size, and a Call the harness has not measured SHALL be reported as unmeasured rather than reconciled against an invented figure.

#### Scenario: Both figures and their relationship are reported

- **WHEN** a Call with an estimate and a reported window size is examined
- **THEN** the report SHALL give both figures and how far the estimate sits from the reported size

#### Scenario: An unmeasured call is not reconciled

- **WHEN** a Call has an estimate but no reported window size
- **THEN** the report SHALL state that the window is unmeasured and SHALL NOT present the estimate as a measurement

#### Scenario: A conversation reports the estimate's bias

- **WHEN** a Conversation with several measured Calls is summarised
- **THEN** the summary SHALL report how the estimate compared with the reported sizes across those Calls

### Requirement: Two packs can be compared

The system SHALL report the difference between two Calls' packs: what entered, what left, and what remained.

#### Scenario: What changed between two calls is named

- **WHEN** two Calls of a Conversation are compared
- **THEN** content present in one and absent in the other SHALL be reported as entering or leaving, and content in both as unchanged

#### Scenario: Comparing a call with itself reports no difference

- **WHEN** a Call is compared with itself
- **THEN** no entering or leaving content SHALL be reported

### Requirement: A conversation's windows can be summarised

The system SHALL summarise a whole Conversation's Calls: how the pack and the Floor compare across it, and how much of each Budget was typically spent.

#### Scenario: A session yields a pack-versus-floor figure

- **WHEN** a Conversation with several measured Calls is summarised
- **THEN** the summary SHALL report the Floor's share of the window across those Calls

#### Scenario: A conversation with nothing recorded summarises to nothing

- **WHEN** a Conversation has no recorded Calls
- **THEN** the summary SHALL report that, rather than failing

### Requirement: Budgets can be changed within a session

The system SHALL allow a Budget to be changed while a session is running, and the change SHALL apply from the next Call without restarting.

#### Scenario: A changed budget takes effect on the next call

- **WHEN** a Budget is changed mid-session
- **THEN** the next Call's pack SHALL be assembled under the new Budget

#### Scenario: An invalid budget is refused, not applied

- **WHEN** a Budget is set to something that is not a count
- **THEN** it SHALL be refused and the previous Budget SHALL remain in force

### Requirement: Inspection never alters what it inspects

Examining a pack, comparing packs, or summarising a Conversation SHALL NOT change any Context Pack, Turn, or accounting record.

#### Scenario: Inspecting leaves the record untouched

- **WHEN** a Call is examined and a Conversation summarised
- **THEN** the accounting for that Conversation SHALL be unchanged afterwards
