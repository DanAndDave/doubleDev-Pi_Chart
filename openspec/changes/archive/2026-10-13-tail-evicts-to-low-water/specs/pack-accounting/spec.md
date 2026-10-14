## MODIFIED Requirements

### Requirement: Accounting records what a call did not carry

Each Call's record SHALL retain what was offered to the Context Pack and not carried, so that an absence can be explained rather than only counted. For each candidate a part rejected as insufficiently relevant, excluded under a Budget, or evicted from the verbatim tail, the record SHALL carry that candidate's identity — a Turn by its position in the Conversation, a Concept by its id, a symbol by its name — together with its distance where relevance decided, its size where a size Budget decided, and the threshold or Budget that excluded it. A Turn the verbatim tail evicted SHALL be recorded as evicted, distinguishably from a Turn a Budget excluded, because the tail that evicted it may be well within its Budgets.

The record SHALL retain a bounded, ranked head of those candidates per Call, ordered nearest first, with a configurable bound. Candidates beyond that head SHALL survive as a count of what was excluded for the same reason, so no exclusion is invisible even where its identity is not retained.

The record SHALL NOT retain the content of a candidate that was not carried. Identity, distance, size and reason are retained; the text is not. The Journal and the Doc Store bundle remain the record of what was said and what is curated, and Accounting SHALL NEVER become a second copy of either.

#### Scenario: A rejected candidate is named, not counted

- **WHEN** retrieval refused a Turn for being too distant and the Call is recorded
- **THEN** the record SHALL carry that Turn's position and its distance rather than only a count of refusals

#### Scenario: The record says what excluded a candidate

- **WHEN** one candidate was refused against a relevance threshold and another was excluded because a Budget was exhausted
- **THEN** each SHALL carry the threshold or the Budget that excluded it, distinguishably

#### Scenario: An evicted turn is recorded as evicted

- **WHEN** the verbatim tail carries fewer Turns than its Budgets allow because older Turns were evicted
- **THEN** the record SHALL name those Turns by position as evicted, with a count of evicted Turns for the part, and SHALL NOT attribute them to the count or token Budget

#### Scenario: The ledger is bounded and the remainder still counted

- **WHEN** more candidates were excluded than the retained bound allows
- **THEN** the record SHALL carry the nearest candidates up to that bound and a count of the rest, and SHALL NOT retain the rest by identity

#### Scenario: Refused content is not retained

- **WHEN** a Call's record is read back
- **THEN** it SHALL carry no text of any candidate that was not carried

#### Scenario: Records written before the ledger existed remain readable

- **WHEN** accounting written by an earlier version is read
- **THEN** it SHALL be returned with the ledger absent rather than failing, and the Call SHALL be reported as unexplainable rather than as having excluded nothing
