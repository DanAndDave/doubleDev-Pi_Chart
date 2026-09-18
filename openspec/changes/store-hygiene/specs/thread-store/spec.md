## MODIFIED Requirements

### Requirement: The Journal is ingested into the store

The system SHALL ingest the harness's Journal into the Thread Store: each Turn's prompt, the agent's responses, every tool call with its result, and any artifact produced. Ingested content SHALL be addressed by Conversation, Turn, and Call, and SHALL record the Codebase the Conversation belongs to, so content found later can be attributed to where it came from.

The extension also constructs a Postgres Store for every dependency set but its shutdown callback closes only the embedder, despite `PostgresStore.close()` existing. Repeated extension sessions therefore leave SQL pools alive until PostgreSQL refuses new clients; that is the observed reason the final store-backed token-budget check cannot currently obtain a connection.

A Turn's Codebase SHALL be recorded when that Turn is first stored, and SHALL NOT be replaced by a later ingest, whatever Codebase that ingest runs from. A Turn happened in one place; resuming its Conversation elsewhere does not move it.

A Turn answered in several Calls SHALL record which Call each piece of content belongs to, so a recollection can say where within a Turn it came from. Content whose Call cannot be established SHALL be addressed to the Turn's first Call rather than refused.

Ingesting a Conversation again SHALL add only what is new. The work an ingest performs SHALL be proportional to the content not yet stored and SHALL NOT grow with the length of the Conversation, and content already stored SHALL NOT be written again.

#### Scenario: A real session becomes queryable

- **WHEN** a Conversation containing a tool-using Turn has been ingested
- **THEN** that Turn's prompt, response, tool call, and tool result SHALL each be retrievable, addressed to that Conversation and Turn

- Every Store resource constructed for a session is released when that session ends, even if the final sweep fails.
#### Scenario: A failed tool result is kept as it happened

- **WHEN** a Turn contains a tool call that errored
- **THEN** the stored result SHALL record the failure rather than omitting the call

#### Scenario: Ingest is repeatable

- **WHEN** the same Journal is ingested more than once
- **THEN** the store SHALL hold one record per Turn, Call, and tool call, not duplicates

#### Scenario: Ingest resumes where it stopped

- **WHEN** a Conversation grows after an earlier ingest
- **THEN** ingesting again SHALL add only what is new, and the work it performs SHALL be proportional to the new Turns rather than to the Conversation's length

#### Scenario: Re-ingesting a conversation that has not grown does nothing

- **WHEN** a Journal is ingested again with no new Turns since the last ingest
- **THEN** nothing SHALL be added and no stored Turn or message SHALL be written again

#### Scenario: A conversation records where it happened

- **WHEN** a Conversation is ingested from a Codebase
- **THEN** its Turns SHALL be retrievable with that Codebase

#### Scenario: A later ingest from elsewhere does not re-attribute a turn

- **WHEN** a Conversation whose Turns already record a Codebase is ingested again from a different Codebase, including a subdirectory of the first
- **THEN** those Turns SHALL still be retrievable with the Codebase they were first stored with, and any Turn stored for the first time by that ingest SHALL record the Codebase it ran from

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

#### Scenario: A turn that changed since it was stored is brought up to date

- **WHEN** a Turn's content in the Journal differs from what is stored, because the Journal held an unflushed final Turn at the previous ingest
- **THEN** ingesting again SHALL store the Turn as the Journal now has it

## ADDED Requirements

### Requirement: Every turn records when it was ingested

The system SHALL record, for each Turn, when that Turn entered the Thread Store, and SHALL set it when the Turn is first stored rather than on every later ingest, so the time describes the Turn's age in the Store and not the age of the last sweep. A Turn stored before this was recorded SHALL be readable with its ingest time absent; the system SHALL NOT invent one, because nothing in such a Turn says when it arrived.

#### Scenario: An ingested turn carries its arrival time

- **WHEN** a Turn is ingested
- **THEN** it SHALL be readable with the time it entered the Store

#### Scenario: A later ingest does not restamp a turn

- **WHEN** a Conversation is ingested again after its Turns were already stored
- **THEN** each already-stored Turn SHALL keep the ingest time it was first given

#### Scenario: A turn stored before this was recorded stays undated

- **WHEN** a Turn ingested before arrival times were recorded is read
- **THEN** its ingest time SHALL be absent

### Requirement: Retention bounds the store only when it is configured

The system SHALL support a retention age, and SHALL remove Turns whose ingest time is older than that age together with their messages. Retention SHALL be off unless a retention age is configured: with none configured, no Turn SHALL be removed. A Turn whose ingest time is absent SHALL NOT be removed, since its age cannot be established. Accounting SHALL survive retention, so what a Call's Context Window contained remains answerable after the Turn itself has been retired. Removal SHALL report how many Turns it removed.

#### Scenario: Nothing is removed by default

- **WHEN** the system runs with no retention age configured
- **THEN** no Turn SHALL be removed, however old

#### Scenario: Turns past the retention age are removed

- **WHEN** a retention age is configured and the Store holds Turns ingested longer ago than that
- **THEN** those Turns and their messages SHALL be removed, and the removal SHALL report how many Turns went

#### Scenario: Turns within the retention age stay

- **WHEN** retention runs
- **THEN** every Turn ingested within the retention age SHALL remain retrievable, tail and recall included

#### Scenario: An undatable turn is not retired

- **WHEN** retention runs over a Store holding Turns with no ingest time
- **THEN** those Turns SHALL be left in place

#### Scenario: Accounting outlives the turns it describes

- **WHEN** retention removes a Turn for which Accounting was recorded
- **THEN** that Accounting SHALL still be readable

### Requirement: A journal that cannot be found is reported

When the Journal for a Conversation cannot be located, the system SHALL report it rather than returning as though there were nothing to ingest. An ingest SHALL state how many Turns it stored, so a Conversation contributing nothing is visible instead of looking like a healthy Store with no history.

#### Scenario: A missing journal is reported

- **WHEN** ingest runs for a Conversation whose Journal cannot be found
- **THEN** the failure SHALL be reported, naming the Conversation and where the Journal was looked for

#### Scenario: A missing journal does not fail the turn

- **WHEN** the Journal cannot be found
- **THEN** the Turn SHALL proceed with whatever history the harness itself provides

#### Scenario: Ingest says how much it stored

- **WHEN** a Journal is ingested
- **THEN** the result SHALL state how many Turns were stored, and a Journal that yielded none SHALL be distinguishable from one that was never read

### Requirement: Store resources are released when a session ends

The system SHALL release every Store resource it constructs when the session ends. Final ingest or retention failures SHALL NOT prevent resource cleanup.

#### Scenario: Session shutdown closes the database client

- **WHEN** a session using the Thread Store shuts down
- **THEN** the Thread Store's database client SHALL be closed

#### Scenario: A failed final sweep does not skip cleanup

- **WHEN** final ingest or retention fails during session shutdown
- **THEN** the system SHALL still attempt to close the Thread Store and every other constructed dependency

#### Scenario: Repeated sessions do not accumulate connections

- **WHEN** extension dependencies are repeatedly started and shut down
- **THEN** database connection use SHALL return to its pre-session baseline rather than accumulate across sessions
[openspec/changes/store-hygiene/design.md#D870]
