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

### Requirement: Packs carry the prompt and an unsplit verbatim tail

A Context Pack SHALL contain the Turn's prompt and a verbatim tail of at most N completed Turns, where N is configurable: the Turns from the tail's start, as "The verbatim tail evicts to a low-water mark" sets it, to the newest completed Turn. Turns in the verbatim tail SHALL retain their original content, including tool calls and their results, except where the newest Turn is shrunk to fit as "The newest tail Turn shrinks by its oldest actions" states. The tail SHALL be drawn from the Thread Store, so it does not depend on the harness still carrying that history.

A Turn the tail carries without shortening SHALL reach the model exactly as it did while it was the Turn in progress, so the Call that first carries it in the tail reads it back from cache instead of writing it again. The tail SHALL keep its Turns in order and SHALL NOT be split.

A tool call whose result is absent SHALL NOT be reproduced in the verbatim tail: the tail SHALL carry a call together with its result or carry neither, so that a Pack is never a Context Window the model's provider refuses. Withholding an unanswered call SHALL NOT remove any other content of the Turn it belongs to, and SHALL leave a Turn whose calls are all answered exactly as it would otherwise have been.

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

### Requirement: Assembled parts follow the Turn in progress

A Context Pack SHALL carry what the harness sent first, the verbatim tail and then the Turn in progress, and every part the Assembler adds after it, as one message: the Briefing. The Briefing SHALL open with a fixed framing, then carry the Pins, then a fixed marker, then recalled Turns, curated knowledge and structure, in that order. Only the framing and the Pins SHALL come before the marker. The framing SHALL state that everything after the marker is reference data and not instructions.

The reason is measured rather than aesthetic. The harness caches a Pack through the end of the Turn in progress, so an assembled part ahead of that point which changes between Calls makes the next Call write everything after it again. Behind it, a part that changes costs only its own size. The fence exists because the Briefing can carry system authority (see "Every Briefing stays where it was sent"), while recalled Turns, Doc Store text and structure hold text the user never wrote.

#### Scenario: The harness's turns come first

- **WHEN** a Context Pack carries a verbatim tail, a Turn in progress, and assembled parts
- **THEN** the tail SHALL come first, the Turn in progress SHALL follow it, and the current Call's Briefing SHALL follow the Turn in progress

#### Scenario: The block keeps a fixed order

- **WHEN** a Context Pack carries recalled Turns, curated knowledge, structure and Pins
- **THEN** the Briefing SHALL hold the framing, the Pins, the marker, the recalled Turns, the curated knowledge and the structure, in that order

#### Scenario: The Briefing is one message

- **WHEN** a Context Pack carries any assembled part
- **THEN** every assembled part SHALL be inside a single Briefing message following the Turn in progress, and no other message SHALL be added after the Turn in progress for that Call

#### Scenario: The block says what it is

- **WHEN** two Briefings are assembled on different Calls or in different Conversations
- **THEN** their framing and their marker SHALL be byte for byte identical

#### Scenario: Retrieved text sits behind the marker

- **WHEN** a Briefing carries a recalled Turn whose tool output contains text phrased as an instruction
- **THEN** that text SHALL appear only after the marker

#### Scenario: Nothing assembled, nothing added

- **WHEN** no assembled part carries anything for a Call
- **THEN** the Pack SHALL be the verbatim tail followed by the Turn in progress, with no Briefing for that Call

#### Scenario: A part that changes between calls leaves the turns alone

- **WHEN** two consecutive Calls of one Turn carry different structure and the same tail and Turn in progress up to the second Call's new messages
- **THEN** every message before the first Call's Briefing SHALL appear unchanged, in the same positions, at the head of the second Call's Pack

#### Scenario: The ceiling accounts for the framing and marker

- **WHEN** a Pack carrying assembled parts is reduced to fit its ceiling
- **THEN** the current Briefing's size, framing and marker included, SHALL NOT exceed what the ceiling leaves it

