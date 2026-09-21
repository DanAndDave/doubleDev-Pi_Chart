# context-assembly Specification

## Purpose
Constructing the Context Window a coding agent receives for a single Turn, so that what the model sees is deliberately assembled for that Turn rather than inherited from everything that came before.

## Requirements

### Requirement: Assembled packs replace accumulated history

The system SHALL supply the model's message input for every Turn by constructing a Context Pack, and the model SHALL receive that pack instead of the accumulated conversation. Content that is not placed in the pack SHALL NOT reach the model, regardless of whether it occurred earlier in the Conversation.

#### Scenario: Content outside the pack is invisible to the model

- **WHEN** a Turn occurs whose Context Pack omits a fact stated earlier in the Conversation
- **THEN** the model's response SHALL show no knowledge of that fact

#### Scenario: The pack is what the model answers

- **WHEN** a Context Pack instructs the model differently from the accumulated conversation
- **THEN** the model SHALL respond to the pack's content

#### Scenario: Assembly applies to every Turn

- **WHEN** a Conversation runs for many Turns
- **THEN** each Turn's input SHALL be a newly constructed Context Pack, and the input size SHALL NOT grow as a function of the number of Turns elapsed

### Requirement: Packs carry the prompt and a verbatim tail

A Context Pack SHALL contain the Turn's prompt and the most recent N Turns reproduced verbatim, where N is configurable. Turns in the verbatim tail SHALL retain their original content, including tool calls and their results. The tail SHALL be drawn from the Thread Store, so it does not depend on the harness still carrying that history.

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

### Requirement: Assembly is deterministic

Given the same inputs and configuration, the system SHALL produce an identical Context Pack. Assembly SHALL NOT consult a model to decide what a pack contains, and SHALL NOT depend on wall-clock time, randomness, or iteration order. Retrieval SHALL be part of this guarantee: the same Conversation and prompt SHALL select the same Turns in the same order.

#### Scenario: Repeated assembly produces an identical pack

- **WHEN** a Context Pack is assembled twice from the same inputs and configuration
- **THEN** the two packs SHALL be identical

#### Scenario: Configuration change is the only cause of difference

- **WHEN** two packs assembled from the same inputs differ
- **THEN** the difference SHALL be attributable to a configuration change

#### Scenario: Equally similar turns are ordered predictably

- **WHEN** retrieval finds Turns of identical similarity
- **THEN** their order SHALL be stable across repeated assembly

### Requirement: Replacement never alters the durable record

Assembling and supplying a Context Pack SHALL NOT modify the Journal or the rendered transcript. The Journal SHALL record the Turn as it actually occurred, including prompt content that the Assembler withheld from the model.

#### Scenario: The journal keeps what the model never saw

- **WHEN** a Context Pack omits or rewrites the user's prompt
- **THEN** the Journal SHALL contain the user's original prompt and the response actually produced

#### Scenario: The user sees the conversation as it happened

- **WHEN** assembly replaces the model's input
- **THEN** the rendered transcript SHALL continue to display the real prompts and responses

### Requirement: Assembly is the only memory injection

The system SHALL operate with the harness's own memory backend disabled, so that no component other than the Assembler introduces recalled content into a Context Window.

#### Scenario: No competing injection

- **WHEN** a Conversation runs with the system active
- **THEN** no content originating from the harness's memory backend SHALL appear in any Context Pack

### Requirement: Assembly failure degrades safely

When assembly cannot complete, the system SHALL surface the failure and leave the Turn's input unmodified rather than sending a partial or empty Context Pack.

#### Scenario: A failed assembly does not truncate the conversation

- **WHEN** assembly raises an error while building a Context Pack
- **THEN** the Turn SHALL proceed with the unmodified input and the failure SHALL be reported

### Requirement: Packs carry recalled turns under their own budget

A Context Pack SHALL be able to carry Turns recalled by meaning, in addition to the verbatim tail. Recalled content SHALL occupy its own Budget, and SHALL be presented as a recollection with its position in the Conversation rather than as something just said.

#### Scenario: A decision outside the tail reaches the model

- **WHEN** a Conversation holds a relevant Turn far outside the verbatim tail
- **THEN** the Context Pack SHALL carry that Turn as a recalled part

#### Scenario: Recalled content is attributed, not disguised

- **WHEN** a recalled Turn enters a pack
- **THEN** it SHALL carry its position in the Conversation and be distinguishable from the current exchange

