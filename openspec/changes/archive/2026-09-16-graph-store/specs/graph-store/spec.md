## ADDED Requirements

### Requirement: A Codebase's structure is available without being asked for

The Graph Store SHALL derive a Codebase's programmatic structure using graphify, obtaining graphify itself if the machine does not have it. A Codebase that already has an extraction SHALL be used as it stands. Failure to obtain or run graphify SHALL be reported and SHALL NOT affect the Turn.

#### Scenario: A codebase with no extraction

- **WHEN** a Codebase has no graph and graphify is available
- **THEN** an extraction SHALL be produced for it

#### Scenario: A machine without graphify

- **WHEN** graphify is not installed
- **THEN** the Graph Store SHALL install it before extracting

#### Scenario: An extraction that already exists

- **WHEN** a Codebase already carries a graph
- **THEN** it SHALL be read rather than re-derived from nothing

#### Scenario: Structure cannot be obtained

- **WHEN** graphify cannot be installed or cannot run
- **THEN** the reason SHALL be reported and the Turn SHALL proceed without structure

### Requirement: Only programmatic connections are carried

The Graph Store SHALL carry connections that a parser established — calls, imports and dynamic imports, re-exports, inheritance and extension, implementation, mixing in, embedding, dependency and requirement, containment, membership, and resolved references — and SHALL exclude anything inferred, semantic, or drawn from documentation. A connection SHALL be carried only if the extraction states it was extracted rather than guessed.

#### Scenario: An inferred edge is excluded

- **WHEN** an extraction contains an edge marked as inferred
- **THEN** it SHALL NOT be carried

#### Scenario: A documentation node is excluded

- **WHEN** an extraction contains nodes that are not code
- **THEN** connections to them SHALL NOT be carried

#### Scenario: An extraction with nothing programmatic

- **WHEN** every connection in an extraction is inferred
- **THEN** the Graph Store SHALL carry nothing rather than fall back to them

### Requirement: The graph keeps up with the Codebase

The Graph Store SHALL refresh an existing graph rather than rebuild it, so that keeping it current costs about as much as the change that made it stale. Refreshing a Codebase nothing has changed SHALL do no work.

#### Scenario: A file changed

- **WHEN** a file in the Codebase has changed since extraction
- **THEN** refreshing SHALL bring the graph up to date

#### Scenario: Nothing changed

- **WHEN** no file has changed since extraction
- **THEN** refreshing SHALL re-extract nothing

### Requirement: An unexpected extraction is reported, never guessed at

The Graph Store SHALL read graphify's output through an adapter that states what it requires. Output that does not meet it SHALL produce an error naming what was wrong, and SHALL NOT be partially interpreted.

#### Scenario: A graph missing what the adapter requires

- **WHEN** an extraction lacks the fields the adapter reads
- **THEN** the error SHALL name the field that was missing

#### Scenario: A graph that cannot be parsed at all

- **WHEN** an extraction is not readable as a graph
- **THEN** the failure SHALL be reported and no structure SHALL be carried

#### Scenario: An unexpected connection kind

- **WHEN** an extraction contains a relation the adapter does not know
- **THEN** that connection SHALL be left out rather than treated as programmatic

### Requirement: The symbols in play are found by name

The Graph Store SHALL find the symbols a prompt refers to by matching the identifiers in it against the names in the graph, without embeddings: a symbol's name is exact, and a structural question has one correct answer.

An ordinary word that matches only a member's name SHALL be disregarded when the prompt also names something unambiguously, since a prompt is written in prose and prose contains words that happen to be method names.

#### Scenario: A symbol named in the prompt

- **WHEN** a prompt names a symbol the graph knows
- **THEN** that symbol SHALL be among those found

#### Scenario: A prompt about nothing in the Codebase

- **WHEN** a prompt names nothing in the graph
- **THEN** no symbols SHALL be found

#### Scenario: A symbol written in a different style

- **WHEN** a prompt names a symbol using different capitalisation or punctuation than the graph records
- **THEN** the symbol SHALL still be found

#### Scenario: A prose word that happens to name a method

- **WHEN** a prompt names a symbol unambiguously and also contains an ordinary word matching a member's name
- **THEN** the unambiguous symbol SHALL be found and the ordinary word SHALL be disregarded

#### Scenario: Two symbols, differently written

- **WHEN** a prompt names one symbol plainly and another as a compound
- **THEN** both SHALL be found
