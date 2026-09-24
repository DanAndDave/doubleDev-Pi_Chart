## ADDED Requirements

### Requirement: A Concept can be authored from inside a Conversation

The Doc Store SHALL give an agent a way to create a new Concept, or revise one that exists, during a Turn and without leaving the Conversation. A created Concept SHALL be conformant and SHALL carry a stable identity the moment it is written, so that nothing further is required to make it readable and indexable. A revision SHALL preserve the parts of the Concept it does not name, other than its lifecycle and its provenance, which SHALL record that a machine changed it — a Concept an agent rewrote is no longer the Concept a human declared stable. A Concept already withdrawn SHALL stay withdrawn: a revision corrects what a superseded Concept says rather than returning it to service. A write SHALL be whole or not at all: an interrupted write SHALL leave the Concept as it was rather than half-written. Nothing outside the bundle SHALL be written.

#### Scenario: A new concept is written and is readable

- **WHEN** an agent authors a Concept the bundle does not hold
- **THEN** the Concept SHALL be present in the bundle, conformant, and readable as a Concept with no further step

#### Scenario: A revision keeps what it did not name

- **WHEN** an agent revises a Concept's body and names none of its other fields
- **THEN** its title, summary, sources and exclusions SHALL be unchanged

#### Scenario: A revised concept is no longer declared stable

- **WHEN** an agent revises a Concept a human had declared stable
- **THEN** its lifecycle SHALL say the text is a draft again

#### Scenario: A withdrawn concept stays withdrawn

- **WHEN** an agent revises a Concept that had been superseded
- **THEN** it SHALL remain superseded rather than returning to service

#### Scenario: Creating over an existing concept is refused

- **WHEN** an agent authors a Concept at an identifier the bundle already holds
- **THEN** the existing Concept SHALL be unchanged and the attempt SHALL be refused with a reason

#### Scenario: Revising a concept that is not there is refused

- **WHEN** an agent revises a Concept the bundle does not hold
- **THEN** no Concept SHALL be created and the attempt SHALL be refused with a reason

#### Scenario: An interrupted write leaves no half-written concept

- **WHEN** a write fails partway through
- **THEN** the Concept SHALL read exactly as it did before the write

#### Scenario: A write may not leave the bundle

- **WHEN** the identifier given for a write resolves outside the bundle
- **THEN** nothing outside the bundle SHALL be written and the attempt SHALL be refused

### Requirement: Authored knowledge carries machine provenance and cannot claim human review

An authored Concept SHALL record that a machine produced it and when, SHALL enter the corpus at the lowest trust tier, and SHALL be marked as a draft. The system SHALL refuse a request to record human verification, naming why, rather than accepting it or discarding it silently. Verification that predates the content it vouches for SHALL NOT count toward a Concept's trust tier, so that revising a reviewed Concept cannot carry its review onto text no human has read. Trust is what retrieval ranks on; an agent that could grant itself the top tier would rank its own draft above a reviewed Concept.

#### Scenario: An authored concept says a machine produced it

- **WHEN** a Concept is authored by an agent
- **THEN** the Concept SHALL record the machine that produced it and when

#### Scenario: An authored concept is unverified and a draft

- **WHEN** a Concept is authored by an agent
- **THEN** it SHALL be reported unverified and its lifecycle SHALL be draft

#### Scenario: Claiming human review is refused

- **WHEN** an authoring request asks for human verification to be recorded
- **THEN** it SHALL be refused with a reason and no Concept SHALL be written or changed

#### Scenario: A review predating a revision no longer vouches for it

- **WHEN** an agent revises a Concept a human had reviewed
- **THEN** the Concept SHALL no longer be reported human-reviewed, and the review already recorded SHALL remain readable in the Concept

#### Scenario: A review recorded after the last change still counts

- **WHEN** a human reviews a Concept after the most recent change to it
- **THEN** the Concept SHALL be reported human-reviewed

### Requirement: A Concept authored during a Conversation is retrievable within it

A Concept created or revised during a Conversation SHALL be retrievable by meaning within that same Conversation, with nothing restarted. Bringing the index in line after one write SHALL cost about that one Concept: Concepts the write did not touch SHALL NOT be re-embedded. A failure to index SHALL NOT lose the written Concept — the bundle is the record the index is derived from — and SHALL be reported.

