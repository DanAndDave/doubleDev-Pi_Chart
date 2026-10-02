## ADDED Requirements

### Requirement: Setup finds or provisions a Postgres server

The Thread Store SHALL be a pgvector-capable Postgres server, and setup SHALL obtain one without the operator naming it. When no store connection is configured, setup SHALL look for a server already running on the machine, trying in order: the standard Postgres connection environment, the platform's local sockets, and the default local port as the current user, and the project's own containerised server if it is already up. On the first candidate that answers, setup SHALL create a database for this project when it is missing and enable vector support in it, leaving every other database on that server untouched. A candidate that answers but cannot be used, because it lacks vector support or refuses to create the database or the extension, SHALL be reported with the command that fixes it, and setup SHALL go on to the next candidate.

When no candidate answers and a container runtime is available, setup SHALL start the project's containerised server, configured to restart with the machine, and use it. When no candidate answers and no container runtime is available, setup SHALL report that a pgvector Postgres is required and SHALL NOT report the store ready.

A store connection the operator configured SHALL be checked, never replaced: setup SHALL report whether it answers and SHALL NOT start or create anything for it.

#### Scenario: A running server is found and prepared

- **WHEN** setup runs with no store connection configured and a local Postgres with vector support is reachable as the current user
- **THEN** setup SHALL use that server, create the project's database on it if missing, enable vector support in that database, and report the store ready with the connection it settled on

#### Scenario: Candidates are tried in order

- **WHEN** more than one candidate server answers
- **THEN** setup SHALL use the earliest one in the discovery order

#### Scenario: An unusable server is explained and passed over

- **WHEN** the first candidate that answers lacks vector support or refuses to create the database or extension, and a later candidate is usable
- **THEN** setup SHALL report the first with the command that fixes it and SHALL settle on the later one

#### Scenario: No server falls back to the container

- **WHEN** no candidate answers and a container runtime is available
- **THEN** setup SHALL start the project's containerised server, wait until it answers, and settle on it

#### Scenario: No server and no container runtime

- **WHEN** no candidate answers and no container runtime is available
- **THEN** setup SHALL report the store not ready and name a pgvector Postgres as the missing requirement

#### Scenario: A configured connection is only checked

- **WHEN** setup runs with a store connection configured
- **THEN** setup SHALL report whether that server answers and SHALL NOT discover, create, or start anything

### Requirement: The connection setup settles on is used by every later session

Setup SHALL save the connection it settled on to a file readable only by the operator, and every later session SHALL use that saved connection whenever no store connection is configured. A configured connection SHALL take precedence over the saved one, and declining the store SHALL take precedence over both. Running setup again SHALL re-verify the saved connection and SHALL replace it only when it no longer answers.

#### Scenario: A later session uses the saved connection

- **WHEN** setup has saved a connection and a later session starts with no store connection configured
- **THEN** that session SHALL ingest into and retrieve from the saved server

#### Scenario: Concurrent sessions share one store

- **WHEN** two sessions run at the same time against the saved connection and both ingest Turns
- **THEN** each session's Turns SHALL be retrievable from the other, and neither session SHALL fail for the other's presence

#### Scenario: A configured connection overrides the saved one

- **WHEN** a connection has been saved and a session starts with a different store connection configured
- **THEN** that session SHALL use the configured connection

#### Scenario: A saved connection that still answers is kept

- **WHEN** setup runs again and the saved connection answers
- **THEN** setup SHALL keep it rather than discover another server

### Requirement: An unconfigured store is reported, not guessed

With no store connection configured and none saved, the system SHALL NOT connect to a server it guessed. The session SHALL degrade as a declined store does, and both the session's start and the installation check SHALL say that setup has not been run, naming the command that runs it.

#### Scenario: A fresh install before setup

- **WHEN** a session starts with no store connection configured and none saved
- **THEN** no database connection SHALL be attempted, the verbatim tail SHALL come from the harness's own history, and the installation check SHALL report the store not set up with the setup command as its fix

### Requirement: A former embedded store is named

When the data directory of the former embedded store exists, the installation check and setup SHALL name it as no longer read and safe to remove, since its content is derived from the Journals. The system SHALL NOT delete or migrate it.

#### Scenario: A stranded embedded store

- **WHEN** the installation check runs and the former embedded store's data directory exists
- **THEN** the check SHALL name that directory as unused and removable, and the directory SHALL be left in place

### Requirement: A store that cannot be used degrades safely

When a configured Thread Store cannot be reached, the system SHALL report the failure and continue the Turn with whatever history the harness itself provides, rather than sending an empty or partial Context Pack. A store declined outright, or not yet set up, SHALL degrade in the same visible way as one that cannot be reached.

#### Scenario: A turn survives an unreachable store

- **WHEN** a configured store cannot be reached while a Context Pack is being assembled
- **THEN** the Turn SHALL proceed and the failure SHALL be reported

#### Scenario: Degradation is visible, not silent

- **WHEN** a Context Pack is assembled without the store
- **THEN** the accounting for that Call SHALL show that the tail did not come from the store

## MODIFIED Requirements

### Requirement: The schema is versioned and applied forward

The system SHALL own its schema and apply migrations forward automatically, so that a store created by an older version becomes usable without manual intervention. Sessions that connect to the same store at the same time SHALL apply each migration exactly once between them.

#### Scenario: An empty database is made ready

- **WHEN** the system connects to a database with no schema
- **THEN** it SHALL create the schema and report the store ready

#### Scenario: Migrations are not reapplied

- **WHEN** the system connects to an already-migrated database
- **THEN** it SHALL leave existing content intact

#### Scenario: Concurrent sessions migrate once

- **WHEN** two sessions connect to the same unmigrated database at the same time
- **THEN** both SHALL report the store ready and each migration SHALL be recorded once

### Requirement: Store resources are released when a session ends

The system SHALL release every Store resource it constructs when the session ends. Final ingest or retention failures SHALL NOT prevent resource cleanup. A store that never opened SHALL be released without raising, since its failure was reported when the session started.

#### Scenario: Session shutdown closes the database client

- **WHEN** a session using the Thread Store shuts down
- **THEN** the Thread Store's database client SHALL be closed

#### Scenario: A failed final sweep does not skip cleanup

- **WHEN** final ingest or retention fails during session shutdown
- **THEN** the system SHALL still attempt to close the Thread Store and every other constructed dependency

#### Scenario: Repeated sessions do not accumulate connections

- **WHEN** extension dependencies are repeatedly started and shut down
- **THEN** database connection use SHALL return to its pre-session baseline rather than accumulate across sessions

#### Scenario: A store that never opened shuts down quietly

- **WHEN** a session whose Thread Store failed to open shuts down
- **THEN** shutdown SHALL complete without reporting an error for that store

## REMOVED Requirements

### Requirement: The default store is embedded and needs no external server

**Reason**: The embedded database is single-process, and concurrent sessions each opened it from their own process; with no cross-process lock, two writers corrupted its write-ahead log until every open aborted.
**Migration**: Run `/pi-chart setup`, which finds or provisions a pgvector Postgres and saves its connection. Turns are rebuilt from the Journals on the next session; the old data directory can be removed.

### Requirement: An unreachable store degrades safely

**Reason**: Its third scenario promised the embedded default would never degrade for want of a server; with the embedded store removed there is no such default, and the requirement is replaced by "A store that cannot be used degrades safely".
**Migration**: None for callers: the two remaining scenarios carry over unchanged into the replacement, which adds the not-set-up store to what degrades visibly.
