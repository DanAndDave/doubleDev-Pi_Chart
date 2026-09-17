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
