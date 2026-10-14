# pack-accounting Specification

## Purpose
Recording what each Turn's Context Window was actually made of, separating the part the Assembler controls from the Floor it cannot reach, so that Budgets are set from measurement rather than estimation.

## Requirements

### Requirement: Every turn's window is accounted for

The system SHALL record, for each Turn, the size of the Context Pack it assembled and the size of the Floor — the portion of the Context Window the Assembler does not control, comprising the harness's system prompt, tool schemas, skills, and rules.

pi-chart's additions to the system prompt — every Pin, the Opening, and the fixed eviction notice — SHALL be counted in the Context Pack and SHALL NOT be counted in the Floor. The Floor SHALL be recorded as the non-message size the harness reported for the Call less the size of the additions pi-chart made to that Call's system prompt, and never below zero. The Pack size SHALL be the reported window size less that Floor. Where pi-chart made no additions to a Call's system prompt, nothing SHALL be subtracted.

The Pins and the Opening SHALL be recorded as Pack parts, `pinned` and `opening`, each marked as placed in the system prompt, so that a reader can tell them from the parts sent as messages. A part recorded without a placement SHALL be read as sent among the messages.

#### Scenario: Pack and floor are recorded separately

- **WHEN** a Turn completes
- **THEN** a record SHALL exist giving that Turn's Context Pack size and Floor size as distinct figures

#### Scenario: A trivial pack still reports its floor

- **WHEN** a Turn's Context Pack contains only a short prompt
- **THEN** the recorded Floor SHALL reflect the full non-pack cost of that Turn rather than being reported as absent or zero

#### Scenario: pi-chart's system-prompt additions count toward the pack

- **WHEN** a Call's system prompt carried two Pins and the Opening and the harness reported the Call's non-message size
- **THEN** the recorded Floor SHALL be that reported size less the size of pi-chart's additions
- **AND** the recorded Pack size SHALL include the size of those additions

#### Scenario: A call without additions keeps its whole non-message size as floor

- **WHEN** pi-chart added nothing to a Call's system prompt because the harness never offered it the system prompt for that Turn
- **THEN** the recorded Floor SHALL be the whole non-message size the harness reported

#### Scenario: The system-prompt parts are recorded with their placement

- **WHEN** a Call's Pack carried Pins and the Opening
- **THEN** the record SHALL hold a `pinned` part and an `opening` part, each marked as placed in the system prompt

#### Scenario: Parts recorded before placement existed read as message parts

- **WHEN** accounting written by an earlier version is read
- **THEN** each of its parts SHALL be returned as sent among the messages rather than failing

### Requirement: Accounting attributes pack contents to their source

Each Turn's record SHALL attribute the Context Pack's composition to the parts that contributed it — the Pins, the Opening, the verbatim tail, and the current Turn — so that a pack's size can be explained rather than merely observed. Each part SHALL also record the Budget that bounded it, how many candidates it had, the identity of what it contributed, and where it was placed, so that a pack can be examined after the fact rather than only measured. Where a part carried less than its candidates offered, the record SHALL carry the reason — an exhausted count Budget, an exhausted size Budget, Eviction from the verbatim tail, or reduction to fit the Pack ceiling — as distinct reasons rather than one undifferentiated shortfall. Where a part carried a Turn with messages dropped, the record SHALL carry how many messages were dropped, distinct from whether content was shortened.

A part that contributed nothing SHALL still be accounted for, and the record SHALL distinguish the reasons it contributed nothing: there was nothing to carry, retrieval failed, no Store was configured, or the harness never offered the system prompt for the Turn. A Budget of zero SHALL be recorded as a deliberate exclusion rather than as an absence of candidates.

What the model pulls with a tool during a Turn is content of the Turn that carries it. The record SHALL count it within the verbatim tail or the current Turn, and SHALL NOT record it as a part of its own or attribute it to the Store it came from.

#### Scenario: Composition is itemised

- **WHEN** a Context Pack is assembled from more than one contributing part
- **THEN** the record SHALL give each part's contribution to the total

#### Scenario: A part records what it contributed

