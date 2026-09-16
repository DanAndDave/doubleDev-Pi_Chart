## Purpose

Recording what each Turn's Context Window was actually made of, separating the part the Assembler controls from the Floor it cannot reach, so that Budgets are set from measurement rather than estimation.

## ADDED Requirements

### Requirement: Every turn's window is accounted for

The system SHALL record, for each Turn, the size of the Context Pack it assembled and the size of the Floor — the portion of the Context Window the Assembler does not control, comprising the system prompt, tool schemas, skills, and rules.

#### Scenario: Pack and floor are recorded separately

- **WHEN** a Turn completes
- **THEN** a record SHALL exist giving that Turn's Context Pack size and Floor size as distinct figures

#### Scenario: A trivial pack still reports its floor

- **WHEN** a Turn's Context Pack contains only a short prompt
- **THEN** the recorded Floor SHALL reflect the full non-pack cost of that Turn rather than being reported as absent or zero

### Requirement: Accounting attributes pack contents to their source

Each Turn's record SHALL attribute the Context Pack's composition to the parts that contributed it, so that a pack's size can be explained rather than merely observed.

#### Scenario: Composition is itemised

- **WHEN** a Context Pack is assembled from more than one contributing part
- **THEN** the record SHALL give each part's contribution to the total

### Requirement: Accounting is readable after the fact

Recorded accounting SHALL be readable outside the Turn that produced it, covering an entire Conversation, so that pack-versus-Floor ratios can be examined across a real session.

#### Scenario: A whole session can be examined

- **WHEN** accounting is read for a completed Conversation
- **THEN** each Turn's pack and Floor figures SHALL be retrievable in Turn order

### Requirement: Accounting never disturbs the turn

Recording accounting SHALL NOT alter a Context Pack, delay the model request, or cause a Turn to fail. If accounting cannot be recorded, the Turn SHALL proceed and the omission SHALL be reported.

#### Scenario: A failed recording does not fail the turn

- **WHEN** accounting cannot be written for a Turn
- **THEN** the Turn SHALL complete normally and the failure SHALL be reported
