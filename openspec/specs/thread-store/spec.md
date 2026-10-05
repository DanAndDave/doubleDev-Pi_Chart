# thread-store Specification

## Purpose
Holding what happened in a Conversation — Turns, tool calls, results, and artifacts — in a durable store that outlives any single process, so the Assembler can retrieve history the harness is no longer carrying.

## Requirements

### Requirement: The Journal is ingested into the store

The system SHALL ingest the harness's Journal into the Thread Store: each Turn's prompt, the agent's responses, every tool call with its result, and any artifact produced. Ingested content SHALL be addressed by Conversation, Turn, and Call, and SHALL record the Codebase the Conversation belongs to, so content found later can be attributed to where it came from.

A Turn's Codebase SHALL be recorded when that Turn is first stored, and SHALL NOT be replaced by a later ingest, whatever Codebase that ingest runs from. A Turn happened in one place; resuming its Conversation elsewhere does not move it.

A Turn answered in several Calls SHALL record which Call each piece of content belongs to, so a recollection can say where within a Turn it came from. Content whose Call cannot be established SHALL be addressed to the Turn's first Call rather than refused.

Ingesting a Conversation again SHALL add only what is new. The work an ingest performs SHALL be proportional to the content not yet stored and SHALL NOT grow with the length of the Conversation, and content already stored SHALL NOT be written again.

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

### Requirement: The store holds the Conversation's active branch

The Thread Store SHALL hold the Turns on the Conversation's active branch, the parent chain from the harness's current leaf back to the root of the Journal, and SHALL NOT hold Turns that exist only on a branch the harness has left. Ingest SHALL number Turns along that chain, not in file order. When the harness moves its leaf (`/tree`, `/branch`), the store SHALL discard every stored Turn from the first one the branch it left and the branch it moved to do not share, then ingest the active branch from there. A rewind that cannot reach the store SHALL be reported, and SHALL NOT fail the navigation.

#### Scenario: Ingest skips an abandoned branch

- **WHEN** a Journal holds a Turn that a later entry's parent chain bypasses
- **THEN** ingesting it SHALL store only the Turns on the chain from the last entry, numbered in chain order

#### Scenario: A rewind drops the abandoned Turns from the next pack

- **WHEN** the store holds Turns 0 to 2, the harness rewinds to the end of Turn 0, and the next Call is assembled
- **THEN** the pack's verbatim tail SHALL hold Turn 0 and SHALL NOT hold the abandoned Turns 1 and 2

#### Scenario: A rewind into the middle of a Turn keeps only its kept part

- **WHEN** the harness rewinds to an entry inside a stored Turn
- **THEN** that Turn SHALL be stored again holding only the messages up to the new leaf

#### Scenario: The continued branch reuses the abandoned positions

- **WHEN** the Conversation continues after a rewind past the number of Turns it had before
- **THEN** each position SHALL hold the Turn from the active branch, never the abandoned Turn that held it earlier

#### Scenario: Returning to a longer branch keeps none of the branch left

- **WHEN** the store holds a shorter branch's Turns and the harness moves its leaf to the end of a longer branch that parted from it earlier
- **THEN** the store SHALL hold exactly the longer branch's Turns, none of the shorter one's

#### Scenario: A rewind with the store unreachable

- **WHEN** the harness rewinds while the Thread Store cannot be reached
- **THEN** the failure SHALL be reported and the navigation SHALL complete

### Requirement: The store is derived and rebuildable

The Thread Store SHALL be a derived index over the Journal, never the record of what happened. Discarding the store and re-ingesting from the Journal SHALL restore equivalent content.

#### Scenario: A discarded store is rebuilt from disk

- **WHEN** the store is emptied and the Journal re-ingested
- **THEN** the Context Pack assembled for a given Turn SHALL be identical to the one assembled before

#### Scenario: Losing the store never loses history

- **WHEN** the store is unavailable
- **THEN** no Journal content SHALL be lost or altered

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

### Requirement: The schema is versioned and applied forward

The system SHALL own its schema and apply migrations forward automatically, so that a store created by an older version becomes usable without manual intervention. Sessions that connect to the same store at the same time SHALL apply each migration exactly once between them.

#### Scenario: An empty database is made ready

- **WHEN** the system connects to a database with no schema
- **THEN** it SHALL create the schema and report the store ready

#### Scenario: Migrations are not reapplied

- **WHEN** the system connects to an already-migrated database
- **THEN** it SHALL leave existing content intact