- **WHEN** the verbatim tail carried completed Turns
- **THEN** the record SHALL identify those Turns by their position in the Conversation

#### Scenario: The system-prompt parts record what they contributed

- **WHEN** a Call's system prompt carried Pins and the Opening
- **THEN** the `pinned` part SHALL identify the Pins by their ids and the `opening` part SHALL identify Turn 0, each with its size

#### Scenario: A part records the budget that bounded it

- **WHEN** a part was trimmed to fit its Budget
- **THEN** the record SHALL carry that Budget and the number of candidates considered

#### Scenario: Records written before this detail existed remain readable

- **WHEN** accounting written by an earlier version is read, including parts and reasons this version no longer records
- **THEN** it SHALL be returned with the added detail absent rather than failing

#### Scenario: Exclusion for size is distinguishable from exclusion for count

- **WHEN** a part's candidates fit its count Budget but were reduced to fit its token Budget
- **THEN** the record SHALL attribute the shortfall to size rather than to count

#### Scenario: Reduction to fit the ceiling is recorded as its own reason

- **WHEN** the verbatim tail was reduced because the Pack exceeded its ceiling rather than because its own Budget was exhausted
- **THEN** the record SHALL attribute that reduction to the ceiling, and SHALL record what the part would have carried without it

#### Scenario: Shortened content is recorded as shortened

- **WHEN** a part carried content that was shortened to fit
- **THEN** the record SHALL state that the part carried shortened content

#### Scenario: Dropped messages are recorded as a count

- **WHEN** the verbatim tail carried its newest Turn with tool-call groups dropped
- **THEN** the record SHALL give the number of messages dropped for that part, and a part that dropped none SHALL carry no count

#### Scenario: A failed retrieval is recorded as a failure

- **WHEN** the Opening could not be read from the Thread Store in time and the Turn was sent without it
- **THEN** the `opening` part SHALL be recorded as absent because retrieval failed

#### Scenario: An unconfigured store is distinguishable from one that had nothing

- **WHEN** one Call's Opening was absent because no Thread Store was configured and another's because Turn 0 was not stored
- **THEN** the record SHALL distinguish the two

#### Scenario: A turn the hook never reached records its system-prompt parts as absent

- **WHEN** the harness did not offer pi-chart the system prompt for a Turn
- **THEN** each Call of that Turn SHALL record the `pinned` and `opening` parts as absent for that reason, distinguishably from a Conversation with no Pins or an Opening that failed

#### Scenario: A zero budget is a deliberate exclusion

- **WHEN** the Opening's size Budget is zero
- **THEN** the `opening` part SHALL be recorded as excluded by its Budget rather than as having nothing to carry

#### Scenario: A pulled tool result is turn content

- **WHEN** the model called `recall_earlier_turns` during a Turn and the result was sent on a later Call of that Turn
- **THEN** that later Call's record SHALL count the result within the current Turn's part
- **AND** the record SHALL hold no part for recall

### Requirement: Accounting records what a call did not carry

Each Call's record SHALL retain what was offered to the Context Pack and not carried, so that an absence can be explained rather than only counted. For each Turn the verbatim tail excluded under a Budget, reduced away to fit the Pack ceiling, or evicted, and for the Opening where its Budget excluded it, the record SHALL carry that candidate's identity — a Turn by its position in the Conversation — together with its size where a size Budget decided, and the Budget, ceiling or Eviction that excluded it. A Turn the verbatim tail evicted SHALL be recorded as evicted, distinguishably from a Turn a Budget excluded, because the tail that evicted it may be well within its Budgets.

The Pins and the Opening SHALL be recorded as absent, with the reason, where they were not sent: the reasons are the same as for any part that contributed nothing, including that the harness never offered the system prompt for the Turn. A Pin is never excluded under a Budget or the ceiling, so no Pin SHALL appear among the excluded candidates.

Content the model pulled with a tool, and candidates a tool considered and did not return, SHALL NOT be recorded as excluded candidates: no Pack part selected them, and the Journal records the tool's result.

