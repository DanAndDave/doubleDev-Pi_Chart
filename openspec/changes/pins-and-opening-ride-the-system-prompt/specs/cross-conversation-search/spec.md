## MODIFIED Requirements

### Requirement: Every conversation can be searched on request

The system SHALL offer a search over all Conversations, returning the Turns most similar in meaning to a given query, most similar first, subject to a relevance minimum. That minimum is the one `PICHART_RECALL_MAX_DISTANCE` sets, and it SHALL govern this search alone: searching the current Conversation's evicted Turns with `recall_earlier_turns` applies none.

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

## REMOVED Requirements

### Requirement: A relevance judge refuses what distance admits

**Reason**: The relevance judge is deleted (ADR-0015). `recall_across_conversations` keeps its distance threshold and its result shape, and the agent that asked weighs what comes back.

**Migration**: None needed for results: the search returns what distance alone admits, as it did without a key. `PICHART_JUDGE` is a retired name; a session that still sets it is warned that it is no longer read.

### Requirement: The search works without the judge

**Reason**: With the judge deleted, the search always runs by distance alone, so there is no judged path to fall back from and no "not judged" state to report.

**Migration**: None. Results are what distance alone admits. `PICHART_JUDGE` is a retired name and warns when set.

### Requirement: Judging can be switched off without removing the key

**Reason**: There is no judge to switch on or off. The judging setting and the installation check's judge line go with it.

**Migration**: Remove `PICHART_JUDGE` from the environment. It is a retired name; while it is set, the session warns that it is no longer read.

### Requirement: Sending Turn text off the machine is disclosed

**Reason**: Nothing sends Turn text to a judge any more, so there is nothing to disclose.

**Migration**: None. `PICHART_JUDGE` is a retired name and warns when set.
