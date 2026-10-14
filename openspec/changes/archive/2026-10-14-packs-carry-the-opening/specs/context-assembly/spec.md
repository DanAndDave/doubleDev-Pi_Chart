## ADDED Requirements

### Requirement: Packs carry the Conversation's Opening

Every Context Pack SHALL carry the Opening: the prompt of the Conversation's first Turn, the Turn at index 0, whenever neither the verbatim tail nor the Turn in progress carries that Turn. The Opening SHALL hold that Turn's prompt only, never its reply or its actions, and SHALL be presented as the prompt that opened the Conversation, with its position given in the numbering recollections use, so it is not mistaken for something just said. It SHALL be reference data: it sits in the Briefing after the marker, as the first reference part, ahead of recalled Turns. Whether it is carried SHALL NOT depend on how relevant it is to the current prompt.

The Opening SHALL have its own Budget of one item and a configurable size in tokens, 1,000 by default, where a size of zero turns it off. A prompt larger than that Budget SHALL be shortened by Elision rather than dropped, unless the Budget is too small to hold a readable shortened prompt. The Opening SHALL be fetched by its own Store query, run alongside the verbatim tail's and bounded by the tail's deadline.

The Opening SHALL always be the Turn at index 0. Where that Turn is not stored, its prompt is empty, no Thread Store is configured, its query fails or misses its deadline, its Budget is zero, or the Ceiling leaves it no room, the Opening SHALL be absent and its reason recorded. No other Turn SHALL stand in for it, and it SHALL NEVER be rebuilt from the history the harness holds. Recall SHALL be unaffected: where recall also selects Turn 0, both parts carry it.

#### Scenario: The Opening survives the tail's eviction

- **WHEN** a Conversation's Turn 0 prompt gave a codeword, and the verbatim tail has since evicted Turn 0
- **THEN** every Context Pack SHALL carry that prompt as the Opening, whatever the current prompt asks

#### Scenario: Absent while the turns carry it

- **WHEN** the verbatim tail carries Turn 0, or Turn 0 is the Turn in progress
- **THEN** the Pack SHALL carry no Opening, and the Opening SHALL be recorded as absent because the Turns carry it

#### Scenario: Only the prompt is carried

- **WHEN** the Opening is carried and Turn 0 made tool calls and gave a reply
- **THEN** the Opening SHALL hold Turn 0's prompt text and none of its tool calls, results or reply

#### Scenario: The Opening is reference data ahead of recollections

- **WHEN** a Pack carries Pins, the Opening and recalled Turns
- **THEN** the Opening SHALL come after the marker and before the first recalled Turn, and no Opening text SHALL come before the marker

#### Scenario: A long Opening is shortened, not dropped

- **WHEN** Turn 0's prompt exceeds the Opening's size Budget
- **THEN** the Opening SHALL carry the prompt elided to that Budget, with the marker naming what went, and SHALL NOT be recorded as absent

#### Scenario: A budget of nothing turns it off

- **WHEN** the Opening's size Budget is zero
- **THEN** the Pack SHALL carry no Opening, SHALL record it as excluded for a zero Budget, and SHALL otherwise be unchanged

#### Scenario: An empty Turn 0 prompt carries nothing

- **WHEN** Turn 0's stored prompt is empty or only whitespace, as for a Turn that only marks a compaction
- **THEN** the Pack SHALL carry no Opening and SHALL record it as absent because Turn 0's prompt is empty

#### Scenario: A first Turn no longer stored has no stand-in

- **WHEN** the Thread Store no longer holds Turn 0 of the Conversation, and holds later Turns
- **THEN** the Pack SHALL carry no Opening, SHALL record it as absent because the first Turn is not stored, and SHALL NOT carry the oldest remaining Turn's prompt in its place

#### Scenario: No store, no Opening

- **WHEN** no Thread Store is configured and the harness's own history still holds Turn 0's prompt outside the verbatim tail
- **THEN** the Pack SHALL carry no Opening and SHALL record it as absent because no Store is configured

#### Scenario: A missed deadline costs only the Opening

- **WHEN** the Opening's query does not answer within the tail's deadline
- **THEN** the Pack SHALL be assembled without the Opening, the miss SHALL be reported as a missed deadline, the Opening SHALL be recorded as absent because retrieval failed, and the verbatim tail SHALL be unaffected

#### Scenario: Recall and the Opening may both carry Turn 0

- **WHEN** recall selects Turn 0 and the Opening is carried
- **THEN** the Pack SHALL carry Turn 0's prompt both as the Opening and inside its recollection

