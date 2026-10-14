## MODIFIED Requirements

### Requirement: A call's pack can be examined

The system SHALL report, for a given Call, each part of its Context Pack, what that part contributed, its size, and its Budget. The parts pi-chart placed in the system prompt, `pinned` and `opening`, SHALL be marked `system prompt`, so they are not mistaken for messages. The Floor SHALL be reported alongside, so the share of the window the Assembler controls is visible rather than inferred; the Floor reported SHALL be the harness's system prompt, tool schemas, skills and rules without pi-chart's additions, which are reported as part of the pack.

Where the verbatim tail was not sent wholly from the harness's live history, the report SHALL say where it came from: that Store copies stood in for Turns the live history no longer held, or that the Store's Turn sizes were unavailable and the tail fell back to the harness's history alone. A tail sent wholly from live history SHALL add no such line.

#### Scenario: A pack is itemised by part

- **WHEN** a Call whose pack carried Pins, the Opening and a verbatim tail is examined
- **THEN** each part SHALL be listed separately with its size and its Budget
- **AND** the `pinned` and `opening` parts SHALL be marked `system prompt` and the tail SHALL NOT

#### Scenario: The floor is shown beside the pack

- **WHEN** a Call with reported window sizes is examined
- **THEN** the Floor and the pack size SHALL both be reported, with the Floor's share of the window
- **AND** the Floor SHALL NOT include the size of pi-chart's additions to the system prompt

#### Scenario: A part names what it contributed

- **WHEN** a pack's verbatim tail carried completed Turns
- **THEN** the report SHALL identify which Turns the tail carried

#### Scenario: A tail that used store copies says so

- **WHEN** a Call is examined whose verbatim tail sent a Store copy of at least one Turn the harness's live history no longer held
- **THEN** the report SHALL say the tail used Store copies

#### Scenario: A tail sent without store sizes says so

- **WHEN** a Call is examined whose tail start could not be replayed because the Store's Turn sizes were unavailable
- **THEN** the report SHALL say the tail fell back to the harness's own history

#### Scenario: A tail sent from live history adds no line

- **WHEN** a Call is examined whose every tail Turn came from the harness's live history
- **THEN** the report SHALL carry no tail-source line

#### Scenario: An unmeasured call is reported as such

- **WHEN** a Call has no reported window size yet
- **THEN** it SHALL be reported without invented figures


### Requirement: Budgets can be changed within a session

The system SHALL allow a Budget to be changed while a session is running without restarting. A change SHALL apply from the next Call, except a change to the Budget of a part placed in the system prompt, which SHALL apply from the next Turn, because the system prompt is fixed when a Turn starts. The Pin Budget, in count and in tokens, SHALL be changeable the same way; lowering it SHALL NOT remove a Pin already held, and SHALL apply to the next Pin written. The budget names `recall`, `docs` and `graph` are retired and SHALL be refused like any name that is not a Budget.

#### Scenario: A changed budget takes effect on the next call

- **WHEN** the verbatim tail's Budget is changed mid-session
- **THEN** the next Call's pack SHALL be assembled under the new Budget

#### Scenario: A system-prompt budget changed mid-turn waits for the next turn

- **WHEN** `/pack budget opening-tokens` is changed during a Turn
- **THEN** the remaining Calls of that Turn SHALL send the Opening as the Turn started, and the next Turn SHALL send it under the new Budget

#### Scenario: An invalid budget is refused, not applied

- **WHEN** a Budget is set to something that is not a count
- **THEN** it SHALL be refused and the previous Budget SHALL remain in force

#### Scenario: A retired budget name is refused

- **WHEN** `/pack budget recall 3` is run
- **THEN** it SHALL be refused, naming the Budgets that can be set, and no setting SHALL change

#### Scenario: A lowered pin budget keeps the pins held

- **WHEN** the Pin Budget is lowered below what the Conversation's Pins spend
- **THEN** every Pin SHALL remain held and carried, and the next `/pins add` SHALL be refused against the new Budget

### Requirement: Pins are examined like any other part

Examining a Call SHALL report the Pins its Pack carried as their own part, marked `system prompt`, with their ids, their size, and the Pin Budget, and SHALL report that part as having no relevance threshold. Where a Call carried no Pins because the harness never offered the system prompt for its Turn, the report SHALL say so rather than report the Conversation as holding no Pins. Comparing two Calls SHALL report a Pin added or removed between them as entering or leaving, identified by its id; because a Pin change takes effect from the next Turn, two Calls of the Turn in which a Pin changed SHALL carry the same Pins. A Conversation summary SHALL report the Pin part's typical spend beside the other parts. Neither the record nor any report SHALL carry a Pin's text: the Journal holds it, and `/pins` prints it.

