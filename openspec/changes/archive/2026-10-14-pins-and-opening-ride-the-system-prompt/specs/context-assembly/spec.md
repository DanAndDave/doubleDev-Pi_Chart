## ADDED Requirements

### Requirement: Every pin rides the system prompt

pi-chart SHALL add its parts to the system prompt when the harness offers it at the start of each Turn, through `before_agent_start`. It SHALL append them, as one block, after every entry of the system prompt it is given. It SHALL NEVER replace, reorder or alter an entry it was given, because the harness passes each handler the system prompt the previous handler returned and takes a returned array as the whole prompt. The block SHALL hold, in this order: every Pin, then the Opening, then the eviction notice. A section with nothing to carry SHALL be left out. Where all three are left out, pi-chart SHALL leave the system prompt as it was given.

Every Pin the Conversation holds when the Turn starts SHALL be in the block, whole and unaltered, in the order the Pins were added, as the Pack's `pinned` part. The Pins SHALL be framed as standing instructions from the user. Each Pin SHALL be attributed as text the user pinned and SHALL be identified by its id, so the model can tell a standing instruction from the prompt being answered and from what a tool returned.

The system prompt SHALL be fixed when a Turn starts. A Pin added or removed during a Turn SHALL take effect from the next Turn and SHALL NOT change the system prompt of any later Call of the Turn in which it was added or removed.

A Pin SHALL NEVER be shortened, elided, dropped by its Budget, or reduced for the Ceiling. Where the Pins held exceed their Budget, because the Budget was lowered after they were added, the system prompt SHALL still carry them all, and the part SHALL report the Budget it exceeded.

#### Scenario: A pin reaches the model

- **WHEN** a Conversation holds a Pin and a Turn starts
- **THEN** the system prompt of every Call of that Turn SHALL carry that Pin's text unaltered

#### Scenario: The harness's system prompt is kept

- **WHEN** pi-chart is given a system prompt whose entries include one another extension appended
- **THEN** the system prompt pi-chart returns SHALL hold every entry it was given, unchanged and in the same order, followed by pi-chart's block

#### Scenario: The block keeps a fixed order

- **WHEN** a Turn starts in a Conversation that holds Pins, has an Opening, and has `recall_earlier_turns` registered
- **THEN** pi-chart's block SHALL hold the Pins, then the Opening, then the eviction notice

#### Scenario: A pin is attributed

- **WHEN** a Pin is carried
- **THEN** the Pin's text SHALL be preceded by an attribution that names it as pinned by the user and gives its id, under the standing-instruction framing

#### Scenario: A pin added mid-Turn waits for the next Turn

- **WHEN** a Pin is added after a Turn's first Call and before its last
- **THEN** no Call of that Turn SHALL carry it, and the system prompt of the next Turn SHALL carry it

#### Scenario: A removed pin is not carried

- **WHEN** a Pin is removed before a Turn starts
- **THEN** no Call of that Turn SHALL carry it

#### Scenario: A pin removed mid-Turn stays until the Turn ends

- **WHEN** a Pin is removed during a Turn
- **THEN** every later Call of that Turn SHALL still carry it, and the next Turn SHALL NOT carry it

#### Scenario: Pins outlive their budget being lowered

- **WHEN** the Pin Budget is lowered below what the Conversation's Pins already spend
- **THEN** every Pin SHALL still be carried, and the part SHALL report the Budget it exceeded

#### Scenario: No pins changes nothing else

- **WHEN** the Conversation holds no Pins
- **THEN** pi-chart's block SHALL hold no Pin section and no Pin framing, and SHALL otherwise be what it would have been with the Pins present

#### Scenario: Nothing to add leaves the system prompt alone

- **WHEN** a Turn starts with no Pins, no Opening to carry, and `recall_earlier_turns` not registered
- **THEN** pi-chart SHALL return no system prompt, and the harness's system prompt SHALL be sent as it was

### Requirement: The system prompt says older Turns can be searched

When `recall_earlier_turns` is registered, pi-chart's system-prompt block SHALL end with one fixed line, the eviction notice. The line SHALL say that older Turns of the Conversation may have left the window and can be searched with `recall_earlier_turns`. The notice SHALL be carried on every Turn, whether or not the verbatim tail has evicted a Turn yet, so the system prompt does not change at the first Eviction. It SHALL be byte for byte identical on every Turn and in every Conversation. When `recall_earlier_turns` is not registered, the notice SHALL NOT be carried, because it would name a tool the model cannot call.

#### Scenario: The notice names the tool

- **WHEN** a Turn starts and `recall_earlier_turns` is registered
- **THEN** pi-chart's block SHALL end with the eviction notice, naming `recall_earlier_turns`

#### Scenario: The notice comes before any eviction

- **WHEN** a Conversation's tail has evicted no Turn and `recall_earlier_turns` is registered
- **THEN** the eviction notice SHALL still be carried

#### Scenario: No tool, no notice

- **WHEN** no Thread Store is available, so `recall_earlier_turns` is not registered
- **THEN** pi-chart's block SHALL carry no eviction notice

#### Scenario: The notice does not vary

- **WHEN** two Turns, of the same or of different Conversations, carry the eviction notice
- **THEN** the two notices SHALL be byte for byte identical

### Requirement: Every Call of a Turn sends the same system-prompt additions

Within a Turn, every Call SHALL send pi-chart's system-prompt block byte for byte as it was when the Turn started, so that every Call after the first reads the system prompt from cache. The Accounting of each Call SHALL record the `pinned` and `opening` parts as they were sent at the Turn's start, not as the Conversation holds them at that Call. The parts SHALL be marked as placed in the system prompt (`placement: system-prompt`). Across Turns, the block SHALL be byte for byte identical while no Pin changes and the Opening's text and Budget stay the same.

