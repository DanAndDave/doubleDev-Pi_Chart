## ADDED Requirements

### Requirement: The newest tail Turn shrinks by its oldest actions

When the newest Turn of the verbatim tail does not fit the room it is given, whether its token Budget or what the Pack ceiling leaves it, after its tool results and tool-call arguments have been elided, the Assembler SHALL drop that Turn's oldest tool-call groups until it fits. A tool-call group is one assistant message together with the results of the tool calls it made, and SHALL be dropped whole, so that every carried tool call keeps its result and every carried result keeps its call. Any group MAY be dropped, the newest included. The Turn's prompt and its final reply SHALL NEVER be dropped.

Where groups were dropped, one marker SHALL be appended to the text of the Turn's prompt, stating how many messages were not carried, a count per tool in the order the tools were first used, and the estimated tokens dropped. The marker's length SHALL depend on how many different tools were dropped, not on how many calls were.

The Turn's smallest form is its prompt with the marker and its final reply. Where that form still does not fit, the final reply SHALL be elided first and the prompt only after it, and the marker SHALL survive both. A Turn that fits with its payloads elided SHALL drop no group, and a Turn that fits whole SHALL be neither elided nor shrunk.

This rule SHALL NOT apply to the current Turn.

#### Scenario: A long turn fits its budget

- **WHEN** the newest tail Turn holds many tool calls whose elided results together exceed the tail token Budget
- **THEN** the tail SHALL carry that Turn within the Budget, with its prompt, the marker and its final reply

#### Scenario: The oldest actions go first

- **WHEN** the newest tail Turn must drop some but not all of its tool-call groups
- **THEN** the groups dropped SHALL be the oldest, and every group newer than the newest one dropped SHALL be carried

#### Scenario: No call is carried without its result

- **WHEN** the newest tail Turn has been shrunk
- **THEN** every tool call it carries SHALL have its result in the Pack, and every tool result it carries SHALL have its call

#### Scenario: The marker names what went

- **WHEN** the newest tail Turn dropped 140 `read` calls, 52 `bash` calls and 13 `edit` calls, with `read` used first and `edit` last
- **THEN** the Turn's prompt SHALL end with a marker giving the number of messages not carried, `read ×140, bash ×52, edit ×13` in that order, and the estimated tokens dropped

#### Scenario: Every group may go

- **WHEN** the newest tail Turn's prompt and final reply alone fill the room it is given
- **THEN** the Turn SHALL carry no tool-call group, and SHALL carry its prompt with the marker and its final reply

#### Scenario: The final reply is elided before the prompt

- **WHEN** the newest tail Turn's smallest form exceeds the room it is given
- **THEN** its final reply SHALL be elided, marked, before its prompt is shortened, and the marker naming the dropped messages SHALL still be carried

#### Scenario: A turn that fits by eliding drops nothing

- **WHEN** the newest tail Turn fits its room once its payloads are elided
- **THEN** no tool-call group SHALL be dropped and its prompt SHALL carry no marker

#### Scenario: The current turn is never shrunk by messages

- **WHEN** the current Turn exceeds the Pack ceiling
- **THEN** every message of the current Turn SHALL be carried, whatever Elision does to their content

#### Scenario: Shrinking is deterministic

- **WHEN** the same oversized Turn is assembled twice under the same configuration
- **THEN** the same groups SHALL be dropped and the same marker carried

## MODIFIED Requirements

### Requirement: Packs carry the prompt and an unsplit verbatim tail

A Context Pack SHALL contain the Turn's prompt and the most recent N Turns reproduced verbatim, where N is configurable. Turns in the verbatim tail SHALL retain their original content, including tool calls and their results, except where the newest Turn is shrunk to fit as "The newest tail Turn shrinks by its oldest actions" states. The tail SHALL be drawn from the Thread Store, so it does not depend on the harness still carrying that history.

A Turn the tail carries without shortening SHALL reach the model exactly as it did while it was the Turn in progress, so the Call that first carries it in the tail reads it back from cache instead of writing it again. The tail SHALL keep its Turns in order and SHALL NOT be split.

A tool call whose result is absent SHALL NOT be reproduced in the verbatim tail: the tail SHALL carry a call together with its result or carry neither, so that a Pack is never a Context Window the model's provider refuses. Withholding an unanswered call SHALL NOT remove any other content of the Turn it belongs to, and SHALL leave a Turn whose calls are all answered exactly as it would otherwise have been.

#### Scenario: Recent turns are reproduced exactly

- **WHEN** a Context Pack is built with a verbatim tail of N Turns that fit its Budget
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

### Requirement: Budgets bound each part of a pack

