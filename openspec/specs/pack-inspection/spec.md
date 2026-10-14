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

The system SHALL report each part's contribution against the Budget that bounded it, including when a part was trimmed to fit. Where content was excluded for being insufficiently relevant rather than for exceeding a Budget, the report SHALL distinguish the two, so that a part which carried little is recognisable as having found little worth carrying. That distinction SHALL hold for every part that selects from candidates, not for recalled Turns alone: a part with a relevance threshold SHALL report what it refused against that threshold, and a part with no threshold SHALL be reported as having none rather than as having refused nothing. A part that contributed nothing SHALL be reported with the reason it contributed nothing — nothing met its threshold, it had no candidates, retrieval failed, its Budget was zero, or its Store was not configured — and SHALL NEVER be silently omitted. A part that carried a Turn with messages dropped SHALL report how many, beside whether its content was shortened.

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

#### Scenario: Dropped messages are reported

- **WHEN** a Call's verbatim tail dropped 412 messages from its newest Turn
- **THEN** examining that Call SHALL report "412 messages dropped" for the tail, separately from "content shortened"

#### Scenario: A record without the count reports no drop

- **WHEN** a Call recorded before this detail existed is examined
- **THEN** no dropped-message line SHALL be reported for any part

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

The system SHALL answer, for a subject a user names, why content matching it was not carried by a Call: a ranked list of the candidates that were excluded, each named by identity, with its distance or size and the threshold, Budget or Eviction that excluded it, nearest first. Where a Call's record holds only a count of exclusions and no identities, the answer SHALL say so rather than report that nothing was excluded. Where the named subject matched no recorded candidate at all, the answer SHALL distinguish that from a candidate that was considered and refused.

#### Scenario: A near miss is named with its distance

- **WHEN** a user asks why the Turn where something was decided was not recalled, and that Turn was refused as too distant
- **THEN** the answer SHALL name that Turn's position, its distance, and the threshold it failed, ranked among the other near misses

#### Scenario: Budget exclusions are explained alongside refusals

- **WHEN** a candidate was relevant enough but excluded because a Budget was exhausted
- **THEN** the answer SHALL name it and attribute its exclusion to that Budget rather than to irrelevance

#### Scenario: An evicted turn is attributed to eviction

- **WHEN** a user asks about a Turn the verbatim tail evicted
- **THEN** the answer SHALL name that Turn and say the tail evicted it, and SHALL NOT attribute its absence to a Budget

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

The system SHALL allow a Budget to be changed while a session is running, and the change SHALL apply from the next Call without restarting. The Pin Budget, in count and in tokens, SHALL be changeable the same way; lowering it SHALL NOT remove a Pin already held, and SHALL apply to the next Pin written.

#### Scenario: A changed budget takes effect on the next call

- **WHEN** a Budget is changed mid-session
- **THEN** the next Call's pack SHALL be assembled under the new Budget

#### Scenario: An invalid budget is refused, not applied

- **WHEN** a Budget is set to something that is not a count
- **THEN** it SHALL be refused and the previous Budget SHALL remain in force

#### Scenario: A lowered pin budget keeps the pins held

- **WHEN** the Pin Budget is lowered below what the Conversation's Pins spend
- **THEN** every Pin SHALL remain held and carried, and the next `/pins add` SHALL be refused against the new Budget

### Requirement: Inspection never alters what it inspects

Examining a pack, comparing packs, or summarising a Conversation SHALL NOT change any Context Pack, Turn, or accounting record.

#### Scenario: Inspecting leaves the record untouched

- **WHEN** a Call is examined and a Conversation summarised
- **THEN** the accounting for that Conversation SHALL be unchanged afterwards

### Requirement: Pins are examined like any other part

Examining a Call SHALL report the Pins its Pack carried as their own part, with their ids, their size, and the Pin Budget, and SHALL report that part as having no relevance threshold. Comparing two Calls SHALL report a Pin added or removed between them as entering or leaving, identified by its id. A Conversation summary SHALL report the Pin part's typical spend beside the other parts. Neither the record nor any report SHALL carry a Pin's text: the Journal holds it, and `/pins` prints it.

