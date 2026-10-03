# graph-store Specification

## Purpose
A Codebase's programmatic structure, derived with graphify and read through an adapter that carries only what a parser established. It answers structural questions — what calls this, what does it import — from a parse rather than a search, because a symbol's name is exact and such a question has one correct answer.

## Requirements

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

Keeping up SHALL hold across a Conversation in which the Codebase is edited, not only at the point the Conversation begins: the Graph Store SHALL refresh after the agent finishes work, so that a Codebase edited during a Conversation is re-extracted without the user asking. Refreshing SHALL NOT run on the path a Call waits on, and a refresh that fails SHALL be reported and SHALL NOT affect the Turn.

A refresh requested while an extraction of the same Codebase is running SHALL NOT be dropped: once the running extraction ends, the Codebase SHALL be extracted again, so that an edit made during a long extraction still reaches the graph. Requests that arrive during one run SHALL produce at most one further run.

A failed refresh SHALL be reported in the session that requested it while that session is open. A failure no open session reported SHALL be reported once by the next session in that Codebase.

#### Scenario: A file changed

- **WHEN** a file in the Codebase has changed since extraction
- **THEN** refreshing SHALL bring the graph up to date

#### Scenario: Nothing changed

- **WHEN** no file has changed since extraction
- **THEN** refreshing SHALL re-extract nothing

#### Scenario: A codebase edited during a conversation

- **WHEN** the agent edits code in a Conversation and then works on a later Turn
- **THEN** the structure offered for that later Turn SHALL reflect the edit rather than the Codebase as it stood when the Conversation began

#### Scenario: Refreshing costs the edit, not the corpus

- **WHEN** a Conversation's Turn changes one file of a Codebase
- **THEN** the refresh that follows it SHALL re-extract that file's share of the Codebase rather than all of it

#### Scenario: A refresh that fails

- **WHEN** a refresh after a Turn cannot run
- **THEN** the reason SHALL be reported, the previous graph SHALL remain readable, and the Turn SHALL be unaffected

#### Scenario: An edit made while a refresh is running

- **WHEN** a Turn edits the Codebase and finishes while an extraction of that Codebase is still running
- **THEN** the Codebase SHALL be extracted again after that extraction ends

#### Scenario: Many refreshes requested during one run

- **WHEN** several Turns finish while one extraction is running
- **THEN** exactly one further extraction SHALL follow it

#### Scenario: A failure after its session ended

- **WHEN** an extraction fails after the session that started it has ended
- **THEN** the next session in that Codebase SHALL report the failure once

### Requirement: An extraction outlives the session that started it

An extraction SHALL continue after the session that started it ends, and its result SHALL be the graph later sessions read. Ending a session SHALL NOT wait for an extraction to complete and SHALL NOT stop one. A session that is ending SHALL still launch the refresh its last Turn asked for.

#### Scenario: A session shorter than the extraction

- **WHEN** a session starts the first extraction of a Codebase and ends before that extraction completes
- **THEN** the extraction SHALL complete, and the next session in that Codebase SHALL read the graph it produced

#### Scenario: Ending a session during an extraction

- **WHEN** a session ends while an extraction it started is running
- **THEN** the session SHALL end without waiting for the extraction to complete

#### Scenario: The last Turn's refresh

- **WHEN** a session ends after a Turn that edited the Codebase
- **THEN** a refresh reflecting that edit SHALL have been launched before the session ends

### Requirement: One extraction at a time per Codebase

At most one extraction of a Codebase SHALL run at any moment across every session and process on the machine, because graphify does not lock the directory it writes. An extraction whose process has died SHALL NOT keep the Codebase from being extracted again.

#### Scenario: Two sessions in one Codebase

- **WHEN** two sessions in the same Codebase each request a refresh at the same time
- **THEN** one extraction SHALL run, followed by at most one more

#### Scenario: A killed extraction

- **WHEN** an extraction's process is killed without warning
- **THEN** the next refresh requested for that Codebase SHALL run rather than wait on the dead one

#### Scenario: Two Codebases at once

- **WHEN** refreshes are requested for two different Codebases
- **THEN** both SHALL be able to run at the same time

### Requirement: A hung extraction is bounded by a deadline the operator can move

