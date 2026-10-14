## ADDED Requirements

### Requirement: Accounting records the Briefings a Call sent again

The system SHALL record, for every Call, which way it sent its Briefing: cleared and kept, as a user message replaced on the next Call, or none because the Call assembled nothing. It SHALL record how many earlier Briefings the Call sent again and their total size in bytes, and how many Briefings it should have sent again but could not because no stored text was found. Earlier Briefings SHALL NOT count toward the pack size, the Budget, the Ceiling, or the Floor, because a cleared Briefing adds no input tokens. A record written before this requirement SHALL be read back with these figures absent rather than zero.

#### Scenario: A later Call counts what it sent again

- **WHEN** a Call sends three earlier Briefings again
- **THEN** its record SHALL hold a count of three and their total size in bytes, and SHALL record that it sent its own Briefing cleared

#### Scenario: A missing Briefing is counted

- **WHEN** a Briefing should be sent again but its text is in no Journal entry
- **THEN** the Call's record SHALL count it as missing and SHALL NOT count it as sent again

#### Scenario: A fallback Call is recorded as such

- **WHEN** a Call's model lacks mid-Conversation or turn-scoped system messages
- **THEN** its record SHALL say the Briefing was sent as a user message and SHALL count no Briefing sent again

#### Scenario: A Call that assembled nothing records no Briefing of its own

- **WHEN** a Call on a capable model assembles nothing
- **THEN** its record SHALL say it sent no Briefing of its own, and SHALL still count the earlier Briefings it sent again

#### Scenario: Earlier Briefings are outside the pack size

- **WHEN** a Call sends earlier Briefings again
- **THEN** its recorded pack size SHALL be the same as if it had sent none

#### Scenario: Older records read back without the figures

- **WHEN** a Call recorded before this requirement is read back
- **THEN** its Briefing figures SHALL be absent, not zero
