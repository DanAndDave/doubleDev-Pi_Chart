## ADDED Requirements

### Requirement: A harness compaction is carried as prose

When the harness has compacted a Conversation, the Context Pack SHALL carry the compaction's summary as text and SHALL NOT carry the harness's provider-native form of it.

A provider-native compaction stands in for the history it summarises, and the provider refuses it anywhere but the head of the conversation. A Pack carries that same history from the Thread Store ahead of the current Turn, so the native form is misplaced by construction, and the Call fails every time it is retried. The summary's text is kept because a compaction may have cut into the current Turn, and the text is then the only account of what that Turn did before the cut.

Only the compaction's own message SHALL be affected. A provider payload on any other message SHALL be carried untouched.

#### Scenario: A compacted conversation stays sendable

- **WHEN** the harness supplies a compaction summary that carries a provider-native payload
- **THEN** the Pack SHALL carry that summary without the payload, and the Call SHALL be one the provider accepts

#### Scenario: The summary still reaches the model

- **WHEN** a Pack carries a harness compaction
- **THEN** the compaction's summary text SHALL be in the Pack

#### Scenario: Other provider payloads are untouched

- **WHEN** a message other than a compaction summary carries a provider payload
- **THEN** the Pack SHALL carry that message with its payload unchanged

### Requirement: The harness does not compact a window it does not send

While the Assembler supplies the Context Window, the system SHALL decline a compaction the harness starts because of its own estimate of the Conversation's size, and SHALL let every other compaction proceed.

The harness triggers compaction by measuring its whole message history, and the Assembler has replaced that history with a Pack bounded by its own ceiling. A compaction triggered this way summarises a window the model never receives, and it costs a Call over the full history to do so. A compaction for any other reason is different. The provider refusing the window actually sent, or the operator asking for one, is a reason that holds for the Pack as much as for the history. So is a compaction after a Call the Assembler failed to assemble, because that Call went out as the harness's own history.

Declining SHALL be disclosed once per session. The disclosure SHALL name the harness setting that stops the harness from starting such compactions at all.

#### Scenario: A size-triggered compaction is declined

- **WHEN** the harness starts a compaction because its size estimate crossed a threshold, and the last Call was assembled
- **THEN** the compaction SHALL be cancelled, and the operator SHALL be told once, naming the setting that disables it

#### Scenario: An overflow still compacts

- **WHEN** the harness starts a compaction because the provider refused the window as too long
- **THEN** the compaction SHALL proceed

#### Scenario: A requested compaction proceeds

- **WHEN** the operator asks for a compaction
- **THEN** the compaction SHALL proceed

#### Scenario: An unassembled call leaves the harness in charge

- **WHEN** the last Call could not be assembled and the harness starts a size-triggered compaction
- **THEN** the compaction SHALL proceed