An extraction SHALL be stopped once it has run for longer than a configured deadline, together with every process it started, and the stop SHALL be reported with what the extraction printed last. The default deadline SHALL be long enough for the cold extraction of a large Codebase to finish, because the deadline exists to free a Codebase from a hung tool and not to limit a Codebase's size.

#### Scenario: A large Codebase's first extraction

- **WHEN** the cold extraction of a Codebase takes longer than one minute and less than the configured deadline
- **THEN** it SHALL complete and produce a graph

#### Scenario: An extraction that never ends

- **WHEN** an extraction runs past the configured deadline
- **THEN** it and every process it started SHALL be stopped, the Codebase SHALL be free to extract again, and the stop SHALL be reported naming the deadline and the setting that moves it

### Requirement: An extraction in progress is disclosed

When a structure Budget is configured and the Codebase has no graph because its extraction has not finished, the report SHALL say that an extraction is in progress and when it began, and SHALL NOT tell the operator to switch extraction on. The configuration report SHALL say whether an extraction is running for the Codebase and how the last one ended.

#### Scenario: The first extraction still running

- **WHEN** a Call asks for structure while the Codebase's first extraction is running
- **THEN** the Turn SHALL proceed without structure and the report SHALL say extraction is in progress, rather than that the Codebase has no graph

#### Scenario: No graph and nothing running

- **WHEN** a Call asks for structure, the Codebase has no graph, and no extraction is running
- **THEN** the report SHALL say the Codebase has no graph, as before

#### Scenario: Status during an extraction

- **WHEN** what the system has configured is reported while an extraction is running
- **THEN** the codebase graph line SHALL say an extraction is running and since when

### Requirement: A graph past graphify's size cap is reported, not raised

When graphify refuses to refresh a graph because it exceeds graphify's graph-file size cap, the Graph Store SHALL report it once per session. The report SHALL name the graph's size, the cap, `GRAPHIFY_MAX_GRAPH_BYTES` as the way to raise the cap, and `.graphifyignore` as the way to shrink the graph, and SHALL say that raising the cap makes reading the graph slower and larger in memory. The Graph Store SHALL NOT raise the cap itself. The existing graph SHALL remain readable, with its age disclosed as for any other refresh that did not land.

#### Scenario: A refresh refused for size

- **WHEN** a refresh fails because the existing graph exceeds graphify's size cap
- **THEN** the report SHALL name the size, the cap, `GRAPHIFY_MAX_GRAPH_BYTES` and `.graphifyignore`, and structure from the existing graph SHALL still be carried

#### Scenario: Refused on every Turn

- **WHEN** refreshes after several Turns in one session are each refused for size
- **THEN** the size report SHALL appear once in that session

#### Scenario: The operator raised the cap

- **WHEN** `GRAPHIFY_MAX_GRAPH_BYTES` is set in the environment pi-chart runs in
- **THEN** graphify SHALL receive it, and a graph under the raised cap SHALL refresh normally

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

### Requirement: Structure older than the Codebase is disclosed as such

The Graph Store SHALL state, for every neighbourhood it reports, whether the extraction it came from is older than the file the symbol lives in. Structure derived before the Codebase's current state SHALL be disclosed as older wherever it is carried, so that positions and connections the agent cannot rely on are visibly second-hand rather than presented as current. Structure SHALL NOT be withheld for being older — it SHALL be carried and disclosed, because a Turn that edits code is the Turn that most needs a starting point.

Freshness that cannot be established SHALL be treated as older rather than as current.

#### Scenario: A symbol in a file edited since extraction

- **WHEN** a symbol's file has changed since the extraction the structure came from
- **THEN** that neighbourhood SHALL be reported as older than the Codebase, and SHALL still be reported

#### Scenario: A symbol in an untouched file

- **WHEN** a symbol's file has not changed since extraction
- **THEN** that neighbourhood SHALL carry no such disclosure

#### Scenario: One pack, two ages

- **WHEN** a Turn works with one symbol whose file was edited and one whose file was not
- **THEN** the disclosure SHALL apply to the edited symbol's neighbourhood alone

#### Scenario: A file that can no longer be found

- **WHEN** a symbol's file cannot be examined for its age
- **THEN** its neighbourhood SHALL be reported as older than the Codebase rather than as current

### Requirement: The symbols in play are those the Turn is working with

