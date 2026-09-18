## MODIFIED Requirements

### Requirement: Packs carry curated knowledge under its own budget

A Context Pack SHALL be able to carry Concepts from the Doc Store, as a part distinct from the verbatim tail and from recalled Turns, bounded by its own Budget. A carried Concept SHALL be attributed to the Doc Store and identified, so the agent can tell curated knowledge from something it was just told. Where what is carried is one part of a Concept rather than the whole of it, the pack SHALL identify the part carried and the Concept it belongs to, and SHALL say that the Concept holds more — a fragment presented under the Concept's name reads as the Concept's complete answer, which is the one thing curated knowledge must not do. What a Concept records that it is not SHALL be carried with it.

#### Scenario: A concept reaches the model

- **WHEN** the Doc Store holds a Concept relevant to the prompt
- **THEN** the Context Pack SHALL carry it as its own part

#### Scenario: Curated knowledge is attributed

- **WHEN** a Concept enters a pack
- **THEN** it SHALL carry its identifier and be distinguishable from the current exchange and from recalled Turns

#### Scenario: A fragment is not presented as the whole concept

- **WHEN** a pack carries one part of a Concept that has several
- **THEN** it SHALL identify the part carried, name the Concept it belongs to, and say the Concept holds more

#### Scenario: A concept carried whole is not marked as partial

- **WHEN** a pack carries all there is of a Concept
- **THEN** it SHALL NOT claim that more exists

#### Scenario: What a concept excludes travels into the pack

- **WHEN** a pack carries a Concept that records what it is not
- **THEN** those exclusions SHALL be carried with it

#### Scenario: The doc budget is independent of the others

- **WHEN** the Doc Store Budget is exhausted
- **THEN** the verbatim tail and recalled Turns SHALL be unaffected

#### Scenario: A doc budget of nothing disables the part

- **WHEN** the Doc Store Budget is zero
- **THEN** the pack SHALL carry no Concepts and SHALL otherwise be unchanged

#### Scenario: The pack is accounted for by part

- **WHEN** a pack carries Concepts alongside a tail and recalled Turns
- **THEN** the accounting for that Call SHALL attribute each to its own part
