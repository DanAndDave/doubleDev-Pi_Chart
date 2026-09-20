## Context

Recall is wired end to end and starved at both ends. `similarTurns` already scores every embedded Turn of a Conversation, tie-broken on Turn order (`src/postgres-store.ts:392-409`). What feeds it does not: `turnText` joins `messageText` output (`:338-357`), which returns `type: "text"` blocks only (`src/messages.ts:55-66`), and the tokenizer cuts the join at 512 tokens — the median Turn's vector sees 6.6% of its own text here, p10 1.1%. The query is the bare prompt (`src/extension.ts:715-720`). What returns is unfaithful the same way: `asRecollection` filters textless lines (`src/assembler.ts:570-574`), so a `toolCall` vanishes while its `toolResult` survives whole.

Underneath sit a vector that outlives its content (`src/postgres-store.ts:318` against `:259-289`), a 384-dimension model swap that passes every check (`src/embedder.ts:57`, `src/embedder-worker.ts:17`), an unanswered tool call replayed verbatim, and a Conversation filter over an index carrying no `conversation_id` (`:96-97,385-401`).

`token-budgets` has landed, so the Pack ceiling and the elision marker exist; this slice makes recollections bigger, which is why it waited. See `proposal.md` for motivation and the two delta specs for the contract.

## Goals / Non-Goals

**Goals:**

- A Turn findable by its conclusions and by what it did, not by its opening.
- A vector that is either current or not ranked at all.
- A Conversation-scoped recall whose count means what it says.
- A recollection an agent can act on without guessing why anything was read.

**Non-Goals:**

- Chunking a Turn into several vectors. A Turn is the unit the Assembler serves; `doc-store-recall` justified the opposite for Concepts, which are documents.
- Another embedding model, hybrid keyword search, or re-ranking.
- Bounding a Pack — `token-budgets`, in place and used here.
- The Codebase relabel, ingest batching, `turns.ingested_at` — `store-hygiene`.

## Decisions

### The embed text is bounded per message, not per Turn

Each message of a Turn gets a share of a character budget: prompt and assistant text whole where they fit, each tool call as its name and arguments, each tool result head-and-tail within its share. A message under its share releases the remainder, so a small Turn embeds whole.

The alternative is what exists — concatenate and let the tokenizer cut — and it is why the p10 Turn embeds 1.1% of itself: one `read` result at the front consumes the window and the conclusion never reaches the model. Shares make coverage a function of the Turn's shape rather than of the order its largest message arrived in. Task 1 measured the budget against the 383 Turns here and chose **1,200 characters with a 180-character floor on any one share**: the target was the median Turn's conclusion inside its own vector, not a maximal byte count, and of the 48 Turns larger than the model's cut, 3 carried their own conclusion before and 47 do now — while byte coverage *falls*, from a 7.9% median to 4.8%, because tool results are most of the bytes and least of the meaning.

### The query instruction is applied query-side only

bge-small-en-v1.5 (`src/embedder.ts:16`) is trained asymmetrically: queries carry an instruction, passages carry none. Prefixing both sides discards that asymmetry and welds every stored vector to a prompt string, so rewording it would re-embed the corpus. Query-side only keeps stored vectors passage-side, which makes the delta spec's "stored vectors SHALL remain valid" free rather than defended.

Both changes move distances, so the 0.50 threshold no longer stands on its measurement. Task 1 re-derived it as **0.52**: over 99 real Turns a prompt asked in other words reaches its own Turn within it 92% of the time while nothing off-topic does. The measurement also refuted the plan's assumption that the derivation brings a genuine Turn *nearer* — it moves every distance outward, genuine included — so what it buys is separation and rank (35 of 99 ranked first against 33, and 0 off-topic admitted at 0.52 against 8 for the bare prompt). The delta spec's scenario was corrected to that claim rather than the measurement being explained away.

### The hash covers the derived embed text

`turns` gains `text_hash`, written on ingest, mirroring `concept_sections` (`src/postgres-store.ts:705-718`): a differing hash nulls `embedding`, and `embedPending` keeps its shape.

The hash is over the derived embed text, not the raw prompt and messages. Hashing raw content saves a derivation per ingest and loses what matters: change the composition rule and every hash changes, so the corpus invalidates itself with no version column and no hand-written backfill.

### A vector records the model the worker actually loaded

The worker answers a handshake with the model id and width it loaded, so `CM_EMBED_MODEL` is recorded rather than inferred and `LocalEmbedder.dimensions` stops being the constant it claims to check (`src/embedder.ts:57`). `turns` gains `embedding_model`; `embedPending` selects rows whose model differs from the one in use, and `similarTurns` scores only matching rows.

A mismatch is pending work, not an error that fails a Turn: the Turn proceeds with fewer recollections while the background pass re-embeds. Loud is reserved for the condition — one report naming both models and the affected Turn count, so a swap is visible in the session that caused it.

### Tool calls are paired in the Assembler, not at ingest

