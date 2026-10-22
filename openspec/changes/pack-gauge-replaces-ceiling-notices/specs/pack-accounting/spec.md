## MODIFIED Requirements

### Requirement: A pack approaching its ceiling is reported

When a Context Pack occupies more than a configured share of the Pack ceiling, the system SHALL report that, so a Conversation whose Packs are creeping toward the ceiling is visible while it is running rather than only once reduction starts discarding content. The ceiling is used as the reference because it is the limit the operator set; the harness reports the size of each Context Window it sent but never the model's maximum, so no larger limit is knowable to the system. The report SHALL NOT alter the Pack, delay the Call, or fail the Turn.

The condition SHALL be written to the log once per Conversation. Where the harness offers a status line, the pack gauge SHALL mark every Call whose Pack is past the share as near the ceiling, for as long as that holds. The condition SHALL NOT be raised as a notice in the conversation.

#### Scenario: Crossing the share is reported

- **WHEN** a Call's Pack size exceeds the configured share of the Pack ceiling
- **THEN** the condition SHALL be written to the log, naming the Pack size and the ceiling it was measured against
- **AND** the pack gauge SHALL mark the Call as near the ceiling

#### Scenario: The log says it once, the gauge every time

- **WHEN** several Calls of one Conversation exceed the configured share
- **THEN** the log SHALL hold one line for the condition, and the pack gauge SHALL mark each of those Calls as near the ceiling

#### Scenario: A quiet conversation is not reported

- **WHEN** every Call's Pack stays within the configured share
- **THEN** nothing SHALL be written to the log for it, and the pack gauge SHALL carry no near-ceiling mark

#### Scenario: The approach is not posted into the conversation

- **WHEN** a Call's Pack exceeds the configured share
- **THEN** no notice SHALL be raised in the conversation for it

#### Scenario: Reporting cannot disturb the turn

- **WHEN** the condition is detected
- **THEN** the Turn SHALL complete normally and the Context Pack SHALL be unchanged by the detection

## ADDED Requirements

### Requirement: An overrun is reported on every call, outside the conversation

A Pack that still exceeds its ceiling after reduction is an overrun. Every overrun SHALL be written to the log, naming the Pack size, the ceiling, and which parts could not be reduced further: the current Turn, and the newest tail Turn where the tail carried one. Where the harness offers a status line, the pack gauge SHALL mark the Call as over the ceiling. An overrun SHALL NOT be raised as a notice in the conversation, since one Turn can make many Calls and a line per Call buries the transcript without being actionable while the Turn runs. The report SHALL NOT alter the Pack, delay the Call, or fail the Turn.

#### Scenario: Every overrun is logged

- **WHEN** two Calls of one Conversation each go out over the Pack ceiling
- **THEN** the log SHALL hold one overrun line for each, naming the Pack size and the ceiling

#### Scenario: An overrun shows on the gauge

- **WHEN** a Call goes out over the Pack ceiling and the harness offers a status line
- **THEN** the pack gauge SHALL mark that Call as over the ceiling

#### Scenario: An overrun is not posted into the conversation

- **WHEN** a Call goes out over the Pack ceiling
- **THEN** no notice SHALL be raised in the conversation for it

#### Scenario: A reporter that fails cannot fail the turn

- **WHEN** a Call goes out over the Pack ceiling and writing to the log throws
- **THEN** the Pack SHALL still be supplied to the model unchanged
