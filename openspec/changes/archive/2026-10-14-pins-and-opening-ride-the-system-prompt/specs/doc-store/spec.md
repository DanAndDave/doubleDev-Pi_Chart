## ADDED Requirements

### Requirement: Curated knowledge is searched when the agent asks

The system SHALL offer the agent a `search_documentation(query, limit?)` tool, registered only when a Doc Store index is available. The tool SHALL return the Concepts most relevant to the query with no distance cutoff, in the order retrieval defines: a deprecated Concept SHALL NOT be returned, current and human-reviewed Concepts SHALL come before comparably relevant stale or unverified ones, and equally near candidates SHALL be ordered by Concept identity. The tool SHALL return 5 Concepts when no limit is given, and SHALL return at most 20 whatever limit is given.

Each Concept returned SHALL be attributed to the Doc Store and carry its identifier, so the agent can tell curated knowledge from something it was just told. It SHALL carry what it records that it is not. It SHALL be shortened by visible Elision to `PICHART_DOC_TOKENS`, and that cap SHALL apply to each Concept on its own, not to the results together. Where a result is one part of a Concept that has several, the result SHALL identify the part, name the Concept it belongs to, and say that the rest is readable with `walk_documentation`. A Concept returned whole SHALL NOT claim that more exists. What the tool returns is Turn content and SHALL NOT be recorded as a part of any Context Pack.

The search SHALL run under the Doc Store's deadline. A search that misses the deadline or fails SHALL return a text result naming the Doc Store and the reason, and the Turn SHALL continue.

#### Scenario: A relevant concept is found

- **WHEN** the Doc Store holds a Concept relevant to the query
- **THEN** the tool SHALL return it, attributed to the Doc Store and carrying its identifier

#### Scenario: A distant concept is still returned

- **WHEN** no Concept is near the query
- **THEN** the nearest Concepts that are not deprecated SHALL still be returned, up to the limit

#### Scenario: Reviewed knowledge comes first

- **WHEN** two Concepts are comparably relevant and one is stale or unverified while the other is current and human-reviewed
- **THEN** the current, human-reviewed one SHALL be returned first

#### Scenario: Five concepts by default

- **WHEN** the tool is called without a limit and more than five Concepts are indexed
- **THEN** five Concepts SHALL be returned

#### Scenario: No more than twenty concepts

- **WHEN** the tool is called with a limit above 20
- **THEN** at most 20 Concepts SHALL be returned

#### Scenario: A large concept is shortened on its own

- **WHEN** one returned Concept is larger than `PICHART_DOC_TOKENS` and the others are smaller
- **THEN** that Concept SHALL be shortened to the cap with a marker naming what went
- **AND** the other Concepts SHALL NOT be shortened on its account

#### Scenario: A fragment points to the rest

- **WHEN** a result is one part of a Concept that has several
- **THEN** it SHALL identify the part, name the Concept, and say the rest is readable with `walk_documentation`

#### Scenario: A concept returned whole is not marked as partial

- **WHEN** a result is all there is of a Concept
- **THEN** it SHALL NOT claim that more exists

#### Scenario: A late or failing index costs the search, not the Turn

- **WHEN** the Doc Store misses its deadline or fails during the search
- **THEN** the tool SHALL return a text result naming the Doc Store and the reason
- **AND** the Turn SHALL proceed

#### Scenario: No index, no tool

- **WHEN** a session runs with no Doc Store index available
- **THEN** `search_documentation` SHALL NOT be registered

### Requirement: Search respects lifecycle and trust

Retrieval SHALL return Concepts relevant to a query, most relevant first, with no relevance minimum: it SHALL return the nearest Concepts up to the requested count, however far they are from the query, because the agent asked and each result names its Concept. A deprecated Concept SHALL NOT be returned. Among Concepts of comparable relevance, those that are current and human-reviewed SHALL be preferred over those that are stale or unverified.

#### Scenario: A deprecated concept is withheld

- **WHEN** a deprecated Concept is the closest match for a query
- **THEN** it SHALL NOT be returned

#### Scenario: Current and reviewed knowledge comes first

- **WHEN** two Concepts are comparably relevant and one is stale or unverified while the other is current and human-reviewed
- **THEN** the current, human-reviewed one SHALL be returned first

#### Scenario: The nearest concepts are returned however far they are

- **WHEN** no Concept is near a query
- **THEN** retrieval SHALL still return the nearest Concepts that are not deprecated, up to the requested count

#### Scenario: An unindexed bundle retrieves nothing rather than failing

- **WHEN** retrieval runs before the bundle has been indexed
- **THEN** it SHALL return nothing and SHALL NOT raise

## MODIFIED Requirements

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
- **THEN** the search SHALL report how many, and the `search_documentation` result SHALL carry that number

### Requirement: An agent can walk the bundle during a Turn

The Doc Store SHALL give an agent a way to read one Level and to open one Concept named in it, during a Turn, without any of it entering a Context Pack. Searching answers "what is relevant to this query"; walking answers "what is there", and a corpus whose shape is invisible can only be sampled.

#### Scenario: Reading the top of a bundle

- **WHEN** an agent asks what a bundle holds
- **THEN** it SHALL receive the sub-levels and the Concepts directly beneath the top, each with its description

