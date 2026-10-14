# graph-store Specification

## Purpose
A Codebase's programmatic structure, derived with graphify and read through an adapter that carries only what a parser established. It answers structural questions — what calls this, what does it import — from a parse rather than a search, because a symbol's name is exact and such a question has one correct answer.

## Requirements

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

When `codebase_structure` is called and the Codebase has no graph because its extraction has not finished, the result SHALL say that an extraction is in progress and when it began, and SHALL NOT tell the agent to switch extraction on. The configuration report SHALL say whether an extraction is running for the Codebase and how the last one ended.

#### Scenario: The first extraction still running

- **WHEN** `codebase_structure` is called while the Codebase's first extraction is running
- **THEN** the result SHALL say extraction is in progress, rather than that the Codebase has no graph
- **AND** the Turn SHALL proceed

#### Scenario: No graph and nothing running

- **WHEN** `codebase_structure` is called, the Codebase has no graph, and no extraction is running
- **THEN** the result SHALL say the Codebase has no graph

#### Scenario: Status during an extraction

- **WHEN** what the system has configured is reported while an extraction is running
- **THEN** the codebase graph line SHALL say an extraction is running and since when

### Requirement: A graph past graphify's size cap is reported, not raised

When graphify refuses to refresh a graph because it exceeds graphify's graph-file size cap, the Graph Store SHALL report it once per session. The report SHALL name the graph's size, the cap, `GRAPHIFY_MAX_GRAPH_BYTES` as the way to raise the cap, and `.graphifyignore` as the way to shrink the graph, and SHALL say that raising the cap makes reading the graph slower and larger in memory. The Graph Store SHALL NOT raise the cap itself. The existing graph SHALL remain readable, with its age disclosed as for any other refresh that did not land.

#### Scenario: A refresh refused for size

- **WHEN** a refresh fails because the existing graph exceeds graphify's size cap
- **THEN** the report SHALL name the size, the cap, `GRAPHIFY_MAX_GRAPH_BYTES` and `.graphifyignore`, and `codebase_structure` SHALL still answer from the existing graph

#### Scenario: Refused on every Turn

- **WHEN** refreshes after several Turns in one session are each refused for size
- **THEN** the size report SHALL appear once in that session

#### Scenario: The operator raised the cap

- **WHEN** `GRAPHIFY_MAX_GRAPH_BYTES` is set in the environment pi-chart runs in
- **THEN** graphify SHALL receive it, and a graph under the raised cap SHALL refresh normally

### Requirement: Reading a graph does not hold up a Call

A `codebase_structure` lookup SHALL NOT wait for a graph to be read once one has been read in this session. When the extraction has changed since the graph in use was read, the lookup SHALL be answered from the graph already in use, and the newer extraction SHALL be read in the background. Lookups that find the same change SHALL share a single read of it. Answering from the graph already in use SHALL NOT present it as current where it is not: what the Codebase has outgrown SHALL be disclosed against the age of that graph, exactly as for any other older extraction.

A session SHALL begin reading its Codebase's graph when it starts, without waiting for the read to finish. A lookup that arrives before any graph has been read SHALL wait for that read no longer than the Graph Store's deadline, and once the deadline passes SHALL say that structure is not loaded yet.

An extraction rewritten with the same content as the graph in use SHALL NOT be read again: the graph in use SHALL be kept, and SHALL count as being as recent as the rewrite.

Reading a graph SHALL NOT make the session unresponsive for the time the whole read takes. Only taking in what was read and indexing it, which each take a fraction of that time, SHALL run where they can hold up the session, and they SHALL NOT run as one uninterrupted stall.

When a newer extraction cannot be read and a graph is already in use, the graph in use SHALL continue to be served and the failure SHALL be reported once. That extraction SHALL NOT be read again until it changes.

#### Scenario: A Call while a newer extraction is read

- **WHEN** a graph has been read and the extraction changes before a Call in which the agent calls `codebase_structure`
- **THEN** the lookup SHALL be answered from the graph already read without waiting for the newer one, and a lookup in a later Call SHALL be answered from the newer graph once it has been read

#### Scenario: Several Calls find the same change

- **WHEN** lookups in several Calls arrive after the extraction changed and before it has been read
- **THEN** the extraction SHALL be read once

#### Scenario: Structure served from the graph already read

