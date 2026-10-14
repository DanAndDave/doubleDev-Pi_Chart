## ADDED Requirements

### Requirement: The Opening is examined like any other part

Examining a Call SHALL report the Opening as its own part, named `opening`, with its size, its Budget, and the Turn it came from, and SHALL report it as having no relevance threshold. Where the Opening contributed nothing, the report SHALL give its reason in words that tell the reasons apart: the Turns already carry it, Turn 0's prompt is empty, the first Turn is no longer stored, no Store is configured, retrieval failed, its Budget is zero, or nothing fitted the room left. Comparing two Calls SHALL report the Opening entering or leaving like any other part, and a Conversation summary SHALL report its typical spend beside the other parts. Its size Budget SHALL be changeable within a session under the name `opening-tokens`, as other Budgets are.

#### Scenario: A carried Opening is listed with its source

- **WHEN** a Call whose Pack carried the Opening is examined
- **THEN** the report SHALL list an `opening` line with its size, its Budget and Turn 0, and SHALL NOT report refusals for irrelevance

#### Scenario: Each reason for an absent Opening reads differently

- **WHEN** one Call's Opening was absent because the tail carried Turn 0, another's because Turn 0's prompt was empty, another's because Turn 0 was no longer stored, and another's because no Store was configured
- **THEN** the four reports SHALL each name their own reason, and none SHALL read as the others

#### Scenario: The Opening entering is visible in a comparison

- **WHEN** two Calls are compared, the first before the tail evicted Turn 0 and the second after
- **THEN** the comparison SHALL report the Opening as entering

#### Scenario: The Opening's Budget changes within the session

- **WHEN** `/pack budget opening-tokens 0` is run
- **THEN** the next Call SHALL carry no Opening and its report SHALL say the Opening's Budget is zero
