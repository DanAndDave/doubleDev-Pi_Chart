## MODIFIED Requirements

### Requirement: The Journal is ingested into the store

The system SHALL ingest the harness's Journal into the Thread Store: each Turn's prompt, the agent's responses, every tool call with its result, and any artifact produced. Ingested content SHALL be addressed by Conversation, Turn, and Call, and SHALL record the Codebase the Conversation belongs to, so content found later can be attributed to where it came from.

A Turn answered in several Calls SHALL record which Call each piece of content belongs to, so a recollection can say where within a Turn it came from. Content whose Call cannot be established SHALL be addressed to the Turn's first Call rather than refused.

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

#### Scenario: A turn answered in several calls

- **WHEN** a Turn whose agent made several Calls is ingested
- **THEN** each piece of its content SHALL record which Call produced it

#### Scenario: A turn answered in one call

- **WHEN** a Turn was answered without a tool loop
- **THEN** all of its content SHALL be addressed to that Turn's first Call

#### Scenario: Content stored before calls were recorded remains readable

- **WHEN** content ingested before the Call was recorded is read
- **THEN** it SHALL be returned addressed to the Turn's first Call rather than failing

#### Scenario: A recollection says how much work its turn took

- **WHEN** a Turn spanning several Calls is found by searching
- **THEN** the result SHALL say how many Calls that Turn took
