# doc-store Specification

## Purpose
Holding curated knowledge that outlives every Codebase as an OKF bundle, and making it readable and trustworthy: which Concepts exist, whether each is well-formed, how current it is, and who stands behind it.

## Requirements

### Requirement: Concepts are read from the bundle

The system SHALL read a Doc Store bundle as a set of Concepts, one per markdown file, each carrying its frontmatter, its body, and an identifier derived from its path within the bundle. Reserved files SHALL NOT be read as Concepts.

#### Scenario: A bundle lists its concepts

- **WHEN** a bundle containing several Concepts in nested directories is read
- **THEN** every Concept SHALL be listed, each addressed by its bundle-relative path without the file extension

#### Scenario: Reserved files are not concepts

- **WHEN** a bundle contains the format's reserved directory-listing and history files
- **THEN** those files SHALL NOT appear as Concepts

#### Scenario: A concept's body is available separately from its frontmatter

- **WHEN** a Concept is read
- **THEN** its frontmatter fields and its markdown body SHALL each be available without the other having to be parsed out again

### Requirement: Conformance is checked without rejecting the bundle

A Concept SHALL be conformant when its frontmatter parses and carries a non-empty type. A non-conformant Concept SHALL be reported with its file and the reason, and SHALL NOT prevent the rest of the bundle from being read.

#### Scenario: A malformed concept is named, not fatal

- **WHEN** a bundle contains one Concept whose frontmatter cannot be parsed
- **THEN** that Concept SHALL be reported with its path and the reason, and every other Concept SHALL still be read

#### Scenario: A concept without a type is reported

- **WHEN** a Concept has frontmatter but no type
- **THEN** it SHALL be reported as non-conformant

#### Scenario: A concept carrying only a type is accepted

- **WHEN** a Concept's frontmatter contains nothing but a type
- **THEN** it SHALL be conformant

### Requirement: Unrecognized content is preserved

The system SHALL tolerate frontmatter keys it does not recognize and types it has never seen, preserving both rather than dropping or rejecting them.

#### Scenario: Unknown keys survive being read

- **WHEN** a Concept carries a frontmatter key the system has no meaning for
- **THEN** that key and its value SHALL still be readable from the parsed Concept

#### Scenario: An unknown type is not an error

- **WHEN** a Concept declares a type the system has never seen
- **THEN** the Concept SHALL be conformant and its type reported as given

### Requirement: Trust and freshness are surfaced

The system SHALL report, for each Concept, its lifecycle status, whether it is stale, and its trust tier. Status SHALL default to stable when absent. A Concept SHALL be stale once the moment named by its freshness field has passed. Trust SHALL be derived: unverified when nothing has verified it, machine-confirmed when only non-human actors have, and human-reviewed when a human has.

#### Scenario: A stale concept is distinguishable from a current one

- **WHEN** one Concept's freshness moment has passed and another's has not
- **THEN** the first SHALL be reported stale and the second SHALL NOT

#### Scenario: Human review outranks machine confirmation

- **WHEN** one Concept was verified by a human and another only by an agent
- **THEN** the first SHALL be human-reviewed and the second machine-confirmed

#### Scenario: An unverified concept is marked as such

- **WHEN** a Concept records no verification
- **THEN** it SHALL be unverified

#### Scenario: Absent status means stable

- **WHEN** a Concept declares no status
- **THEN** it SHALL be reported stable

### Requirement: The bundle can be walked a level at a time

The system SHALL expose the bundle's directory listings so a consumer can see what a level contains — each entry's identifier and description — without reading every Concept beneath it. A level the bundle does not have SHALL be reported as absent rather than as a listing of nothing: a level holding nothing and a level that does not exist mean opposite things. A level's own listing file SHALL be preferred over a synthesised one however its entries are written, since its ordering and wording are the author's judgement.

#### Scenario: A level lists its children

- **WHEN** a bundle level is listed
- **THEN** the Concepts and sub-levels directly beneath it SHALL be returned with their descriptions, and Concepts deeper in the tree SHALL NOT be read

#### Scenario: A listing is available even when the bundle provides none

- **WHEN** a level has no directory-listing file of its own
- **THEN** a listing SHALL still be produced from what the level contains

#### Scenario: An author's listing is used wherever it sits

- **WHEN** a level below the top has its own listing naming its Concepts as an author writes them
- **THEN** that listing SHALL be used, in its order, rather than a synthesised one

#### Scenario: A level that does not exist