The block SHALL be built once per Turn start. Where the harness offers the system prompt again within the same start, the block SHALL be the same.

#### Scenario: Later Calls read the same block

- **WHEN** a Turn makes several Calls
- **THEN** pi-chart's block SHALL be byte for byte identical in the system prompt of each Call

#### Scenario: Accounting records what was sent

- **WHEN** a Pin is added during a Turn and a later Call of that Turn is recorded
- **THEN** that Call's `pinned` part SHALL list only the Pins the Turn's system prompt carried, and SHALL NOT list the new Pin

#### Scenario: The parts are marked as system prompt

- **WHEN** a Call's Accounting records the `pinned` or `opening` part
- **THEN** the part SHALL be recorded with `placement: system-prompt`

#### Scenario: An unchanged Conversation keeps its block

- **WHEN** two consecutive Turns start in the same process with the same Pins and the same Opening Budget
- **THEN** pi-chart's block SHALL be byte for byte identical in both Turns

### Requirement: System-prompt additions are absent when the harness does not offer the system prompt

When the harness does not run `before_agent_start` for a Turn, pi-chart SHALL NOT carry its Pins, the Opening or the eviction notice by any other means: it SHALL add no user message, no system message and no other message to the Pack in their place. Each Call of that Turn SHALL record the `pinned` and `opening` parts as absent with the cause `unhooked`, meaning the harness never offered the system prompt; a Turn's additions SHALL end with the Turn, so a later Turn the hook does not reach SHALL NOT be recorded with an earlier Turn's parts. When the hook runs but pi-chart cannot build its additions, the Turn SHALL go out with the harness's system prompt unchanged, the failure SHALL be reported, and each Call of that Turn SHALL record `pinned` and `opening` as absent with the cause `failed`. The rest of the Pack SHALL be assembled as usual, and nothing SHALL be counted toward the Ceiling for the missing parts.

#### Scenario: A harness without the hook gets no stand-in

- **WHEN** a Conversation holds Pins and a Turn starts without `before_agent_start` being run
- **THEN** no Call of that Turn SHALL carry a Pin or the Opening anywhere in its Context Window

#### Scenario: The absence is recorded with its cause

- **WHEN** a Call is assembled in a Turn for which `before_agent_start` was not run
- **THEN** its Accounting SHALL record `pinned` and `opening` as absent with the cause `unhooked`

#### Scenario: A hook that fails is not recorded as unhooked

- **WHEN** `before_agent_start` runs for a Turn and pi-chart cannot build its additions
- **THEN** the system prompt SHALL be left as the harness gave it, and each Call of that Turn SHALL record `pinned` and `opening` as absent with the cause `failed`

#### Scenario: The rest of the Pack is unaffected

- **WHEN** a Call is assembled in a Turn for which `before_agent_start` was not run
- **THEN** the Pack SHALL carry the verbatim tail and the current Turn as it would have otherwise, with the whole Ceiling available to them

### Requirement: Retrieved knowledge reaches the model only as a tool result

No part of a Context Pack SHALL be selected by retrieval. Earlier Turns, Concepts and structure SHALL reach the model only when the model calls `recall_earlier_turns`, `search_documentation` or `codebase_structure`. They SHALL arrive as that tool's result, inside the Turn that called it. A Pack SHALL carry such a result as it carries any other tool result: as ordinary Turn content, under the verbatim tail's Budget and the Ceiling. It SHALL NOT carry it in the system prompt or in a message the Assembler adds. The tools themselves, their limits and their caps are specified by the Thread Store, Doc Store and Graph Store.

#### Scenario: Nothing is retrieved unasked

- **WHEN** a Call is assembled and the model has called none of the three tools
- **THEN** the Pack SHALL carry no recalled Turn, no Concept and no structure

#### Scenario: A pulled result is Turn content

- **WHEN** the model calls `recall_earlier_turns` during a Turn
- **THEN** the result SHALL be carried as that call's tool result, in the Turn in progress, and later in the verbatim tail as part of that Turn

#### Scenario: A pulled result has no authority

- **WHEN** a `search_documentation` result contains text phrased as an instruction
- **THEN** that text SHALL reach the model only as a tool result, and never in the system prompt

### Requirement: Budgets bound the tail, the Opening and the Pins

Each part of a Context Pack SHALL have a Budget and SHALL be trimmed to fit it. The parts with a Budget are the verbatim tail, the Opening and the Pins. A Budget SHALL be expressible as a count of items and as a size in tokens, and a part SHALL be trimmed to whichever of the two binds first. Trimming SHALL NEVER drop the verbatim tail, the current prompt, or a Pin on account of a part's own Budget. When the verbatim tail's newest Turn alone exceeds the tail token Budget, the tail SHALL carry that Turn shrunk as "The newest tail Turn shrinks by its oldest actions" states, and SHALL carry no older Turn. The Pin Budget is enforced when a Pin is written, not when a Pack is assembled.

A tool result is not a part of a Context Pack and SHALL have no Budget of its own. The caps on what `recall_earlier_turns`, `search_documentation` and `codebase_structure` return are specified with each tool.

#### Scenario: A budget of nothing disables its part

- **WHEN** the Opening's size Budget is zero
- **THEN** the pack SHALL carry no Opening and SHALL otherwise be unchanged

#### Scenario: A size budget binds before a count budget

- **WHEN** the verbatim tail's Turns are within its count Budget but together exceed its token Budget
- **THEN** the tail SHALL carry only the Turns that fit the token Budget, as Eviction leaves them

