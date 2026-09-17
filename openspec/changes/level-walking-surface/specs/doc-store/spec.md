## ADDED Requirements

### Requirement: An agent can walk the bundle rather than only be given it

The Doc Store SHALL let an agent read a Level — the Concepts and sub-levels directly beneath it, each Concept with its description — and open one Concept by name. Walking SHALL cost no Context Pack Budget: it is a question the agent chooses to ask, not content assembly decides to carry.

Retrieval answers "what is relevant to this prompt"; walking answers "what is there". A corpus whose shape is invisible cannot be reasoned about, only sampled.

#### Scenario: Reading the top of a bundle

- **WHEN** an agent asks what a bundle holds
- **THEN** it SHALL receive the sub-levels and the Concepts directly beneath the top, each with its description

#### Scenario: Walking into a level

- **WHEN** an agent asks for a named Level
- **THEN** it SHALL receive what is directly beneath that Level and nothing deeper

#### Scenario: Opening one concept

- **WHEN** an agent opens a Concept named in a listing
- **THEN** it SHALL receive that Concept's content

#### Scenario: Walking does not load the corpus

- **WHEN** a Level is read
- **THEN** Concepts below it SHALL NOT be read

#### Scenario: A level that is not there

- **WHEN** an agent asks for a Level the bundle does not have
- **THEN** it SHALL be told so rather than receiving an empty listing indistinguishable from an empty Level

#### Scenario: A bundle that is not there

- **WHEN** no bundle is configured or present
- **THEN** walking SHALL say so rather than raising

#### Scenario: Walking costs no budget

- **WHEN** an agent walks a bundle during a Turn
- **THEN** the Context Pack for that Turn SHALL be unchanged by it
