## ADDED Requirements

### Requirement: Pins are examined like any other part

Examining a Call SHALL report the Pins its Pack carried as their own part, with their ids, their size, and the Pin Budget, and SHALL report that part as having no relevance threshold. Comparing two Calls SHALL report a Pin added or removed between them as entering or leaving, identified by its id. A Conversation summary SHALL report the Pin part's typical spend beside the other parts. Neither the record nor any report SHALL carry a Pin's text: the Journal holds it, and `/pins` prints it.

#### Scenario: A call's pins are itemised

- **WHEN** a Call whose Pack carried two Pins is examined
- **THEN** the report SHALL list a pinned part naming both ids, with its size against the Pin Budget

#### Scenario: A pin added between calls enters

- **WHEN** a Call before a Pin was added is compared with a Call after it
- **THEN** the Pin SHALL be reported as entering, by its id

#### Scenario: A pin removed between calls leaves

- **WHEN** a Call before a Pin was removed is compared with a Call after it
- **THEN** the Pin SHALL be reported as leaving, by its id

#### Scenario: Pins over a lowered budget are reported as exceeding it

- **WHEN** a Call carried Pins that together exceeded the Pin Budget in force
- **THEN** the report SHALL state the Budget exceeded rather than report the part as fitting

#### Scenario: Calls recorded before pins existed read without them

- **WHEN** a Call recorded before Pins existed is examined or compared
- **THEN** it SHALL be reported with no pinned part, and comparing it with a later Call SHALL report that Call's Pins as entering

## MODIFIED Requirements

### Requirement: Budgets can be changed within a session

The system SHALL allow a Budget to be changed while a session is running, and the change SHALL apply from the next Call without restarting. The Pin Budget, in count and in tokens, SHALL be changeable the same way; lowering it SHALL NOT remove a Pin already held, and SHALL apply to the next Pin written.

#### Scenario: A changed budget takes effect on the next call

- **WHEN** a Budget is changed mid-session
- **THEN** the next Call's pack SHALL be assembled under the new Budget

#### Scenario: An invalid budget is refused, not applied

- **WHEN** a Budget is set to something that is not a count
- **THEN** it SHALL be refused and the previous Budget SHALL remain in force

#### Scenario: A lowered pin budget keeps the pins held

- **WHEN** the Pin Budget is lowered below what the Conversation's Pins spend
- **THEN** every Pin SHALL remain held and carried, and the next `/pins add` SHALL be refused against the new Budget
