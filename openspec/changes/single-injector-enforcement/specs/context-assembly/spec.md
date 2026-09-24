## MODIFIED Requirements

### Requirement: Assembly is the only memory injection

The system SHALL operate with the harness's own memory backend disabled, so that no component other than the Assembler introduces recalled content into a Context Window.

Because the harness injects recalled content into the Floor rather than into the message array, the Assembler cannot remove it: the Floor is by definition the part of a Context Window the Assembler does not supply. The invariant is therefore enforced by detection and disclosure rather than by filtering. The system SHALL check the backend's state when a Conversation starts, SHALL report it when the backend is anything other than off, and SHALL treat a backend that cannot be interrogated as unconfirmed rather than as off. The state SHALL be recorded for each Call, so that the condition outlives the report and a Conversation run with two injectors is diagnosable afterwards rather than only suspected.

A Context Pack SHALL NOT be withheld on account of an active backend: refusing to assemble would hand the Conversation the accumulating Context Window this system exists to replace, which is a worse outcome than a diagnosable one.

#### Scenario: No competing injection

- **WHEN** a Conversation runs with the system active
- **THEN** no content originating from the harness's memory backend SHALL appear in any Context Pack

#### Scenario: An active backend is reported

- **WHEN** a Conversation starts and the harness reports its memory backend as active
- **THEN** the condition SHALL be reported, naming the backend and the setting that disables it

#### Scenario: A backend that cannot be interrogated is unconfirmed

- **WHEN** the harness does not report its memory backend
- **THEN** the system SHALL report that the invariant could not be confirmed, and SHALL NOT treat the backend as off or as active

#### Scenario: A contaminated conversation is diagnosable afterwards

- **WHEN** a Call is made while the backend is active or unconfirmed
- **THEN** that state SHALL be recorded against the Call, so the Conversation's Accounting shows which Calls were exposed

#### Scenario: An active backend does not cost the turn

- **WHEN** a Turn is taken while the backend is active
- **THEN** the Context Pack SHALL still be assembled and supplied, and the Turn SHALL complete

#### Scenario: A confirmed-off backend is silent

- **WHEN** the harness reports its memory backend as off
- **THEN** nothing SHALL be reported and the recorded state SHALL say the backend was off
