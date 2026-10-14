## ADDED Requirements

### Requirement: Evicted Turns are recalled when the agent asks

The system SHALL offer the agent a `recall_earlier_turns(query, limit?)` tool, registered only when a Thread Store is available. The tool SHALL search only the current Conversation's Turns whose index is below the tail start recorded by the latest Call of that Conversation, so that a Turn the verbatim tail still carries is never returned as a recollection. It SHALL rank those Turns by similarity to the query, most similar first, with no distance cutoff: the agent asked, and each result says which Turn it is so the agent can weigh it.

The tool SHALL return 5 results when no limit is given, and SHALL return at most 20 whatever limit is given. Each result SHALL be shown as a recollection carrying its Turn number and the actions its Turn took, and SHALL be shortened by visible Elision to `PICHART_RECALL_TOKENS`. That cap SHALL apply to each result on its own, not to the results together. What the tool returns is Turn content and SHALL NOT be recorded as a part of any Context Pack.

When no Turn of the Conversation has been evicted, because no Call has recorded a tail start yet or the tail still starts at Turn 0, the result SHALL say that nothing has been evicted yet, distinguishably from a search that found nothing. The search SHALL run under the Thread Store's recall deadline. A search that misses the deadline or fails SHALL return a text result naming the Thread Store and the reason, and the Turn SHALL continue.

#### Scenario: A Turn the tail evicted is found

- **WHEN** the latest Call's tail starts at Turn 12 and Turn 3 matches the query
- **THEN** Turn 3 SHALL be returned as a recollection that names Turn 3

#### Scenario: A Turn the tail still carries is not returned

- **WHEN** the Turn most similar to the query is at or after the tail start of the latest Call
- **THEN** it SHALL NOT be returned
- **AND** the most similar Turns below the tail start SHALL fill the result up to the limit

#### Scenario: A distant Turn is still returned

- **WHEN** the nearest evicted Turn is farther from the query than `PICHART_RECALL_MAX_DISTANCE`
- **THEN** it SHALL still be returned

#### Scenario: Five results by default

- **WHEN** the tool is called without a limit and more than five evicted Turns hold valid vectors
- **THEN** five results SHALL be returned, most similar first

#### Scenario: No more than twenty results

- **WHEN** the tool is called with a limit above 20
- **THEN** at most 20 results SHALL be returned

#### Scenario: A large Turn is shortened on its own

- **WHEN** one recalled Turn is larger than `PICHART_RECALL_TOKENS` and the others are smaller
- **THEN** that result SHALL be shortened to the cap with a marker naming what went, and SHALL still name the actions its Turn took
- **AND** the other results SHALL NOT be shortened on its account

#### Scenario: Nothing has been evicted yet

- **WHEN** the tool is called before any Call of the Conversation has recorded a tail start
- **THEN** the result SHALL say that no Turn has been evicted yet, rather than return an empty list

#### Scenario: Another Conversation's Turn is not recalled

- **WHEN** another Conversation holds a Turn more similar to the query than anything in this one
- **THEN** that Turn SHALL NOT be returned

#### Scenario: A late or failing store costs the search, not the Turn

- **WHEN** the Thread Store misses its recall deadline or fails during the search
- **THEN** the tool SHALL return a text result naming the Thread Store and the reason
- **AND** the Turn SHALL proceed

#### Scenario: No Thread Store, no tool

- **WHEN** a session runs with no Thread Store available
- **THEN** `recall_earlier_turns` SHALL NOT be registered

### Requirement: Retrieval stays within one Conversation

Retrieval SHALL return content from the current Conversation only. Content from other Conversations SHALL NOT appear unless a search explicitly asks for a wider scope, and neither the verbatim tail nor `recall_earlier_turns` SHALL return content from outside the current Conversation.

#### Scenario: Another conversation's turns stay out

- **WHEN** two Conversations have been ingested and the tail is retrieved for one
- **THEN** no Turn belonging to the other SHALL be returned

#### Scenario: Turns come back in order

- **WHEN** the most recent Turns are retrieved for a Conversation
- **THEN** they SHALL be returned in Turn order, each with its messages in the order they occurred

#### Scenario: Recall stays within the conversation

- **WHEN** another Conversation holds a Turn more similar to a `recall_earlier_turns` query than anything in this one
- **THEN** the tool's result SHALL NOT carry it

### Requirement: Retrieval ranks turns by similarity to the query

