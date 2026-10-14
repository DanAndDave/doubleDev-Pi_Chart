## ADDED Requirements

### Requirement: Examining a Call reports its earlier Briefings

Examining a Call SHALL report which way it sent its Briefing and, where it sent earlier Briefings again, how many and their total size, beside any it could not send because the stored text was missing. A Conversation summary SHALL report how many of its Calls sent the Briefing each way and how many Briefings went missing. A Call recorded without these figures SHALL be reported without the line, not as zero.

#### Scenario: A Call with earlier Briefings shows them

- **WHEN** a user examines a Call that sent four earlier Briefings again and found one missing
- **THEN** the report SHALL show that the Briefing was sent cleared, that four earlier Briefings were sent again with their total size, and that one was missing

#### Scenario: A fallback Call says so

- **WHEN** a user examines a Call whose model lacked the capabilities
- **THEN** the report SHALL show that the Briefing was sent as a user message

#### Scenario: A Call with no Briefing of its own says so

- **WHEN** a user examines a Call that assembled nothing but sent earlier Briefings again
- **THEN** the report SHALL show that it sent no Briefing of its own, beside the earlier Briefings it sent again

#### Scenario: The summary counts missing Briefings

- **WHEN** a user summarises a Conversation in which some Calls found Briefings missing
- **THEN** the summary SHALL report the number missing across the Conversation

#### Scenario: An older record shows no Briefing line

- **WHEN** a user examines a Call recorded before Briefings were kept
- **THEN** the report SHALL omit the Briefing line rather than show zero
