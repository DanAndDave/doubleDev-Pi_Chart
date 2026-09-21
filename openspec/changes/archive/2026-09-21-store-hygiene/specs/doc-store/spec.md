## ADDED Requirements

### Requirement: Concept retrieval selects from a totally ordered candidate set

Concept retrieval SHALL select from a candidate set whose order is total: no two candidates SHALL be left equally placed, so that no part of the selection is decided by the index's own traversal. The same query against the same Concepts SHALL select the same Concepts, in the same order, across repeated retrieval and across a rebuild of the retrieval index. Nearness SHALL decide first; where candidates are equally near, their Concept identity SHALL decide, which is stable across a rename and across a rebuild.

#### Scenario: The same query selects the same concepts

- **WHEN** the same query is retrieved for twice with no change to the bundle
- **THEN** the same Concepts SHALL be returned in the same order

#### Scenario: A rebuilt index selects the same concepts

- **WHEN** the retrieval index is discarded and built again from unchanged Concepts, and the same query is retrieved for
- **THEN** the same Concepts SHALL be returned in the same order as before the rebuild

#### Scenario: Equally near candidates are ordered predictably

- **WHEN** two Concepts are equally near a query at the boundary of what the candidate set holds
- **THEN** which of them enters the candidate set SHALL be decided by Concept identity and SHALL be the same on every retrieval

#### Scenario: Determinism survives a corpus larger than the candidate set

- **WHEN** the bundle holds more Concepts than the candidate set admits
- **THEN** repeated retrieval SHALL admit the same candidates, so a Concept SHALL NOT appear in one Pack and be absent from the next without the bundle or the configuration changing