- **WHEN** a lookup is answered from the graph already read while a newer extraction is being read, and a symbol's file was edited after the older graph was written
- **THEN** that symbol's neighbourhood SHALL be disclosed as older than the Codebase

#### Scenario: The first Call of a session

- **WHEN** a session starts in a Codebase that has a graph and the first `codebase_structure` lookup arrives after the graph has been read
- **THEN** that lookup SHALL be answered without reading the graph itself

#### Scenario: A Call before any graph is read

- **WHEN** a lookup arrives while the session's first read of the graph is still running
- **THEN** it SHALL wait for that read no longer than the Graph Store's deadline, and once the deadline passes its result SHALL say that structure is not loaded yet

#### Scenario: A refresh that rewrote the same graph

- **WHEN** an extraction is rewritten with content identical to the graph in use
- **THEN** the graph SHALL NOT be read again, and files changed before the rewrite SHALL no longer be disclosed as older than it

#### Scenario: Reading a large graph

- **WHEN** a graph of hundreds of megabytes is read
- **THEN** the session SHALL remain responsive throughout the read, except while what was read is taken in and while it is indexed, each a stall of its own

#### Scenario: A newer extraction that cannot be read

- **WHEN** a graph is in use and a newer extraction cannot be read
- **THEN** lookups SHALL keep being answered from the graph in use, the failure SHALL be reported once, and that extraction SHALL NOT be read again until it changes

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

### Requirement: A truncated neighbourhood keeps its most informative connections

When a symbol has more connections than one hop of a `codebase_structure` lookup keeps for it, the Graph Store SHALL choose which to keep by what the connection says about the symbol, not by the order the extraction happens to list them. Connections describing how a symbol is used and what it depends on (what calls it, what it calls, what imports or re-exports it, what it inherits from or implements) SHALL be preferred over connections describing what it merely contains or is a member of, in both directions. Two truncations of the same neighbourhood SHALL keep the same connections.

#### Scenario: A hub with more members than the cap

- **WHEN** a symbol's members alone outnumber the connections a lookup keeps for it
- **THEN** what calls and imports that symbol SHALL be kept, and its members SHALL be the connections left out

#### Scenario: A neighbourhood that fits

- **WHEN** a symbol has no more connections than a lookup keeps for it
- **THEN** every one of them SHALL be kept

#### Scenario: Truncation is deterministic

- **WHEN** the same over-sized neighbourhood is truncated twice
- **THEN** the same connections SHALL be kept, in the same order

#### Scenario: Both directions survive ranking

- **WHEN** an over-sized neighbourhood holds both inbound and outbound connections of the preferred kinds
- **THEN** the connections kept SHALL include both directions rather than one direction's worth

### Requirement: A Codebase's structure is derived with graphify

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

### Requirement: Structure is looked up when the agent asks

The system SHALL offer the agent a `codebase_structure(symbol, depth?)` tool, registered only when a Graph Store is available. The tool SHALL resolve the symbol it is given by name against the names in the graph, without embeddings: a symbol's name is exact, and a structural question has one correct answer. A qualified `Class.method` name SHALL resolve to that member, a trailing `()` SHALL be ignored, and a name written with different capitalisation or punctuation than the graph records SHALL still resolve. A symbol defined in a test or script file SHALL resolve like any other, since naming it is asking for it.

The tool SHALL return the connections around the resolved symbol out to `depth` hops, each connection once, every one in the form `A (file:line) --relation--> B (file:line)`. `depth` SHALL be 1 when not given and SHALL be at most 3 whatever is given. Each hop SHALL keep each symbol's most informative connections, as "A truncated neighbourhood keeps its most informative connections" defines, and a symbol whose connections were cut SHALL say how many it left out. The whole result SHALL be cut at a line boundary to `PICHART_GRAPH_TOKENS`, with a visible marker saying that it was cut. What the tool returns is Turn content and SHALL NOT be recorded as a part of any Context Pack.

When the name resolves to nothing, the result SHALL say so and SHALL list up to five of the graph's nearest names. When no graph has been read yet, the tool SHALL wait for the session's first read no longer than the Graph Store's deadline, and once that passes SHALL say that structure is not loaded yet. A lookup that fails SHALL return a text result naming the Graph Store and the reason. In every case the Turn SHALL continue.

#### Scenario: A named symbol's connections are returned

- **WHEN** the tool is called with the name of a symbol the graph knows
- **THEN** the result SHALL list that symbol's connections, each with the file and line of both ends