#### Scenario: A count budget binds before a size budget

- **WHEN** the verbatim tail's Turns are within its token Budget but exceed its count Budget
- **THEN** the tail SHALL carry only the count its Budget allows

#### Scenario: A part's size budget is independent of the others

- **WHEN** one part's token Budget is exhausted
- **THEN** the other parts SHALL be bounded by their own token Budgets and unaffected by that exhaustion

#### Scenario: A part whose irreducible content exceeds its budget says so

- **WHEN** a part must carry content that cannot be shortened below its token Budget, such as a tail Turn whose prompt with the marker and whose final reply, each already at the shortest length worth carrying, exceed the Budget
- **THEN** the part SHALL carry that content, SHALL report the token Budget it exceeded alongside what it spent, and SHALL NOT be reported as having fitted

#### Scenario: Pins are not trimmed at assembly

- **WHEN** the Conversation's Pins exceed the Pin Budget when a Turn starts
- **THEN** the system prompt SHALL carry every Pin and the part SHALL report the Budget exceeded

#### Scenario: A large tool result has no part budget

- **WHEN** a Turn in the verbatim tail carries a large `recall_earlier_turns` result
- **THEN** that result SHALL be bounded as any other tool result in that Turn is, and SHALL NOT be counted as a part of its own

### Requirement: A pack fits a ceiling by reducing only the tail and the current Turn

A Context Pack SHALL have a total size ceiling. The ceiling SHALL be configurable and independent of any single part's Budget. When the parts of a Pack together exceed that ceiling, the Assembler SHALL reduce the Pack until it fits, before the Pack reaches the model.

pi-chart's system-prompt block SHALL count toward the ceiling: the Pins, the Opening and the eviction notice. It SHALL NEVER be reduced for it. Only the verbatim tail and the current Turn SHALL be reduced, in a fixed order: first the oldest Turns of the verbatim tail, then the newest tail Turn as the next paragraph states, then the current Turn by Elision. Two Packs assembled from the same inputs and configuration SHALL therefore be reduced identically. The current Turn SHALL NEVER be dropped. Where the system-prompt block and the current Turn together leave no room, the current Turn is what is elided and the overrun is reported.

The ceiling SHALL NEVER leave the verbatim tail empty when the tail carried a Turn before the ceiling bound. Once the tail is down to its newest Turn, that Turn SHALL be shrunk to the room left, as "The newest tail Turn shrinks by its oldest actions" states, rather than dropped. Where its smallest form exceeds that room, it SHALL be carried at its smallest form and counted toward the ceiling as the system-prompt block is. The current Turn SHALL be elided around it, and a Pack still over its ceiling SHALL be reported as an overrun.

#### Scenario: An oversized pack is reduced before it is sent

- **WHEN** a Pack's parts exceed the Pack ceiling, and the newest tail Turn's smallest form fits the room left by the current Turn and the system-prompt block
- **THEN** the Pack supplied to the model SHALL be within the ceiling

#### Scenario: Reduction follows the specified order

- **WHEN** a Pack carrying Pins, the Opening, a verbatim tail and a current Turn must be reduced
- **THEN** the oldest tail Turns SHALL be removed first, the newest tail Turn SHALL be shrunk next, the current Turn SHALL be elided last, and the Pins and the Opening SHALL be untouched

#### Scenario: The Opening survives the ceiling

- **WHEN** a Pack carrying the Opening must be reduced to fit the ceiling
- **THEN** the Opening SHALL be carried as its own Budget left it, SHALL NOT be shortened further, and SHALL NOT be recorded as absent for want of room

#### Scenario: The tail is reduced from its oldest turn

- **WHEN** the verbatim tail must be reduced to fit the ceiling
- **THEN** the Turns removed SHALL be the oldest in the tail, and the most recent Turns SHALL remain

#### Scenario: The newest tail turn survives the ceiling, shrunk

- **WHEN** the room the ceiling leaves the verbatim tail is smaller than its newest Turn
- **THEN** the tail SHALL carry that Turn shrunk to the room, with the marker naming what went, and SHALL NOT be recorded as absent

#### Scenario: A tail turn that cannot shrink enough is still carried

- **WHEN** the newest tail Turn's smallest form exceeds the room the ceiling leaves it
- **THEN** the tail SHALL carry that Turn at its smallest form, the current Turn SHALL be elided around it, and a Pack still over its ceiling SHALL be reported as an overrun

#### Scenario: Reduction is deterministic

- **WHEN** the same oversized selection is assembled twice under the same configuration
- **THEN** the two reduced Packs SHALL be identical

#### Scenario: The current turn survives a ceiling it cannot fit

- **WHEN** the current Turn alone exceeds the Pack ceiling
- **THEN** the Pack SHALL still carry the current Turn, its oversized content SHALL be elided rather than the Turn dropped, and the condition SHALL be reported

#### Scenario: A pack that cannot be brought within its ceiling keeps the prompt

- **WHEN** the current Turn exceeds the Pack ceiling and holds nothing large enough to elide, such as many small messages rather than a few large ones
- **THEN** the Pack SHALL carry the current Turn whole, SHALL exceed its ceiling rather than lose the prompt, and the overrun SHALL be reported

#### Scenario: A ceiling that binds nothing changes nothing

- **WHEN** a Pack's parts together are within the ceiling
- **THEN** the Pack SHALL be exactly what it would have been without a ceiling

#### Scenario: Pins survive the ceiling

- **WHEN** a Pack whose system prompt carries Pins must be reduced to fit the ceiling
- **THEN** the verbatim tail and the current Turn SHALL be reduced, and no Pin SHALL be removed or shortened