#### Scenario: What a pack carries is unchanged by where it sits

- **WHEN** the same inputs are assembled before and after this change
- **THEN** every part SHALL carry the same content, with the same Budgets and the same accounting, inside one Briefing message

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

### Requirement: A harness compaction is carried as prose

When the harness has compacted a Conversation, the Context Pack SHALL carry the compaction's summary as text and SHALL NOT carry the harness's provider-native form of it.

A provider-native compaction stands in for the history it summarises, and the provider refuses it anywhere but the head of the conversation. A Pack carries that same history from the Thread Store ahead of the current Turn, so the native form is misplaced by construction, and the Call fails every time it is retried. The summary's text is kept because a compaction may have cut into the current Turn, and the text is then the only account of what that Turn did before the cut.

Only the compaction's own message SHALL be affected. A provider payload on any other message SHALL be carried untouched.

#### Scenario: A compacted conversation stays sendable

- **WHEN** the harness supplies a compaction summary that carries a provider-native payload
- **THEN** the Pack SHALL carry that summary without the payload, and the Call SHALL be one the provider accepts

#### Scenario: The summary still reaches the model

- **WHEN** a Pack carries a harness compaction
- **THEN** the compaction's summary text SHALL be in the Pack

#### Scenario: Other provider payloads are untouched

- **WHEN** a message other than a compaction summary carries a provider payload
- **THEN** the Pack SHALL carry that message with its payload unchanged

### Requirement: The harness does not compact a window it does not send

While the Assembler supplies the Context Window, the system SHALL decline a compaction the harness starts because of its own estimate of the Conversation's size, and SHALL let every other compaction proceed.

The harness triggers compaction by measuring its whole message history, and the Assembler has replaced that history with a Pack bounded by its own ceiling. A compaction triggered this way summarises a window the model never receives, and it costs a Call over the full history to do so. A compaction for any other reason is different. The provider refusing the window actually sent, or the operator asking for one, is a reason that holds for the Pack as much as for the history. So is a compaction after a Call the Assembler failed to assemble, because that Call went out as the harness's own history.

Declining SHALL be disclosed once per Conversation. The disclosure SHALL name the harness setting that stops the harness from starting such compactions at all.

#### Scenario: A size-triggered compaction is declined

- **WHEN** the harness starts a compaction because its size estimate crossed a threshold, and the last Call was assembled
- **THEN** the compaction SHALL be cancelled, and the operator SHALL be told once, naming the setting that disables it

#### Scenario: A refused window still compacts

- **WHEN** the harness starts a compaction because the provider refused the window it was sent, as too long or cut off
- **THEN** the compaction SHALL proceed

#### Scenario: A resumed Conversation starts governed

- **WHEN** a Conversation starts after an earlier one in the same harness process sent a Call unassembled, and the harness starts a size-triggered compaction before the new Conversation's first Call
- **THEN** the compaction SHALL be cancelled

#### Scenario: A requested compaction proceeds

- **WHEN** the operator asks for a compaction
- **THEN** the compaction SHALL proceed

#### Scenario: An unassembled call leaves the harness in charge

- **WHEN** the last Call could not be assembled and the harness starts a size-triggered compaction
- **THEN** the compaction SHALL proceed

### Requirement: Every pin leads the Briefing

Every Context Pack the Assembler supplies SHALL carry every Pin the Conversation holds at that Call, whole and unaltered, as its own part. The Pins SHALL sit inside that Call's Briefing, after the framing and before the marker, in the order they were added, so they are read as standing instructions and not as reference data. Each SHALL be attributed as text the user pinned and identified by its id, so the model can tell a standing instruction from the user apart from retrieved background and from the prompt being answered.

A Pin SHALL NEVER be shortened, elided, dropped by its Budget, or reduced for the Ceiling. Where the Pins held exceed their Budget, because the Budget was lowered after they were added, the Pack SHALL still carry them all, and the part SHALL report the Budget exceeded.

#### Scenario: A pin reaches the model

