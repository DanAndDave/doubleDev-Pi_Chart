## ADDED Requirements

### Requirement: The store answers a Conversation's Turn 0 prompt

The Thread Store SHALL answer, for a Conversation, the prompt of its Turn at index 0 exactly as stored, including an empty prompt. Where the store holds no Turn 0 for that Conversation, because it was never ingested or has been removed by retention or by a branch move, it SHALL answer that it holds none, and SHALL NEVER answer with the prompt of another Turn. The answer SHALL be scoped to the one Conversation asked about.

#### Scenario: Turn 0's prompt is answered

- **WHEN** a Conversation's Turns 0 to 11 are stored and its Turn 0 prompt is asked for
- **THEN** the store SHALL answer Turn 0's prompt

#### Scenario: An empty Turn 0 prompt is answered as empty

- **WHEN** Turn 0 is stored with an empty prompt
- **THEN** the store SHALL answer an empty prompt, distinguishably from holding no Turn 0

#### Scenario: A removed first Turn is not replaced

- **WHEN** Turn 0 has been removed and Turns 1 onward remain
- **THEN** the store SHALL answer that it holds no Turn 0 prompt, and SHALL NOT answer Turn 1's prompt

#### Scenario: Another Conversation's Turn 0 prompt is not answered

- **WHEN** one Conversation's Turn 0 is stored and another Conversation with no stored Turns asks for its Turn 0 prompt
- **THEN** the store SHALL answer that it holds none for the second Conversation

#### Scenario: A re-ingested first Turn answers its new prompt

- **WHEN** Turn 0 is ingested again with a different prompt, as after a branch move that diverges at the root
- **THEN** the store SHALL answer the new prompt
