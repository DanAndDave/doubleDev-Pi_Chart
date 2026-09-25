## ADDED Requirements

### Requirement: A pack leads with what the harness already sent

A Context Pack SHALL begin with the longest run of messages the harness supplied for that Call, carried unaltered and in the order it supplied them, before any assembled part. What the Assembler adds — recalled Turns, Concepts, structure — SHALL follow that run.

The reason is measured rather than aesthetic: the harness marks a supplied array for caching only up to the first message it did not itself send, so a Pack that opens with an assembled part is cached not at all. A Pack that opens with the harness's own messages is cached to the point where it stops agreeing with them.

A Pack SHALL NOT alter a message in order to lead with it: where the Assembler would carry a Turn shortened, drawn from the Thread Store, or otherwise different from what the harness sent, that message SHALL follow the run rather than break it. Correct content outranks a cacheable prefix.

#### Scenario: The harness's own messages come first

- **WHEN** a Context Pack carries both messages the harness supplied and parts the Assembler added
- **THEN** the supplied messages SHALL come first, unaltered, in the order they arrived

#### Scenario: A shortened message does not lead

- **WHEN** a message the Assembler would carry differs from what the harness supplied for that position
- **THEN** it SHALL be carried after the unaltered run rather than in place of it

#### Scenario: A pack with nothing supplied is still assembled

- **WHEN** the harness supplies no messages the Assembler keeps unaltered
- **THEN** the Pack SHALL still carry every part it would otherwise have carried

#### Scenario: The current turn still ends the pack

- **WHEN** a Context Pack is assembled
- **THEN** the Turn in progress SHALL be the last thing in it, as it is today

#### Scenario: What a pack carries is unchanged by where it sits

- **WHEN** the same inputs are assembled before and after this change
- **THEN** the Pack SHALL carry the same parts, with the same Budgets and the same accounting, in a different order