The record SHALL retain a bounded head of those candidates per Call, newest Turn first, with a configurable bound. Candidates beyond that head SHALL survive as a count of what was excluded for the same reason, so no exclusion is invisible even where its identity is not retained.

The record SHALL NOT retain the content of a candidate that was not carried. Identity, size and reason are retained; the text is not. The Journal remains the record of what was said, and Accounting SHALL NEVER become a second copy of it.

#### Scenario: A rejected candidate is named, not counted

- **WHEN** the verbatim tail's count Budget kept a completed Turn out and the Call is recorded
- **THEN** the record SHALL carry that Turn's position and the Budget that excluded it rather than only a count of exclusions

#### Scenario: The record says what excluded a candidate

- **WHEN** one Turn was excluded because a Budget was exhausted and another was reduced away to fit the Pack ceiling
- **THEN** each SHALL carry the Budget or the ceiling that excluded it, distinguishably

#### Scenario: An evicted turn is recorded as evicted

- **WHEN** the verbatim tail carries fewer Turns than its Budgets allow because older Turns were evicted
- **THEN** the record SHALL name those Turns by position as evicted, with a count of evicted Turns for the part, and SHALL NOT attribute them to the count or token Budget

#### Scenario: Absent system-prompt parts carry their reason

- **WHEN** a Call's Pins and Opening were not sent because the harness never offered the system prompt for its Turn
- **THEN** the record SHALL carry the `pinned` and `opening` parts as absent for that reason, and SHALL list no Pin among the excluded candidates

#### Scenario: Pulled content is not a ledger entry

- **WHEN** the model called `recall_earlier_turns` or `search_documentation` during a Turn
- **THEN** no Turn or Concept the tool returned or passed over SHALL be recorded as an excluded candidate of any Call

#### Scenario: The ledger is bounded and the remainder still counted

- **WHEN** more candidates were excluded than the retained bound allows
- **THEN** the record SHALL carry the newest candidates up to that bound and a count of the rest, and SHALL NOT retain the rest by identity

#### Scenario: Refused content is not retained

- **WHEN** a Call's record is read back
- **THEN** it SHALL carry no text of any candidate that was not carried

#### Scenario: Records written before the ledger existed remain readable

- **WHEN** accounting written by an earlier version is read
- **THEN** it SHALL be returned with the ledger absent rather than failing, and the Call SHALL be reported as unexplainable rather than as having excluded nothing

#### Scenario: Records holding retrieval exclusions remain readable

- **WHEN** accounting written before this change is read, holding Concepts, symbols or Turns refused against a relevance threshold
- **THEN** it SHALL be returned with those entries as recorded rather than failing

### Requirement: A harness compaction is recorded against the call it affected

Where the harness reports that it has compacted the Conversation, the system SHALL record that fact against the Call at which the change was first reported, so that Calls assembled before a compaction are distinguishable from Calls assembled after it. Detecting a compaction SHALL NOT alter a Context Pack, delay a Call, or fail a Turn.

#### Scenario: A compaction is recorded where it happened

- **WHEN** the harness reports a compaction of the Conversation between two Calls
- **THEN** the later Call's record SHALL carry that a compaction occurred and the earlier Call's SHALL NOT

#### Scenario: A conversation the harness never compacted records no compaction

- **WHEN** every Call of a Conversation is reported under the same compaction state
- **THEN** no Call SHALL be recorded as compacted

#### Scenario: Detection cannot disturb the turn

- **WHEN** a compaction is detected
- **THEN** the Turn SHALL complete normally and its Context Pack SHALL be unchanged by the detection

### Requirement: Accounting is readable after the fact

Recorded accounting SHALL be readable outside the Turn that produced it, covering an entire Conversation, so that pack-versus-Floor ratios can be examined across a real session. Accounting SHALL live in the Thread Store alongside the Turns it describes.

#### Scenario: A whole session can be examined

- **WHEN** accounting is read for a completed Conversation
- **THEN** each Turn's pack and Floor figures SHALL be retrievable in Turn order

#### Scenario: Accounting outlives the process that recorded it

- **WHEN** accounting is read in a later process than the one that wrote it
- **THEN** the earlier Turns' figures SHALL still be present

