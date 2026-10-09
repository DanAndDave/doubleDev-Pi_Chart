## ADDED Requirements

### Requirement: Packs carry every pin

Every Context Pack the Assembler supplies SHALL carry every Pin the Conversation holds at that Call, whole and unaltered, as its own part. The Pins SHALL be placed immediately before the Turn in progress, after the assembled parts and the rest of the verbatim tail, in the order they were added. Each SHALL be attributed as text the user pinned and identified by its id, so the model can tell a standing instruction from the user apart from retrieved background and from the prompt being answered.

A Pin SHALL NEVER be shortened, elided, dropped by its Budget, or reduced for the Ceiling. Where the Pins held exceed their Budget — the Budget was lowered after they were added — the Pack SHALL still carry them all, and the part SHALL report the Budget it exceeded. A Conversation holding no Pins SHALL send exactly the messages it would have sent without this requirement.

#### Scenario: A pin reaches the model

- **WHEN** a Conversation holds a Pin and a Call is assembled
- **THEN** the Context Pack SHALL carry that Pin's text unaltered

#### Scenario: Pins sit just before the current turn

- **WHEN** a Context Pack carries Pins, assembled parts and a verbatim tail
- **THEN** the Pins SHALL follow everything else and the Turn in progress SHALL follow the Pins

#### Scenario: A pin is attributed

- **WHEN** a Pin enters a Pack
- **THEN** it SHALL be marked as pinned by the user and carry its id

#### Scenario: Pins outlive their budget being lowered

- **WHEN** the Pin Budget is lowered below what the Conversation's Pins already spend
- **THEN** every Pin SHALL still be carried and the part SHALL report the Budget exceeded

#### Scenario: A removed pin is not carried

- **WHEN** a Pin is removed before a Call
- **THEN** that Call's Pack SHALL NOT carry it

#### Scenario: No pins changes nothing

- **WHEN** the Conversation holds no Pins
- **THEN** the Pack's messages SHALL be exactly what they would have been without Pins

## MODIFIED Requirements

### Requirement: Budgets bound each part of a pack

Each part of a Context Pack SHALL have a Budget, and SHALL be trimmed to fit it. A Budget SHALL be expressible as a count of items and as a size in tokens, and a part SHALL be trimmed to whichever of the two binds first. Trimming SHALL drop the weakest-matching recalled Turns first and SHALL NEVER drop the verbatim tail, the current prompt, or a Pin on account of a part's own Budget. The Pin Budget is enforced when a Pin is written, not when a Pack is assembled.

#### Scenario: Recall is trimmed to its budget

- **WHEN** more relevant Turns are found than the recall Budget allows
- **THEN** the pack SHALL carry only what fits, keeping the strongest matches

#### Scenario: Recall cannot crowd out the tail

- **WHEN** the recall Budget is large and many Turns match
- **THEN** the verbatim tail and the current prompt SHALL still appear in full

#### Scenario: A budget of nothing disables its part

- **WHEN** the recall Budget is zero
- **THEN** the pack SHALL carry no recalled Turns and SHALL otherwise be unchanged

#### Scenario: A size budget binds before a count budget

- **WHEN** a part's candidates are within its count Budget but together exceed its token Budget
- **THEN** the part SHALL carry only the candidates that fit the token Budget, strongest first

#### Scenario: A count budget binds before a size budget

- **WHEN** a part's candidates are within its token Budget but exceed its count Budget
- **THEN** the part SHALL carry only the count its Budget allows

#### Scenario: A part's size budget is independent of the others

- **WHEN** one part's token Budget is exhausted
- **THEN** the other parts SHALL be bounded by their own token Budgets and unaffected by that exhaustion

#### Scenario: A part whose irreducible content exceeds its budget says so

- **WHEN** a part must carry content that cannot be shortened below its token Budget — a Turn of many messages, each already at the shortest length worth carrying
- **THEN** the part SHALL carry that content, SHALL report the token Budget it exceeded alongside what it spent, and SHALL NOT be reported as having fitted

#### Scenario: Pins are not trimmed at assembly

- **WHEN** the Conversation's Pins exceed the Pin Budget at assembly
- **THEN** the Pack SHALL carry every Pin and report the Budget exceeded

### Requirement: A pack fits a ceiling the assembler enforces

A Context Pack SHALL have a total size ceiling, configurable and independent of any single part's Budget. When the parts selected for a Pack together exceed that ceiling, the Assembler SHALL reduce the Pack until it fits, before the Pack reaches the model. Reduction SHALL follow a fixed order — structure, then curated knowledge, then the weakest-matching recalled Turns, then the oldest Turns of the verbatim tail — so that two Packs assembled from the same inputs and configuration are reduced identically. The current Turn SHALL NEVER be dropped. Pins SHALL NEVER be reduced: they count toward the ceiling, and where they and the current Turn together leave no room, the current Turn is what is elided and the overrun is reported.

#### Scenario: An oversized pack is reduced before it is sent

- **WHEN** the parts selected for a Pack exceed the Pack ceiling
- **THEN** the Pack supplied to the model SHALL be within the ceiling

#### Scenario: Reduction follows the specified order

- **WHEN** a Pack carrying structure, curated knowledge, recalled Turns, and a verbatim tail must be reduced
- **THEN** structure SHALL be reduced before curated knowledge, curated knowledge before recalled Turns, and recalled Turns before the verbatim tail

#### Scenario: The tail is reduced from its oldest turn

- **WHEN** the verbatim tail must be reduced to fit the ceiling
- **THEN** the Turns removed SHALL be the oldest in the tail, and the most recent Turns SHALL remain

#### Scenario: Reduction is deterministic

- **WHEN** the same oversized selection is assembled twice under the same configuration
- **THEN** the two reduced Packs SHALL be identical

#### Scenario: The current turn survives a ceiling it cannot fit

- **WHEN** the current Turn alone exceeds the Pack ceiling
- **THEN** the Pack SHALL still carry the current Turn, its oversized content SHALL be elided rather than the Turn dropped, and the condition SHALL be reported

#### Scenario: A pack that cannot be brought within its ceiling keeps the prompt

- **WHEN** the current Turn exceeds the Pack ceiling and holds nothing large enough to elide — many small messages rather than a few large ones
- **THEN** the Pack SHALL carry the current Turn whole, SHALL exceed its ceiling rather than lose the prompt, and the overrun SHALL be reported

#### Scenario: A ceiling that binds nothing changes nothing

- **WHEN** a Pack's parts together are within the ceiling
- **THEN** the Pack SHALL be exactly what it would have been without a ceiling

#### Scenario: Pins survive the ceiling

- **WHEN** a Pack carrying Pins must be reduced to fit the ceiling
- **THEN** every reducible part SHALL be reduced before any Pin is affected, and no Pin SHALL be removed or shortened