- **WHEN** a level absent from the bundle is listed
- **THEN** its absence SHALL be reported, distinctly from a level that exists and holds nothing

### Requirement: Concept identity survives a move

Each Concept SHALL carry an identity that is stable when its file is renamed or moved within the bundle, so that the same Concept is recognisable as itself afterwards. Assigning identity SHALL leave the bundle conformant to the format.

#### Scenario: A moved concept is still the same concept

- **WHEN** a Concept with an assigned identity is moved to a different path in the bundle
- **THEN** it SHALL be recognisable as the same Concept, with its path reported as changed

#### Scenario: A concept without an identity is given one

- **WHEN** a Concept carrying no identity is encountered
- **THEN** an identity SHALL be assigned and persisted to the Concept

#### Scenario: Assigning identity does not break conformance

- **WHEN** identity has been assigned to a Concept
- **THEN** the Concept SHALL remain conformant and its other frontmatter unchanged

### Requirement: A missing or empty bundle is not a failure

When the bundle does not exist or contains no Concepts, the system SHALL report an empty Doc Store rather than an error, so that a machine with no curated knowledge yet behaves normally.

#### Scenario: A machine with no bundle yet

- **WHEN** the configured bundle location does not exist
- **THEN** reading it SHALL yield no Concepts and no error

### Requirement: Concepts are indexed for retrieval

The system SHALL index the bundle's Concepts so they can be found by meaning: each Concept SHALL be divided into parts small enough to retrieve usefully, and each part embedded. The index SHALL be derived from the bundle and rebuildable from it.

#### Scenario: A concept becomes findable

- **WHEN** a bundle has been indexed
- **THEN** a Concept SHALL be retrievable by a query that shares its meaning but not its wording

#### Scenario: A long concept is divided rather than averaged

- **WHEN** a Concept covers several subjects under separate headings
- **THEN** a query matching one of them SHALL retrieve that Concept without needing to match the rest

#### Scenario: Discarding the index loses nothing

- **WHEN** the index is emptied and the bundle indexed again
- **THEN** the same query SHALL retrieve the same Concepts

#### Scenario: A non-conformant concept is not indexed

- **WHEN** the bundle contains a Concept that could not be read
- **THEN** it SHALL be excluded from the index and the rest SHALL still be indexed

### Requirement: Re-indexing covers only what changed

The system SHALL re-index a Concept when its content changes and SHALL leave unchanged Concepts alone, so that keeping the index current costs about as much as the edit that prompted it.

#### Scenario: An edited concept is re-indexed

- **WHEN** a Concept's content changes and the bundle is indexed again
- **THEN** a query matching the new content SHALL retrieve it

#### Scenario: Unchanged concepts are not re-embedded

- **WHEN** a bundle is indexed twice with no edits between
- **THEN** the second pass SHALL embed nothing

#### Scenario: A removed concept leaves the index

- **WHEN** a Concept is deleted from the bundle and the bundle is indexed again
- **THEN** it SHALL no longer be retrievable

### Requirement: Retrieval respects lifecycle and trust

Retrieval SHALL return Concepts relevant to a query, most relevant first, subject to a relevance minimum. A deprecated Concept SHALL NOT be returned. Among Concepts of comparable relevance, those that are current and human-reviewed SHALL be preferred over those that are stale or unverified.

#### Scenario: A deprecated concept is withheld

- **WHEN** a deprecated Concept is the closest match for a query
- **THEN** it SHALL NOT be returned

#### Scenario: Current and reviewed knowledge comes first

- **WHEN** two Concepts are comparably relevant and one is stale or unverified while the other is current and human-reviewed
- **THEN** the current, human-reviewed one SHALL be returned first

#### Scenario: Nothing relevant returns nothing

- **WHEN** no Concept meets the relevance minimum for a query
- **THEN** retrieval SHALL return no Concepts rather than the nearest available

#### Scenario: An unindexed bundle retrieves nothing rather than failing

- **WHEN** retrieval runs before the bundle has been indexed
- **THEN** it SHALL return nothing and SHALL NOT raise

### Requirement: An agent can walk the bundle during a Turn

The Doc Store SHALL give an agent a way to read one Level and to open one Concept named in it, during a Turn, without any of it entering a Context Pack. Retrieval answers "what is relevant to this prompt"; walking answers "what is there", and a corpus whose shape is invisible can only be sampled.

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
- **THEN** repeated retrieval SHALL admit the same candidates, so a Concept SHALL NOT appear in one Pack and be absent from the next without the bundle or the configuration changing

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
