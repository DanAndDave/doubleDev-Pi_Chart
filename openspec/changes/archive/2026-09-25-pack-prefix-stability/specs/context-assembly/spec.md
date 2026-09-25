## MODIFIED Requirements

### Requirement: Packs carry the prompt and a verbatim tail

A Context Pack SHALL contain the Turn's prompt and the most recent N Turns reproduced verbatim, where N is configurable. Turns in the verbatim tail SHALL retain their original content, including tool calls and their results. The tail SHALL be drawn from the Thread Store, so it does not depend on the harness still carrying that history.

The tail decides what a Pack carries; where a message the harness supplied says the same thing, the Pack MAY send the harness's own message in its place, because only the harness's own copy is one it recognises. It SHALL NOT send a message that says anything else.

The tail MAY be split, with its oldest messages leading the Pack and the rest following the assembled parts, and SHALL keep its Turns in order either way. It SHALL NOT be split within a Turn: assembled content between a call and its result is a Context Window the model's provider refuses, which is the same rule an unanswered call already obeys.

A tool call whose result is absent SHALL NOT be reproduced in the verbatim tail: the tail SHALL carry a call together with its result or carry neither, so that a Pack is never a Context Window the model's provider refuses. Withholding an unanswered call SHALL NOT remove any other content of the Turn it belongs to, and SHALL leave a Turn whose calls are all answered exactly as it would otherwise have been.

#### Scenario: Recent turns are reproduced exactly

- **WHEN** a Context Pack is built with a verbatim tail of N Turns
- **THEN** the pack SHALL contain those Turns' content unaltered and unsummarized

#### Scenario: Tail length is configurable

- **WHEN** N is changed
- **THEN** subsequent packs SHALL carry that many Turns in the verbatim tail

#### Scenario: A tool result remains actionable

- **WHEN** a Turn in the verbatim tail contains a tool call and its result
- **THEN** both SHALL appear in the pack in a form the model can act on

#### Scenario: A split tail keeps each call with its result

- **WHEN** only part of the tail agrees with what the harness supplied, and the disagreement falls inside a Turn
- **THEN** the Pack SHALL lead with whole Turns only, so that nothing assembled is carried between a call and its result

#### Scenario: The tail outlives the conversation being cleared

- **WHEN** the harness's own conversation is cleared and a new prompt is sent within the same Conversation
- **THEN** the verbatim tail SHALL still carry the Turns that preceded the clear

#### Scenario: An unanswered tool call is not replayed

- **WHEN** a Turn in the verbatim tail contains a tool call whose result was never recorded
- **THEN** the Pack SHALL NOT carry that call

#### Scenario: The rest of an interrupted turn survives

- **WHEN** a Turn whose last tool call went unanswered is carried in the verbatim tail
- **THEN** that Turn's prompt, its assistant text, and its answered tool calls with their results SHALL still appear

#### Scenario: A turn with every call answered is untouched

- **WHEN** every tool call in the verbatim tail has its result
- **THEN** the tail SHALL be exactly what it would have been without this rule

## ADDED Requirements

### Requirement: A pack leads with what the harness already sent

A Context Pack SHALL begin with the longest run of messages the harness supplied for that Call, carried unaltered and in the order it supplied them, before any assembled part. What the Assembler adds — recalled Turns, Concepts, structure — SHALL follow that run.

The reason is measured rather than aesthetic: the harness marks a supplied array for caching only up to the first message it did not itself send, so a Pack that opens with an assembled part is cached not at all. A Pack that opens with the harness's own messages is cached to the point where it stops agreeing with them.

Where a part sits is not what the ceiling reads: the order a Pack is composed in and the order its parts are reduced in are independent, and reducing a Pack SHALL NOT change which messages may lead it beyond the messages its parts still carry.

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
