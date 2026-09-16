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

### Requirement: Assembly is deterministic

Given the same inputs and configuration, the system SHALL produce an identical Context Pack. Assembly SHALL NOT consult a model and SHALL NOT depend on wall-clock time, randomness, or iteration order.

#### Scenario: Repeated assembly produces an identical pack

- **WHEN** a Context Pack is assembled twice from the same inputs and configuration
- **THEN** the two packs SHALL be identical

#### Scenario: Configuration change is the only cause of difference

- **WHEN** two packs assembled from the same inputs differ
- **THEN** the difference SHALL be attributable to a configuration change

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
