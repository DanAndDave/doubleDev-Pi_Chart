## MODIFIED Requirements

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

## ADDED Requirements

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
