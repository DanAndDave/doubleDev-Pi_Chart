## MODIFIED Requirements

### Requirement: Results say where they came from

Every result SHALL carry the Conversation it belongs to and, where recorded, the Codebase that Conversation happened in, so that a recollection from elsewhere is recognisable as such. The tool result SHALL also record, apart from its text, each result's Conversation and Turn index in result order, so that what a search returned can be read from the Journal without parsing the rendered text.

#### Scenario: A result names its origin

- **WHEN** a search returns a Turn from another Conversation
- **THEN** the result SHALL identify that Conversation and its Codebase

#### Scenario: A result from before codebases were recorded still says what it can

- **WHEN** a matching Turn predates the recording of Codebases
- **THEN** it SHALL be returned with its Conversation and no Codebase, rather than withheld

#### Scenario: The record says which Turns a search returned

- **WHEN** a search returns Turn 3 of Conversation A and then Turn 7 of Conversation B
- **THEN** the tool result's details SHALL record Conversation A Turn 3 and Conversation B Turn 7, in that order
