## 1. Measure before choosing

- [x] 1.1 Run `EXPLAIN (ANALYZE)` on today's Conversation-filtered recall query against a seeded multi-Conversation corpus, and record which plan pgvector chooses and how many Turns a `limit`-sized recall actually returns, settling the audit's `[INFERENCE]` — **settled: not ANN**. Against 20,000 Turns in 400 Conversations and again at 200,000, today's query plans as a *Bitmap Index Scan on `turns_pkey`* over `conversation_id` followed by a sort — an exact scan of the Conversation, 0.116 ms and 0.278 ms respectively. The audit's first branch (a corpus-wide candidate set post-filtered, returning short) is not what happens; the second (a distance per Turn of the Conversation) is, and it is already complete. It rests on the primary key's leading column, so task 6's partial index makes completeness a property of the schema rather than of the key's column order: with it the same query costs 0.090 ms and reads two buffers instead of three
- [x] 1.2 Report, over this machine's 373 Turns, what share of each Turn's text the current embed text covers and what share candidate per-message share budgets cover, and record the median and p10 against the measured 6.6% and 1.1% — measured over **383 Turns in 220 Journals**. The audit's 6.6%/1.1% were a 25-Turn sample; over the whole corpus the figure is bimodal, because 335 Turns fit inside the cut whole. The Turns the cut actually bites — **48 of 383** — cover a median 7.9% and a p10 0.6% of their own text today. Byte coverage is the wrong target, and the measurement says why: candidate budgets cover a *lower* median share (4.8% at 1,200 characters) while carrying far more of what matters, because tool results are most of the bytes and least of the meaning. What rises is reachability: **the Turn's own conclusion is inside its vector on 3 of those 48 Turns today and on 47 with the candidate composition, and a tool call appears on 0 of 48 today and 47 with it**
- [x] 1.3 Choose the per-message share budget from those figures, and record why, including the headroom left under the model's 512-token cut — **1,200 characters, with a 180-character floor on one contribution's share** (`EMBED_CHARACTERS`, `SHORTEST_SHARE` in `src/embed-text.ts`). 1,200 is the largest round budget whose composed text stayed inside the cut on every one of the 383 Turns: **499 tokens at the worst, 475 at p99, 13 tokens of headroom**, measured through the real composition with the real elision marker. At 1,400 fourteen Turns overran the cut, which reinstates the defect. The 180-character floor decides how many contributions get a share at all (six at this budget); at 100 the last message's share is too small to keep its tail and the conclusion reaches only 16 of the 48, at 180 it reaches 47
- [x] 1.4 Re-derive the Thread Store's relevance minimum under the new embed text and the query derivation, and record the distances from a prompt to its genuine Turn and to the nearest unrelated one against the 0.50 measured before — **0.52**, measured over 99 real Turns with the pinned model. A prompt against its own Turn composed *without* that prompt — asking in other words — lands at median 0.384 and p90 0.510 with the derivation. The corpus cannot supply an unrelated control (every Journal here is the same project), so off-topic passages were used: their nearest distance is p10 0.572, median 0.618. At 0.52 the derived query keeps 91 of 99 genuine and admits 0 of 99 off-topic; the bare prompt at the same distance keeps 95 but admits 8. **The derivation does not make a genuine Turn nearer** — median 0.384 derived against 0.370 bare — so the delta spec's scenario was corrected to the property that holds and matters: it ranks the answering Turn first more often (35 of 99 against 33, MRR 0.471 against 0.456) and pushes unrelated content further away, which is what buys the higher threshold

## 2. What a turn is embedded as

- [x] 2.1 Compose a Turn's embed text from its prompt, assistant text, each tool call's name and arguments, and each tool result, and verify a tool-using fixture Turn's embed text carries every message's contribution
- [x] 2.2 Bound each message to a share of the budget, releasing what a small message does not use, and verify a Turn whose first message exceeds the whole budget still carries its later messages
- [x] 2.3 Shorten an oversized tool result head-and-tail within its share using the existing elision marker, and verify the marker states what was removed — the marker moved to `src/elision.ts`, so the Assembler and the embed text mark a gap the same way
- [x] 2.4 Verify the same Turn composes to the same embed text on repeated calls and in the presence of an unanswered tool call

