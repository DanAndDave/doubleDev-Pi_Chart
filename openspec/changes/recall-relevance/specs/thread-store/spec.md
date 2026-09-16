## MODIFIED Requirements

### Requirement: Retrieval ranks turns by similarity to the prompt

The system SHALL return the Turns most similar in meaning to a given prompt, most similar first, limited to a requested count. Retrieval SHALL remain scoped to the current Conversation. A Turn SHALL be returned only when its similarity meets a configured minimum, so that retrieval returns what is relevant rather than merely what is nearest.

#### Scenario: The most relevant turn comes first

- **WHEN** a Conversation holds Turns on several subjects and one is retrieved for a prompt about one of them
- **THEN** the Turn on that subject SHALL rank above the others

#### Scenario: Retrieval does not reach into another conversation

- **WHEN** two Conversations hold Turns on the same subject and one retrieves
- **THEN** no Turn belonging to the other SHALL be returned

#### Scenario: Turns already carried verbatim are not retrieved again

- **WHEN** retrieval runs for a Call whose verbatim tail already holds a matching Turn
- **THEN** that Turn SHALL NOT also be returned as a recollection

#### Scenario: An unembedded conversation retrieves nothing rather than failing

- **WHEN** retrieval runs against a Conversation whose Turns have no vectors yet
- **THEN** it SHALL return no Turns and SHALL NOT raise

#### Scenario: A turn below the threshold is not returned

- **WHEN** the nearest Turn to a prompt is still less similar than the minimum
- **THEN** it SHALL NOT be returned, even though nothing ranks above it

#### Scenario: A conversation with nothing relevant returns nothing

- **WHEN** no Turn in a Conversation meets the minimum for a prompt
- **THEN** retrieval SHALL return no Turns rather than its least-irrelevant ones

#### Scenario: The threshold does not disturb ranking

- **WHEN** several Turns meet the minimum
- **THEN** they SHALL be returned in the same order they would have been without it

#### Scenario: Retrieval reports what the threshold excluded

- **WHEN** retrieval rejects Turns for being below the minimum
- **THEN** it SHALL report how many it rejected, so the minimum can be judged