#### Scenario: Concurrent sessions migrate once

- **WHEN** two sessions connect to the same unmigrated database at the same time
- **THEN** both SHALL report the store ready and each migration SHALL be recorded once

### Requirement: Ingested turns are embedded

The system SHALL embed each ingested Turn so it can be retrieved by meaning rather than by recency. Embedding SHALL happen away from the model request's path, and the same text SHALL always produce the same vector.

A Turn SHALL be embedded from a representation of the whole Turn: its prompt, what the agent said, the actions the agent took with the arguments they were taken with, and what those actions returned. Where the representation cannot carry every message of the Turn whole, each message SHALL be shortened to fit a share of it, rather than the representation being filled in message order and cut where it runs out. A Turn's conclusions SHALL be findable through that Turn's own vector, not only its opening.

#### Scenario: A turn becomes retrievable after ingest

- **WHEN** a Turn has been ingested and embedding has run
- **THEN** that Turn SHALL be retrievable by a prompt that shares its meaning but not its wording

#### Scenario: Embedding is deterministic

- **WHEN** the same text is embedded twice
- **THEN** both vectors SHALL be identical

#### Scenario: Embedding never delays a turn

- **WHEN** embedding is slow or fails
- **THEN** the Turn SHALL still complete and the failure SHALL be reported

#### Scenario: A turn is findable by what it concluded

- **WHEN** a Turn reads several files and states its conclusion in its last message
- **THEN** a prompt matching that conclusion SHALL retrieve that Turn

#### Scenario: A turn is findable by what it did

- **WHEN** a subject appears in a Turn only as the name and arguments of a tool call
- **THEN** a prompt naming that subject SHALL retrieve that Turn

#### Scenario: One large message does not crowd out the rest of its turn

- **WHEN** a single message of a Turn is larger than the whole representation allows
- **THEN** every other message of that Turn SHALL still contribute to the representation

### Requirement: Embedding backfill is resumable

The system SHALL embed Turns that were ingested before embedding was available, and SHALL be able to continue after interruption without repeating work already done.

#### Scenario: Existing turns are embedded without re-ingesting

- **WHEN** a Conversation was ingested before embeddings existed and backfill runs
- **THEN** its Turns SHALL become retrievable without the Journal being ingested again

#### Scenario: Backfill resumes rather than restarts

- **WHEN** backfill runs again after being interrupted
- **THEN** it SHALL embed only the Turns still lacking a vector

### Requirement: Retrieval ranks turns by similarity to the prompt

The system SHALL return the Turns most similar in meaning to a given prompt, most similar first, limited to a requested count. Retrieval SHALL remain scoped to the current Conversation. A Turn SHALL be returned only when its similarity meets a configured minimum, so that retrieval returns what is relevant rather than merely what is nearest.

Retrieval SHALL consider every Turn of the current Conversation that holds a valid vector, rather than an approximation over the wider corpus narrowed to the Conversation afterwards. A Turn of this Conversation that meets the minimum SHALL be returned whether the corpus holds ten Turns or ten million, up to the requested count. When retrieval cannot complete the search it claims — leaving a qualifying Turn unreturned — it SHALL report that shortfall, distinguishably from a Conversation in which nothing met the minimum.

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

#### Scenario: A turn below the threshold is not returned

- **WHEN** the nearest Turn to a prompt is still less similar than the minimum
- **THEN** it SHALL NOT be returned, even though nothing ranks above it

#### Scenario: A conversation with nothing relevant returns nothing

- **WHEN** no Turn in a Conversation meets the minimum for a prompt
- **THEN** retrieval SHALL return no Turns rather than its least-irrelevant ones

#### Scenario: The threshold does not disturb ranking

- **WHEN** several Turns meet the minimum
- **THEN** they SHALL be returned in the same order they would have been without it

#### Scenario: Retrieval reports what the threshold excluded

- **WHEN** retrieval rejects Turns for being below the minimum
- **THEN** it SHALL report how many it rejected, so the minimum can be judged

#### Scenario: Every qualifying turn of the conversation is returned

- **WHEN** Turns of other Conversations closer to the prompt outnumber this Conversation's qualifying Turns many times over
- **THEN** each qualifying Turn of this Conversation SHALL still be returned, up to the requested count

#### Scenario: A growing corpus does not change one conversation's recall

- **WHEN** Turns of unrelated Conversations are added and the same recall is run again
- **THEN** the same Turns SHALL be returned in the same order