#### Scenario: Recall is accounted for separately

- **WHEN** a pack carries both a verbatim tail and recalled Turns
- **THEN** the accounting for that Call SHALL attribute each to its own part

### Requirement: Budgets bound each part of a pack

Each part of a Context Pack SHALL have a Budget, and SHALL be trimmed to fit it. A Budget SHALL be expressible as a count of items and as a size in tokens, and a part SHALL be trimmed to whichever of the two binds first. Trimming SHALL drop the weakest-matching recalled Turns first and SHALL NEVER drop the verbatim tail or the current prompt on account of a part's own Budget.

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

### Requirement: Packs carry curated knowledge under its own budget

A Context Pack SHALL be able to carry Concepts from the Doc Store, as a part distinct from the verbatim tail and from recalled Turns, bounded by its own Budget. A carried Concept SHALL be attributed to the Doc Store and identified, so the agent can tell curated knowledge from something it was just told.

#### Scenario: A concept reaches the model

- **WHEN** the Doc Store holds a Concept relevant to the prompt
- **THEN** the Context Pack SHALL carry it as its own part

#### Scenario: Curated knowledge is attributed

- **WHEN** a Concept enters a pack
- **THEN** it SHALL carry its identifier and be distinguishable from the current exchange and from recalled Turns

#### Scenario: The doc budget is independent of the others

- **WHEN** the Doc Store Budget is exhausted
- **THEN** the verbatim tail and recalled Turns SHALL be unaffected

#### Scenario: A doc budget of nothing disables the part

- **WHEN** the Doc Store Budget is zero
- **THEN** the pack SHALL carry no Concepts and SHALL otherwise be unchanged

#### Scenario: The pack is accounted for by part

- **WHEN** a pack carries Concepts alongside a tail and recalled Turns
- **THEN** the accounting for that Call SHALL attribute each to its own part

### Requirement: Packs carry the structure around the symbols in play

A Context Pack SHALL be able to carry the programmatic neighbourhood of the symbols a prompt refers to, as a part distinct from the verbatim tail, recalled Turns, and Concepts, bounded by its own Budget. Each connection SHALL be carried with where it is in the Codebase, so the agent can act on it without reading a file.

#### Scenario: Structure reaches the model

- **WHEN** a prompt names a symbol the Graph Store knows
- **THEN** the Context Pack SHALL carry that symbol's connections as its own part

#### Scenario: Connections say where they are

- **WHEN** a connection enters a pack
- **THEN** it SHALL carry the file and position of what it connects

#### Scenario: A symbol with more connections than a pack can hold

- **WHEN** a symbol has more connections than the pack carries
- **THEN** the pack SHALL say how many it left out rather than present what it carried as complete

#### Scenario: The structure budget is independent of the others

- **WHEN** the Graph Store Budget is exhausted
- **THEN** the verbatim tail, recalled Turns, and Concepts SHALL be unaffected

#### Scenario: A structure budget of nothing disables the part

- **WHEN** the Graph Store Budget is zero
- **THEN** the pack SHALL carry no structure and SHALL otherwise be unchanged

#### Scenario: The pack is accounted for by part

- **WHEN** a pack carries structure alongside its other parts
- **THEN** the accounting for that Call SHALL attribute it separately, naming the symbols it carried distinguishably from others of the same name

### Requirement: A pack fits a ceiling the assembler enforces

A Context Pack SHALL have a total size ceiling, configurable and independent of any single part's Budget. When the parts selected for a Pack together exceed that ceiling, the Assembler SHALL reduce the Pack until it fits, before the Pack reaches the model. Reduction SHALL follow a fixed order — structure, then curated knowledge, then the weakest-matching recalled Turns, then the oldest Turns of the verbatim tail — so that two Packs assembled from the same inputs and configuration are reduced identically. The current Turn SHALL NEVER be dropped.

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

### Requirement: Content too large to carry whole is elided visibly

When a Context Pack carries content that has been shortened to fit a Budget or the Pack ceiling, the shortened content SHALL be marked as incomplete and SHALL say what was removed. Shortening SHALL NOT be silent, and SHALL NOT be applied by discarding the end of a message without a marker, so that the agent can tell shortened content from content that was always that short and can ask for the remainder.

#### Scenario: A shortened tool result says so

