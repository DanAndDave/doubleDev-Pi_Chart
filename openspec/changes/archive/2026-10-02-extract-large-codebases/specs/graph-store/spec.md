## MODIFIED Requirements

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

## ADDED Requirements

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
