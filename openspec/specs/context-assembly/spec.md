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

Because the harness injects recalled content into the Floor rather than into the message array, the Assembler cannot remove it: the Floor is by definition the part of a Context Window the Assembler does not supply. The invariant is therefore enforced by detection and disclosure rather than by filtering. The system SHALL check the backend's state when a Conversation starts, SHALL report it when the backend is anything other than off, and SHALL treat a backend that cannot be interrogated as unconfirmed rather than as off. The state SHALL be recorded for each Call, so that the condition outlives the report and a Conversation run with two injectors is diagnosable afterwards rather than only suspected.

A Context Pack SHALL NOT be withheld on account of an active backend: refusing to assemble would hand the Conversation the accumulating Context Window this system exists to replace, which is a worse outcome than a diagnosable one.

#### Scenario: No competing injection

- **WHEN** a Conversation runs with the system active
- **THEN** no content originating from the harness's memory backend SHALL appear in any Context Pack

#### Scenario: An active backend is reported

- **WHEN** a Conversation starts and the harness reports its memory backend as active
- **THEN** the condition SHALL be reported, naming the backend and the setting that disables it

#### Scenario: A backend that cannot be interrogated is unconfirmed

- **WHEN** the harness does not report its memory backend
- **THEN** the system SHALL report that the invariant could not be confirmed, and SHALL NOT treat the backend as off or as active

#### Scenario: A contaminated conversation is diagnosable afterwards

- **WHEN** a Call is made while the backend is active or unconfirmed
- **THEN** that state SHALL be recorded against the Call, so the Conversation's Accounting shows which Calls were exposed

#### Scenario: An active backend does not cost the turn

- **WHEN** a Turn is taken while the backend is active
- **THEN** the Context Pack SHALL still be assembled and supplied, and the Turn SHALL complete

#### Scenario: A confirmed-off backend is silent

- **WHEN** the harness reports its memory backend as off
- **THEN** nothing SHALL be reported and the recorded state SHALL say the backend was off

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

A Context Pack SHALL be able to carry Concepts from the Doc Store, as a part distinct from the verbatim tail and from recalled Turns, bounded by its own Budget. A carried Concept SHALL be attributed to the Doc Store and identified, so the agent can tell curated knowledge from something it was just told. Where what is carried is one part of a Concept rather than the whole of it, the pack SHALL identify the part carried and the Concept it belongs to, and SHALL say that the Concept holds more — a fragment presented under the Concept's name reads as the Concept's complete answer, which is the one thing curated knowledge must not do. What a Concept records that it is not SHALL be carried with it.

#### Scenario: A concept reaches the model

- **WHEN** the Doc Store holds a Concept relevant to the prompt
- **THEN** the Context Pack SHALL carry it as its own part

#### Scenario: Curated knowledge is attributed

- **WHEN** a Concept enters a pack
- **THEN** it SHALL carry its identifier and be distinguishable from the current exchange and from recalled Turns

#### Scenario: A fragment is not presented as the whole concept

- **WHEN** a pack carries one part of a Concept that has several
- **THEN** it SHALL identify the part carried, name the Concept it belongs to, and say the Concept holds more

#### Scenario: A concept carried whole is not marked as partial

- **WHEN** a pack carries all there is of a Concept
- **THEN** it SHALL NOT claim that more exists

#### Scenario: What a concept excludes travels into the pack

- **WHEN** a pack carries a Concept that records what it is not
- **THEN** those exclusions SHALL be carried with it

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

A Context Pack SHALL be able to carry the programmatic neighbourhood of the symbols the current Turn is working with, as a part distinct from the verbatim tail, recalled Turns, and Concepts, bounded by its own Budget. Each connection SHALL be carried with where it is in the Codebase, so the agent can act on it without reading a file.

The symbols in play SHALL be taken from the Turn rather than from its opening prompt alone, so that every Call of a Turn — including those made after tool results the prompt could not have named — can carry structure.

#### Scenario: Structure reaches the model

- **WHEN** a prompt names a symbol the Graph Store knows
- **THEN** the Context Pack SHALL carry that symbol's connections as its own part

#### Scenario: Structure reaches a call the prompt did not describe

- **WHEN** a Call is made later in a Turn whose prompt names no symbol, and the Turn has since worked with files the Graph Store knows
- **THEN** the Context Pack for that Call SHALL carry structure for those files' symbols

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

### Requirement: A pack declares structure older than the Codebase

Structure entering a Context Pack SHALL be marked as older than the Codebase when the extraction it came from precedes the current state of the file it describes, in the same way a Concept known to be stale is marked. The mark SHALL travel with the structure itself, so the agent reads it beside the positions it would otherwise act on. Structure whose age is current SHALL carry no mark, so the mark means something when it appears.

Age SHALL NOT be a reason to withhold structure: an out-of-date neighbourhood is a starting point, and the Pack SHALL carry it marked rather than drop it.

#### Scenario: Structure from before an edit is marked

- **WHEN** a pack carries the neighbourhood of a symbol whose file has been edited since the extraction
- **THEN** that structure SHALL be marked as older than the Codebase

#### Scenario: Current structure is unmarked

- **WHEN** a pack carries the neighbourhood of a symbol whose file has not changed since the extraction
- **THEN** that structure SHALL carry no such mark

#### Scenario: Marking is per symbol, not per pack

- **WHEN** one pack carries structure for an edited file and for an untouched one
- **THEN** only the edited file's structure SHALL be marked

#### Scenario: Older structure is still carried

- **WHEN** every symbol in play lives in a file edited since the extraction
- **THEN** the pack SHALL carry their structure, marked, rather than carry no structure