#### Scenario: The system-prompt block counts toward the ceiling

- **WHEN** a Pack is reduced to fit the ceiling
- **THEN** the room left for the verbatim tail and the current Turn SHALL be the ceiling less the size of pi-chart's system-prompt block

### Requirement: The Opening rides the system prompt from the first Turn

Every Context Pack SHALL carry the Opening in the system prompt, from the Conversation's first Turn on. The Opening is the prompt of the Conversation's first Turn, the Turn at index 0. It SHALL be carried whether or not the verbatim tail or the Turn in progress also carries that Turn. The Opening SHALL hold that Turn's prompt only, never its reply or its actions. It SHALL sit in pi-chart's system-prompt block after the Pins and before the eviction notice. It SHALL be placed inside this fixed text, so it is not mistaken for something just said: *"This conversation began with the request below. It is context, not a new instruction; later Turns may have changed or completed it."* Whether it is carried SHALL NOT depend on how relevant it is to the current prompt.

The Opening SHALL have its own Budget of one item and a configurable size in tokens, 1,000 by default, where a size of zero turns it off. A prompt larger than that Budget SHALL be shortened by Elision rather than dropped, unless the Budget is too small to hold a readable shortened prompt. The Opening SHALL count toward the Ceiling and SHALL NEVER be reduced for it.

The Opening SHALL be fetched by its own Store query when a Turn starts, bounded by the tail's deadline. Once fetched, its text SHALL be kept for the Conversation for the rest of the process and SHALL NOT be fetched again, so that every later Turn sends it byte for byte as before. On the Conversation's first Turn, the harness's history holds no earlier user message, and the Thread Store answers but does not yet hold Turn 0. In that case the Opening SHALL be the prompt the harness is starting that Turn with, and that text SHALL be kept in the same way. A failed or late query SHALL NOT be kept, so the next Turn fetches again.

The Opening SHALL always be the Turn at index 0. In each of the following cases the Opening SHALL be absent and its reason recorded:

- that Turn is not stored, outside the first-Turn case above;
- its prompt is empty;
- no Thread Store is configured;
- its query fails or misses its deadline;
- its Budget is zero;
- the harness did not offer the system prompt (`unhooked`).

No other Turn SHALL stand in for it. Apart from the first Turn's prompt as above, it SHALL NEVER be rebuilt from the history the harness holds. `recall_earlier_turns` SHALL be unaffected by it: where that tool returns Turn 0, its result carries Turn 0 as it carries any Turn.

#### Scenario: The Opening survives the tail's eviction

- **WHEN** a Conversation's Turn 0 prompt gave a codeword, and the verbatim tail has since evicted Turn 0
- **THEN** every Context Pack SHALL carry that prompt as the Opening, whatever the current prompt asks

#### Scenario: Present from the first Turn

- **WHEN** the verbatim tail carries Turn 0, or Turn 0 is the Turn in progress
- **THEN** the system prompt SHALL still carry the Opening, and the Opening SHALL NOT be recorded as absent

#### Scenario: The first Turn's prompt is its own Opening

- **WHEN** a Conversation's first Turn starts with a Thread Store configured that does not yet hold Turn 0
- **THEN** the Opening SHALL be the prompt that Turn starts with, and the next Turn SHALL carry the same Opening text byte for byte

#### Scenario: Only the prompt is carried

- **WHEN** the Opening is carried and Turn 0 made tool calls and gave a reply
- **THEN** the Opening SHALL hold Turn 0's prompt text and none of its tool calls, results or reply

#### Scenario: The Opening is framed as context

- **WHEN** a Turn's system prompt carries Pins, the Opening and the eviction notice
- **THEN** the Opening SHALL follow the Pins and precede the eviction notice, inside the fixed text that says it began the Conversation and is context, not a new instruction

#### Scenario: A long Opening is shortened, not dropped

- **WHEN** Turn 0's prompt exceeds the Opening's size Budget
- **THEN** the Opening SHALL carry the prompt elided to that Budget, with the marker naming what went, and SHALL NOT be recorded as absent

#### Scenario: A budget of nothing turns it off

- **WHEN** the Opening's size Budget is zero
- **THEN** the system prompt SHALL carry no Opening, SHALL record it as excluded for a zero Budget, and SHALL otherwise be unchanged

#### Scenario: An empty Turn 0 prompt carries nothing

- **WHEN** Turn 0's stored prompt is empty or only whitespace, as for a Turn that only marks a compaction
- **THEN** the system prompt SHALL carry no Opening and SHALL record it as absent because Turn 0's prompt is empty

#### Scenario: A first Turn no longer stored has no stand-in

- **WHEN** the Opening has not been fetched in this process, and the Thread Store holds later Turns of the Conversation but not Turn 0
- **THEN** the system prompt SHALL carry no Opening, SHALL record it as absent because the first Turn is not stored, and SHALL NOT carry the oldest remaining Turn's prompt in its place

#### Scenario: No store, no Opening

- **WHEN** no Thread Store is configured and the harness's own history still holds Turn 0's prompt
- **THEN** the system prompt SHALL carry no Opening and SHALL record it as absent because no Store is configured

#### Scenario: A missed deadline costs only the Opening

- **WHEN** the Opening's query does not answer within the tail's deadline
- **THEN** that Turn's system prompt SHALL carry no Opening, the miss SHALL be reported as a missed deadline, the Opening SHALL be recorded as absent because retrieval failed, and the verbatim tail SHALL be unaffected

#### Scenario: A failed fetch is tried again next Turn

