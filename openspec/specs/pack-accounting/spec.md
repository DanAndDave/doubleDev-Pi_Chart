# pack-accounting Specification

## Purpose
Recording what each Turn's Context Window was actually made of, separating the part the Assembler controls from the Floor it cannot reach, so that Budgets are set from measurement rather than estimation.

## Requirements

### Requirement: Every turn's window is accounted for

The system SHALL record, for each Turn, the size of the Context Pack it assembled and the size of the Floor — the portion of the Context Window the Assembler does not control, comprising the system prompt, tool schemas, skills, and rules.

#### Scenario: Pack and floor are recorded separately

- **WHEN** a Turn completes
- **THEN** a record SHALL exist giving that Turn's Context Pack size and Floor size as distinct figures

#### Scenario: A trivial pack still reports its floor

- **WHEN** a Turn's Context Pack contains only a short prompt
- **THEN** the recorded Floor SHALL reflect the full non-pack cost of that Turn rather than being reported as absent or zero

### Requirement: Accounting attributes pack contents to their source

Each Turn's record SHALL attribute the Context Pack's composition to the parts that contributed it, so that a pack's size can be explained rather than merely observed. Each part SHALL also record the Budget that bounded it, how many candidates it had, and the identity of what it contributed, so that a pack can be examined after the fact rather than only measured. Where a part carried less than its candidates offered, the record SHALL carry the reason — insufficient relevance, an exhausted count Budget, an exhausted size Budget, or reduction to fit the Pack ceiling — as distinct reasons rather than one undifferentiated shortfall.

#### Scenario: Composition is itemised

- **WHEN** a Context Pack is assembled from more than one contributing part
- **THEN** the record SHALL give each part's contribution to the total

#### Scenario: A part records what it contributed

- **WHEN** a part carried recalled Turns
- **THEN** the record SHALL identify those Turns by their position in the Conversation

#### Scenario: A part records the budget that bounded it

- **WHEN** a part was trimmed to fit its Budget
- **THEN** the record SHALL carry that Budget and the number of candidates considered

#### Scenario: Records written before this detail existed remain readable

- **WHEN** accounting written by an earlier version is read
- **THEN** it SHALL be returned with the added detail absent rather than failing

#### Scenario: Exclusion for size is distinguishable from exclusion for count

- **WHEN** a part's candidates fit its count Budget but were reduced to fit its token Budget
- **THEN** the record SHALL attribute the shortfall to size rather than to count

#### Scenario: Reduction to fit the ceiling is recorded as its own reason

- **WHEN** a part was reduced because the Pack exceeded its ceiling rather than because its own Budget was exhausted
- **THEN** the record SHALL attribute that reduction to the ceiling, and SHALL record what the part would have carried without it

#### Scenario: Shortened content is recorded as shortened

- **WHEN** a part carried content that was shortened to fit
- **THEN** the record SHALL state that the part carried shortened content

### Requirement: Accounting records what a call did not carry

Each Call's record SHALL retain what was offered to the Context Pack and not carried, so that an absence can be explained rather than only counted. For each candidate a part rejected as insufficiently relevant or excluded under a Budget, the record SHALL carry that candidate's identity — a Turn by its position in the Conversation, a Concept by its id, a symbol by its name — together with its distance where relevance decided, its size where a size Budget decided, and the threshold or Budget that excluded it.

The record SHALL retain a bounded, ranked head of those candidates per Call, ordered nearest first, with a configurable bound. Candidates beyond that head SHALL survive as a count of what was excluded for the same reason, so no exclusion is invisible even where its identity is not retained.

The record SHALL NOT retain the content of a candidate that was not carried. Identity, distance, size and reason are retained; the text is not. The Journal and the Doc Store bundle remain the record of what was said and what is curated, and Accounting SHALL NEVER become a second copy of either.

#### Scenario: A rejected candidate is named, not counted

- **WHEN** retrieval refused a Turn for being too distant and the Call is recorded
- **THEN** the record SHALL carry that Turn's position and its distance rather than only a count of refusals

#### Scenario: The record says what excluded a candidate

- **WHEN** one candidate was refused against a relevance threshold and another was excluded because a Budget was exhausted
- **THEN** each SHALL carry the threshold or the Budget that excluded it, distinguishably

#### Scenario: The ledger is bounded and the remainder still counted

- **WHEN** more candidates were excluded than the retained bound allows
- **THEN** the record SHALL carry the nearest candidates up to that bound and a count of the rest, and SHALL NOT retain the rest by identity

#### Scenario: Refused content is not retained

- **WHEN** a Call's record is read back
- **THEN** it SHALL carry no text of any candidate that was not carried

#### Scenario: Records written before the ledger existed remain readable

- **WHEN** accounting written by an earlier version is read
- **THEN** it SHALL be returned with the ledger absent rather than failing, and the Call SHALL be reported as unexplainable rather than as having excluded nothing

### Requirement: Every retrieving part records what it refused

The record for each part that selects from candidates SHALL carry how many of those candidates were refused as insufficiently relevant and the relevance threshold in force, not for recalled Turns alone. Where a part has no relevance threshold, its record SHALL state that rather than record zero refusals, so that a part which refuses nothing is distinguishable from a part which cannot refuse.

A part that contributed nothing SHALL still be accounted for, and the record SHALL distinguish the reasons it contributed nothing: no candidate met the threshold, there were no candidates to consider, retrieval failed, or the Store was never configured. A Budget of zero SHALL be recorded as a deliberate exclusion rather than as an absence of candidates.

#### Scenario: Curated knowledge records its refusals

- **WHEN** Concepts were retrieved and some fell outside the curated relevance threshold
- **THEN** the record SHALL carry the count refused and the threshold they were measured against

#### Scenario: A part without a threshold does not report false refusals

- **WHEN** a part selected from candidates that carry no distance
- **THEN** its record SHALL state that it has no relevance threshold rather than record that nothing was refused as irrelevant

#### Scenario: A threshold set too tight is distinguishable from an empty corpus

- **WHEN** every candidate was refused because the threshold was tighter than any of them
- **THEN** the record SHALL carry the refusals and the threshold, and SHALL NOT read the same as a Call that had no candidates at all

#### Scenario: An unconfigured store is distinguishable from one that found nothing

- **WHEN** a Store was never configured for the Conversation and another Store was configured but returned nothing
- **THEN** the record SHALL distinguish the two

#### Scenario: A failed retrieval is recorded as a failure

- **WHEN** retrieval for a part failed and the Pack was assembled without it
- **THEN** the record SHALL attribute that part's absence to the failure rather than to irrelevance

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

The system SHALL record both its own estimate of a Context Pack's size and the size the harness reported for the Context Window that carried it, so the estimate's accuracy is observable rather than assumed. The estimate SHALL account for every part of a message that is sent to the model, not a subset of it. The estimate SHALL remain deterministic, and SHALL NEVER be presented as the measured window size where the harness has reported one.

#### Scenario: Both figures are retained for a call

- **WHEN** a Call completes and the harness reports its window size
- **THEN** the record SHALL carry the estimate made at assembly and the reported size, distinguishably

#### Scenario: The estimate covers the whole message

- **WHEN** a message carries content alongside other fields that are sent with it
- **THEN** the estimate SHALL include those fields rather than the content alone

#### Scenario: The reported size wins where both exist

- **WHEN** a pack-versus-Floor figure is reported for a Call the harness measured
- **THEN** that figure SHALL come from the reported sizes, not from the estimate

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