#### Scenario: Walking into a level

- **WHEN** an agent asks for a named Level
- **THEN** it SHALL receive what is directly beneath that Level and nothing deeper

#### Scenario: Opening one concept

- **WHEN** an agent opens a Concept named in a listing
- **THEN** it SHALL receive that Concept's content

#### Scenario: A level that is not there

- **WHEN** an agent asks for a Level the bundle does not have
- **THEN** it SHALL be told so rather than receiving a listing indistinguishable from an empty Level

#### Scenario: A bundle that is not there

- **WHEN** no bundle is configured or present
- **THEN** walking SHALL say so rather than raising

#### Scenario: Neither a level nor a concept may reach outside the bundle

- **WHEN** an agent names a Level or Concept whose path leaves the bundle
- **THEN** nothing outside the bundle SHALL be read

#### Scenario: Walking costs no budget

- **WHEN** an agent walks a bundle during a Turn
- **THEN** the Context Pack for that Turn SHALL be unchanged by it

### Requirement: Concept retrieval selects from a totally ordered candidate set

Concept retrieval SHALL select from a candidate set whose order is total: no two candidates SHALL be left equally placed, so that no part of the selection is decided by the index's own traversal. The same query against the same Concepts SHALL select the same Concepts, in the same order, across repeated retrieval and across a rebuild of the retrieval index. Nearness SHALL decide first; where candidates are equally near, their Concept identity SHALL decide, which is stable across a rename and across a rebuild.

#### Scenario: The same query selects the same concepts

- **WHEN** the same query is retrieved for twice with no change to the bundle
- **THEN** the same Concepts SHALL be returned in the same order

#### Scenario: A rebuilt index selects the same concepts

- **WHEN** the retrieval index is discarded and built again from unchanged Concepts, and the same query is retrieved for
- **THEN** the same Concepts SHALL be returned in the same order as before the rebuild

#### Scenario: Equally near candidates are ordered predictably

- **WHEN** two Concepts are equally near a query at the boundary of what the candidate set holds
- **THEN** which of them enters the candidate set SHALL be decided by Concept identity and SHALL be the same on every retrieval

#### Scenario: Determinism survives a corpus larger than the candidate set

- **WHEN** the bundle holds more Concepts than the candidate set admits
- **THEN** repeated retrieval SHALL admit the same candidates, so a Concept SHALL NOT appear in one search's result and be absent from the next without the bundle or the configuration changing

### Requirement: A Concept's exclusions and sources travel with it

Where a Concept records what it is not, that SHALL accompany it wherever the Concept is served: to an agent walking the bundle, and in a `search_documentation` result. A definition served without the exclusions that qualify it invites the mistake the exclusions exist to prevent. What a Concept was drawn from SHALL accompany it where the Concept is served whole, so prose carried with no provenance can still be checked against what it came from.

#### Scenario: What a concept excludes is served with it

- **WHEN** a Concept that records what it is not is served
- **THEN** those exclusions SHALL be served with it

#### Scenario: Where a concept came from is served with it

- **WHEN** a Concept that names its sources is served
- **THEN** those sources SHALL be served with it

#### Scenario: A concept that records neither carries nothing extra

- **WHEN** a Concept records no exclusions and no sources
- **THEN** what is served SHALL carry no placeholder for either

### Requirement: A Concept authored during a Conversation is retrievable within it

A Concept created or revised during a Conversation SHALL be retrievable by meaning within that same Conversation, with nothing restarted. Bringing the index in line after one write SHALL cost about that one Concept: Concepts the write did not touch SHALL NOT be re-embedded. A failure to index SHALL NOT lose the written Concept — the bundle is the record the index is derived from — and SHALL be reported.

#### Scenario: Authored knowledge is retrievable without a restart

- **WHEN** an agent authors a Concept and, later in the same Conversation, `search_documentation` is called with a query matching its meaning
- **THEN** the Concept SHALL be returned

#### Scenario: A revision replaces what it superseded

- **WHEN** an agent revises a Concept, removing one claim and adding another
- **THEN** the Concept SHALL be retrievable by the new claim and SHALL NOT be retrievable by the removed one

#### Scenario: Indexing one concept leaves the rest alone

- **WHEN** one Concept is written and the index is brought in line
- **THEN** no other Concept's index entry SHALL be re-embedded

#### Scenario: A revision into unreadability leaves retrieval

- **WHEN** a revision leaves a Concept non-conformant
- **THEN** it SHALL no longer be retrievable, and the rest of the corpus SHALL be unaffected

#### Scenario: Indexing failure costs the index, not the concept

- **WHEN** the index cannot be brought in line after a successful write
- **THEN** the written Concept SHALL remain in the bundle and the failure SHALL be reported

## REMOVED Requirements

### Requirement: Retrieval respects lifecycle and trust

**Reason**: Retrieval from the Doc Store now answers the agent's `search_documentation` query and applies no relevance minimum: the agent asked, and each result names its Concept (ADR-0015). Its scenario that nothing relevant returns nothing no longer holds. The requirement is restated as "Search respects lifecycle and trust", which keeps lifecycle and trust ordering unchanged.

**Migration**: The Doc Store's relevance minimum is no longer read. Pass `limit` to `search_documentation` to bound how many Concepts come back.