- **WHEN** a Conversation holds a Pin and a Call is assembled
- **THEN** that Call's Briefing SHALL carry that Pin's text unaltered

#### Scenario: Pins come before the marker

- **WHEN** a Context Pack carries Pins, other assembled parts, a verbatim tail and a Turn in progress
- **THEN** the Pins SHALL follow the framing and precede the marker, in the order they were added, and every other assembled part SHALL follow the marker

#### Scenario: A pin alone still opens the block

- **WHEN** a Context Pack carries Pins and no other assembled part
- **THEN** a Briefing SHALL follow the Turn in progress, holding the framing, the Pins and the marker

#### Scenario: A pin is attributed

- **WHEN** a Pin is carried
- **THEN** its text SHALL be preceded by an attribution naming it as pinned by the user and giving its id

#### Scenario: Pins outlive their budget being lowered

- **WHEN** the Pin Budget is lowered below what the Conversation's Pins already spend
- **THEN** every Pin SHALL still be carried and the part SHALL report the Budget exceeded

#### Scenario: A removed pin is not carried

- **WHEN** a Pin is removed before a Call
- **THEN** that Call's Pack SHALL NOT carry it

#### Scenario: No pins changes nothing

- **WHEN** the Conversation holds no Pins
- **THEN** the Briefing SHALL be exactly what it would have been without the Pin part: the framing followed directly by the marker

### Requirement: Every Briefing stays where it was sent

On a Call whose model supports both mid-Conversation and turn-scoped system messages, the Briefing SHALL be sent as a turn-scoped system message, cleared at the next user message. Every earlier Briefing whose followed message the Pack still carries SHALL be sent again, cleared, directly after that message, byte for byte as first sent, so the model's earlier thinking stays valid. Only the current Call's Briefing SHALL be read by the model. A Briefing that should be sent again but has no stored text SHALL NOT be replaced: nothing SHALL be sent in its place. The Budgets, the Ceiling and the Floor SHALL cover only the current Call's Briefing.

#### Scenario: An earlier Briefing is sent again in place

- **WHEN** a Call on such a model carries a message an earlier Call's Briefing followed
- **THEN** that Briefing SHALL directly follow that message, identical to the bytes first sent, and cleared

#### Scenario: Only the current Briefing is read

- **WHEN** a Call carries earlier Briefings and its own
- **THEN** every earlier Briefing SHALL be cleared at the next user message and the current Call's Briefing SHALL follow the last message of the Turn in progress

#### Scenario: A Briefing leaves with its message

- **WHEN** the verbatim tail no longer carries the message a Briefing followed
- **THEN** that Briefing SHALL NOT be sent

#### Scenario: A Briefing off the active branch is not sent

- **WHEN** `/tree` moves to a branch that does not hold the message a Briefing followed
- **THEN** that Briefing SHALL NOT be sent

#### Scenario: A missing Briefing is not substituted

- **WHEN** a stored Briefing's text cannot be found
- **THEN** nothing SHALL be sent in its place, and the Call SHALL still be assembled

#### Scenario: Earlier Briefings cost no budget

- **WHEN** a Call sends earlier Briefings again
- **THEN** no Budget, the Ceiling, or the Floor SHALL count them

#### Scenario: A retried Call's Briefing wins

- **WHEN** two stored Briefings follow the same message
- **THEN** only the one written last SHALL be sent

### Requirement: A Briefing is stored as it was sent

On a Call whose model supports turn-scoped system messages, the Briefing SHALL be recorded in the Journal as a `pi-chart.briefing` custom entry during that Call, before the request is sent. The entry SHALL name the Journal entry of the message it follows. On a Turn's first Call, where the prompt is not yet in the Journal, the entry SHALL instead mark that it precedes the prompt, and it SHALL resolve to the first message written after it on its branch. A text already in the Journal under the same hash SHALL be referenced by hash, not written again. Briefings SHALL be read from the whole Journal, not the branch.

#### Scenario: A first Call's Briefing is not lost