#### Scenario: Authored knowledge is retrievable without a restart

- **WHEN** an agent authors a Concept and, later in the same Conversation, a prompt matches its meaning
- **THEN** the Concept SHALL be retrievable

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

### Requirement: A Concept's exclusions and sources travel with it

Where a Concept records what it is not, that SHALL accompany it wherever the Concept is served — to an agent walking the bundle, and into a Context Pack. A definition served without the exclusions that qualify it invites the mistake the exclusions exist to prevent. What a Concept was drawn from SHALL accompany it where the Concept is served whole, so prose carried with no provenance can still be checked against what it came from.

#### Scenario: What a concept excludes is served with it

- **WHEN** a Concept that records what it is not is served
- **THEN** those exclusions SHALL be served with it

#### Scenario: Where a concept came from is served with it

- **WHEN** a Concept that names its sources is served
- **THEN** those sources SHALL be served with it

#### Scenario: A concept that records neither carries nothing extra

- **WHEN** a Concept records no exclusions and no sources
- **THEN** what is served SHALL carry no placeholder for either

### Requirement: A Concept is findable by what it says it is about

A Concept's own summary of its subject SHALL contribute to what retrieval matches against, so that a Concept is findable by a paraphrase of its subject rather than only by the wording of its body. Doing so SHALL NOT make the parts of one Concept less distinguishable from one another.

#### Scenario: A concept is found by a paraphrase of its subject

- **WHEN** a query paraphrases a Concept's stated subject using none of its body's wording
- **THEN** that Concept SHALL be retrieved

#### Scenario: Parts of one concept stay distinguishable

- **WHEN** a query matches one part of a Concept covering several subjects
- **THEN** that part SHALL be the part retrieved for it

### Requirement: A Concept that cannot be read is reported as unreadable

When a Concept exists but cannot be read, or can be read but is not conformant, the system SHALL report it as such together with the reason. It SHALL NOT be served as a Concept with no content: an empty Concept and an unreadable one mean opposite things — "there is nothing here to say" and "something is here and it is broken". Absence SHALL remain distinct from both.

#### Scenario: An unreadable concept is named as unreadable

- **WHEN** an agent opens a Concept whose file exists but cannot be read
- **THEN** it SHALL be told the Concept could not be read, and why

#### Scenario: A non-conformant concept is reported rather than served empty

- **WHEN** an agent opens a Concept the bundle holds but cannot parse
- **THEN** it SHALL be told the Concept is not conformant, and why, rather than receiving a Concept with an empty body

#### Scenario: Absence stays distinct from unreadability

- **WHEN** an agent opens a Concept the bundle does not hold
- **THEN** it SHALL be told the Concept is absent, distinguishably from being told one is unreadable

#### Scenario: One broken concept does not cost the level

- **WHEN** a Level holds one Concept that cannot be read
- **THEN** the Level SHALL still list its other Concepts, and the broken one SHALL be listed as broken

### Requirement: A Concept the listing omits is still reachable

A Level's listing SHALL be reconciled against the Concepts the Level actually holds: a Concept present but not named in the listing SHALL still be reported, distinguishably from the ones the listing names. Entries the listing does name SHALL keep their order and their wording, because that order is the author's judgement about what matters first. A listing entry naming a Concept the Level does not hold SHALL NOT be reported as present. Authoring a Concept into a Level whose listing is curated SHALL add it to that listing.

#### Scenario: A concept missing from the listing is still listed

- **WHEN** a Level holds a Concept its listing does not name
- **THEN** that Concept SHALL appear in the Level, marked as absent from the listing

#### Scenario: The author's ordering survives reconciliation

- **WHEN** a Level's listing is reconciled against Concepts it does not name
- **THEN** the entries the listing names SHALL keep their order and their wording, ahead of the ones it does not

#### Scenario: A listing entry with nothing behind it is not invented

- **WHEN** a listing names a Concept the Level does not hold
- **THEN** that entry SHALL NOT be reported as a Concept of the Level

#### Scenario: Authoring maintains the listing it writes into

- **WHEN** an agent authors a Concept into a Level that has its own listing
- **THEN** the listing SHALL name the new Concept afterwards
