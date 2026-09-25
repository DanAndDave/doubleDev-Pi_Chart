## MODIFIED Requirements

### Requirement: Re-indexing covers only what changed

The system SHALL re-index a Concept when its content changes, or when its stored vector was produced by an embedding model other than the one in use, and SHALL leave every other Concept alone, so that keeping the index current costs about as much as the edit — or the model change — that prompted it.

#### Scenario: An edited concept is re-indexed

- **WHEN** a Concept's content changes and the bundle is indexed again
- **THEN** a query matching the new content SHALL retrieve it

#### Scenario: Unchanged concepts are not re-embedded

- **WHEN** a bundle is indexed twice with no edits and no change of embedding model between
- **THEN** the second pass SHALL embed nothing

#### Scenario: A removed concept leaves the index

- **WHEN** a Concept is deleted from the bundle and the bundle is indexed again
- **THEN** it SHALL no longer be retrievable

## ADDED Requirements

### Requirement: A Concept's vector is valid only for the model that produced it

A section's stored vector SHALL cease to be valid when the embedding model in use is not the model that produced it. An invalid vector SHALL NOT be ranked, and SHALL be treated as though the section had no vector, so that the pass which embeds a new section is also the pass which repairs one left behind by a model change. Two models' coordinates mean different things; ranking a query from one against vectors from the other returns a Concept that is wrong for a reason nothing reports.

A search SHALL say how much of the index it could not see, so that curated knowledge coming back thin reads as an index in transition rather than as a corpus with nothing relevant in it.

#### Scenario: A vector from another model is never a hit

- **WHEN** a section's stored vector was produced by a different embedding model
- **THEN** that section SHALL NOT be returned, however near the query it would otherwise measure

#### Scenario: A section left behind by a model change is repaired

- **WHEN** the index is brought in line while a different embedding model is in use
- **THEN** sections embedded by the previous model SHALL be embedded again, whether or not their text changed

#### Scenario: What the search could not see is reported

- **WHEN** a search runs while the index holds Concepts it could not rank, because every vector they hold was produced by another embedding model
- **THEN** the search SHALL report how many, and the Call's record SHALL carry that number beside what the relevance threshold refused