The store keeps the orphan. It is a derived index over the Journal (ADR-0002), and the Journal recorded an unanswered call; dropping it at ingest would also mutilate the common case, where the in-flight Turn is re-ingested complete by the shutdown sweep.

Pairing therefore happens where messages become protocol messages: `assemble()`, which is pure and also sees Turns reconstructed from the live array (`src/turns.ts:10-29`) that never passed through the store. A recollection is text, not protocol, so there the unanswered call is rendered and labelled — the audit's one case in 219 Journals is informative history, and a refused Call only in the tail.

### A Conversation-scoped recall is exact; the ANN index serves the corpus-wide path

`turns_embedding_idx` cannot carry `conversation_id` — HNSW indexes one vector column — so a Conversation filter is either post-filtered from a corpus-wide candidate set, returning short, or seq-scanned. Task 1 ran `EXPLAIN (ANALYZE)` over a seeded corpus and **settled the audit's `[INFERENCE]`: neither shape occurs today**. At 20,000 Turns and again at 200,000, the planner reaches the Conversation's rows through `turns_pkey`'s leading column and scores them exactly, so recall does not silently come back short — but completeness rests on the primary key's column order rather than on anything the query asks for.

The fix does not depend on that answer: the Conversation-scoped query gets a b-tree on `(conversation_id)` where `embedding IS NOT NULL` and computes distance exactly over that Conversation's Turns. Cost is bounded by Conversation length — tens of Turns, sixteen in the worst session here — not by corpus size, so completeness is a property rather than a tuning parameter. The alternative, `hnsw.iterative_scan` with a raised `hnsw.ef_search`, keeps an approximate answer to a question whose spec now says "every qualifying Turn". HNSW stays for the corpus-wide search, where approximation is the point.

### The corpus re-embeds through the path that already exists

Every hash differs and every `embedding_model` is null, so all 373 Turns here are pending. No migration script: the `agent_end` and `session_shutdown` sweeps already call `embedPending` in batches of 32 off the request path (`src/postgres-store.ts:306`), against the embedder's 120 s per-batch budget (`src/embedder.ts:66`). Twelve batches for this corpus, and the Conversation being worked in goes first because the sweep passes its id. Until a Turn is re-embedded it is not recalled — never recalled wrongly, since an invalid vector is not ranked.

## Risks / Trade-offs

- **Recollections grow, by design** → `token-budgets` clamps them and marks the elision; this slice orders the clamp — actions survive, output is shortened.
- **The embed text is still capped at 512 tokens** → shares raise coverage of what matters without raising the cap; task 1 reports the new figure against the measured 6.6% median.
- **Hashing the derived text costs a derivation per ingest** → a string build over messages already in hand, and it buys self-invalidation on every later composition change.
- **An exact per-Conversation scan grows with Conversation length** → linear in tens of rows, measured in task 6, re-tunable back to ANN if a Conversation ever gets long enough to matter.
- **Re-embedding leaves recall thin for a session or two** → thin, not wrong: an invalid vector is absent, the tail is untouched, and `/pack` shows recall empty rather than mysterious.

## Testing seams

| Requirement | Seam |
| --- | --- |
| Ingested turns are embedded | Composition boundary for the shares, container-free; store boundary (`CM_DATABASE_URL`) over `test/fixtures/journal-tool-session.jsonl` for findability by conclusion and by action. |
| A stored vector is valid only for the content and the model that produced it | Store boundary: ingest, change the fixture, ingest again, assert re-embedding; a row stamped with another model asserted unranked and reported. |
| A recall query is represented as a query, not as stored content | Model suite (`CM_EMBED=1`): distance to the genuinely matching Turn with and without the derivation, and the re-derived threshold. |
| Retrieval ranks turns by similarity to the prompt | Store boundary over a seeded multi-Conversation corpus: every qualifying Turn returned, order stable as the corpus grows, shortfall distinguishable from irrelevance. |
| Packs carry the prompt and a verbatim tail | `assemble()` boundary with an orphaned `toolCall` fixture, plus the unchanged-tail comparison. |
| A recollection carries the actions its turn took | `assemble()` boundary over the tool-session fixture: the `write(...)` and `read(...)` invocations the audit reproduced as missing. |

`assemble()` is the target seam — pure, no container, no model — covering rendering and orphan refusal. Vector validity, re-embedding and the recall guarantee need the store-backed suite (`CM_DATABASE_URL`); only the query row needs the model suite (`CM_EMBED=1`). The default suite stays container-free, model-free and network-free; no row needs `CM_LIVE=1`, `CM_GRAPHIFY=1` or `CM_OPENSPEC=1`.

## Open Questions

None. Three numbers are task 1's measurement: the per-message share budget, the re-derived relevance minimum, and today's `EXPLAIN` plan. Two wait on later evidence — whether the per-Conversation scan should return to ANN once a Conversation is long enough for the scan to be measurable, and whether `CM_EMBED_MODEL` should be refused rather than recorded.