### Requirement: Accounting never disturbs the turn

Recording accounting SHALL NOT alter a Context Pack, delay the model request, or cause a Turn to fail. If accounting cannot be recorded, the Turn SHALL proceed and the omission SHALL be reported.

#### Scenario: A failed recording does not fail the turn

- **WHEN** accounting cannot be written for a Turn
- **THEN** the Turn SHALL complete normally and the failure SHALL be reported

### Requirement: The recorded pack size is comparable to the reported window

The system SHALL record both its own estimate of a Context Pack's size and the size the harness reported for the Context Window that carried it, so the estimate's accuracy is observable rather than assumed. The estimate SHALL account for everything pi-chart sends — its additions to the system prompt as well as every part of every message sent to the model — not a subset of it. The estimate SHALL remain deterministic, and SHALL NEVER be presented as the measured window size where the harness has reported one.

The harness reports the system prompt as part of one non-message figure, so the size of pi-chart's additions to it is not measured. Where the harness has reported a Call's sizes, the pack-versus-Floor figures SHALL come from the reported sizes, with only the size of pi-chart's system-prompt additions taken from the estimate.

#### Scenario: Both figures are retained for a call

- **WHEN** a Call completes and the harness reports its window size
- **THEN** the record SHALL carry the estimate made at assembly and the reported size, distinguishably

#### Scenario: The estimate covers the whole message

- **WHEN** a message carries content alongside other fields that are sent with it
- **THEN** the estimate SHALL include those fields rather than the content alone

#### Scenario: The estimate covers the system-prompt additions

- **WHEN** a Call's system prompt carried Pins, the Opening and the eviction notice
- **THEN** the estimate SHALL include their size

#### Scenario: The reported size wins where both exist

- **WHEN** a pack-versus-Floor figure is reported for a Call the harness measured
- **THEN** that figure SHALL come from the reported sizes, not from the estimate, except for the size of pi-chart's system-prompt additions, which SHALL come from the estimate

### Requirement: A pack approaching its ceiling is reported

When a Context Pack occupies more than a configured share of the Pack ceiling, the system SHALL report that, so a Conversation whose Packs are creeping toward the ceiling is visible while it is running rather than only once reduction starts discarding content. The ceiling is used as the reference because it is the limit the operator set; the harness reports the size of each Context Window it sent but never the model's maximum, so no larger limit is knowable to the system. The report SHALL NOT alter the Pack, delay the Call, or fail the Turn.

#### Scenario: Crossing the share is reported

- **WHEN** a Call's Pack size exceeds the configured share of the Pack ceiling
- **THEN** the condition SHALL be reported, naming the Pack size and the ceiling it was measured against

#### Scenario: A quiet conversation is not reported

- **WHEN** every Call's Pack stays within the configured share
- **THEN** nothing SHALL be reported

#### Scenario: Reporting cannot disturb the turn

- **WHEN** the condition is detected
- **THEN** the Turn SHALL complete normally and the Context Pack SHALL be unchanged by the detection

### Requirement: The competing-injector state is recorded per call

Each Call's record SHALL carry whether the harness's own memory backend was off, active, or unconfirmed at the time, so that a Context Window whose Floor may have carried recalled content from another component is identifiable after the fact. The state SHALL be recorded whether or not anything was reported, and recording it SHALL NOT alter a Context Pack, delay a Call, or fail a Turn.

#### Scenario: The state is retained for every call

- **WHEN** a Call's Accounting is written
- **THEN** it SHALL carry the backend state observed for that Conversation

#### Scenario: Unconfirmed is distinguishable from off

- **WHEN** the harness never reported its backend
- **THEN** the record SHALL say unconfirmed rather than off

#### Scenario: Exposed calls can be listed for a conversation

- **WHEN** Accounting is read for a Conversation in which the backend was active
- **THEN** the Calls made while it was active SHALL be identifiable among that Conversation's Calls

#### Scenario: Records written before this detail existed remain readable

- **WHEN** Accounting written by an earlier version is read
- **THEN** it SHALL be returned with the backend state absent rather than failing