- **WHEN** the Opening's query failed on one Turn and answers on the next
- **THEN** the next Turn's system prompt SHALL carry the Opening

#### Scenario: The Ceiling does not touch the Opening

- **WHEN** a Pack carrying the Opening must be reduced to fit the Ceiling
- **THEN** the Opening SHALL be carried as its Budget left it, and SHALL NOT be shortened or recorded as absent for want of room

#### Scenario: Recall and the Opening may both carry Turn 0

- **WHEN** `recall_earlier_turns` returns Turn 0 while the Opening is carried
- **THEN** the tool result SHALL carry Turn 0 as a recollection, and the Opening SHALL be unchanged

#### Scenario: The Opening is stable across Turns

- **WHEN** two Turns of a Conversation in one process carry the Opening under the same Budget
- **THEN** the Opening's text SHALL be byte for byte identical in both

#### Scenario: The Opening is accounted as its own part

- **WHEN** a system prompt carries the Opening
- **THEN** the Accounting for each Call of that Turn SHALL attribute it to its own part, identified as Turn 0, with its size, its Budget and `placement: system-prompt`

## MODIFIED Requirements

### Requirement: Packs carry the prompt and an unsplit verbatim tail

A Context Pack SHALL contain the Turn's prompt and a verbatim tail of at most N completed Turns, where N is configurable. The tail runs from its start, as "The verbatim tail evicts to a low-water mark" sets it, to the newest completed Turn. Turns in the verbatim tail SHALL retain their original content, including tool calls and their results, except where the newest Turn is shrunk to fit as "The newest tail Turn shrinks by its oldest actions" states.

The tail's start SHALL be derived from the Thread Store's Turn sizes. Its content SHALL be the matching slice of the history the harness itself sends, taken Turn by Turn. A Turn the harness's history still holds SHALL be carried as those messages, unchanged. A Turn the harness's history no longer holds, because an overflow or manual compaction cut it out, SHALL be carried as the Thread Store's copy, so the tail does not depend on the harness still holding that history. The Accounting for each Call SHALL record where the tail came from. The source is `harness` when every tail Turn came from the harness's history, `thread-store` when at least one Turn is a Store copy, and `harness-fallback` when the Store's Turn sizes were unavailable.

A Turn the tail carries without shortening SHALL reach the model exactly as it did while it was the Turn in progress, so the Call that first carries it in the tail reads it back from cache instead of writing it again. The tail SHALL keep its Turns in order and SHALL NOT be split.

A tool call whose result is absent SHALL NOT be reproduced in the verbatim tail. The tail SHALL carry a call together with its result or carry neither, so that a Pack is never a Context Window the model's provider refuses. Withholding an unanswered call SHALL NOT remove any other content of the Turn it belongs to. It SHALL leave a Turn whose calls are all answered exactly as it would otherwise have been.

#### Scenario: Recent turns are reproduced exactly

- **WHEN** a Context Pack is built with a verbatim tail of N Turns that fit its Budget
- **THEN** the pack SHALL contain those Turns' content unaltered and unsummarized

#### Scenario: Tail length is configurable

- **WHEN** N is changed
- **THEN** subsequent packs SHALL carry no more than that many Turns in the verbatim tail

#### Scenario: A tool result remains actionable

- **WHEN** a Turn in the verbatim tail contains a tool call and its result
- **THEN** both SHALL appear in the pack in a form the model can act on

#### Scenario: A finished turn reads back as it was sent

- **WHEN** a Turn completes and the next Turn's first Call carries it, unshortened, in the verbatim tail
- **THEN** that Turn's messages SHALL be the messages the harness's history holds for it, and SHALL serialise to the model identically to how they did as the Turn in progress, including the key order of every tool call's arguments

#### Scenario: The tail is the harness's own messages

- **WHEN** every Turn in the verbatim tail is still held by the harness's history
- **THEN** the tail SHALL carry those messages, no Turn SHALL be a Thread Store copy, and the tail's source SHALL be recorded as `harness`

#### Scenario: A compacted-away turn comes from the store

- **WHEN** an overflow or manual compaction has cut a Turn that the verbatim tail carries out of the harness's history
- **THEN** the tail SHALL carry the Thread Store's copy of that Turn in its place, SHALL carry every other Turn from the harness's history, and the tail's source SHALL be recorded as `thread-store`

#### Scenario: Unavailable sizes fall back to the harness

- **WHEN** the Thread Store's Turn sizes are unavailable for a Call
- **THEN** the tail SHALL be taken from the history the harness provides, and the tail's source SHALL be recorded as `harness-fallback`

#### Scenario: The tail outlives the conversation being cleared

- **WHEN** the harness's own conversation is cleared and a new prompt is sent within the same Conversation
- **THEN** the verbatim tail SHALL still carry the Turns that preceded the clear, from the Thread Store's copies

#### Scenario: An unanswered tool call is not replayed

- **WHEN** a Turn in the verbatim tail contains a tool call whose result was never recorded
- **THEN** the Pack SHALL NOT carry that call

#### Scenario: The rest of an interrupted turn survives

- **WHEN** a Turn whose last tool call went unanswered is carried in the verbatim tail
- **THEN** that Turn's prompt, its assistant text, and its answered tool calls with their results SHALL still appear

#### Scenario: A turn with every call answered is untouched

- **WHEN** every tool call in the verbatim tail has its result
- **THEN** the tail SHALL be exactly what it would have been without this rule

### Requirement: Assembly is deterministic

