## 1. Measure before choosing

- [ ] 1.1 Run `EXPLAIN (ANALYZE)` on today's Conversation-filtered recall query against a seeded multi-Conversation corpus, and record which plan pgvector chooses and how many Turns a `limit`-sized recall actually returns, settling the audit's `[INFERENCE]`
- [ ] 1.2 Report, over this machine's 373 Turns, what share of each Turn's text the current embed text covers and what share candidate per-message share budgets cover, and record the median and p10 against the measured 6.6% and 1.1%
- [ ] 1.3 Choose the per-message share budget from those figures, and record why, including the headroom left under the model's 512-token cut
- [ ] 1.4 Re-derive the Thread Store's relevance minimum under the new embed text and the query derivation, and record the distances from a prompt to its genuine Turn and to the nearest unrelated one against the 0.50 measured before

## 2. What a turn is embedded as

- [ ] 2.1 Compose a Turn's embed text from its prompt, assistant text, each tool call's name and arguments, and each tool result, and verify a tool-using fixture Turn's embed text carries every message's contribution
- [ ] 2.2 Bound each message to a share of the budget, releasing what a small message does not use, and verify a Turn whose first message exceeds the whole budget still carries its later messages
- [ ] 2.3 Shorten an oversized tool result head-and-tail within its share using the existing elision marker, and verify the marker states what was removed
- [ ] 2.4 Verify the same Turn composes to the same embed text on repeated calls and in the presence of an unanswered tool call

## 3. The query side

- [ ] 3.1 Apply the pinned model's query instruction to a recall query only, and verify a stored Turn's vector is unchanged by the presence of the derivation
- [ ] 3.2 Verify against the real model that the derived query is no further from the Turn that genuinely answers it than the bare prompt is
- [ ] 3.3 Apply the re-derived relevance minimum from task 1.4 as the configured default, and verify an unset value falls back to it

## 4. A vector stops being valid when its content changes

- [ ] 4.1 Add the forward migration for a Turn's embed-text hash and verify it applies to the existing database without disturbing stored content
- [ ] 4.2 Write the hash of the derived embed text on ingest and null the embedding when it differs, and verify a Turn re-ingested with changed content is selected for embedding again
- [ ] 4.3 Verify a Turn re-ingested unchanged is not embedded a second time
- [ ] 4.4 Verify a Turn whose content changed is no longer retrievable by the content it lost and becomes retrievable by its new content once embedding has run
- [ ] 4.5 Verify a Turn awaiting re-embedding is still returned as part of the Conversation's history and still counts as pending

## 5. A vector records the model that produced it

- [ ] 5.1 Have the embedder worker report the model id and width it loaded, and verify the reported width is the running model's rather than the pinned constant
- [ ] 5.2 Add the forward migration recording a vector's producing model, and verify existing vectors are treated as of unknown provenance
- [ ] 5.3 Exclude vectors produced by another model from ranking, and verify such a Turn is returned for no query
- [ ] 5.4 Select a mismatched vector as pending, and verify the next embedding pass re-embeds it under the model in use
- [ ] 5.5 Report once when the store holds vectors from another model, naming both models and the affected Turn count, and verify the Turn still completes

## 6. A conversation-scoped recall returns what it claims

- [ ] 6.1 Compute distance exactly over the current Conversation's embedded Turns behind an index on the Conversation, and verify every Turn meeting the minimum is returned up to the requested count with unrelated Conversations dominating the corpus
- [ ] 6.2 Verify the same recall returns the same Turns in the same order after Turns of unrelated Conversations are added
- [ ] 6.3 Report a recall that came back short of the count it searched for, distinguishably from a Conversation in which nothing met the minimum, and verify both cases read differently
- [ ] 6.4 Verify the corpus-wide search keeps its approximate index and its behaviour is unchanged
- [ ] 6.5 Measure the recall query's time against the longest Conversation in this machine's Journals, and record it beside the ANN figure from task 1.1

## 7. Faithful recollections

- [ ] 7.1 Render each tool call in a recollection from its name and arguments, and verify against `test/fixtures/journal-tool-session.jsonl` that the `write(...)` and `read(...)` invocations the audit found missing are present
- [ ] 7.2 Verify a message carrying a tool call and no prose is no longer dropped from a recollection
- [ ] 7.3 Record an unanswered tool call in a recollection as made and unanswered, and verify it is labelled rather than omitted
- [ ] 7.4 Shorten a recollection's tool output before its actions, and verify an over-Budget recollection keeps every action it recorded
- [ ] 7.5 Verify a recollection remains one attributed message carrying its position in the Conversation

## 8. The verbatim tail refuses an orphan

- [ ] 8.1 Pair tool calls with their results where a Turn's messages enter the tail, and verify a call whose result was never recorded is not carried
- [ ] 8.2 Verify the rest of such a Turn — prompt, assistant text, answered calls with their results — still appears
- [ ] 8.3 Verify a Turn whose calls are all answered produces a tail identical to the one assembled before this rule
- [ ] 8.4 Verify the same pairing applies to a Turn reconstructed from the live message array rather than the store

## 9. Re-embedding the corpus

- [ ] 9.1 Verify every existing Turn is selected as pending after the migrations — by hash and by unknown model provenance — and that the existing sweep re-embeds it in batches of 32 off the request path, this session's Conversation first
- [ ] 9.2 Verify a Conversation mid-re-embedding recalls fewer Turns rather than wrong ones, and the tail is unaffected

## 10. Verification

- [ ] 10.1 Ingest this machine's Journals into a scratch Thread Store, re-embed, and confirm the embed-text coverage and recall-minimum figures from task 1 hold on the real corpus
- [ ] 10.2 Run a live session, ask about something decided early in a long Conversation, and confirm `/pack` shows the Turn recalled with its tool calls rendered
- [ ] 10.3 Run the default, store-backed, and model suites and the type checker, and confirm `openspec validate recall-fidelity` passes
