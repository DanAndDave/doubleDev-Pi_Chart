## MODIFIED Requirements

### Requirement: Packs carry the structure around the symbols in play

A Context Pack SHALL be able to carry the programmatic neighbourhood of the symbols the current Turn is working with, as a part distinct from the verbatim tail, recalled Turns, and Concepts, bounded by its own Budget. Each connection SHALL be carried with where it is in the Codebase, so the agent can act on it without reading a file.

The symbols in play SHALL be taken from the Turn rather than from its opening prompt alone, so that every Call of a Turn — including those made after tool results the prompt could not have named — can carry structure.

#### Scenario: Structure reaches the model

- **WHEN** a prompt names a symbol the Graph Store knows
- **THEN** the Context Pack SHALL carry that symbol's connections as its own part

#### Scenario: Structure reaches a call the prompt did not describe

- **WHEN** a Call is made later in a Turn whose prompt names no symbol, and the Turn has since worked with files the Graph Store knows
- **THEN** the Context Pack for that Call SHALL carry structure for those files' symbols

#### Scenario: Connections say where they are

- **WHEN** a connection enters a pack
- **THEN** it SHALL carry the file and position of what it connects

#### Scenario: A symbol with more connections than a pack can hold

- **WHEN** a symbol has more connections than the pack carries
- **THEN** the pack SHALL say how many it left out rather than present what it carried as complete

#### Scenario: The structure budget is independent of the others

- **WHEN** the Graph Store Budget is exhausted
- **THEN** the verbatim tail, recalled Turns, and Concepts SHALL be unaffected

#### Scenario: A structure budget of nothing disables the part

- **WHEN** the Graph Store Budget is zero
- **THEN** the pack SHALL carry no structure and SHALL otherwise be unchanged

#### Scenario: The pack is accounted for by part

- **WHEN** a pack carries structure alongside its other parts
- **THEN** the accounting for that Call SHALL attribute it separately, naming the symbols it carried distinguishably from others of the same name

## ADDED Requirements

### Requirement: A pack declares structure older than the Codebase

Structure entering a Context Pack SHALL be marked as older than the Codebase when the extraction it came from precedes the current state of the file it describes, in the same way a Concept known to be stale is marked. The mark SHALL travel with the structure itself, so the agent reads it beside the positions it would otherwise act on. Structure whose age is current SHALL carry no mark, so the mark means something when it appears.

Age SHALL NOT be a reason to withhold structure: an out-of-date neighbourhood is a starting point, and the Pack SHALL carry it marked rather than drop it.

#### Scenario: Structure from before an edit is marked

- **WHEN** a pack carries the neighbourhood of a symbol whose file has been edited since the extraction
- **THEN** that structure SHALL be marked as older than the Codebase

#### Scenario: Current structure is unmarked

- **WHEN** a pack carries the neighbourhood of a symbol whose file has not changed since the extraction
- **THEN** that structure SHALL carry no such mark

#### Scenario: Marking is per symbol, not per pack

- **WHEN** one pack carries structure for an edited file and for an untouched one
- **THEN** only the edited file's structure SHALL be marked

#### Scenario: Older structure is still carried

- **WHEN** every symbol in play lives in a file edited since the extraction
- **THEN** the pack SHALL carry their structure, marked, rather than carry no structure
