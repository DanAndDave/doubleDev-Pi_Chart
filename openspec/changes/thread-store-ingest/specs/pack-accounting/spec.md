## MODIFIED Requirements

### Requirement: Accounting is readable after the fact

Recorded accounting SHALL be readable outside the Turn that produced it, covering an entire Conversation, so that pack-versus-Floor ratios can be examined across a real session. Accounting SHALL live in the Thread Store alongside the Turns it describes.

#### Scenario: A whole session can be examined

- **WHEN** accounting is read for a completed Conversation
- **THEN** each Turn's pack and Floor figures SHALL be retrievable in Turn order

#### Scenario: Accounting outlives the process that recorded it

- **WHEN** accounting is read in a later process than the one that wrote it
- **THEN** the earlier Turns' figures SHALL still be present
