# pack-inspection Specification

## Purpose
Making a Context Window something that can be examined rather than inferred: what each part contributed, how much of its Budget it spent, how it compares with the Floor, and how one Call's pack differs from another's.

## Requirements

### Requirement: A call's pack can be examined

The system SHALL report, for a given Call, each part of its Context Pack, what that part contributed, its size, and its Budget. The Floor SHALL be reported alongside, so the share of the window the Assembler controls is visible rather than inferred.

#### Scenario: A pack is itemised by part

- **WHEN** a Call whose pack carried a verbatim tail and recalled Turns is examined
- **THEN** each part SHALL be listed separately with its size and its Budget

#### Scenario: The floor is shown beside the pack

- **WHEN** a Call with reported window sizes is examined
- **THEN** the Floor and the pack size SHALL both be reported, with the Floor's share of the window

#### Scenario: A part names what it contributed

- **WHEN** a pack carried recalled Turns
- **THEN** the report SHALL identify which Turns were recalled, so an unhelpful recollection can be recognised

#### Scenario: An unmeasured call is reported as such

- **WHEN** a Call has no reported window size yet
- **THEN** it SHALL be reported without invented figures

### Requirement: A part reports how much of its budget it spent

The system SHALL report each part's contribution against the Budget that bounded it, including when a part was trimmed to fit.

#### Scenario: A trimmed part is visible as trimmed

- **WHEN** more Turns matched than the recall Budget allowed
- **THEN** the report SHALL show the part at its Budget and say how many candidates were dropped

#### Scenario: A part under its budget is not reported as full

- **WHEN** a part contributed less than its Budget allowed
- **THEN** its spend SHALL be reported as less than its Budget

### Requirement: Two packs can be compared

The system SHALL report the difference between two Calls' packs: what entered, what left, and what remained.

#### Scenario: What changed between two calls is named

- **WHEN** two Calls of a Conversation are compared
- **THEN** content present in one and absent in the other SHALL be reported as entering or leaving, and content in both as unchanged

#### Scenario: Comparing a call with itself reports no difference

- **WHEN** a Call is compared with itself
- **THEN** no entering or leaving content SHALL be reported

### Requirement: A conversation's windows can be summarised

The system SHALL summarise a whole Conversation's Calls: how the pack and the Floor compare across it, and how much of each Budget was typically spent.

#### Scenario: A session yields a pack-versus-floor figure

- **WHEN** a Conversation with several measured Calls is summarised
- **THEN** the summary SHALL report the Floor's share of the window across those Calls

#### Scenario: A conversation with nothing recorded summarises to nothing

- **WHEN** a Conversation has no recorded Calls
- **THEN** the summary SHALL report that, rather than failing

### Requirement: Budgets can be changed within a session

The system SHALL allow a Budget to be changed while a session is running, and the change SHALL apply from the next Call without restarting.

#### Scenario: A changed budget takes effect on the next call

- **WHEN** a Budget is changed mid-session
- **THEN** the next Call's pack SHALL be assembled under the new Budget

#### Scenario: An invalid budget is refused, not applied

- **WHEN** a Budget is set to something that is not a count
- **THEN** it SHALL be refused and the previous Budget SHALL remain in force

### Requirement: Inspection never alters what it inspects

Examining a pack, comparing packs, or summarising a Conversation SHALL NOT change any Context Pack, Turn, or accounting record.

#### Scenario: Inspecting leaves the record untouched

- **WHEN** a Call is examined and a Conversation summarised
- **THEN** the accounting for that Conversation SHALL be unchanged afterwards
