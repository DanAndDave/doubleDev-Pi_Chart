# The newest tail Turn shrinks by its oldest actions, never to nothing

The verbatim tail is carried as the messages each Turn was. A single completed Turn can be larger than any Budget: in the incident behind this change, the newest tail Turn ran to 431 messages. Elision could shorten individual payloads but never remove a message, so that Turn still did not fit.

**When the newest tail Turn does not fit, it drops its oldest tool-call groups first.** A group is one assistant message together with the results of the tool calls it made. It is dropped whole, so every tool call still has its result and every result still has its call. In place of what went, one marker is appended to the Turn's prompt text: a count per tool in order of first use, plus the estimated tokens dropped, e.g. `[412 earlier messages not carried: read ×140, bash ×52, edit ×13; ~460k tokens]`. The marker's length depends on how many different tools ran, not how many calls were made.

The Turn is never dropped. Its smallest form is the prompt with the marker and the final reply. Every group can go, the newest included, because in a completed Turn the final reply is what reports the result. Below that, Elision shortens the final reply, and the prompt last.

## Considered options

- **Turn the Turn into a recollection.** That replaces the agent's most recent work with prose the Assembler writes, at the point where the agent is most likely continuing from it.
- **Keep the start and end, drop the middle.** The prompt and the final reply already survive; whatever else stays should be the newest actions, not the oldest, which are the ones the agent has moved past.
- **Put the marker in its own user message.** That puts two user messages in a row, and it is unverified whether every provider accepts that.
- **Put the marker at the start of the first kept assistant message.** That puts words in the agent's mouth.
- **Apply the same rule to the current Turn.** That would remove what the agent did earlier in the Turn it is still working on, and would rewrite the start of that Turn on every Call. The current Turn keeps its existing rule: shortened by Elision, never shrunk by messages, an overrun reported. The harness's own compaction remains its backstop.

## Consequences

- "Verbatim tail" no longer means every message of every tail Turn. It means the Turns are carried as messages rather than as recollections, and its newest Turn is never dropped.
- A shrunk Turn's prompt no longer matches the message the harness sent, so a run of harness-sent messages ends there and nothing after it is read from cache. Thinking after a changed message is dropped, as ADR-0011 already records for tail eviction and Elision.
- [Inference] As the current Turn grows, the Ceiling can force more of the tail Turn out, so the dropped set and its marker can change from Call to Call; each change misses the cache again.
- Each part in Accounting gains an optional count of dropped messages, shown in `/pack` as "N messages dropped" beside "content shortened". Parts are stored as JSON, so no migration is needed. A Turn whose smallest form still exceeds its Budget is reported as "Budget exceeded", as before.
