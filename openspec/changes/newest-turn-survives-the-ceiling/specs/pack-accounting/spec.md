## MODIFIED Requirements

### Requirement: Accounting attributes pack contents to their source

Each Turn's record SHALL attribute the Context Pack's composition to the parts that contributed it, so that a pack's size can be explained rather than merely observed. Each part SHALL also record the Budget that bounded it, how many candidates it had, and the identity of what it contributed, so that a pack can be examined after the fact rather than only measured. Where a part carried less than its candidates offered, the record SHALL carry the reason — insufficient relevance, an exhausted count Budget, an exhausted size Budget, or reduction to fit the Pack ceiling — as distinct reasons rather than one undifferentiated shortfall. Where a part carried a Turn with messages dropped, the record SHALL carry how many messages were dropped, distinct from whether content was shortened.

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

#### Scenario: Dropped messages are recorded as a count

- **WHEN** the verbatim tail carried its newest Turn with tool-call groups dropped
- **THEN** the record SHALL give the number of messages dropped for that part, and a part that dropped none SHALL carry no count