## 3. The query side

- [x] 3.1 Apply the pinned model's query instruction to a recall query only, and verify a stored Turn's vector is unchanged by the presence of the derivation — `Embedder.embedQuery` is the query side; `embed` stays the storing side. Held at the store boundary against an embedder that derives queries differently, so a derivation reaching the storing side would show in the stored vector
- [x] 3.2 Verify against the real model that the derived query is no further from the Turn that genuinely answers it than the bare prompt is — **measured false, and the plan corrected rather than the measurement**. The derivation moves every distance outward, genuine included (median 0.384 against 0.370 over 99 Turns); what it improves is separation and rank. The model suite now holds the property the configured minimum depends on: a derived query is within 0.52 of the Turn that answers it and beyond 0.52 from unrelated content. The delta spec's scenario was reworded to that claim
- [x] 3.3 Apply the re-derived relevance minimum from task 1.4 as the configured default, and verify an unset value falls back to it — `DEFAULT_RECALL_MAX_DISTANCE` is 0.52; the fallback is already held by `loadConfig` in `test/inspection.test.ts`

## 4. A vector stops being valid when its content changes

- [x] 4.1 Add the forward migration for a Turn's embed-text hash and verify it applies to the existing database without disturbing stored content — migration 10 adds `turns.text_hash`; the migration test holds the versions ascending, and the store-backed suite runs every case against a database migrated from the previous schema
- [x] 4.2 Write the hash of the derived embed text on ingest and null the embedding when it differs, and verify a Turn re-ingested with changed content is selected for embedding again
- [x] 4.3 Verify a Turn re-ingested unchanged is not embedded a second time
- [x] 4.4 Verify a Turn whose content changed is no longer retrievable by the content it lost and becomes retrievable by its new content once embedding has run
- [x] 4.5 Verify a Turn awaiting re-embedding is still returned as part of the Conversation's history and still counts as pending

## 5. A vector records the model that produced it

- [x] 5.1 Have the embedder worker report the model id and width it loaded, and verify the reported width is the running model's rather than the pinned constant — the worker answers an `identify` request with the model it loaded and the width of a vector it produced; `LocalEmbedder.dimensions` is gone, and the check in `embedPending` reads the running model's width. Confirmed against the real model: `{ model: "Xenova/bge-small-en-v1.5", dimensions: 384 }`
- [x] 5.2 Add the forward migration recording a vector's producing model, and verify existing vectors are treated as of unknown provenance — migration 11 adds `turns.embedding_model`, null on every row written before it, which `embedPending` selects as pending
- [x] 5.3 Exclude vectors produced by another model from ranking, and verify such a Turn is returned for no query
- [x] 5.4 Select a mismatched vector as pending, and verify the next embedding pass re-embeds it under the model in use
- [x] 5.5 Report once when the store holds vectors from another model, naming both models and the affected Turn count, and verify the Turn still completes — `PostgresStore.vectorModels()` answers with the model in use and the strangers; the sweep reports it in the background, once a session, so a failed report cannot fail a Turn

## 6. A conversation-scoped recall returns what it claims