Given the same inputs and configuration, the system SHALL produce an identical Context Pack, including pi-chart's system-prompt block. Assembly SHALL NOT consult a model to decide what a pack contains. It SHALL NOT depend on wall-clock time, randomness, or iteration order. What the model pulls with a tool is not assembled: it is Turn content, and it enters later Packs as the Journal recorded it. The tools' own retrieval SHALL keep the same guarantee: the same Conversation, tail start and query SHALL select the same Turns in the same order.

#### Scenario: Repeated assembly produces an identical pack

- **WHEN** a Context Pack is assembled twice from the same inputs and configuration
- **THEN** the two packs SHALL be identical

#### Scenario: Configuration change is the only cause of difference

- **WHEN** two packs assembled from the same inputs differ
- **THEN** the difference SHALL be attributable to a configuration change

#### Scenario: Equally similar turns are ordered predictably

- **WHEN** `recall_earlier_turns` finds Turns of identical similarity
- **THEN** their order SHALL be stable across repeated calls with the same query

#### Scenario: The system-prompt block is reproducible

- **WHEN** pi-chart's system-prompt block is built twice from the same Pins, the same Opening text, the same tool registrations and the same configuration
- **THEN** the two blocks SHALL be byte for byte identical

### Requirement: Content too large to carry whole is elided visibly

When content has been shortened to fit a Budget, the Pack ceiling, or the cap on a tool result pi-chart returns, the shortened content SHALL be marked as incomplete and SHALL say what was removed. This applies to content a Context Pack carries and to content a pi-chart tool returns. Shortening SHALL NOT be silent. It SHALL NOT be applied by discarding the end of a message without a marker, so that the agent can tell shortened content from content that was always that short, and can ask for the remainder. Messages dropped from a Turn SHALL likewise be marked, by the marker on that Turn's prompt.

#### Scenario: A shortened tool result says so

- **WHEN** a tool result in the verbatim tail is too large for its Budget
- **THEN** the Pack SHALL carry it shortened, marked as shortened, and stating how much was removed

#### Scenario: A shortened recollection says so

- **WHEN** a Turn that `recall_earlier_turns` returns is larger than the per-result cap `PICHART_RECALL_TOKENS` sets
- **THEN** the tool result SHALL carry that Turn shortened and marked, rather than dropping the recollection or carrying it whole

#### Scenario: Dropped messages say so

- **WHEN** a tail Turn is carried with messages dropped
- **THEN** its prompt SHALL carry a marker stating how many messages went, which tools they ran, and the estimated tokens removed

#### Scenario: Content that fits is untouched

- **WHEN** content is within its Budget
- **THEN** it SHALL appear in the Pack unaltered and unmarked

### Requirement: A recollection carries the actions its turn took

A Turn that `recall_earlier_turns` returns SHALL be presented with the actions that Turn took, and not only the output those actions produced. An action is the name of a tool call and the arguments it was made with. A message carrying an action and no prose SHALL NOT be dropped from a recollection. Where a recollection must be shortened to fit the per-result cap, the actions SHALL be retained in preference to the output of those actions, because the output without the action is a result with no question attached.

#### Scenario: A recalled turn shows why it read something

- **WHEN** a Turn that `recall_earlier_turns` returns read files before reaching a conclusion
- **THEN** the result SHALL show what that Turn asked for, with the arguments it asked with, alongside what came back

#### Scenario: An action with no prose is not dropped

- **WHEN** a message in a recalled Turn carries a tool call and no text
- **THEN** the recollection SHALL still record that call

#### Scenario: An unanswered action is recorded as unanswered

- **WHEN** a recalled Turn contains a tool call whose result was never recorded
- **THEN** the recollection SHALL record that the call was made and that nothing came back

#### Scenario: Shortening a recollection keeps its actions

- **WHEN** a recollection is larger than the per-result cap it must fit
- **THEN** the actions it records SHALL survive and the output of those actions SHALL be what is shortened

#### Scenario: A recollection is still distinguishable from the current exchange

- **WHEN** a recollection carries actions and their results
- **THEN** it SHALL remain one attributed recollection, carrying its position in the Conversation, inside the `recall_earlier_turns` result, and SHALL NOT be a replayed exchange the model could mistake for the current one

### Requirement: A store that misses its deadline is treated as unavailable

Every Store call that a Call, the start of a Turn, or a pi-chart tool waits on SHALL have a deadline, configurable per Store. A Store that has not answered within its deadline SHALL be treated as unavailable, and the omission SHALL be reported. Where the Store serves a part of the Pack, the Pack SHALL be assembled without that part, and the Accounting for that Call SHALL show the part absent. Where it serves a tool, the tool SHALL return a result naming the Store and the missed deadline. A wait SHALL NOT run beyond its deadline, so the time a Turn spends assembling is bounded by configuration rather than by the slowest Store. A missed deadline SHALL be reported as such, distinguishably from a Store that refused the connection, because the two call for different remedies.

Where serving a part or a tool requires running a program, that program SHALL also be bounded. On passing its deadline it SHALL be stopped, whatever output it produced SHALL be kept, and the condition SHALL be reported. A program that never finishes SHALL NOT leave the failure unreported.

#### Scenario: A silent store costs its part, not the turn

- **WHEN** a Store serving a part of the Pack accepts the request and does not answer within its deadline
- **THEN** the Pack SHALL be assembled without that part and the Turn SHALL proceed

#### Scenario: A missed deadline is visible

- **WHEN** a Store serving a part of the Pack misses its deadline
- **THEN** the omission SHALL be reported as a missed deadline, and the Accounting for that Call SHALL show the part absent

#### Scenario: A slow store costs a tool only its result

- **WHEN** the Store a pi-chart tool reads does not answer within its deadline
- **THEN** the tool SHALL return a result that names the Store and says it missed its deadline, and the Turn SHALL proceed

