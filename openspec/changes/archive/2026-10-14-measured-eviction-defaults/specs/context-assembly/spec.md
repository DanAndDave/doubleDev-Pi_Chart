## MODIFIED Requirements

### Requirement: The verbatim tail evicts to a low-water mark

The verbatim tail SHALL give up its oldest Turns only by Eviction. Between Evictions its start SHALL NOT move, and each newly completed Turn SHALL be added behind it. A newly completed Turn may carry the tail past its token Budget or past its count Budget. When it does, the tail SHALL drop its oldest Turns in one step until it is at or under the low-water mark of both Budgets. The mark is the configured share of the token Budget, and the same share of the count Budget, rounded down and never below one Turn. The Turn just completed SHALL NEVER be evicted. Where it alone exceeds the mark, it SHALL be the whole tail.

The low-water mark SHALL be configurable as a share greater than 0 and at most 1, defaulting to 0.2. A share of 1 SHALL make the tail drop only what it must to fit its Budgets.

The tail's start SHALL be a function of the Conversation's completed Turns and the configuration alone. It SHALL be derived on every Call by applying the rule above to each completed Turn in order, from the first Turn the Conversation holds to the newest. It SHALL NOT be stored. Each Turn's size for this purpose SHALL be measured on the Turn as the tail would carry it. It SHALL be the same on every Call for a Turn whose content has not changed.

A Turn the tail has evicted SHALL be searchable with `recall_earlier_turns`, as is any Turn before the tail's start. A Turn the tail carries SHALL NOT be returned by it. Reducing a Pack to its ceiling SHALL NOT move the tail's start on later Calls.

#### Scenario: The start holds between evictions

- **WHEN** a Turn completes and the tail with it stays within both Budgets
- **THEN** the next Call's tail SHALL start at the same Turn as the previous Call's, and SHALL carry the new Turn behind the Turns it already carried

#### Scenario: Eviction drops to the mark in one step

- **WHEN** under a 25,000-token tail Budget and a mark of 0.6, a Turn completes that carries the tail past 25,000 tokens
- **THEN** the tail SHALL drop its oldest Turns until it is at or under 15,000 tokens, and SHALL drop no Turn it did not need to reach that

#### Scenario: The count budget evicts to its mark

- **WHEN** under a count Budget of 8 and a mark of 0.6, a ninth Turn completes within the token Budget
- **THEN** the tail SHALL carry the newest 4 Turns

#### Scenario: The default mark

- **WHEN** no mark is configured, and under a 25,000-token tail Budget a Turn completes that carries the tail past 25,000 tokens
- **THEN** the tail SHALL drop its oldest Turns until it is at or under 5,000 tokens

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
