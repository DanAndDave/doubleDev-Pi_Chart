## ADDED Requirements

### Requirement: Reading a graph does not hold up a Call

A Call SHALL NOT wait for a graph to be read once one has been read in this session. When the extraction has changed since the graph in use was read, the Call SHALL be served the graph already in use, and the newer extraction SHALL be read in the background. Calls that find the same change SHALL share a single read of it. Serving the graph already in use SHALL NOT present it as current where it is not: what the Codebase has outgrown SHALL be disclosed against the age of that graph, exactly as for any other older extraction.

A session SHALL begin reading its Codebase's graph when it starts, without waiting for the read to finish. A Call that arrives before any graph has been read SHALL wait for that read no longer than the structure deadline, and SHALL be treated as a missed deadline once it passes.

An extraction rewritten with the same content as the graph in use SHALL NOT be read again: the graph in use SHALL be kept, and SHALL count as being as recent as the rewrite.

Reading a graph SHALL NOT make the session unresponsive for the time the whole read takes. Only taking in what was read and indexing it, which each take a fraction of that time, SHALL run where they can hold up the session, and they SHALL NOT run as one uninterrupted stall.

When a newer extraction cannot be read and a graph is already in use, the graph in use SHALL continue to be served and the failure SHALL be reported once. That extraction SHALL NOT be read again until it changes.

#### Scenario: A Call while a newer extraction is read

- **WHEN** a graph has been read and the extraction changes before a Call
- **THEN** the Call SHALL be served the graph already read without waiting for the newer one, and a later Call SHALL be served the newer graph once it has been read

#### Scenario: Several Calls find the same change

- **WHEN** several Calls arrive after the extraction changed and before it has been read
- **THEN** the extraction SHALL be read once

#### Scenario: Structure served from the graph already read

- **WHEN** a Call is served the graph already read while a newer extraction is being read, and a symbol's file was edited after the older graph was written
- **THEN** that symbol's neighbourhood SHALL be disclosed as older than the Codebase

#### Scenario: The first Call of a session

- **WHEN** a session starts in a Codebase that has a graph and its first Call arrives after the graph has been read
- **THEN** that Call SHALL carry structure without reading the graph itself

#### Scenario: A Call before any graph is read

- **WHEN** a Call arrives while the session's first read of the graph is still running
- **THEN** the Call SHALL wait for it no longer than the structure deadline, and once the deadline passes the Pack SHALL be assembled without structure and the omission reported as a missed deadline

#### Scenario: A refresh that rewrote the same graph

- **WHEN** an extraction is rewritten with content identical to the graph in use
- **THEN** the graph SHALL NOT be read again, and files changed before the rewrite SHALL no longer be disclosed as older than it

#### Scenario: Reading a large graph

- **WHEN** a graph of hundreds of megabytes is read
- **THEN** the session SHALL remain responsive throughout the read, except while what was read is taken in and while it is indexed, each a stall of its own

#### Scenario: A newer extraction that cannot be read

- **WHEN** a graph is in use and a newer extraction cannot be read
- **THEN** Calls SHALL keep carrying structure from the graph in use, the failure SHALL be reported once, and that extraction SHALL NOT be read again until it changes

## MODIFIED Requirements

### Requirement: An unexpected extraction is reported, never guessed at

The Graph Store SHALL read graphify's output through an adapter that states what it requires. Output that does not meet it SHALL produce an error naming what was wrong, and SHALL NOT be partially interpreted.

#### Scenario: A graph missing what the adapter requires

- **WHEN** an extraction lacks the fields the adapter reads
- **THEN** the error SHALL name the field that was missing

#### Scenario: A graph that cannot be parsed at all

- **WHEN** an extraction is not readable as a graph and no earlier graph has been read in the session
- **THEN** the failure SHALL be reported and no structure SHALL be carried

#### Scenario: An unexpected connection kind

- **WHEN** an extraction contains a relation the adapter does not know
- **THEN** that connection SHALL be left out rather than treated as programmatic