#### Scenario: A call's pins are itemised

- **WHEN** a Call whose Pack carried two Pins is examined
- **THEN** the report SHALL list a pinned part marked `system prompt` naming both ids, with its size against the Pin Budget

#### Scenario: A pin added between calls enters

- **WHEN** a Call of the Turn before a Pin was added is compared with a Call of a later Turn
- **THEN** the Pin SHALL be reported as entering, by its id

#### Scenario: A pin added mid-turn does not enter within that turn

- **WHEN** a Pin is added during a Turn and two Calls of that Turn are compared
- **THEN** the Pin SHALL NOT be reported as entering

#### Scenario: A pin removed between calls leaves

- **WHEN** a Call of the Turn before a Pin was removed is compared with a Call of a later Turn
- **THEN** the Pin SHALL be reported as leaving, by its id

#### Scenario: Pins not sent because the hook never fired are reported as such

- **WHEN** a Call is examined whose Turn the harness never offered pi-chart the system prompt for, in a Conversation that holds Pins
- **THEN** the report SHALL show the pinned part absent because the system prompt was not offered

#### Scenario: Pins over a lowered budget are reported as exceeding it

- **WHEN** a Call carried Pins that together exceeded the Pin Budget in force
- **THEN** the report SHALL state the Budget exceeded rather than report the part as fitting

#### Scenario: Calls recorded before pins existed read without them

- **WHEN** a Call recorded before Pins existed is examined or compared
- **THEN** it SHALL be reported with no pinned part, and comparing it with a later Call SHALL report that Call's Pins as entering

#### Scenario: Calls recorded before pins moved read as messages

- **WHEN** a Call recorded while Pins were sent as a message is examined
- **THEN** its pinned part SHALL be listed without the `system prompt` mark

### Requirement: The Opening is examined like any other part

Examining a Call SHALL report the Opening as its own part, named `opening` and marked `system prompt`, with its size, its Budget, and the Turn it came from, and SHALL report it as having no relevance threshold. Where the Opening contributed nothing, the report SHALL give its reason in words that tell the reasons apart: Turn 0's prompt is empty, the first Turn is no longer stored, no Store is configured, retrieval failed, its Budget is zero, or the harness never offered the system prompt for the Turn. Comparing two Calls SHALL report the Opening entering or leaving like any other part, and a Conversation summary SHALL report its typical spend beside the other parts. Its size Budget SHALL be changeable within a session under the name `opening-tokens`, as other Budgets are.

#### Scenario: A carried Opening is listed with its source

- **WHEN** a Call whose Pack carried the Opening is examined
- **THEN** the report SHALL list an `opening` line marked `system prompt` with its size, its Budget and Turn 0, and SHALL NOT report refusals for irrelevance

#### Scenario: The first turn's Opening is listed

- **WHEN** a Call of the Conversation's first Turn is examined
- **THEN** the report SHALL list the `opening` part as carried, beside the tail and the current Turn

#### Scenario: Each reason for an absent Opening reads differently

- **WHEN** one Call's Opening was absent because Turn 0's prompt was empty, another's because Turn 0 was no longer stored, another's because no Store was configured, another's because retrieval failed, and another's because the harness never offered the system prompt
- **THEN** the five reports SHALL each name their own reason, and none SHALL read as the others

#### Scenario: The Opening is unchanged across an eviction

- **WHEN** two Calls are compared, the first before the tail evicted Turn 0 and the second after
- **THEN** the comparison SHALL NOT report the Opening as entering or leaving

#### Scenario: The Opening entering is visible in a comparison

- **WHEN** a Call whose Opening was absent because retrieval failed is compared with a later Call that carried it
- **THEN** the comparison SHALL report the Opening as entering

#### Scenario: The Opening's Budget changes within the session

- **WHEN** `/pack budget opening-tokens 0` is run
- **THEN** the next Turn SHALL carry no Opening and its report SHALL say the Opening's Budget is zero

## ADDED Requirements

### Requirement: A part reports its spend against its Budget

The system SHALL report each part's contribution against the Budget that bounded it, including when a part was trimmed to fit, and SHALL distinguish what an exhausted count Budget, an exhausted size Budget, an Eviction, and the Pack ceiling each kept out. No part of a Context Pack selects by relevance, so no part SHALL be reported as having refused content for irrelevance. A part that contributed nothing SHALL be reported with the reason it contributed nothing — it had nothing to carry, retrieval failed, its Budget was zero, its Store was not configured, or the harness never offered the system prompt for its Turn — and SHALL NEVER be silently omitted. A part that carried a Turn with messages dropped SHALL report how many, beside whether its content was shortened.

#### Scenario: A trimmed part is visible as trimmed