#### Scenario: A method named with its class

- **WHEN** the tool is called with `Class.method` for a method the graph records under that class
- **THEN** that method's connections SHALL be returned

#### Scenario: A name written as a call

- **WHEN** the tool is called with a symbol's name followed by `()`
- **THEN** it SHALL resolve as the bare name does

#### Scenario: A name written in a different style

- **WHEN** the tool is called with a symbol's name using different capitalisation or punctuation than the graph records
- **THEN** the symbol SHALL still resolve

#### Scenario: One hop by default

- **WHEN** the tool is called without a depth
- **THEN** the result SHALL hold the symbol's own connections and none of its neighbours' further connections

#### Scenario: Deeper on request, up to three hops

- **WHEN** the tool is called with a depth above 3
- **THEN** the result SHALL reach three hops from the symbol and no further

#### Scenario: A connection reached twice is listed once

- **WHEN** two symbols within the requested depth share a connection
- **THEN** that connection SHALL appear once in the result

#### Scenario: A result too large is cut visibly

- **WHEN** the connections within the requested depth exceed `PICHART_GRAPH_TOKENS`
- **THEN** the result SHALL end at a whole line within the cap, followed by a marker saying it was cut

#### Scenario: An unknown name

- **WHEN** the tool is called with a name the graph does not know
- **THEN** the result SHALL say the name was not found and SHALL list up to five of the graph's nearest names

#### Scenario: A graph still loading

- **WHEN** the tool is called while the session's first read of the graph has not finished and the Graph Store's deadline passes
- **THEN** the result SHALL say that structure is not loaded yet
- **AND** the Turn SHALL proceed

#### Scenario: No Graph Store, no tool

- **WHEN** a session runs with no Graph Store available
- **THEN** `codebase_structure` SHALL NOT be registered

### Requirement: Structure older than the Codebase is disclosed in every result

The Graph Store SHALL state, for every neighbourhood it reports, whether the extraction it came from is older than the file the symbol lives in. Structure derived before the Codebase's current state SHALL be disclosed as older in every `codebase_structure` result that holds it, so that positions and connections the agent cannot rely on are visibly second-hand rather than presented as current. Structure SHALL NOT be withheld for being older: it SHALL be returned and disclosed, because a Turn that edits code is the Turn that most needs a starting point.

Freshness that cannot be established SHALL be treated as older rather than as current.

#### Scenario: A symbol in a file edited since extraction

- **WHEN** a symbol's file has changed since the extraction the structure came from
- **THEN** that neighbourhood SHALL be reported as older than the Codebase, and SHALL still be reported

#### Scenario: A symbol in an untouched file

- **WHEN** a symbol's file has not changed since extraction
- **THEN** that neighbourhood SHALL carry no such disclosure

#### Scenario: One result, two ages

- **WHEN** a lookup reaches one symbol whose file was edited and one whose file was not
- **THEN** the disclosure SHALL apply to the edited symbol's neighbourhood alone

#### Scenario: A file that can no longer be found

- **WHEN** a symbol's file cannot be examined for its age
- **THEN** its neighbourhood SHALL be reported as older than the Codebase rather than as current

### Requirement: Structure is available without a Thread Store

The Graph Store SHALL be available whether or not a Thread Store is configured: declining the record of what happened SHALL NOT withdraw a Codebase's structure, since structure is derived from the Codebase alone.

A `codebase_structure` lookup with no graph the system can reach SHALL say why structure is unavailable, rather than return an empty result with no explanation. A report of what the system has configured SHALL describe structure as unavailable when no Graph Store exists to serve it, and SHALL NOT describe extraction as on.

#### Scenario: A session with no Thread Store

- **WHEN** a Thread Store is declined and a Codebase has a graph
- **THEN** `codebase_structure` SHALL still be registered and SHALL answer from that graph

#### Scenario: A lookup with nothing behind it

- **WHEN** `codebase_structure` is called and no graph can be reached
- **THEN** the result SHALL name the reason rather than be silently empty

#### Scenario: The configuration report matches what exists

- **WHEN** what the system has configured is reported and no Graph Store was constructed
- **THEN** structure SHALL be described as unavailable rather than as extracting

#### Scenario: Extraction declined is not extraction broken

- **WHEN** extraction has been declined by configuration
- **THEN** the report SHALL say so and SHALL NOT report it as a fault
