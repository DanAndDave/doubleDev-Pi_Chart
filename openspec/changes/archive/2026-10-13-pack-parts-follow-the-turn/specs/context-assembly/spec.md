## ADDED Requirements

### Requirement: Assembled parts follow the Turn in progress

A Context Pack SHALL carry what the harness sent first, the verbatim tail and then the Turn in progress, and every part the Assembler adds after it, as one closing block. The block SHALL carry recalled Turns, then curated knowledge, then structure, then Pins, so the last thing in a Pack that holds Pins is the last Pin.

The reason is measured rather than aesthetic. The harness caches a Pack through the end of the Turn in progress, so an assembled part ahead of that point which changes between Calls makes the next Call write everything after it again. Behind it, a part that changes costs only its own size.

The block SHALL open with one fixed line, identical on every Call, stating that what follows is background for the request above it and not a new request. A Pack that carries no assembled content SHALL carry no such line, and SHALL be exactly the verbatim tail followed by the Turn in progress.

Nothing assembled SHALL sit between two messages of the verbatim tail, between the tail and the Turn in progress, or within the Turn in progress.

Where a part sits is not what the ceiling reads: the order a Pack is composed in and the order its parts are reduced in are independent. The opening line SHALL count toward the Pack's size, and a Pack that carries it SHALL still fit its ceiling.

#### Scenario: The harness's turns come first

- **WHEN** a Context Pack carries a verbatim tail, a Turn in progress, and assembled parts
- **THEN** the tail SHALL come first, the Turn in progress SHALL follow it, and every assembled part SHALL follow the Turn in progress

#### Scenario: The block keeps a fixed order

- **WHEN** a Context Pack carries recalled Turns, curated knowledge, structure and Pins
- **THEN** they SHALL follow the Turn in progress in that order, with the Pins last

#### Scenario: The block says what it is

- **WHEN** a Context Pack carries any assembled part
- **THEN** the first message after the Turn in progress SHALL be the fixed opening line, identical across Calls and Conversations

#### Scenario: Nothing assembled, nothing added

- **WHEN** no assembled part carries anything for a Call
- **THEN** the Pack SHALL be the verbatim tail followed by the Turn in progress, with no opening line

#### Scenario: A part that changes between calls leaves the turns alone

- **WHEN** two consecutive Calls of one Turn carry different structure and the same tail and Turn in progress up to the second Call's new messages
- **THEN** every message before the assembled block in the first Call's Pack SHALL appear unchanged, in the same positions, at the head of the second Call's Pack

#### Scenario: The ceiling accounts for the opening line

- **WHEN** a Pack carrying assembled parts is reduced to fit its ceiling
- **THEN** the Pack's size, opening line included, SHALL NOT exceed the ceiling

#### Scenario: What a pack carries is unchanged by where it sits

- **WHEN** the same inputs are assembled before and after this change
- **THEN** every part SHALL carry the same content, with the same Budgets and the same accounting, in a different order

### Requirement: Packs carry the prompt and an unsplit verbatim tail

A Context Pack SHALL contain the Turn's prompt and the most recent N Turns reproduced verbatim, where N is configurable. Turns in the verbatim tail SHALL retain their original content, including tool calls and their results. The tail SHALL be drawn from the Thread Store, so it does not depend on the harness still carrying that history.

A Turn the tail carries without shortening SHALL reach the model exactly as it did while it was the Turn in progress, so the Call that first carries it in the tail reads it back from cache instead of writing it again. The tail SHALL keep its Turns in order and SHALL NOT be split.

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

#### Scenario: A finished turn reads back as it was sent

- **WHEN** a Turn completes and the next Turn's first Call carries it, unshortened, in the verbatim tail read from the Thread Store
- **THEN** that Turn's messages SHALL serialise to the model identically to how they did as the Turn in progress, including the key order of every tool call's arguments

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

### Requirement: Every pin closes the pack

Every Context Pack the Assembler supplies SHALL carry every Pin the Conversation holds at that Call, whole and unaltered, as its own part. The Pins SHALL be the last messages of the Pack, after the Turn in progress and every other assembled part, in the order they were added, so nothing stands between them and the model's reply. Each SHALL be attributed as text the user pinned and identified by its id, so the model can tell a standing instruction from the user apart from retrieved background and from the prompt being answered.

A Pin SHALL NEVER be shortened, elided, dropped by its Budget, or reduced for the Ceiling. Where the Pins held exceed their Budget — the Budget was lowered after they were added — the Pack SHALL still carry them all, and the part SHALL report the Budget it exceeded. A Conversation holding no Pins SHALL send exactly the messages it would have sent without this requirement.

#### Scenario: A pin reaches the model

- **WHEN** a Conversation holds a Pin and a Call is assembled
- **THEN** the Context Pack SHALL carry that Pin's text unaltered

#### Scenario: Pins close the pack

- **WHEN** a Context Pack carries Pins, other assembled parts, a verbatim tail and a Turn in progress
- **THEN** the Pins SHALL follow everything else, in the order they were added

#### Scenario: A pin alone still opens the block

- **WHEN** a Context Pack carries Pins and no other assembled part
- **THEN** the opening line SHALL follow the Turn in progress and the Pins SHALL follow the opening line

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

## REMOVED Requirements

### Requirement: A pack leads with what the harness already sent

**Reason**: It rested on reading the harness as caching only up to the first message it did not itself send. omp 18.10.3 actually places its breakpoint on the last message handed back unchanged, the end of the Turn in progress, so the leading run bought nothing, and the parts it placed between the run and the Turn in progress broke the cache whenever they changed (ADR-0010).

**Migration**: Superseded by "Assembled parts follow the Turn in progress". The whole tail now precedes every assembled part, so nothing has to agree with the harness's array by position. `leading_tokens` keeps its column and now records the tokens ahead of the assembled block.

### Requirement: Packs carry the prompt and a verbatim tail

**Reason**: It allowed the tail to be split around a leading run and allowed the harness's own message objects to be substituted for the tail's. Neither applies once the whole tail precedes every assembled part.

**Migration**: Replaced by "Packs carry the prompt and an unsplit verbatim tail", which keeps every other rule and adds that a finished Turn reaches the model exactly as it was sent.

### Requirement: Packs carry every pin

**Reason**: It placed Pins immediately before the Turn in progress, where the previous Turn would pass them at every Turn boundary and be written to the cache again.

**Migration**: Replaced by "Every pin closes the pack", which keeps every guarantee about what a Pin is and how it is carried and moves the Pins to the end of the Pack.
