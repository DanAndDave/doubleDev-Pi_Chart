## ADDED Requirements

### Requirement: Concepts are indexed for retrieval

The system SHALL index the bundle's Concepts so they can be found by meaning: each Concept SHALL be divided into parts small enough to retrieve usefully, and each part embedded. The index SHALL be derived from the bundle and rebuildable from it.

#### Scenario: A concept becomes findable

- **WHEN** a bundle has been indexed
- **THEN** a Concept SHALL be retrievable by a query that shares its meaning but not its wording

#### Scenario: A long concept is divided rather than averaged

- **WHEN** a Concept covers several subjects under separate headings
- **THEN** a query matching one of them SHALL retrieve that Concept without needing to match the rest

#### Scenario: Discarding the index loses nothing

- **WHEN** the index is emptied and the bundle indexed again
- **THEN** the same query SHALL retrieve the same Concepts

#### Scenario: A non-conformant concept is not indexed

- **WHEN** the bundle contains a Concept that could not be read
- **THEN** it SHALL be excluded from the index and the rest SHALL still be indexed

### Requirement: Re-indexing covers only what changed

The system SHALL re-index a Concept when its content changes and SHALL leave unchanged Concepts alone, so that keeping the index current costs about as much as the edit that prompted it.

#### Scenario: An edited concept is re-indexed

- **WHEN** a Concept's content changes and the bundle is indexed again
- **THEN** a query matching the new content SHALL retrieve it

#### Scenario: Unchanged concepts are not re-embedded

- **WHEN** a bundle is indexed twice with no edits between
- **THEN** the second pass SHALL embed nothing

#### Scenario: A removed concept leaves the index

- **WHEN** a Concept is deleted from the bundle and the bundle is indexed again
- **THEN** it SHALL no longer be retrievable

### Requirement: Retrieval respects lifecycle and trust

Retrieval SHALL return Concepts relevant to a query, most relevant first, subject to a relevance minimum. A deprecated Concept SHALL NOT be returned. Among Concepts of comparable relevance, those that are current and human-reviewed SHALL be preferred over those that are stale or unverified.

#### Scenario: A deprecated concept is withheld

- **WHEN** a deprecated Concept is the closest match for a query
- **THEN** it SHALL NOT be returned

#### Scenario: Current and reviewed knowledge comes first

- **WHEN** two Concepts are comparably relevant and one is stale or unverified while the other is current and human-reviewed
- **THEN** the current, human-reviewed one SHALL be returned first

#### Scenario: Nothing relevant returns nothing

- **WHEN** no Concept meets the relevance minimum for a query
- **THEN** retrieval SHALL return no Concepts rather than the nearest available

#### Scenario: An unindexed bundle retrieves nothing rather than failing

- **WHEN** retrieval runs before the bundle has been indexed
- **THEN** it SHALL return nothing and SHALL NOT raise
