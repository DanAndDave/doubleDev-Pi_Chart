## ADDED Requirements

### Requirement: The store holds the Conversation's active branch

The Thread Store SHALL hold the Turns on the Conversation's active branch, the parent chain from the harness's current leaf back to the root of the Journal, and SHALL NOT hold Turns that exist only on a branch the harness has left. Ingest SHALL number Turns along that chain, not in file order. When the harness moves its leaf (`/tree`, `/branch`), the store SHALL discard every stored Turn from the first one the branch it left and the branch it moved to do not share, then ingest the active branch from there. A rewind that cannot reach the store SHALL be reported, and SHALL NOT fail the navigation.

#### Scenario: Ingest skips an abandoned branch

- **WHEN** a Journal holds a Turn that a later entry's parent chain bypasses
- **THEN** ingesting it SHALL store only the Turns on the chain from the last entry, numbered in chain order

#### Scenario: A rewind drops the abandoned Turns from the next pack

- **WHEN** the store holds Turns 0 to 2, the harness rewinds to the end of Turn 0, and the next Call is assembled
- **THEN** the pack's verbatim tail SHALL hold Turn 0 and SHALL NOT hold the abandoned Turns 1 and 2

#### Scenario: A rewind into the middle of a Turn keeps only its kept part

- **WHEN** the harness rewinds to an entry inside a stored Turn
- **THEN** that Turn SHALL be stored again holding only the messages up to the new leaf

#### Scenario: The continued branch reuses the abandoned positions

- **WHEN** the Conversation continues after a rewind past the number of Turns it had before
- **THEN** each position SHALL hold the Turn from the active branch, never the abandoned Turn that held it earlier

#### Scenario: Returning to a longer branch keeps none of the branch left

- **WHEN** the store holds a shorter branch's Turns and the harness moves its leaf to the end of a longer branch that parted from it earlier
- **THEN** the store SHALL hold exactly the longer branch's Turns, none of the shorter one's

#### Scenario: A rewind with the store unreachable

- **WHEN** the harness rewinds while the Thread Store cannot be reached
- **THEN** the failure SHALL be reported and the navigation SHALL complete
