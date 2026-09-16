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

The system SHALL expose the bundle's directory listings so a consumer can see what a level contains — each entry's identifier and description — without reading every Concept beneath it.

#### Scenario: A level lists its children

- **WHEN** a bundle level is listed
- **THEN** the Concepts and sub-levels directly beneath it SHALL be returned with their descriptions, and Concepts deeper in the tree SHALL NOT be read

#### Scenario: A listing is available even when the bundle provides none

- **WHEN** a level has no directory-listing file of its own
- **THEN** a listing SHALL still be produced from what the level contains

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
