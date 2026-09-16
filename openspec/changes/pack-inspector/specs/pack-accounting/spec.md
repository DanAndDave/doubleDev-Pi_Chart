## MODIFIED Requirements

### Requirement: Accounting attributes pack contents to their source

Each Turn's record SHALL attribute the Context Pack's composition to the parts that contributed it, so that a pack's size can be explained rather than merely observed. Each part SHALL also record the Budget that bounded it, how many candidates it had, and the identity of what it contributed, so that a pack can be examined after the fact rather than only measured.

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
