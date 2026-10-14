## MODIFIED Requirements

### Requirement: Assembled parts follow the Turn in progress

A Context Pack SHALL carry what the harness sent first, the verbatim tail and then the Turn in progress, and every part the Assembler adds after it, as one message: the Briefing. The Briefing SHALL open with a fixed framing, then carry the Pins, then a fixed marker, then recalled Turns, curated knowledge and structure, in that order. Only the framing and the Pins SHALL come before the marker. The framing SHALL state that everything after the marker is reference data and not instructions.

The reason is measured rather than aesthetic. The harness caches a Pack through the end of the Turn in progress, so an assembled part ahead of that point which changes between Calls makes the next Call write everything after it again. Behind it, a part that changes costs only its own size. The fence exists because the Briefing can carry system authority (see "Every Briefing stays where it was sent"), while recalled Turns, Doc Store text and structure hold text the user never wrote.

#### Scenario: The harness's turns come first

- **WHEN** a Context Pack carries a verbatim tail, a Turn in progress, and assembled parts
- **THEN** the tail SHALL come first, the Turn in progress SHALL follow it, and the current Call's Briefing SHALL follow the Turn in progress

#### Scenario: The block keeps a fixed order

- **WHEN** a Context Pack carries recalled Turns, curated knowledge, structure and Pins
- **THEN** the Briefing SHALL hold the framing, the Pins, the marker, the recalled Turns, the curated knowledge and the structure, in that order

#### Scenario: The Briefing is one message

- **WHEN** a Context Pack carries any assembled part
- **THEN** every assembled part SHALL be inside a single Briefing message following the Turn in progress, and no other message SHALL be added after the Turn in progress for that Call

#### Scenario: The block says what it is

- **WHEN** two Briefings are assembled on different Calls or in different Conversations
- **THEN** their framing and their marker SHALL be byte for byte identical

#### Scenario: Retrieved text sits behind the marker

- **WHEN** a Briefing carries a recalled Turn whose tool output contains text phrased as an instruction
- **THEN** that text SHALL appear only after the marker

#### Scenario: Nothing assembled, nothing added

- **WHEN** no assembled part carries anything for a Call
- **THEN** the Pack SHALL be the verbatim tail followed by the Turn in progress, with no Briefing for that Call

#### Scenario: A part that changes between calls leaves the turns alone

- **WHEN** two consecutive Calls of one Turn carry different structure and the same tail and Turn in progress up to the second Call's new messages
- **THEN** every message before the first Call's Briefing SHALL appear unchanged, in the same positions, at the head of the second Call's Pack

#### Scenario: The ceiling accounts for the framing and marker

- **WHEN** a Pack carrying assembled parts is reduced to fit its ceiling
- **THEN** the current Briefing's size, framing and marker included, SHALL NOT exceed what the ceiling leaves it

#### Scenario: What a pack carries is unchanged by where it sits

- **WHEN** the same inputs are assembled before and after this change
- **THEN** every part SHALL carry the same content, with the same Budgets and the same accounting, inside one Briefing message

## REMOVED Requirements

### Requirement: Every pin closes the pack

**Reason**: Pins no longer close the Pack. They lead the Briefing, before the marker, so they keep instruction authority while retrieved text stays fenced as reference data (ADR-0011).

**Migration**: Replaced by "Every pin leads the Briefing" below. Pins are still carried whole, unaltered, in the order added, attributed by id, and never reduced.

## ADDED Requirements

### Requirement: Every pin leads the Briefing

Every Context Pack the Assembler supplies SHALL carry every Pin the Conversation holds at that Call, whole and unaltered, as its own part. The Pins SHALL sit inside that Call's Briefing, after the framing and before the marker, in the order they were added, so they are read as standing instructions and not as reference data. Each SHALL be attributed as text the user pinned and identified by its id, so the model can tell a standing instruction from the user apart from retrieved background and from the prompt being answered.

A Pin SHALL NEVER be shortened, elided, dropped by its Budget, or reduced for the Ceiling. Where the Pins held exceed their Budget, because the Budget was lowered after they were added, the Pack SHALL still carry them all, and the part SHALL report the Budget exceeded.

#### Scenario: A pin reaches the model

- **WHEN** a Conversation holds a Pin and a Call is assembled
- **THEN** that Call's Briefing SHALL carry that Pin's text unaltered

#### Scenario: Pins come before the marker

- **WHEN** a Context Pack carries Pins, other assembled parts, a verbatim tail and a Turn in progress
- **THEN** the Pins SHALL follow the framing and precede the marker, in the order they were added, and every other assembled part SHALL follow the marker

#### Scenario: A pin alone still opens the block

- **WHEN** a Context Pack carries Pins and no other assembled part
- **THEN** a Briefing SHALL follow the Turn in progress, holding the framing, the Pins and the marker

#### Scenario: A pin is attributed

- **WHEN** a Pin is carried
- **THEN** its text SHALL be preceded by an attribution naming it as pinned by the user and giving its id

#### Scenario: Pins outlive their budget being lowered