- [x] 6.1 Compute distance exactly over the current Conversation's embedded Turns behind an index on the Conversation, and verify every Turn meeting the minimum is returned up to the requested count with unrelated Conversations dominating the corpus — migration 12 adds `turns_conversation_embedded_idx`; held against a corpus where 200 Turns of other Conversations are nearer the probe than any of ours
- [x] 6.2 Verify the same recall returns the same Turns in the same order after Turns of unrelated Conversations are added
- [x] 6.3 Report a recall that came back short of the count it searched for, distinguishably from a Conversation in which nothing met the minimum, and verify both cases read differently — `Recollections.unsearched` counts the Turns of the Conversation holding no valid vector; it is recorded per Call (migration 13) and `/pack` renders it as its own line, separate from "not relevant enough"
- [x] 6.4 Verify the corpus-wide search keeps its approximate index and its behaviour is unchanged — `searchAll` still plans as `Index Scan using turns_embedding_idx`, confirmed by `EXPLAIN (ANALYZE)` over the seeded 20,000-Turn corpus; its existing cases pass unchanged. The one thing added is the model filter every ranking path now shares
- [x] 6.5 Measure the recall query's time against the longest Conversation in this machine's Journals, and record it beside the ANN figure from task 1.1 — the longest Conversation here is **16 Turns**. The exact scan behind the partial index executes in **0.216 ms** against the ANN path's 0.230 ms on the seeded corpus, so the guarantee costs nothing at this scale. End to end a recall takes **62 ms at p50**, of which the query is under a millisecond: embedding the prompt is the cost, and it was the cost before

## 7. Faithful recollections

- [x] 7.1 Render each tool call in a recollection from its name and arguments, and verify against `test/fixtures/journal-tool-session.jsonl` that the `write(...)` and `read(...)` invocations the audit found missing are present
- [x] 7.2 Verify a message carrying a tool call and no prose is no longer dropped from a recollection
- [x] 7.3 Record an unanswered tool call in a recollection as made and unanswered, and verify it is labelled rather than omitted
- [x] 7.4 Shorten a recollection's tool output before its actions, and verify an over-Budget recollection keeps every action it recorded — a recollection now renders to an allowance rather than being shortened afterwards as one blob, so the actions survive by construction and only the outputs give way
- [x] 7.5 Verify a recollection remains one attributed message carrying its position in the Conversation

## 8. The verbatim tail refuses an orphan

- [x] 8.1 Pair tool calls with their results where a Turn's messages enter the tail, and verify a call whose result was never recorded is not carried
- [x] 8.2 Verify the rest of such a Turn — prompt, assistant text, answered calls with their results — still appears
- [x] 8.3 Verify a Turn whose calls are all answered produces a tail identical to the one assembled before this rule
- [x] 8.4 Verify the same pairing applies to a Turn reconstructed from the live message array rather than the store

## 9. Re-embedding the corpus

- [x] 9.1 Verify every existing Turn is selected as pending after the migrations — by hash and by unknown model provenance — and that the existing sweep re-embeds it in batches of 32 off the request path, this session's Conversation first — run against this machine's Journals in a scratch store: **383 of 383 Turns pending after ingest, re-embedded in 12 batches of 32 in 37.6 s**, no migration script and no change to the sweep
- [x] 9.2 Verify a Conversation mid-re-embedding recalls fewer Turns rather than wrong ones, and the tail is unaffected — a Turn awaiting embedding is absent from recall, counted as `unsearched`, and still returned by `recentTurns`, so the tail is untouched

## 10. Verification

- [x] 10.1 Ingest this machine's Journals into a scratch Thread Store, re-embed, and confirm the embed-text coverage and recall-minimum figures from task 1 hold on the real corpus — 383 Turns from 220 Journals: embed text p50 24 tokens, p99 475, **max 499 of the model's 512**, none over. Recall on the longest Conversation returns four Turns including its second and third, which is the class of Turn the audit found unreachable
- [x] 10.2 Run a live session, ask about something decided early in a long Conversation, and confirm `/pack` shows the Turn recalled with its tool calls rendered — a four-Turn live session against the real provider with `CM_TAIL_TURNS=1`: Turn 0 wrote a file, Turns 1 and 2 were filler, and Turn 3 asked what was written and how. The recorded Accounting for Turn 3 reads `recalled ~142 tokens (2 of 4) turns 0, 1`, and the recollection carried `assistant: write({"path":"maple.txt","content":"syrup\n",…})` with its result — the invocation the audit reproduced as missing. The model answered with the method, not only the content
- [x] 10.3 Run the default, store-backed, and model suites and the type checker, and confirm `openspec validate recall-fidelity` passes