The system SHALL return the Turns most similar in meaning to a given query, most similar first, limited to a requested count. Retrieval SHALL remain scoped to the current Conversation. Retrieval within one Conversation SHALL apply no relevance minimum: it SHALL return the nearest Turns up to the requested count, however far they are from the query, because the agent asked and each result names its Turn.

Retrieval SHALL consider every Turn of the current Conversation that holds a valid vector, rather than an approximation over the wider corpus narrowed to the Conversation afterwards. A Turn of this Conversation SHALL be eligible whether the corpus holds ten Turns or ten million, up to the requested count. When retrieval cannot complete the search it claims, leaving an eligible Turn unreturned, it SHALL report that shortfall, distinguishably from a Conversation that holds fewer eligible Turns than were requested.

#### Scenario: The most relevant turn comes first

- **WHEN** a Conversation holds Turns on several subjects and one is retrieved for a query about one of them
- **THEN** the Turn on that subject SHALL rank above the others

#### Scenario: Retrieval does not reach into another conversation

- **WHEN** two Conversations hold Turns on the same subject and one retrieves
- **THEN** no Turn belonging to the other SHALL be returned

#### Scenario: Turns already carried verbatim are not retrieved again

- **WHEN** `recall_earlier_turns` runs while the latest Call's verbatim tail holds a matching Turn
- **THEN** that Turn SHALL NOT also be returned as a recollection

#### Scenario: An unembedded conversation retrieves nothing rather than failing

- **WHEN** retrieval runs against a Conversation whose Turns have no vectors yet
- **THEN** it SHALL return no Turns and SHALL NOT raise

#### Scenario: The nearest turn is returned however far it is

- **WHEN** the nearest Turn of the Conversation is far from the query
- **THEN** it SHALL still be returned, ahead of every Turn farther away

#### Scenario: Every eligible turn of the conversation is returned

- **WHEN** Turns of other Conversations closer to the query outnumber this Conversation's Turns many times over
- **THEN** this Conversation's Turns SHALL still be returned, nearest first, up to the requested count

#### Scenario: A growing corpus does not change one conversation's recall

- **WHEN** Turns of unrelated Conversations are added and the same recall is run again
- **THEN** the same Turns SHALL be returned in the same order

#### Scenario: A shortfall is not reported as an empty conversation

- **WHEN** retrieval returns fewer Turns than the count requested because it could not complete its search
- **THEN** it SHALL report that it came back short, distinguishably from a Conversation that held no more eligible Turns

## MODIFIED Requirements

### Requirement: A recall query is represented as a query, not as stored content

The system SHALL derive a recall query's vector in the form the embedding model expects of a query, and SHALL NOT apply that derivation to the Turns it stores, so that a change to how queries are formed never invalidates a stored vector. The relevance minimum `recall_across_conversations` applies SHALL be the minimum measured under the query derivation in use.

#### Scenario: A derived query keeps its turn and refuses unrelated content

- **WHEN** a prompt is derived as a query and scored against the Turn that genuinely answers it and against unrelated content
- **THEN** the answering Turn SHALL fall within the relevance minimum and the unrelated content SHALL fall outside it

#### Scenario: Stored turns are unaffected by how queries are formed

- **WHEN** the query derivation changes
- **THEN** stored vectors SHALL remain valid and SHALL NOT require re-embedding

#### Scenario: The minimum means what it was measured to mean

- **WHEN** the relevance minimum is applied to a search across Conversations
- **THEN** the minimum applied SHALL be one measured against the query derivation in use, not against a bare prompt

## REMOVED Requirements

### Requirement: Retrieval is scoped to one Conversation

**Reason**: Retrieval within a Conversation no longer feeds a Context Pack: earlier Turns reach the agent only through `recall_earlier_turns` (ADR-0015). The requirement is restated as "Retrieval stays within one Conversation", whose scenarios speak of the tool's result rather than of a Pack.

**Migration**: None. The scoping is unchanged; see "Retrieval stays within one Conversation".

### Requirement: Retrieval ranks turns by similarity to the prompt

**Reason**: Retrieval within a Conversation now ranks against the agent's `recall_earlier_turns` query, not the prompt, and applies no relevance minimum: the agent asked, and each result names its Turn. The scenarios about the minimum, what it excluded, and irrelevance told apart from a shortfall go with it. The relevance minimum survives for searches across Conversations alone (cross-conversation-search). The requirement is restated as "Retrieval ranks turns by similarity to the query".

**Migration**: `PICHART_RECALL_MAX_DISTANCE` no longer affects `recall_earlier_turns`; it governs `recall_across_conversations` only. Pass `limit` to `recall_earlier_turns` to bound how many Turns come back.
