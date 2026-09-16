## MODIFIED Requirements

### Requirement: A part reports how much of its budget it spent

The system SHALL report each part's contribution against the Budget that bounded it, including when a part was trimmed to fit. Where content was excluded for being insufficiently relevant rather than for exceeding a Budget, the report SHALL distinguish the two, so that a part which carried little is recognisable as having found little worth carrying.

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
