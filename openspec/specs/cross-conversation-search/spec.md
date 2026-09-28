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

### Requirement: A relevance judge refuses what distance admits

When a relevance judge is available for the session, the system SHALL ask it, for each Turn that meets the distance threshold, whether that Turn is relevant to the query, and SHALL refuse every Turn the judge scores below its threshold. The Turns that remain SHALL keep their order by distance, and no more than the requested number SHALL be returned.

#### Scenario: A Turn the judge refuses is not returned

- **WHEN** a Turn meets the distance threshold and the judge scores it below its threshold
- **THEN** that Turn SHALL NOT be returned

#### Scenario: A refusal does not shrink the answer when more is available

- **WHEN** the judge refuses some of the requested number of Turns and further Turns, within the search's candidate ceiling, meet the distance threshold
- **THEN** those further Turns SHALL be judged, and those the judge accepts SHALL fill the result up to the requested number, in distance order

#### Scenario: The result says what the judge refused

- **WHEN** the judge refuses one or more Turns
- **THEN** the result SHALL state how many Turns the judge refused

#### Scenario: Everything refused is an empty answer, not the nearest

- **WHEN** the judge refuses every Turn that met the distance threshold
- **THEN** the search SHALL return no Turns and SHALL say that the judge refused them

### Requirement: The search works without the judge

The system SHALL run the search by distance alone when no key for the judge resolves, when judging is switched off, or when the judge cannot answer. Without a key or with judging off, the result SHALL be what the search returned before judging existed. When the judge was to be asked and could not answer, the result SHALL say that it was not judged, and why.

#### Scenario: No key

- **WHEN** no key for the judge resolves in the session
- **THEN** the search SHALL return what distance alone admits, and SHALL NOT contact the judge

#### Scenario: The judge fails

- **WHEN** the judge rejects the key, is rate-limited, does not answer within its deadline, or returns an answer that cannot be read
- **THEN** the search SHALL return what distance alone admits and SHALL say that the result was not judged and why

#### Scenario: A rejected key is reported once

- **WHEN** the judge rejects the key
- **THEN** the operator SHALL be told once in the session, and later searches in that session SHALL NOT contact the judge

### Requirement: Judging can be switched off without removing the key

The system SHALL judge by default whenever a key resolves, and SHALL offer a setting that turns judging off while the key stays where it is, both as a default and for the running session only.

#### Scenario: Off by setting

- **WHEN** the judging setting is `off` and a key resolves
- **THEN** no search SHALL contact the judge

#### Scenario: Off for this session only

- **WHEN** the operator switches judging off for the running session
- **THEN** no later search in that session SHALL contact the judge, and the next session SHALL start from the configured setting

#### Scenario: An unrecognised setting is not silently obeyed

- **WHEN** the judging setting holds a value other than `auto` or `off`
- **THEN** judging SHALL be off and the operator SHALL be told at session start

#### Scenario: The state of the judge is visible

- **WHEN** the operator checks the installation
- **THEN** the check SHALL say whether the judge is on, switched off, or has no key, and how to change that

### Requirement: Sending Turn text off the machine is disclosed

The first time in a session that the system sends Turn text to the judge, it SHALL tell the operator what is sent, where it goes, and how to stop it.

#### Scenario: The first judged search discloses

- **WHEN** the first judged search of a session contacts the judge
- **THEN** the operator SHALL be told, once, that Turn text is sent to the judge's service, and the setting that stops it

#### Scenario: No disclosure when nothing is sent

- **WHEN** a session's searches never contact the judge
- **THEN** no disclosure SHALL be made
