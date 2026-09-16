## ADDED Requirements

### Requirement: Packs carry the structure around the symbols in play

A Context Pack SHALL be able to carry the programmatic neighbourhood of the symbols a prompt refers to, as a part distinct from the verbatim tail, recalled Turns, and Concepts, bounded by its own Budget. Each connection SHALL be carried with where it is in the Codebase, so the agent can act on it without reading a file.

#### Scenario: Structure reaches the model

- **WHEN** a prompt names a symbol the Graph Store knows
- **THEN** the Context Pack SHALL carry that symbol's connections as its own part

#### Scenario: Connections say where they are

- **WHEN** a connection enters a pack
- **THEN** it SHALL carry the file and position of what it connects

#### Scenario: The structure budget is independent of the others

- **WHEN** the Graph Store Budget is exhausted
- **THEN** the verbatim tail, recalled Turns, and Concepts SHALL be unaffected

#### Scenario: A structure budget of nothing disables the part

- **WHEN** the Graph Store Budget is zero
- **THEN** the pack SHALL carry no structure and SHALL otherwise be unchanged

#### Scenario: The pack is accounted for by part

- **WHEN** a pack carries structure alongside its other parts
- **THEN** the accounting for that Call SHALL attribute it separately, naming the symbols it carried
