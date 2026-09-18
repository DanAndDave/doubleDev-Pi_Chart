## MODIFIED Requirements

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

## ADDED Requirements

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

#### Scenario: A derived query is no further from its turn

- **WHEN** the same prompt is used for recall with and without the query derivation
- **THEN** the distance to the Turn that genuinely answers it SHALL be no greater with the derivation than without it

#### Scenario: Stored turns are unaffected by how queries are formed

- **WHEN** the query derivation changes
- **THEN** stored vectors SHALL remain valid and SHALL NOT require re-embedding

#### Scenario: The minimum means what it was measured to mean

- **WHEN** the relevance minimum is applied to a recall
- **THEN** the minimum applied SHALL be one measured against the query derivation in use, not against a bare prompt
