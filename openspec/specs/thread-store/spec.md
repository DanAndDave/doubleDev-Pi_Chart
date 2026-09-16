# thread-store Specification

## Purpose
Holding what happened in a Conversation — Turns, tool calls, results, and artifacts — in a durable store that outlives any single process, so the Assembler can retrieve history the harness is no longer carrying.

## Requirements

### Requirement: The Journal is ingested into the store

The system SHALL ingest the harness's Journal into the Thread Store: each Turn's prompt, the agent's responses, every tool call with its result, and any artifact produced. Ingested content SHALL be addressed by Conversation, Turn, and Call.

#### Scenario: A real session becomes queryable

- **WHEN** a Conversation containing a tool-using Turn has been ingested
- **THEN** that Turn's prompt, response, tool call, and tool result SHALL each be retrievable, addressed to that Conversation and Turn

#### Scenario: A failed tool result is kept as it happened

- **WHEN** a Turn contains a tool call that errored
- **THEN** the stored result SHALL record the failure rather than omitting the call

#### Scenario: Ingest is repeatable

- **WHEN** the same Journal is ingested more than once
- **THEN** the store SHALL hold one record per Turn, Call, and tool call, not duplicates

#### Scenario: Ingest resumes where it stopped

- **WHEN** a Conversation grows after an earlier ingest
- **THEN** ingesting again SHALL add only what is new

### Requirement: The store is derived and rebuildable

The Thread Store SHALL be a derived index over the Journal, never the record of what happened. Discarding the store and re-ingesting from the Journal SHALL restore equivalent content.

#### Scenario: A discarded store is rebuilt from disk

- **WHEN** the store is emptied and the Journal re-ingested
- **THEN** the Context Pack assembled for a given Turn SHALL be identical to the one assembled before

#### Scenario: Losing the store never loses history

- **WHEN** the store is unavailable
- **THEN** no Journal content SHALL be lost or altered

### Requirement: Retrieval is scoped to one Conversation

Retrieval SHALL return content from the current Conversation only. Content from other Conversations SHALL NOT appear without an explicit request naming a wider scope, which this capability does not yet offer.

#### Scenario: Another conversation's turns stay out

- **WHEN** two Conversations have been ingested and the tail is retrieved for one
- **THEN** no Turn belonging to the other SHALL be returned

#### Scenario: Turns come back in order

- **WHEN** the most recent Turns are retrieved for a Conversation
- **THEN** they SHALL be returned in Turn order, each with its messages in the order they occurred

### Requirement: The schema is versioned and applied forward

The system SHALL own its schema and apply migrations forward automatically, so that a store created by an older version becomes usable without manual intervention.

#### Scenario: An empty database is made ready

- **WHEN** the system connects to a database with no schema
- **THEN** it SHALL create the schema and report the store ready

#### Scenario: Migrations are not reapplied

- **WHEN** the system connects to an already-migrated database
- **THEN** it SHALL leave existing content intact

### Requirement: An unreachable store degrades safely

When the Thread Store cannot be reached, the system SHALL report the failure and continue the Turn with whatever history the harness itself provides, rather than sending an empty or partial Context Pack.

#### Scenario: A turn survives an unreachable store

- **WHEN** the store cannot be reached while a Context Pack is being assembled
- **THEN** the Turn SHALL proceed and the failure SHALL be reported

#### Scenario: Degradation is visible, not silent

- **WHEN** a Context Pack is assembled without the store
- **THEN** the accounting for that Call SHALL show that the tail did not come from the store

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
