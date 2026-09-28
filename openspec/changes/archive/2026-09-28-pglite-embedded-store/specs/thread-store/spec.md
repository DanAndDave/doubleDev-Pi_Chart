## ADDED Requirements

### Requirement: The default store is embedded and needs no external server

The system SHALL provide the Thread Store from an embedded database that runs in the extension's own process and persists to a local data directory, so that a fresh installation needs no server, daemon, or container — only the runtime. This embedded store SHALL be the default, used whenever no store connection is configured. The embedded store SHALL support the same schema, vector indexing, and similarity search as a server-backed store, so that whether the store is embedded or a server changes where content lives, not what the system can retrieve.

When a store connection is configured, the system SHALL use that server-backed store instead of the embedded one. Declining the store SHALL remain distinct from both: neither embedded nor server, the verbatim tail falls back to the harness's own history.

#### Scenario: A fresh install retrieves with no server running

- **WHEN** the system runs with no store connection configured and no database server present
- **THEN** the Thread Store SHALL be available, and a Conversation's Turns SHALL be ingested and retrievable both by recency and by meaning without any server having been started

#### Scenario: The embedded store persists across sessions

- **WHEN** a Conversation is ingested into the default store, the session ends, and a later session opens the default store from the same data directory
- **THEN** the earlier Conversation's Turns SHALL still be retrievable

#### Scenario: A configured connection selects the server-backed store

- **WHEN** a store connection is configured
- **THEN** the system SHALL ingest into and retrieve from the server it names rather than the embedded store

#### Scenario: Embedded and server stores retrieve equivalently

- **WHEN** the same Conversation is ingested into the embedded store and into a server-backed store and the same recall is run against each
- **THEN** each SHALL return the same Turns in the same order

## MODIFIED Requirements

### Requirement: An unreachable store degrades safely

When a configured Thread Store cannot be reached, the system SHALL report the failure and continue the Turn with whatever history the harness itself provides, rather than sending an empty or partial Context Pack. The embedded default store runs in-process and SHALL NOT be subject to this degradation for want of a server. A store declined outright SHALL degrade in the same visible way as one that cannot be reached.

#### Scenario: A turn survives an unreachable store

- **WHEN** a configured store cannot be reached while a Context Pack is being assembled
- **THEN** the Turn SHALL proceed and the failure SHALL be reported

#### Scenario: Degradation is visible, not silent

- **WHEN** a Context Pack is assembled without the store
- **THEN** the accounting for that Call SHALL show that the tail did not come from the store

#### Scenario: The embedded default does not degrade for lack of a server

- **WHEN** a Context Pack is assembled against the embedded default store with no database server running
- **THEN** the verbatim tail SHALL come from the store rather than from the harness's fallback history
