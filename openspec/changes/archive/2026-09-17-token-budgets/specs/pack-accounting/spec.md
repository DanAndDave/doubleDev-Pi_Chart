## MODIFIED Requirements

### Requirement: Accounting attributes pack contents to their source

Each Turn's record SHALL attribute the Context Pack's composition to the parts that contributed it, so that a pack's size can be explained rather than merely observed. Each part SHALL also record the Budget that bounded it, how many candidates it had, and the identity of what it contributed, so that a pack can be examined after the fact rather than only measured. Where a part carried less than its candidates offered, the record SHALL carry the reason — insufficient relevance, an exhausted count Budget, an exhausted size Budget, or reduction to fit the Pack ceiling — as distinct reasons rather than one undifferentiated shortfall.

#### Scenario: Composition is itemised

- **WHEN** a Context Pack is assembled from more than one contributing part
- **THEN** the record SHALL give each part's contribution to the total

#### Scenario: A part records what it contributed

- **WHEN** a part carried recalled Turns
- **THEN** the record SHALL identify those Turns by their position in the Conversation

#### Scenario: A part records the budget that bounded it

- **WHEN** a part was trimmed to fit its Budget
- **THEN** the record SHALL carry that Budget and the number of candidates considered

#### Scenario: Records written before this detail existed remain readable

- **WHEN** accounting written by an earlier version is read
- **THEN** it SHALL be returned with the added detail absent rather than failing

#### Scenario: Exclusion for size is distinguishable from exclusion for count

- **WHEN** a part's candidates fit its count Budget but were reduced to fit its token Budget
- **THEN** the record SHALL attribute the shortfall to size rather than to count

#### Scenario: Reduction to fit the ceiling is recorded as its own reason

- **WHEN** a part was reduced because the Pack exceeded its ceiling rather than because its own Budget was exhausted
- **THEN** the record SHALL attribute that reduction to the ceiling, and SHALL record what the part would have carried without it

#### Scenario: Shortened content is recorded as shortened

- **WHEN** a part carried content that was shortened to fit
- **THEN** the record SHALL state that the part carried shortened content

## ADDED Requirements

### Requirement: The recorded pack size is comparable to the reported window

The system SHALL record both its own estimate of a Context Pack's size and the size the harness reported for the Context Window that carried it, so the estimate's accuracy is observable rather than assumed. The estimate SHALL account for every part of a message that is sent to the model, not a subset of it. The estimate SHALL remain deterministic, and SHALL NEVER be presented as the measured window size where the harness has reported one.

#### Scenario: Both figures are retained for a call

- **WHEN** a Call completes and the harness reports its window size
- **THEN** the record SHALL carry the estimate made at assembly and the reported size, distinguishably

#### Scenario: The estimate covers the whole message

- **WHEN** a message carries content alongside other fields that are sent with it
- **THEN** the estimate SHALL include those fields rather than the content alone

#### Scenario: The reported size wins where both exist

- **WHEN** a pack-versus-Floor figure is reported for a Call the harness measured
- **THEN** that figure SHALL come from the reported sizes, not from the estimate

### Requirement: A pack approaching its ceiling is reported

When a Context Pack occupies more than a configured share of the Pack ceiling, the system SHALL report that, so a Conversation whose Packs are creeping toward the ceiling is visible while it is running rather than only once reduction starts discarding content. The ceiling is used as the reference because it is the limit the operator set; the harness reports the size of each Context Window it sent but never the model's maximum, so no larger limit is knowable to the system. The report SHALL NOT alter the Pack, delay the Call, or fail the Turn.

#### Scenario: Crossing the share is reported

- **WHEN** a Call's Pack size exceeds the configured share of the Pack ceiling
- **THEN** the condition SHALL be reported, naming the Pack size and the ceiling it was measured against

#### Scenario: A quiet conversation is not reported

- **WHEN** every Call's Pack stays within the configured share
- **THEN** nothing SHALL be reported

#### Scenario: Reporting cannot disturb the turn

- **WHEN** the condition is detected
- **THEN** the Turn SHALL complete normally and the Context Pack SHALL be unchanged by the detection