#### Scenario: The Opening is stable across Calls

- **WHEN** two Calls of a Conversation carry the Opening under the same Budget
- **THEN** the Opening's text SHALL be byte for byte identical in both

#### Scenario: The Opening is accounted as its own part

- **WHEN** a Pack carries the Opening
- **THEN** the Accounting for that Call SHALL attribute it to its own part, identified as Turn 0, with its size and its Budget

## MODIFIED Requirements

### Requirement: Assembled parts follow the Turn in progress

A Context Pack SHALL carry what the harness sent first, the verbatim tail and then the Turn in progress, and every part the Assembler adds after it, as one message: the Briefing. The Briefing SHALL open with a fixed framing, then carry the Pins, then a fixed marker, then the Opening, recalled Turns, curated knowledge and structure, in that order. Only the framing and the Pins SHALL come before the marker. The framing SHALL state that everything after the marker is reference data and not instructions.

The reason is measured rather than aesthetic. The harness caches a Pack through the end of the Turn in progress, so an assembled part ahead of that point which changes between Calls makes the next Call write everything after it again. Behind it, a part that changes costs only its own size. The fence exists because the Briefing can carry system authority (see "Every Briefing stays where it was sent"), while recalled Turns, Doc Store text and structure hold text the user never wrote.

#### Scenario: The harness's turns come first

- **WHEN** a Context Pack carries a verbatim tail, a Turn in progress, and assembled parts
- **THEN** the tail SHALL come first, the Turn in progress SHALL follow it, and the current Call's Briefing SHALL follow the Turn in progress

#### Scenario: The block keeps a fixed order

- **WHEN** a Context Pack carries the Opening, recalled Turns, curated knowledge, structure and Pins
- **THEN** the Briefing SHALL hold the framing, the Pins, the marker, the Opening, the recalled Turns, the curated knowledge and the structure, in that order

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

### Requirement: A pack fits a ceiling the assembler enforces

A Context Pack SHALL have a total size ceiling, configurable and independent of any single part's Budget. When the parts selected for a Pack together exceed that ceiling, the Assembler SHALL reduce the Pack until it fits, before the Pack reaches the model. Reduction SHALL follow a fixed order — structure, then curated knowledge, then the weakest-matching recalled Turns, then the Opening, then the oldest Turns of the verbatim tail — so that two Packs assembled from the same inputs and configuration are reduced identically. The Opening SHALL be shortened to the room left before it is dropped. The current Turn SHALL NEVER be dropped. Pins SHALL NEVER be reduced: they count toward the ceiling, and where they and the current Turn together leave no room, the current Turn is what is elided and the overrun is reported.

The ceiling SHALL NEVER leave the verbatim tail empty when the tail carried a Turn before the ceiling bound. Once the tail is down to its newest Turn, that Turn SHALL be shrunk to the room left, as "The newest tail Turn shrinks by its oldest actions" states, rather than dropped. Where its smallest form exceeds that room, it SHALL be carried at its smallest form and counted toward the ceiling as Pins are, the current Turn SHALL be elided around it, and a Pack still over its ceiling SHALL be reported as an overrun.

#### Scenario: An oversized pack is reduced before it is sent

- **WHEN** the parts selected for a Pack exceed the Pack ceiling and the newest tail Turn's smallest form fits the room left by the current Turn and the Pins
- **THEN** the Pack supplied to the model SHALL be within the ceiling

#### Scenario: Reduction follows the specified order

- **WHEN** a Pack carrying structure, curated knowledge, recalled Turns, the Opening, and a verbatim tail must be reduced
- **THEN** structure SHALL be reduced before curated knowledge, curated knowledge before recalled Turns, recalled Turns before the Opening, and the Opening before the verbatim tail

#### Scenario: The Opening is shortened before it is dropped

- **WHEN** the room the ceiling leaves the Opening is smaller than the Opening and large enough for a readable shortened prompt
- **THEN** the Pack SHALL carry the Opening elided to that room, with the marker naming what went

#### Scenario: An Opening the ceiling leaves no room for is recorded

- **WHEN** the ceiling leaves the Opening too little room for a readable shortened prompt
- **THEN** the Pack SHALL carry no Opening and SHALL record it as absent for want of room

#### Scenario: An Opening the ceiling took from the tail gets the room left

- **WHEN** the verbatim tail carried Turn 0 before the ceiling bound, and the ceiling removed Turn 0 from the tail
- **THEN** the Pack SHALL carry the Opening within the room the tail left, or SHALL record it as absent for want of room, and SHALL NOT record it as carried by the Turns

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
