## MODIFIED Requirements

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

## ADDED Requirements

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