#### Scenario: One slow store does not cost the others

- **WHEN** one Store misses its deadline during a Turn
- **THEN** the parts and tool results served by the other Stores SHALL still be carried

#### Scenario: The verbatim tail has its own deadline

- **WHEN** the Store serving the verbatim tail does not answer within its deadline
- **THEN** the tail SHALL fall back to the history the harness itself provides, and the fallback SHALL be recorded as it is for an unreachable Store

#### Scenario: A deadline nothing exceeds changes nothing

- **WHEN** every Store answers within its deadline
- **THEN** the Pack SHALL be exactly what it would have been without deadlines

#### Scenario: Deadlines are configurable per store

- **WHEN** a Store's deadline is changed
- **THEN** later waits on that Store SHALL be bounded by the new deadline, and the other Stores' deadlines SHALL be unchanged

#### Scenario: A program that hangs is stopped and reported

- **WHEN** a program run to serve a part or a tool has not finished by its deadline
- **THEN** it SHALL be stopped, the part or the tool's result SHALL be omitted, and the failure SHALL be reported with whatever output the program had produced

#### Scenario: Assembly time is bounded by the deadlines

- **WHEN** every Store consulted for a Call fails to answer
- **THEN** the Pack SHALL still be supplied, and the Call SHALL have waited no longer than the largest configured deadline

### Requirement: A harness compaction is carried as prose

When the harness has compacted a Conversation, the Context Pack SHALL carry the compaction's summary as text. It SHALL NOT carry the harness's provider-native form of the summary, whether the summary comes from the harness's live history or from a Thread Store copy.

A provider-native compaction stands in for the history it summarises, and the provider refuses it anywhere but the head of the conversation. After a compaction, a Pack carries the Thread Store's copies of tail Turns that the compaction cut from the harness's history, ahead of what the harness still holds. The native form is then misplaced, and the Call fails every time it is retried. The summary's text is kept because a compaction may have cut into the current Turn, and the text is then the only account of what that Turn did before the cut.

Only the compaction's own message SHALL be affected. A provider payload on any other message SHALL be carried untouched.

#### Scenario: A compacted conversation stays sendable

- **WHEN** the harness supplies a compaction summary that carries a provider-native payload
- **THEN** the Pack SHALL carry that summary without the payload, and the Call SHALL be one the provider accepts

#### Scenario: The summary still reaches the model

- **WHEN** a Pack carries a harness compaction
- **THEN** the compaction's summary text SHALL be in the Pack

#### Scenario: Store copies ahead of a summary stay sendable

- **WHEN** an overflow compaction has cut tail Turns from the harness's history, and the Pack carries their Thread Store copies ahead of the compaction summary
- **THEN** the summary SHALL be carried as text without its provider payload, and the Call SHALL be one the provider accepts

#### Scenario: Other provider payloads are untouched

- **WHEN** a message other than a compaction summary carries a provider payload
- **THEN** the Pack SHALL carry that message with its payload unchanged

### Requirement: The verbatim tail evicts to a low-water mark

The verbatim tail SHALL give up its oldest Turns only by Eviction. Between Evictions its start SHALL NOT move, and each newly completed Turn SHALL be added behind it. A newly completed Turn may carry the tail past its token Budget or past its count Budget. When it does, the tail SHALL drop its oldest Turns in one step until it is at or under the low-water mark of both Budgets. The mark is the configured share of the token Budget, and the same share of the count Budget, rounded down and never below one Turn. The Turn just completed SHALL NEVER be evicted. Where it alone exceeds the mark, it SHALL be the whole tail.

The low-water mark SHALL be configurable as a share greater than 0 and at most 1, defaulting to 0.6. A share of 1 SHALL make the tail drop only what it must to fit its Budgets.

The tail's start SHALL be a function of the Conversation's completed Turns and the configuration alone. It SHALL be derived on every Call by applying the rule above to each completed Turn in order, from the first Turn the Conversation holds to the newest. It SHALL NOT be stored. Each Turn's size for this purpose SHALL be measured on the Turn as the tail would carry it. It SHALL be the same on every Call for a Turn whose content has not changed.

A Turn the tail has evicted SHALL be searchable with `recall_earlier_turns`, as is any Turn before the tail's start. A Turn the tail carries SHALL NOT be returned by it. Reducing a Pack to its ceiling SHALL NOT move the tail's start on later Calls.

#### Scenario: The start holds between evictions

- **WHEN** a Turn completes and the tail with it stays within both Budgets
- **THEN** the next Call's tail SHALL start at the same Turn as the previous Call's, and SHALL carry the new Turn behind the Turns it already carried

#### Scenario: Eviction drops to the mark in one step

- **WHEN** under a 25,000-token tail Budget and the default mark, a Turn completes that carries the tail past 25,000 tokens
- **THEN** the tail SHALL drop its oldest Turns until it is at or under 15,000 tokens, and SHALL drop no Turn it did not need to reach that

#### Scenario: The count budget evicts to its mark

- **WHEN** under a count Budget of 8 and the default mark, a ninth Turn completes within the token Budget
- **THEN** the tail SHALL carry the newest 4 Turns

#### Scenario: A newest turn larger than the mark is kept alone

- **WHEN** a Turn completes that alone exceeds the token mark
- **THEN** the tail SHALL carry that Turn alone, shrunk as "The newest tail Turn shrinks by its oldest actions" states where it exceeds the token Budget

#### Scenario: A mark of one slides the tail

- **WHEN** the mark is 1
- **THEN** the tail SHALL carry the newest Turns that fit both Budgets, as many as fit

#### Scenario: The start is the same however it is reached

