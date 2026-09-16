## ADDED Requirements

### Requirement: Packs carry curated knowledge under its own budget

A Context Pack SHALL be able to carry Concepts from the Doc Store, as a part distinct from the verbatim tail and from recalled Turns, bounded by its own Budget. A carried Concept SHALL be attributed to the Doc Store and identified, so the agent can tell curated knowledge from something it was just told.

#### Scenario: A concept reaches the model

- **WHEN** the Doc Store holds a Concept relevant to the prompt
- **THEN** the Context Pack SHALL carry it as its own part

#### Scenario: Curated knowledge is attributed

- **WHEN** a Concept enters a pack
- **THEN** it SHALL carry its identifier and be distinguishable from the current exchange and from recalled Turns

#### Scenario: The doc budget is independent of the others

- **WHEN** the Doc Store Budget is exhausted
- **THEN** the verbatim tail and recalled Turns SHALL be unaffected

#### Scenario: A doc budget of nothing disables the part

- **WHEN** the Doc Store Budget is zero
- **THEN** the pack SHALL carry no Concepts and SHALL otherwise be unchanged

#### Scenario: The pack is accounted for by part

- **WHEN** a pack carries Concepts alongside a tail and recalled Turns
- **THEN** the accounting for that Call SHALL attribute each to its own part