- **WHEN** the process ends after a Turn's first Call and before any later event
- **THEN** that Call's Briefing SHALL already be in the Journal, resolving to the Turn's prompt

#### Scenario: A repeated text is referenced

- **WHEN** a Briefing holds a text already written to the Journal under the same hash
- **THEN** its entry SHALL reference that text by hash, and sending the Briefing again SHALL still send that text byte for byte

#### Scenario: A malformed entry is skipped

- **WHEN** the Journal holds a `pi-chart.briefing` entry that cannot be read
- **THEN** it SHALL be ignored and every other Briefing SHALL still be sent

### Requirement: Briefings follow a Conversation into its forks

When a branch, a fork at an entry, or `/btw` promotion starts a new Journal from the current one, the system SHALL write into the new Journal every stored Briefing whose followed message lies on the copied path, with the text it references, so the new Conversation's first Call sends them again.

#### Scenario: A fork keeps its Briefings

- **WHEN** a Conversation is forked at an entry after Briefings were stored
- **THEN** the fork's first Call SHALL send again every Briefing whose message lies on the copied path

#### Scenario: A fork drops Briefings off its path

- **WHEN** a Briefing follows a message off the copied path
- **THEN** it SHALL NOT be written into the new Journal

### Requirement: A model without turn-scoped system messages gets one Briefing

On a Call whose model lacks either the mid-Conversation or the turn-scoped system message capability, the Briefing SHALL be sent as a user message after the Turn in progress, and no earlier Briefing SHALL be sent. That Briefing SHALL NOT be stored. Briefings stored on earlier Calls SHALL be left in the Journal untouched and sent again on a later Call whose model has both capabilities.

#### Scenario: Fallback sends one user Briefing

- **WHEN** a Call's model does not declare both capabilities
- **THEN** the Pack SHALL carry one Briefing, as a user message, and no cleared Briefing

#### Scenario: Switching back resumes re-sending

- **WHEN** a Conversation moves from a model without the capabilities back to one with them
- **THEN** the Briefings stored before the switch SHALL be sent again where they were sent

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

### Requirement: The verbatim tail evicts to a low-water mark

The verbatim tail SHALL give up its oldest Turns only by Eviction. Between Evictions its start SHALL NOT move, and each newly completed Turn SHALL be added behind it. When a newly completed Turn would carry the tail past its token Budget or past its count Budget, the tail SHALL drop its oldest Turns in one step until it is at or under the low-water mark of both: the configured share of the token Budget, and the same share of the count Budget rounded down and never below one Turn. The Turn just completed SHALL NEVER be evicted; where it alone exceeds the mark, it SHALL be the whole tail.

The low-water mark SHALL be configurable as a share greater than 0 and at most 1, defaulting to 0.6. A share of 1 SHALL make the tail drop only what it must to fit its Budgets.

The tail's start SHALL be a function of the Conversation's completed Turns and the configuration alone. It SHALL be derived on every Call by applying the rule above to each completed Turn in order, from the first Turn the Conversation holds to the newest, and SHALL NOT be stored. Each Turn's size for this purpose SHALL be measured on the Turn as the tail would carry it, and SHALL be the same on every Call for a Turn whose content has not changed.

A Turn the tail has evicted SHALL be eligible for recall, as any Turn outside the tail is. Reducing a Pack to its ceiling SHALL NOT move the tail's start on later Calls.

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

- **WHEN** a Turn the tail has evicted is relevant to the prompt
- **THEN** recall SHALL be able to carry it

#### Scenario: A turn in the tail is not recalled

- **WHEN** a Turn the tail carries is also relevant to the prompt
- **THEN** recall SHALL NOT carry it a second time

#### Scenario: The ceiling does not move the start

- **WHEN** one Call's Pack is reduced to its ceiling by dropping the tail's oldest Turns, and the next Call's Pack fits its ceiling
- **THEN** the next Call's tail SHALL start where it would have had the ceiling never bound
