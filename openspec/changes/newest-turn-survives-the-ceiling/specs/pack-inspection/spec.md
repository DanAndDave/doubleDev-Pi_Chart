## MODIFIED Requirements

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
