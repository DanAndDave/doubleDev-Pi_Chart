## ADDED Requirements

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