#### Scenario: A call's pins are itemised

- **WHEN** a Call whose Pack carried two Pins is examined
- **THEN** the report SHALL list a pinned part naming both ids, with its size against the Pin Budget

#### Scenario: A pin added between calls enters

- **WHEN** a Call before a Pin was added is compared with a Call after it
- **THEN** the Pin SHALL be reported as entering, by its id

#### Scenario: A pin removed between calls leaves

- **WHEN** a Call before a Pin was removed is compared with a Call after it
- **THEN** the Pin SHALL be reported as leaving, by its id

#### Scenario: Pins over a lowered budget are reported as exceeding it

- **WHEN** a Call carried Pins that together exceeded the Pin Budget in force
- **THEN** the report SHALL state the Budget exceeded rather than report the part as fitting

#### Scenario: Calls recorded before pins existed read without them

- **WHEN** a Call recorded before Pins existed is examined or compared
- **THEN** it SHALL be reported with no pinned part, and comparing it with a later Call SHALL report that Call's Pins as entering

### Requirement: Examining a Call reports its earlier Briefings

Examining a Call SHALL report which way it sent its Briefing and, where it sent earlier Briefings again, how many and their total size, beside any it could not send because the stored text was missing. A Conversation summary SHALL report how many of its Calls sent the Briefing each way and how many Briefings went missing. A Call recorded without these figures SHALL be reported without the line, not as zero.

#### Scenario: A Call with earlier Briefings shows them

- **WHEN** a user examines a Call that sent four earlier Briefings again and found one missing
- **THEN** the report SHALL show that the Briefing was sent cleared, that four earlier Briefings were sent again with their total size, and that one was missing

#### Scenario: A fallback Call says so

- **WHEN** a user examines a Call whose model lacked the capabilities
- **THEN** the report SHALL show that the Briefing was sent as a user message

#### Scenario: A Call with no Briefing of its own says so

- **WHEN** a user examines a Call that assembled nothing but sent earlier Briefings again
- **THEN** the report SHALL show that it sent no Briefing of its own, beside the earlier Briefings it sent again

#### Scenario: The summary counts missing Briefings

- **WHEN** a user summarises a Conversation in which some Calls found Briefings missing
- **THEN** the summary SHALL report the number missing across the Conversation

#### Scenario: An older record shows no Briefing line

- **WHEN** a user examines a Call recorded before Briefings were kept
- **THEN** the report SHALL omit the Briefing line rather than show zero

### Requirement: The Opening is examined like any other part

Examining a Call SHALL report the Opening as its own part, named `opening`, with its size, its Budget, and the Turn it came from, and SHALL report it as having no relevance threshold. Where the Opening contributed nothing, the report SHALL give its reason in words that tell the reasons apart: the Turns already carry it, Turn 0's prompt is empty, the first Turn is no longer stored, no Store is configured, retrieval failed, its Budget is zero, or nothing fitted the room left. Comparing two Calls SHALL report the Opening entering or leaving like any other part, and a Conversation summary SHALL report its typical spend beside the other parts. Its size Budget SHALL be changeable within a session under the name `opening-tokens`, as other Budgets are.

#### Scenario: A carried Opening is listed with its source

- **WHEN** a Call whose Pack carried the Opening is examined
- **THEN** the report SHALL list an `opening` line with its size, its Budget and Turn 0, and SHALL NOT report refusals for irrelevance

#### Scenario: Each reason for an absent Opening reads differently

- **WHEN** one Call's Opening was absent because the tail carried Turn 0, another's because Turn 0's prompt was empty, another's because Turn 0 was no longer stored, and another's because no Store was configured
- **THEN** the four reports SHALL each name their own reason, and none SHALL read as the others

#### Scenario: The Opening entering is visible in a comparison

- **WHEN** two Calls are compared, the first before the tail evicted Turn 0 and the second after
- **THEN** the comparison SHALL report the Opening as entering

#### Scenario: The Opening's Budget changes within the session

- **WHEN** `/pack budget opening-tokens 0` is run
- **THEN** the next Call SHALL carry no Opening and its report SHALL say the Opening's Budget is zero
