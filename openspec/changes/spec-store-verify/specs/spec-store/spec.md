## ADDED Requirements

### Requirement: A Codebase's stated intent is verified without being changed

The Spec Store SHALL report whether a Codebase's OpenSpec tree is as this project expects, naming each part that is absent. Verification SHALL write nothing.

#### Scenario: A conforming Codebase

- **WHEN** a Codebase's OpenSpec tree has everything expected of it
- **THEN** verification SHALL report it as conforming

#### Scenario: A Codebase with no OpenSpec tree at all

- **WHEN** a Codebase has no OpenSpec directory
- **THEN** verification SHALL report its absence, distinctly from a tree that is incomplete

#### Scenario: A partial tree

- **WHEN** parts of the expected tree are absent
- **THEN** verification SHALL name each absent part

#### Scenario: Something expected to be a directory is a file

- **WHEN** a part of the tree exists but is not the kind of thing expected
- **THEN** verification SHALL say so rather than treat it as present

#### Scenario: Verification changes nothing

- **WHEN** a Codebase is verified, whatever its state
- **THEN** the Codebase SHALL be unchanged afterwards

### Requirement: A Codebase can be brought up to a conforming tree

The Spec Store SHALL be able to initialize a Codebase's OpenSpec tree, and SHALL do so only when asked. Initialization SHALL fill in what is absent and SHALL NOT alter specs, changes, or configuration that already exist.

#### Scenario: A bare Codebase

- **WHEN** a Codebase with no OpenSpec tree is initialized
- **THEN** it SHALL afterwards verify as conforming

#### Scenario: A partial tree is completed

- **WHEN** a Codebase missing part of its tree is initialized
- **THEN** the absent parts SHALL be created

#### Scenario: Existing intent is left alone

- **WHEN** a Codebase holding specs, changes, and configuration is initialized
- **THEN** those SHALL be unchanged

#### Scenario: Nothing is initialized unasked

- **WHEN** a session begins in a Codebase with no OpenSpec tree
- **THEN** the Codebase SHALL NOT be initialized as a side effect

### Requirement: Malformed content is diagnosed by the tool that defines it

The Spec Store SHALL diagnose the content of specs and changes by asking OpenSpec itself, and SHALL surface its diagnosis rather than restate it. Structure this project expects but OpenSpec does not check SHALL be diagnosed by the Spec Store.

#### Scenario: A change that OpenSpec rejects

- **WHEN** a Codebase holds a change OpenSpec considers invalid
- **THEN** the diagnosis SHALL name that change and give OpenSpec's reason

#### Scenario: Conforming content

- **WHEN** every spec and change is valid
- **THEN** the diagnosis SHALL report nothing wrong

#### Scenario: OpenSpec is not available

- **WHEN** OpenSpec cannot be run
- **THEN** that SHALL be reported as an unknown rather than as conformance

### Requirement: The Spec Store contributes nothing to a Context Pack

The Spec Store SHALL NOT place anything in a Context Pack. A Codebase's intent reaches the agent through the workflow that reads it, not through assembly.

#### Scenario: Assembly is unaffected

- **WHEN** a Codebase has an OpenSpec tree, conforming or not
- **THEN** the Context Pack SHALL be exactly what it would have been without one
