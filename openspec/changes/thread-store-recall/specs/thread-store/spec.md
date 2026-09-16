## ADDED Requirements

### Requirement: Ingested turns are embedded

The system SHALL embed each ingested Turn so it can be retrieved by meaning rather than by recency. Embedding SHALL happen away from the model request's path, and the same text SHALL always produce the same vector.

#### Scenario: A turn becomes retrievable after ingest

- **WHEN** a Turn has been ingested and embedding has run
- **THEN** that Turn SHALL be retrievable by a prompt that shares its meaning but not its wording

#### Scenario: Embedding is deterministic

- **WHEN** the same text is embedded twice
- **THEN** both vectors SHALL be identical

#### Scenario: Embedding never delays a turn

- **WHEN** embedding is slow or fails
- **THEN** the Turn SHALL still complete and the failure SHALL be reported

### Requirement: Embedding backfill is resumable

The system SHALL embed Turns that were ingested before embedding was available, and SHALL be able to continue after interruption without repeating work already done.

#### Scenario: Existing turns are embedded without re-ingesting

- **WHEN** a Conversation was ingested before embeddings existed and backfill runs
- **THEN** its Turns SHALL become retrievable without the Journal being ingested again

#### Scenario: Backfill resumes rather than restarts

- **WHEN** backfill runs again after being interrupted
- **THEN** it SHALL embed only the Turns still lacking a vector

### Requirement: Retrieval ranks turns by similarity to the prompt

The system SHALL return the Turns most similar in meaning to a given prompt, most similar first, limited to a requested count. Retrieval SHALL remain scoped to the current Conversation.

#### Scenario: The most relevant turn comes first

- **WHEN** a Conversation holds Turns on several subjects and one is retrieved for a prompt about one of them
- **THEN** the Turn on that subject SHALL rank above the others

#### Scenario: Retrieval does not reach into another conversation

- **WHEN** two Conversations hold Turns on the same subject and one retrieves
- **THEN** no Turn belonging to the other SHALL be returned

#### Scenario: Turns already carried verbatim are not retrieved again

- **WHEN** retrieval runs for a Call whose verbatim tail already holds a matching Turn
- **THEN** that Turn SHALL NOT also be returned as a recollection

#### Scenario: An unembedded conversation retrieves nothing rather than failing

- **WHEN** retrieval runs against a Conversation whose Turns have no vectors yet
- **THEN** it SHALL return no Turns and SHALL NOT raise
