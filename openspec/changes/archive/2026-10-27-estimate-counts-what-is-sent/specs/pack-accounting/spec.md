## MODIFIED Requirements

### Requirement: The recorded pack size is comparable to the reported window

The system SHALL record both its own estimate of a Context Pack's size and the size the harness reported for the Context Window that carried it, so the estimate's accuracy is observable rather than assumed. The estimate SHALL account for everything pi-chart sends that a provider charges as input: its additions to the system prompt, and every part of every message sent to the model, not the content alone. It SHALL NOT count what the harness records on a message but never sends to a provider, such as a tool result's display details or the metadata of a provider's response. It SHALL NOT count the opaque signature that travels with a thinking block, which the provider does not charge as input; the thinking text itself SHALL be counted. The estimate SHALL remain deterministic, and SHALL NEVER be presented as the measured window size where the harness has reported one.

The harness reports the system prompt as part of one non-message figure, so the size of pi-chart's additions to it is not measured. Where the harness has reported a Call's sizes, the pack-versus-Floor figures SHALL come from the reported sizes, with only the size of pi-chart's system-prompt additions taken from the estimate.

#### Scenario: Both figures are retained for a call

- **WHEN** a Call completes and the harness reports its window size
- **THEN** the record SHALL carry the estimate made at assembly and the reported size, distinguishably

#### Scenario: The estimate covers the whole message

- **WHEN** a message carries content alongside other fields that are sent with it, such as a tool result's call id, tool name and error flag
- **THEN** the estimate SHALL include those fields rather than the content alone

#### Scenario: What is recorded but never sent is not counted

- **WHEN** two messages are identical except that one also carries a tool result's display details, or the harness's record of the response that produced it
- **THEN** their estimates SHALL be equal

#### Scenario: A thinking block counts its text and not its signature

- **WHEN** two assistant messages carry the same thinking text, one with a signature and one without
- **THEN** their estimates SHALL be equal, and each SHALL exceed the estimate of the same message without the thinking block

#### Scenario: The estimate covers the system-prompt additions

- **WHEN** a Call's system prompt carried Pins, the Opening and the eviction notice
- **THEN** the estimate SHALL include their size

#### Scenario: The reported size wins where both exist

- **WHEN** a pack-versus-Floor figure is reported for a Call the harness measured
- **THEN** that figure SHALL come from the reported sizes, not from the estimate, except for the size of pi-chart's system-prompt additions, which SHALL come from the estimate
