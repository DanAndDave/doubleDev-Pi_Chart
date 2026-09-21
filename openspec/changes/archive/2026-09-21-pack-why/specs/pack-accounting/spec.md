## ADDED Requirements

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