- **WHEN** Turn 0's prompt was larger than the Opening's size Budget
- **THEN** the report SHALL show the `opening` part at its Budget and say its content was shortened

#### Scenario: A part under its budget is not reported as full

- **WHEN** a part contributed less than its Budget allowed
- **THEN** its spend SHALL be reported as less than its Budget

#### Scenario: A shortfall is attributed to what caused it

- **WHEN** a part contributed less than its Budget
- **THEN** the report SHALL attribute the shortfall to its Budget, its supply, an Eviction, or the Pack ceiling, and SHALL NOT report refusals for irrelevance

#### Scenario: A part that contributed nothing gives its reason

- **WHEN** a Call's verbatim tail carried nothing because its count Budget was zero
- **THEN** the report SHALL show the tail as excluded by a zero Budget rather than omit it or report it as having nothing to carry

#### Scenario: Dropped messages are reported

- **WHEN** a Call's verbatim tail dropped 412 messages from its newest Turn
- **THEN** examining that Call SHALL report "412 messages dropped" for the tail, separately from "content shortened"

#### Scenario: A record without the count reports no drop

- **WHEN** a Call recorded before this detail existed is examined
- **THEN** no dropped-message line SHALL be reported for any part

#### Scenario: An older record with retrieval parts can still be examined

- **WHEN** a Call recorded before this change, whose pack carried recalled Turns, curated knowledge or structure, is examined
- **THEN** it SHALL be reported without failing

### Requirement: An exclusion can be explained by name

The system SHALL answer, for a subject a user names, why content matching it was not carried by a Call: a list of the candidates that were excluded, each named by identity, with its size where a size Budget decided and the Budget, Pack ceiling or Eviction that excluded it, newest Turn first. The candidates are the Turns the verbatim tail did not carry and the Opening where its Budget excluded it. Where the subject names a Pin or the Opening and that part was absent from the Call, the answer SHALL give the part's absence reason. Content the model pulled with a tool, or a tool passed over, SHALL NOT be offered as a candidate. Where a Call's record holds only a count of exclusions and no identities, the answer SHALL say so rather than report that nothing was excluded. Where the named subject matched no recorded candidate at all, the answer SHALL distinguish that from a candidate that was considered and excluded.

#### Scenario: An excluded turn is named with what excluded it

- **WHEN** a user asks why a Turn was not carried, and the Pack ceiling reduced it out of the verbatim tail
- **THEN** the answer SHALL name that Turn's position and attribute its exclusion to the ceiling

#### Scenario: Budget exclusions are named by their budget

- **WHEN** a Turn was excluded because the verbatim tail's count or size Budget was exhausted
- **THEN** the answer SHALL name it and attribute its exclusion to that Budget

#### Scenario: An evicted turn is attributed to eviction

- **WHEN** a user asks about a Turn the verbatim tail evicted
- **THEN** the answer SHALL name that Turn and say the tail evicted it, and SHALL NOT attribute its absence to a Budget

#### Scenario: An absent Opening is explained by its reason

- **WHEN** a user asks about the Opening of a Call whose Turn the harness never offered pi-chart the system prompt for
- **THEN** the answer SHALL say the Opening was absent because the system prompt was not offered

#### Scenario: A subject that was never a candidate says so

- **WHEN** a user asks about a subject no recorded candidate matches
- **THEN** the answer SHALL say that nothing matching it was considered, rather than reporting no exclusions

#### Scenario: An unexplainable call says it is unexplainable

- **WHEN** a Call recorded before candidate identities were retained is asked about
- **THEN** the answer SHALL say the Call holds no candidate detail rather than report that nothing was excluded

## REMOVED Requirements

### Requirement: Examining a Call reports its earlier Briefings

**Reason**: pi-chart no longer sends a Briefing (ADR-0015), and Accounting no longer records Briefing figures, so there is nothing to report.

**Migration**: None. `/pack` drops the Briefing line from examinations and summaries. Calls recorded before this change are examined without it.

### Requirement: A part reports how much of its budget it spent

**Reason**: Its body and most of its scenarios distinguish refusals for irrelevance from Budget shortfalls, and no Context Pack part selects by relevance any more (ADR-0015). The scenarios for recall and curated knowledge describe parts that no longer exist.

**Migration**: Replaced by "A part reports its spend against its Budget", which keeps the Budget, absence-reason and dropped-message rules for the parts that remain.

### Requirement: An absence can be explained by name

**Reason**: It ranks near misses by distance against a relevance threshold, and the Pack no longer holds any part that refuses by distance (ADR-0015).

**Migration**: Replaced by "An exclusion can be explained by name", which explains the Turns the verbatim tail did not carry and an absent Pin or Opening. A Turn the tail evicted can be searched with `recall_earlier_turns`.