The Graph Store SHALL take the symbols in play from the whole current Turn — the prompt, the agent's own text, the tools it called, the arguments it called them with, and their results — and not from the prompt's prose alone, so that a Call made deep in a tool loop derives structure from what the Turn is working with rather than from a sentence written many steps earlier.

A file the Turn names SHALL resolve to the symbols that file defines, so that naming a path is a way of asking about its contents. A path naming nothing the graph knows SHALL yield no symbols rather than a guess.

A symbol named directly SHALL be preferred over one reached only through a file in play, and the text considered SHALL be bounded per message so that a single large tool result cannot displace what the Turn is about. The rule that disregards an ordinary word matching only a member's name SHALL continue to apply to the whole of this text.

#### Scenario: A tool-loop call whose prompt names nothing

- **WHEN** a Turn's prompt names no symbol but the Turn has read files the graph knows
- **THEN** the symbols those files define SHALL be among those found

#### Scenario: A path in play

- **WHEN** a Turn names a path to a file the graph knows
- **THEN** the symbols that file defines SHALL be found

#### Scenario: A path that matches nothing

- **WHEN** a Turn names a path no symbol in the graph belongs to
- **THEN** no symbols SHALL be found for it

#### Scenario: What the prompt names comes first

- **WHEN** a Turn names one symbol outright and works with a file defining many others
- **THEN** the symbol named outright SHALL be preferred over those reached only through the file

#### Scenario: A large tool result cannot take over the turn

- **WHEN** a Turn carries a tool result far larger than the rest of the Turn
- **THEN** the symbols found SHALL still include those the prompt and the tool arguments name

#### Scenario: Prose words are still disregarded

- **WHEN** a Turn's wider text contains ordinary words matching only members' names, alongside something named unambiguously
- **THEN** the unambiguous symbol SHALL be found and the ordinary words SHALL be disregarded

### Requirement: A truncated neighbourhood keeps its most informative connections

When a symbol has more connections than the Pack carries, the Graph Store SHALL choose which to keep by what the connection says about the symbol, not by the order the extraction happens to list them. Connections describing how a symbol is used and what it depends on — what calls it, what it calls, what imports or re-exports it, what it inherits from or implements — SHALL be preferred over connections describing what it merely contains or is a member of, in both directions. Two truncations of the same neighbourhood SHALL keep the same connections.

#### Scenario: A hub with more members than the cap

- **WHEN** a symbol's members alone outnumber the connections a Pack carries
- **THEN** what calls and imports that symbol SHALL be carried, and its members SHALL be the connections left out

#### Scenario: A neighbourhood that fits

- **WHEN** a symbol has no more connections than a Pack carries
- **THEN** every one of them SHALL be carried

#### Scenario: Truncation is deterministic

- **WHEN** the same over-sized neighbourhood is truncated twice
- **THEN** the same connections SHALL be kept, in the same order

#### Scenario: Both directions survive ranking

- **WHEN** an over-sized neighbourhood holds both inbound and outbound connections of the preferred kinds
- **THEN** the connections kept SHALL include both directions rather than one direction's worth

### Requirement: Structure does not depend on a Thread Store

The Graph Store SHALL be available whether or not a Thread Store is configured: declining the record of what happened SHALL NOT withdraw a Codebase's structure, since structure is derived from the Codebase alone.

A configured structure Budget with no graph the system can reach SHALL be reported, naming why structure is unavailable, rather than producing an empty part with no explanation. A report of what the system has configured SHALL describe structure as unavailable when no Graph Store exists to serve it, and SHALL NOT describe extraction as on.

#### Scenario: A session with no Thread Store

- **WHEN** a Thread Store is declined and a Codebase has a graph
- **THEN** structure SHALL still be available for the Turn

#### Scenario: A structure budget with nothing behind it

- **WHEN** a structure Budget is configured and no graph can be reached
- **THEN** the reason SHALL be reported once rather than the part being silently empty

#### Scenario: The configuration report matches what exists

- **WHEN** what the system has configured is reported and no Graph Store was constructed
- **THEN** structure SHALL be described as unavailable rather than as extracting

#### Scenario: Extraction declined is not extraction broken

- **WHEN** extraction has been declined by configuration
- **THEN** the report SHALL say so and SHALL NOT report it as a fault
