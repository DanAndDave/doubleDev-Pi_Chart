## MODIFIED Requirements

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

## ADDED Requirements

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