- **WHEN** the same Conversation is assembled in a fresh process with the same configuration
- **THEN** the tail SHALL start at the same Turn as it did in the process that answered the Conversation's Turns

#### Scenario: An evicted turn can be recalled

- **WHEN** the model calls `recall_earlier_turns` with a query that a Turn the tail has evicted matches
- **THEN** the result SHALL be able to include that Turn

#### Scenario: A turn in the tail is not recalled

- **WHEN** the model calls `recall_earlier_turns` with a query that a Turn the tail carries matches
- **THEN** the result SHALL NOT include that Turn

#### Scenario: The ceiling does not move the start

- **WHEN** one Call's Pack is reduced to its ceiling by dropping the tail's oldest Turns, and the next Call's Pack fits its ceiling
- **THEN** the next Call's tail SHALL start where it would have had the ceiling never bound

## REMOVED Requirements

### Requirement: Assembled parts follow the Turn in progress

**Reason**: No Briefing is sent (ADR-0015). It followed the cache breakpoint and changed on every Call, so it was billed as uncached input on every Call. The framing, the marker and the fence went with it.

**Migration**: The Pins and the Opening are carried in the system prompt ("Every pin rides the system prompt", "The Opening rides the system prompt from the first Turn"). Recalled Turns, curated knowledge and structure reach the model only as tool results ("Retrieved knowledge reaches the model only as a tool result").

### Requirement: Packs carry recalled turns under their own budget

**Reason**: Recall is no longer assembled into every Call. The model pulls it with `recall_earlier_turns` (ADR-0015). `PICHART_RECALL_TURNS` and the `/pack budget` key `recall` are removed.

**Migration**: `recall_earlier_turns` is specified by the Thread Store. Its results are Turn content ("Retrieved knowledge reaches the model only as a tool result"), and `PICHART_RECALL_TOKENS` caps each result.

### Requirement: Packs carry curated knowledge under its own budget

**Reason**: Concepts are no longer assembled into every Call. The model pulls them with `search_documentation` (ADR-0015). `PICHART_DOC_CONCEPTS`, `PICHART_DOC_MAX_DISTANCE` and the `/pack budget` key `docs` are removed.

**Migration**: `search_documentation` is specified by the Doc Store, including attribution, fragment marking and exclusions. `PICHART_DOC_TOKENS` caps each Concept it returns.

### Requirement: Packs carry the structure around the symbols in play

**Reason**: Structure is no longer assembled into every Call from symbols matched in the Turn. The model asks for it by name with `codebase_structure` (ADR-0015). `PICHART_GRAPH_SYMBOLS` and the `/pack budget` key `graph` are removed.

**Migration**: `codebase_structure` is specified by the Graph Store, including positions, truncation disclosure and depth. `PICHART_GRAPH_TOKENS` caps its whole result.

### Requirement: A pack declares structure older than the Codebase

**Reason**: Structure no longer enters a Context Pack, so a Pack has no structure to mark.

**Migration**: The Graph Store's "Structure older than the Codebase is disclosed in every result" requires the disclosure inside every `codebase_structure` result.

### Requirement: Every pin leads the Briefing

**Reason**: The Briefing is deleted (ADR-0015). Pins are appended to the system prompt instead.

**Migration**: See "Every pin rides the system prompt". A Pin changed during a Turn now takes effect from the next Turn.

### Requirement: Every Briefing stays where it was sent

**Reason**: No Briefing is sent, so there is nothing to send again (ADR-0015).

**Migration**: None. Within a Turn, the system-prompt block is stable by construction ("Every Call of a Turn sends the same system-prompt additions").

### Requirement: A Briefing is stored as it was sent

**Reason**: No Briefing is sent, so none is stored (ADR-0015). No `pi-chart.briefing` entry is written.

**Migration**: None. Existing `pi-chart.briefing` entries stay in the Journal and are not read.

### Requirement: Briefings follow a Conversation into its forks

**Reason**: No Briefing is stored, so a fork has none to copy (ADR-0015).

**Migration**: None. A fork's Pins reach its system prompt through the Pins it inherits.

### Requirement: A model without turn-scoped system messages gets one Briefing

**Reason**: The user-message fallback is deleted (ADR-0015). Every model gets the same assembly path, because Pins and the Opening ride the system prompt, which every model has.

**Migration**: None. Where the harness does not offer the system prompt, see "System-prompt additions are absent when the harness does not offer the system prompt".

### Requirement: Budgets bound each part of a pack

**Reason**: Recalled Turns, curated knowledge and structure are no longer parts of a Pack (ADR-0015), so the recall Budget and its trimming rules go. What has a Budget is now only the verbatim tail, the Opening and the Pins.

**Migration**: See "Budgets bound the tail, the Opening and the Pins". The caps on tool results are specified with each tool.

### Requirement: A pack fits a ceiling the assembler enforces

**Reason**: The Ceiling no longer reduces structure, curated knowledge, recalled Turns or the Opening (ADR-0015). It reduces only the verbatim tail, then the current Turn, and the system-prompt block counts toward it without being reduced.

**Migration**: See "A pack fits a ceiling by reducing only the tail and the current Turn". The Opening is never shortened or dropped for the Ceiling.

### Requirement: Packs carry the Conversation's Opening

**Reason**: The Opening moves from the Briefing to the system prompt, and it is carried from the first Turn rather than only once the tail has evicted Turn 0 (ADR-0015). It is no longer reference data behind a marker, and the Ceiling no longer reduces it.

**Migration**: See "The Opening rides the system prompt from the first Turn". Its Budget, its Elision and the rule that it is always the Turn at index 0 are unchanged.