- **WHEN** the Pin Budget is lowered below what the Conversation's Pins already spend
- **THEN** every Pin SHALL still be carried and the part SHALL report the Budget exceeded

#### Scenario: A removed pin is not carried

- **WHEN** a Pin is removed before a Call
- **THEN** that Call's Pack SHALL NOT carry it

#### Scenario: No pins changes nothing

- **WHEN** the Conversation holds no Pins
- **THEN** the Briefing SHALL be exactly what it would have been without the Pin part: the framing followed directly by the marker

### Requirement: Every Briefing stays where it was sent

On a Call whose model supports both mid-Conversation and turn-scoped system messages, the Briefing SHALL be sent as a turn-scoped system message, cleared at the next user message. Every earlier Briefing whose followed message the Pack still carries SHALL be sent again, cleared, directly after that message, byte for byte as first sent, so the model's earlier thinking stays valid. Only the current Call's Briefing SHALL be read by the model. A Briefing that should be sent again but has no stored text SHALL NOT be replaced: nothing SHALL be sent in its place. The Budgets, the Ceiling and the Floor SHALL cover only the current Call's Briefing.

#### Scenario: An earlier Briefing is sent again in place

- **WHEN** a Call on such a model carries a message an earlier Call's Briefing followed
- **THEN** that Briefing SHALL directly follow that message, identical to the bytes first sent, and cleared

#### Scenario: Only the current Briefing is read

- **WHEN** a Call carries earlier Briefings and its own
- **THEN** every earlier Briefing SHALL be cleared at the next user message and the current Call's Briefing SHALL follow the last message of the Turn in progress

#### Scenario: A Briefing leaves with its message

- **WHEN** the verbatim tail no longer carries the message a Briefing followed
- **THEN** that Briefing SHALL NOT be sent

#### Scenario: A Briefing off the active branch is not sent

- **WHEN** `/tree` moves to a branch that does not hold the message a Briefing followed
- **THEN** that Briefing SHALL NOT be sent

#### Scenario: A missing Briefing is not substituted

- **WHEN** a stored Briefing's text cannot be found
- **THEN** nothing SHALL be sent in its place, and the Call SHALL still be assembled

#### Scenario: Earlier Briefings cost no budget

- **WHEN** a Call sends earlier Briefings again
- **THEN** no Budget, the Ceiling, or the Floor SHALL count them

#### Scenario: A retried Call's Briefing wins

- **WHEN** two stored Briefings follow the same message
- **THEN** only the one written last SHALL be sent

### Requirement: A Briefing is stored as it was sent

On a Call whose model supports turn-scoped system messages, the Briefing SHALL be recorded in the Journal as a `pi-chart.briefing` custom entry during that Call, before the request is sent. The entry SHALL name the Journal entry of the message it follows. On a Turn's first Call, where the prompt is not yet in the Journal, the entry SHALL instead mark that it precedes the prompt, and it SHALL resolve to the first message written after it on its branch. A text already in the Journal under the same hash SHALL be referenced by hash, not written again. Briefings SHALL be read from the whole Journal, not the branch.

#### Scenario: A first Call's Briefing is not lost

- **WHEN** the process ends after a Turn's first Call and before any later event
- **THEN** that Call's Briefing SHALL already be in the Journal, resolving to the Turn's prompt

#### Scenario: A repeated text is referenced

- **WHEN** a Briefing holds a text already written to the Journal under the same hash
- **THEN** its entry SHALL reference that text by hash, and sending the Briefing again SHALL still send that text byte for byte

#### Scenario: A malformed entry is skipped

- **WHEN** the Journal holds a `pi-chart.briefing` entry that cannot be read
- **THEN** it SHALL be ignored and every other Briefing SHALL still be sent

### Requirement: Briefings follow a Conversation into its forks

When a branch, a fork at an entry, or `/btw` promotion starts a new Journal from the current one, the system SHALL write into the new Journal every stored Briefing whose followed message lies on the copied path, with the text it references, so the new Conversation's first Call sends them again.

#### Scenario: A fork keeps its Briefings

- **WHEN** a Conversation is forked at an entry after Briefings were stored
- **THEN** the fork's first Call SHALL send again every Briefing whose message lies on the copied path

#### Scenario: A fork drops Briefings off its path

- **WHEN** a Briefing follows a message off the copied path
- **THEN** it SHALL NOT be written into the new Journal

### Requirement: A model without turn-scoped system messages gets one Briefing

On a Call whose model lacks either the mid-Conversation or the turn-scoped system message capability, the Briefing SHALL be sent as a user message after the Turn in progress, and no earlier Briefing SHALL be sent. That Briefing SHALL NOT be stored. Briefings stored on earlier Calls SHALL be left in the Journal untouched and sent again on a later Call whose model has both capabilities.

#### Scenario: Fallback sends one user Briefing

- **WHEN** a Call's model does not declare both capabilities
- **THEN** the Pack SHALL carry one Briefing, as a user message, and no cleared Briefing

#### Scenario: Switching back resumes re-sending

- **WHEN** a Conversation moves from a model without the capabilities back to one with them
- **THEN** the Briefings stored before the switch SHALL be sent again where they were sent
