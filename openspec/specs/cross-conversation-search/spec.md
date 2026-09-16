# cross-conversation-search Specification

## Purpose
Reaching deliberately into everything the Thread Store remembers — every Conversation, every Codebase — when the current Conversation does not hold the answer, without letting that reach happen by accident.

## Requirements

### Requirement: Every conversation can be searched on request

The system SHALL offer a search over all Conversations, returning the Turns most similar in meaning to a given query, most similar first, subject to the same relevance minimum as recall.

#### Scenario: A decision from another conversation is found

- **WHEN** a Conversation other than the current one holds a Turn matching the query
- **THEN** that Turn SHALL be returned

#### Scenario: The current conversation is not excluded

- **WHEN** the current Conversation holds a matching Turn
- **THEN** it SHALL be returned alongside matches from elsewhere

#### Scenario: Irrelevant turns are refused here too

- **WHEN** no Turn anywhere meets the relevance minimum
- **THEN** the search SHALL return nothing rather than the nearest available

#### Scenario: The number of results is bounded

- **WHEN** more Turns match than were asked for
- **THEN** only the requested number SHALL be returned, most similar first

### Requirement: Results say where they came from

Every result SHALL carry the Conversation it belongs to and, where recorded, the Codebase that Conversation happened in, so that a recollection from elsewhere is recognisable as such.

#### Scenario: A result names its origin

- **WHEN** a search returns a Turn from another Conversation
- **THEN** the result SHALL identify that Conversation and its Codebase

#### Scenario: A result from before codebases were recorded still says what it can

- **WHEN** a matching Turn predates the recording of Codebases
- **THEN** it SHALL be returned with its Conversation and no Codebase, rather than withheld

### Requirement: Searching is an action, not an assembly step

Searching across Conversations SHALL be something the agent does explicitly, whose result it receives as the outcome of that action. It SHALL NOT alter how a Context Pack is assembled.

#### Scenario: A pack is unchanged by the existence of a wider search

- **WHEN** a search across Conversations is available
- **THEN** the Context Pack assembled for a Call SHALL contain exactly what it would have contained without it

#### Scenario: Searching is visible

- **WHEN** the agent searches across Conversations
- **THEN** the search and its result SHALL be visible in the Conversation rather than injected silently

### Requirement: A search failure is reported, not fatal

When the search cannot run, the system SHALL report the failure as the outcome of the action and the Turn SHALL continue.

#### Scenario: An unreachable store fails the search, not the turn

- **WHEN** the Thread Store cannot be reached during a search
- **THEN** the failure SHALL be reported as the search's result and the Turn SHALL proceed
