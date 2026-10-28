## ADDED Requirements

### Requirement: A process holds one bounded pool per store

A process SHALL hold at most one connection pool to a given Thread Store, whatever the number of sessions it runs, main or subagent, and however many times the extension is loaded into it. Every session in the process that opens the Thread Store at the same connection SHALL draw on that pool. The pool SHALL open no more than a fixed number of connections, and a query issued while every connection is busy SHALL wait for one rather than open another. Each session SHALL hold one share of the pool; the pool SHALL close only when no session in the process holds a share. A session that gives its share back twice SHALL NOT give back another session's share.

#### Scenario: A subagent's session reuses the pool

- **WHEN** a session using the Thread Store is running and a subagent's session opens the same Thread Store in the same process
- **THEN** the subagent's session SHALL use the pool the first session opened, and the process SHALL hold no more connections to the Thread Store than before

#### Scenario: The pool closes only when the last session ends

- **WHEN** two sessions in one process share the pool and one of them shuts down
- **THEN** the other SHALL go on reading and writing the Thread Store, and the process's connections to it SHALL close only once that other session shuts down too

#### Scenario: A repeated close gives back one share

- **WHEN** a session's store is closed twice while another session still shares the pool
- **THEN** the other session SHALL still be able to use the Thread Store

#### Scenario: The bound holds under concurrent queries

- **WHEN** the sessions sharing the pool issue more concurrent queries than the pool's bound
- **THEN** the process SHALL hold no more connections to the Thread Store than the bound, and every query SHALL complete

## MODIFIED Requirements

### Requirement: Store resources are released when a session ends

The system SHALL release every Store resource it constructs when the session ends. For the Thread Store's connection pool, which a process shares between its sessions, the session SHALL give back its share, and the pool SHALL close once no session in the process holds one. Final ingest or retention failures SHALL NOT prevent resource cleanup. A store that never opened SHALL be released without raising, since its failure was reported when the session started.

#### Scenario: Session shutdown closes the database client

- **WHEN** a session using the Thread Store shuts down
- **THEN** the session SHALL give back its share of the Thread Store's database client, and the client SHALL be closed when that was the last share in the process

#### Scenario: A failed final sweep does not skip cleanup

- **WHEN** final ingest or retention fails during session shutdown
- **THEN** the system SHALL still attempt to close the Thread Store and every other constructed dependency

#### Scenario: Repeated sessions do not accumulate connections

- **WHEN** extension dependencies are repeatedly started and shut down in one process, main sessions and subagents alike
- **THEN** the process's connections to the Thread Store SHALL never exceed the shared pool's bound however many sessions it has run, and SHALL return to its pre-session baseline once the last session holding a share shuts down

#### Scenario: A store that never opened shuts down quietly

- **WHEN** a session whose Thread Store failed to open shuts down
- **THEN** shutdown SHALL complete without reporting an error for that store