#### Scenario: A shortfall is not reported as irrelevance

- **WHEN** retrieval returns fewer Turns than the count requested because it could not complete its search
- **THEN** it SHALL report that it came back short, distinguishably from having found nothing that met the minimum

### Requirement: A stored vector is valid only for the content and the model that produced it

A stored vector SHALL cease to be valid when the Turn's content changes, and when the embedding model in use is not the model that produced it. An invalid vector SHALL NOT be ranked and SHALL be treated as though the Turn had no vector, so that the path which embeds an unembedded Turn is also the path which repairs a stale one. Where the store holds vectors produced by a model other than the one now in use, the system SHALL report that condition rather than rank across both spaces.

#### Scenario: A changed turn is not recalled on content it no longer has

- **WHEN** a Turn's content changes after it was embedded
- **THEN** it SHALL NOT be retrievable by the content it no longer holds

#### Scenario: A changed turn becomes findable by its new content

- **WHEN** a Turn's content changes and embedding runs again
- **THEN** a prompt matching the new content SHALL retrieve it, without the Journal being ingested again

#### Scenario: An unchanged turn is not embedded twice

- **WHEN** a Conversation is ingested again with no content change
- **THEN** no Turn of it SHALL be embedded a second time

#### Scenario: A vector from another model is never a hit

- **WHEN** a Turn's stored vector was produced by a different embedding model
- **THEN** it SHALL NOT be returned for any query

#### Scenario: A model change is reported, not absorbed

- **WHEN** the store holds vectors produced by a model other than the one now in use
- **THEN** the system SHALL report the condition and how many Turns it affects, and recall SHALL be limited to the Turns embedded by the model in use

#### Scenario: An invalidated turn is still part of the conversation

- **WHEN** a Turn's vector has been invalidated and not yet replaced
- **THEN** that Turn SHALL still be retrievable among the Conversation's Turns and SHALL still count as awaiting embedding

### Requirement: A recall query is represented as a query, not as stored content

The system SHALL derive a recall query's vector in the form the embedding model expects of a query, and SHALL NOT apply that derivation to the Turns it stores, so that a change to how queries are formed never invalidates a stored vector. The relevance minimum SHALL be the minimum measured under the query derivation in use.

#### Scenario: A derived query keeps its turn and refuses unrelated content

- **WHEN** a prompt is derived as a query and scored against the Turn that genuinely answers it and against unrelated content
- **THEN** the answering Turn SHALL fall within the relevance minimum and the unrelated content SHALL fall outside it

#### Scenario: Stored turns are unaffected by how queries are formed

- **WHEN** the query derivation changes
- **THEN** stored vectors SHALL remain valid and SHALL NOT require re-embedding

#### Scenario: The minimum means what it was measured to mean

- **WHEN** the relevance minimum is applied to a recall
- **THEN** the minimum applied SHALL be one measured against the query derivation in use, not against a bare prompt

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

The system SHALL release every Store resource it constructs when the session ends. Final ingest or retention failures SHALL NOT prevent resource cleanup. A store that never opened SHALL be released without raising, since its failure was reported when the session started.

#### Scenario: Session shutdown closes the database client

- **WHEN** a session using the Thread Store shuts down
- **THEN** the Thread Store's database client SHALL be closed

#### Scenario: A failed final sweep does not skip cleanup

- **WHEN** final ingest or retention fails during session shutdown
- **THEN** the system SHALL still attempt to close the Thread Store and every other constructed dependency

#### Scenario: Repeated sessions do not accumulate connections

- **WHEN** extension dependencies are repeatedly started and shut down
- **THEN** database connection use SHALL return to its pre-session baseline rather than accumulate across sessions

#### Scenario: A store that never opened shuts down quietly

- **WHEN** a session whose Thread Store failed to open shuts down
- **THEN** shutdown SHALL complete without reporting an error for that store

### Requirement: Setup finds or provisions a Postgres server

The Thread Store SHALL be a pgvector-capable Postgres server, and setup SHALL obtain one without the operator naming it. When no store connection is configured, setup SHALL look for a server already running on the machine, trying in order: the standard Postgres connection environment, the platform's local sockets, and the default local port as the current user, and the project's own containerised server if it is already up. On the first candidate that answers, setup SHALL create a database for this project when it is missing and enable vector support in it, leaving every other database on that server untouched. A candidate that answers but cannot be used, because it lacks vector support or refuses to create the database or the extension, SHALL be reported with the command that fixes it, and setup SHALL go on to the next candidate.

