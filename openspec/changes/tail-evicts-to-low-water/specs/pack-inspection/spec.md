## MODIFIED Requirements

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