- **WHEN** a tool result in the verbatim tail is too large for its Budget
- **THEN** the Pack SHALL carry it shortened, marked as shortened, and stating how much was removed

#### Scenario: A shortened recollection says so

- **WHEN** a recalled Turn is too large for the recall Budget
- **THEN** the Pack SHALL carry it shortened and marked, rather than dropping the recollection or carrying it whole

#### Scenario: Content that fits is untouched

- **WHEN** content is within its Budget
- **THEN** it SHALL appear in the Pack unaltered and unmarked

### Requirement: A recollection carries the actions its turn took

A recalled Turn SHALL be presented with the actions that Turn took — the name of each tool call and the arguments it was made with — and not only the output those actions produced. A message carrying an action and no prose SHALL NOT be dropped from a recollection. Where a recollection must be shortened to fit a Budget, the actions SHALL be retained in preference to the output of those actions, because the output without the action is a result with no question attached.

#### Scenario: A recalled turn shows why it read something

- **WHEN** a recalled Turn read files before reaching a conclusion
- **THEN** the Pack SHALL show what it asked for, with the arguments it asked with, alongside what came back

#### Scenario: An action with no prose is not dropped

- **WHEN** a message in a recalled Turn carries a tool call and no text
- **THEN** the recollection SHALL still record that call

#### Scenario: An unanswered action is recorded as unanswered

- **WHEN** a recalled Turn contains a tool call whose result was never recorded
- **THEN** the recollection SHALL record that the call was made and that nothing came back

#### Scenario: Shortening a recollection keeps its actions

- **WHEN** a recollection is larger than the Budget it must fit
- **THEN** the actions it records SHALL survive and the output of those actions SHALL be what is shortened

#### Scenario: A recollection is still distinguishable from the current exchange

- **WHEN** a recollection carries actions and their results
- **THEN** it SHALL remain one attributed recollection carrying its position in the Conversation, not a replayed exchange the model could mistake for the current one

### Requirement: A store that misses its deadline is treated as unavailable

Every Store call a Call waits on SHALL have a deadline, configurable per Store. A Store that has not answered within its deadline SHALL be treated as unavailable: the Context Pack SHALL be assembled without that Store's part, the omission SHALL be reported, and the Accounting for that Call SHALL show the part absent. A Call SHALL NOT wait on a Store beyond its deadline, so the time a Turn spends assembling is bounded by configuration rather than by the slowest Store. A missed deadline SHALL be reported as such, distinguishably from a Store that refused the connection, because the two call for different remedies.

Where serving a part requires running a program, that program SHALL also be bounded: on passing its deadline it SHALL be stopped, whatever output it produced SHALL be kept, and the condition SHALL be reported. A program that never finishes SHALL NOT leave the part's failure unreported.

#### Scenario: A silent store costs its part, not the turn

- **WHEN** a Store accepts the request and does not answer within its deadline
- **THEN** the Pack SHALL be assembled without that Store's part and the Turn SHALL proceed

#### Scenario: A missed deadline is visible

- **WHEN** a Store misses its deadline
- **THEN** the omission SHALL be reported as a missed deadline, and the Accounting for that Call SHALL show the part absent

#### Scenario: One slow store does not cost the others

- **WHEN** one of several Stores consulted for a Call misses its deadline
- **THEN** the parts served by the other Stores SHALL still be carried

#### Scenario: The verbatim tail has its own deadline

- **WHEN** the Store serving the verbatim tail does not answer within its deadline
- **THEN** the tail SHALL fall back to the history the harness itself provides, and the fallback SHALL be recorded as it is for an unreachable Store

#### Scenario: A deadline nothing exceeds changes nothing

- **WHEN** every Store answers within its deadline
- **THEN** the Pack SHALL be exactly what it would have been without deadlines

#### Scenario: Deadlines are configurable per store

- **WHEN** a Store's deadline is changed
- **THEN** subsequent Calls SHALL bound that Store by the new deadline and SHALL leave the other Stores' deadlines untouched

#### Scenario: A program that hangs is stopped and reported

- **WHEN** a program run to serve a part has not finished by its deadline
- **THEN** it SHALL be stopped, the part SHALL be omitted, and the failure SHALL be reported with whatever output the program had produced

#### Scenario: Assembly time is bounded by the deadlines

- **WHEN** every Store consulted for a Call fails to answer
- **THEN** the Pack SHALL still be supplied, and the Call SHALL have waited no longer than the largest configured deadline
