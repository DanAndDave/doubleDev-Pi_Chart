## ADDED Requirements

### Requirement: Packs carry recalled turns under their own budget

A Context Pack SHALL be able to carry Turns recalled by meaning, in addition to the verbatim tail. Recalled content SHALL occupy its own Budget, and SHALL be presented as a recollection with its position in the Conversation rather than as something just said.

#### Scenario: A decision outside the tail reaches the model

- **WHEN** a Conversation holds a relevant Turn far outside the verbatim tail
- **THEN** the Context Pack SHALL carry that Turn as a recalled part

#### Scenario: Recalled content is attributed, not disguised

- **WHEN** a recalled Turn enters a pack
- **THEN** it SHALL carry its position in the Conversation and be distinguishable from the current exchange

#### Scenario: Recall is accounted for separately

- **WHEN** a pack carries both a verbatim tail and recalled Turns
- **THEN** the accounting for that Call SHALL attribute each to its own part

### Requirement: Budgets bound each part of a pack

Each part of a Context Pack SHALL have a Budget, and SHALL be trimmed to fit it. Trimming SHALL drop the weakest-matching recalled Turns first and SHALL NEVER drop the verbatim tail or the current prompt.

#### Scenario: Recall is trimmed to its budget

- **WHEN** more relevant Turns are found than the recall Budget allows
- **THEN** the pack SHALL carry only what fits, keeping the strongest matches

#### Scenario: Recall cannot crowd out the tail

- **WHEN** the recall Budget is large and many Turns match
- **THEN** the verbatim tail and the current prompt SHALL still appear in full

#### Scenario: A budget of nothing disables its part

- **WHEN** the recall Budget is zero
- **THEN** the pack SHALL carry no recalled Turns and SHALL otherwise be unchanged

## MODIFIED Requirements

### Requirement: Assembly is deterministic

Given the same inputs and configuration, the system SHALL produce an identical Context Pack. Assembly SHALL NOT consult a model to decide what a pack contains, and SHALL NOT depend on wall-clock time, randomness, or iteration order. Retrieval SHALL be part of this guarantee: the same Conversation and prompt SHALL select the same Turns in the same order.

#### Scenario: Repeated assembly produces an identical pack

- **WHEN** a Context Pack is assembled twice from the same inputs and configuration
- **THEN** the two packs SHALL be identical

#### Scenario: Configuration change is the only cause of difference

- **WHEN** two packs assembled from the same inputs differ
- **THEN** the difference SHALL be attributable to a configuration change

#### Scenario: Equally similar turns are ordered predictably

- **WHEN** retrieval finds Turns of identical similarity
- **THEN** their order SHALL be stable across repeated assembly
