## MODIFIED Requirements

### Requirement: Retrieval is scoped to one Conversation

Retrieval SHALL return content from the current Conversation only. Content from other Conversations SHALL NOT appear unless a search explicitly asks for a wider scope, and no Context Pack SHALL be assembled from content outside the current Conversation.

#### Scenario: Another conversation's turns stay out

- **WHEN** two Conversations have been ingested and the tail is retrieved for one
- **THEN** no Turn belonging to the other SHALL be returned

#### Scenario: Turns come back in order

- **WHEN** the most recent Turns are retrieved for a Conversation
- **THEN** they SHALL be returned in Turn order, each with its messages in the order they occurred

#### Scenario: Recall into a pack stays within the conversation

- **WHEN** another Conversation holds a Turn more relevant to the prompt than anything in this one
- **THEN** the Context Pack SHALL NOT carry it

### Requirement: The Journal is ingested into the store

The system SHALL ingest the harness's Journal into the Thread Store: each Turn's prompt, the agent's responses, every tool call with its result, and any artifact produced. Ingested content SHALL be addressed by Conversation, Turn, and Call, and SHALL record the Codebase the Conversation belongs to, so content found later can be attributed to where it came from.

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

#### Scenario: A conversation records where it happened

- **WHEN** a Conversation is ingested from a Codebase
- **THEN** its Turns SHALL be retrievable with that Codebase

#### Scenario: Turns stored before this was recorded remain readable

- **WHEN** Turns ingested before the Codebase was recorded are read
- **THEN** they SHALL be returned with the Codebase absent rather than failing