Each part of a Context Pack SHALL have a Budget, and SHALL be trimmed to fit it. A Budget SHALL be expressible as a count of items and as a size in tokens, and a part SHALL be trimmed to whichever of the two binds first. Trimming SHALL drop the weakest-matching recalled Turns first and SHALL NEVER drop the verbatim tail, the current prompt, or a Pin on account of a part's own Budget. When the verbatim tail's newest Turn alone exceeds the tail token Budget, the tail SHALL carry that Turn shrunk as "The newest tail Turn shrinks by its oldest actions" states, and SHALL carry no older Turn. The Pin Budget is enforced when a Pin is written, not when a Pack is assembled.

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

- **WHEN** a part must carry content that cannot be shortened below its token Budget — a tail Turn whose prompt with the marker and whose final reply, each already at the shortest length worth carrying, exceed the Budget
- **THEN** the part SHALL carry that content, SHALL report the token Budget it exceeded alongside what it spent, and SHALL NOT be reported as having fitted

#### Scenario: Pins are not trimmed at assembly

- **WHEN** the Conversation's Pins exceed the Pin Budget at assembly
- **THEN** the Pack SHALL carry every Pin and report the Budget exceeded

### Requirement: A pack fits a ceiling the assembler enforces

A Context Pack SHALL have a total size ceiling, configurable and independent of any single part's Budget. When the parts selected for a Pack together exceed that ceiling, the Assembler SHALL reduce the Pack until it fits, before the Pack reaches the model. Reduction SHALL follow a fixed order — structure, then curated knowledge, then the weakest-matching recalled Turns, then the oldest Turns of the verbatim tail — so that two Packs assembled from the same inputs and configuration are reduced identically. The current Turn SHALL NEVER be dropped. Pins SHALL NEVER be reduced: they count toward the ceiling, and where they and the current Turn together leave no room, the current Turn is what is elided and the overrun is reported.

The ceiling SHALL NEVER leave the verbatim tail empty when the tail carried a Turn before the ceiling bound. Once the tail is down to its newest Turn, that Turn SHALL be shrunk to the room left, as "The newest tail Turn shrinks by its oldest actions" states, rather than dropped. Where its smallest form exceeds that room, it SHALL be carried at its smallest form and counted toward the ceiling as Pins are, the current Turn SHALL be elided around it, and a Pack still over its ceiling SHALL be reported as an overrun.

#### Scenario: An oversized pack is reduced before it is sent

- **WHEN** the parts selected for a Pack exceed the Pack ceiling and the newest tail Turn's smallest form fits the room left by the current Turn and the Pins
- **THEN** the Pack supplied to the model SHALL be within the ceiling

#### Scenario: Reduction follows the specified order

- **WHEN** a Pack carrying structure, curated knowledge, recalled Turns, and a verbatim tail must be reduced
- **THEN** structure SHALL be reduced before curated knowledge, curated knowledge before recalled Turns, and recalled Turns before the verbatim tail

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

- **WHEN** the current Turn exceeds the Pack ceiling and holds nothing large enough to elide — many small messages rather than a few large ones
- **THEN** the Pack SHALL carry the current Turn whole, SHALL exceed its ceiling rather than lose the prompt, and the overrun SHALL be reported

#### Scenario: A ceiling that binds nothing changes nothing

- **WHEN** a Pack's parts together are within the ceiling
- **THEN** the Pack SHALL be exactly what it would have been without a ceiling

#### Scenario: Pins survive the ceiling

- **WHEN** a Pack carrying Pins must be reduced to fit the ceiling
- **THEN** every reducible part SHALL be reduced before any Pin is affected, and no Pin SHALL be removed or shortened

### Requirement: Content too large to carry whole is elided visibly

When a Context Pack carries content that has been shortened to fit a Budget or the Pack ceiling, the shortened content SHALL be marked as incomplete and SHALL say what was removed. Shortening SHALL NOT be silent, and SHALL NOT be applied by discarding the end of a message without a marker, so that the agent can tell shortened content from content that was always that short and can ask for the remainder. Messages dropped from a Turn SHALL likewise be marked, by the marker on that Turn's prompt.

#### Scenario: A shortened tool result says so

- **WHEN** a tool result in the verbatim tail is too large for its Budget
- **THEN** the Pack SHALL carry it shortened, marked as shortened, and stating how much was removed

#### Scenario: A shortened recollection says so

- **WHEN** a recalled Turn is too large for the recall Budget
- **THEN** the Pack SHALL carry it shortened and marked, rather than dropping the recollection or carrying it whole

#### Scenario: Dropped messages say so

- **WHEN** a tail Turn is carried with messages dropped
- **THEN** its prompt SHALL carry a marker stating how many messages went, which tools they ran, and the estimated tokens removed

#### Scenario: Content that fits is untouched

- **WHEN** content is within its Budget
- **THEN** it SHALL appear in the Pack unaltered and unmarked