When no candidate answers and a container runtime is available, setup SHALL start the project's containerised server, configured to restart with the machine, and use it. When no candidate answers and no container runtime is available, setup SHALL report that a pgvector Postgres is required and SHALL NOT report the store ready.

A store connection the operator configured SHALL be checked, never replaced: setup SHALL report whether it answers and SHALL NOT start or create anything for it.

#### Scenario: A running server is found and prepared

- **WHEN** setup runs with no store connection configured and a local Postgres with vector support is reachable as the current user
- **THEN** setup SHALL use that server, create the project's database on it if missing, enable vector support in that database, and report the store ready with the connection it settled on

#### Scenario: Candidates are tried in order

- **WHEN** more than one candidate server answers
- **THEN** setup SHALL use the earliest one in the discovery order

#### Scenario: An unusable server is explained and passed over

- **WHEN** the first candidate that answers lacks vector support or refuses to create the database or extension, and a later candidate is usable
- **THEN** setup SHALL report the first with the command that fixes it and SHALL settle on the later one

#### Scenario: No server falls back to the container

- **WHEN** no candidate answers and a container runtime is available
- **THEN** setup SHALL start the project's containerised server, wait until it answers, and settle on it

#### Scenario: No server and no container runtime

- **WHEN** no candidate answers and no container runtime is available
- **THEN** setup SHALL report the store not ready and name a pgvector Postgres as the missing requirement

#### Scenario: A configured connection is only checked

- **WHEN** setup runs with a store connection configured
- **THEN** setup SHALL report whether that server answers and SHALL NOT discover, create, or start anything

### Requirement: The connection setup settles on is used by every later session

Setup SHALL save the connection it settled on to a file readable only by the operator, and every later session SHALL use that saved connection whenever no store connection is configured. A configured connection SHALL take precedence over the saved one, and declining the store SHALL take precedence over both. Running setup again SHALL re-verify the saved connection and SHALL replace it only when it no longer answers.

#### Scenario: A later session uses the saved connection

- **WHEN** setup has saved a connection and a later session starts with no store connection configured
- **THEN** that session SHALL ingest into and retrieve from the saved server

#### Scenario: Concurrent sessions share one store

- **WHEN** two sessions run at the same time against the saved connection and both ingest Turns
- **THEN** each session's Turns SHALL be retrievable from the other, and neither session SHALL fail for the other's presence

#### Scenario: A configured connection overrides the saved one

- **WHEN** a connection has been saved and a session starts with a different store connection configured
- **THEN** that session SHALL use the configured connection

#### Scenario: A saved connection that still answers is kept

- **WHEN** setup runs again and the saved connection answers
- **THEN** setup SHALL keep it rather than discover another server

### Requirement: An unconfigured store is reported, not guessed

With no store connection configured and none saved, the system SHALL NOT connect to a server it guessed. The session SHALL degrade as a declined store does, and both the session's start and the installation check SHALL say that setup has not been run, naming the command that runs it.

#### Scenario: A fresh install before setup

- **WHEN** a session starts with no store connection configured and none saved
- **THEN** no database connection SHALL be attempted, the verbatim tail SHALL come from the harness's own history, and the installation check SHALL report the store not set up with the setup command as its fix

### Requirement: A former embedded store is named

When the data directory of the former embedded store exists, the installation check and setup SHALL name it as no longer read and safe to remove, since its content is derived from the Journals. The system SHALL NOT delete or migrate it.

#### Scenario: A stranded embedded store

- **WHEN** the installation check runs and the former embedded store's data directory exists
- **THEN** the check SHALL name that directory as unused and removable, and the directory SHALL be left in place

### Requirement: A store that cannot be used degrades safely

When a configured Thread Store cannot be reached, the system SHALL report the failure and continue the Turn with whatever history the harness itself provides, rather than sending an empty or partial Context Pack. A store declined outright, or not yet set up, SHALL degrade in the same visible way as one that cannot be reached.

#### Scenario: A turn survives an unreachable store

- **WHEN** a configured store cannot be reached while a Context Pack is being assembled
- **THEN** the Turn SHALL proceed and the failure SHALL be reported

#### Scenario: Degradation is visible, not silent

- **WHEN** a Context Pack is assembled without the store
- **THEN** the accounting for that Call SHALL show that the tail did not come from the store
