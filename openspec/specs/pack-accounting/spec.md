# pack-accounting Specification

## Purpose
Recording what each Turn's Context Window was actually made of, separating the part the Assembler controls from the Floor it cannot reach, so that Budgets are set from measurement rather than estimation.

## Requirements

### Requirement: Every turn's window is accounted for

The system SHALL record, for each Turn, the size of the Context Pack it assembled and the size of the Floor — the portion of the Context Window the Assembler does not control, comprising the system prompt, tool schemas, skills, and rules.

#### Scenario: Pack and floor are recorded separately

- **WHEN** a Turn completes
- **THEN** a record SHALL exist giving that Turn's Context Pack size and Floor size as distinct figures

#### Scenario: A trivial pack still reports its floor

- **WHEN** a Turn's Context Pack contains only a short prompt
- **THEN** the recorded Floor SHALL reflect the full non-pack cost of that Turn rather than being reported as absent or zero

### Requirement: Accounting attributes pack contents to their source

Each Turn's record SHALL attribute the Context Pack's composition to the parts that contributed it, so that a pack's size can be explained rather than merely observed. Each part SHALL also record the Budget that bounded it, how many candidates it had, and the identity of what it contributed, so that a pack can be examined after the fact rather than only measured.

#### Scenario: Composition is itemised

- **WHEN** a Context Pack is assembled from more than one contributing part
- **THEN** the record SHALL give each part's contribution to the total

#### Scenario: A part records what it contributed

- **WHEN** a part carried recalled Turns
- **THEN** the record SHALL identify those Turns by their position in the Conversation

#### Scenario: A part records the budget that bounded it

- **WHEN** a part was trimmed to fit its Budget
- **THEN** the record SHALL carry that Budget and the number of candidates considered

#### Scenario: Records written before this detail existed remain readable

- **WHEN** accounting written by an earlier version is read
- **THEN** it SHALL be returned with the added detail absent rather than failing

### Requirement: Accounting is readable after the fact

Recorded accounting SHALL be readable outside the Turn that produced it, covering an entire Conversation, so that pack-versus-Floor ratios can be examined across a real session. Accounting SHALL live in the Thread Store alongside the Turns it describes.

#### Scenario: A whole session can be examined

- **WHEN** accounting is read for a completed Conversation
- **THEN** each Turn's pack and Floor figures SHALL be retrievable in Turn order

#### Scenario: Accounting outlives the process that recorded it

- **WHEN** accounting is read in a later process than the one that wrote it
- **THEN** the earlier Turns' figures SHALL still be present

### Requirement: Accounting never disturbs the turn

Recording accounting SHALL NOT alter a Context Pack, delay the model request, or cause a Turn to fail. If accounting cannot be recorded, the Turn SHALL proceed and the omission SHALL be reported.

#### Scenario: A failed recording does not fail the turn

- **WHEN** accounting cannot be written for a Turn
- **THEN** the Turn SHALL complete normally and the failure SHALL be reported
