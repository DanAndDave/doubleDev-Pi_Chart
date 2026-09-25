# Proposal: Faithful and Findable Recollections

Triage: ready-for-agent

## Why

The early Turns of a Conversation are unreachable. The whole-Conversation path already exists — `similarTurns` scores every embedded Turn of the Conversation, not just the tail (`src/postgres-store.ts:392-409`). It is starved by what gets embedded and by what gets queried. `turnText` joins `messageText` output (`src/postgres-store.ts:350-369`), which returns only `type: "text"` blocks (`src/messages.ts:55-66`), and the model's tokenizer then cuts the join at 512 tokens. Measured on real Journals here: the median Turn's vector sees 6.6% of that Turn's text, p10 sees 1.1%, and 10 of 25 Turns embed under 5%. A Turn's conclusion is routinely outside its own vector. The query side is the bare prompt with no bge query prefix (`src/extension.ts:715-720`), so `"continue"` fires recall on noise.

What returns is unfaithful. `asRecollection` renders `${role}: ${messageText(message)}` and drops textless lines (`src/assembler.ts:570-574`), so an assistant `toolCall` becomes `"assistant: "` and vanishes while its `toolResult` survives whole. Reproduced against `test/fixtures/journal-tool-session.jsonl`: file contents come back, the `write(...)` and `read(...)` invocations do not.

Two silent corruptions sit underneath. `embedPending` selects `WHERE embedding IS NULL` (`src/postgres-store.ts:318`) and ingest's `DO UPDATE` never nulls it (`:271-301`), so a Turn embedded from a truncated Journal line keeps that vector. And `PICHART_EMBED_MODEL` overrides the pinned model (`src/embedder-worker.ts:17`) while only width is checked (`src/embedder.ts:57`, `src/postgres-store.ts:308-313`) and no vector records its producer: any other 384-dimension model mixes two vector spaces in one table and ranking turns arbitrary.

## What Changes

- A recollection renders tool calls from the block's `name` and `arguments`, so a recalled Turn shows why anything was read.
- A Turn is embedded as a bounded summary: prompt, assistant text, tool names and arguments, tool results truncated per message rather than the join cut at 512 tokens.
- The query carries the model's query instruction, query side only, so stored vectors stay passage-side.
- `turns` gains a text hash. Changed text nulls the embedding so `embedPending` re-embeds — the pattern `concept_sections` already uses (`src/postgres-store.ts:705-718`).
- Every vector records its producing model. A mismatch counts as pending, not as a hit; a mid-corpus swap fails loudly.
- Turns reconstruct with `toolCall` ids paired to results. An unanswered call is never replayed verbatim, which providers reject outright — one such Turn in 219 Journals, rare and total.
- Conversation-filtered nearest-neighbour search returns what it claims: `turns_embedding_idx` carries no `conversation_id` and nothing sets `hnsw.ef_search` or `hnsw.iterative_scan` (`src/postgres-store.ts:96-97,397-413`), so recall can come back short while `rejected` reads "nothing was relevant".
- **BREAKING** every stored Turn vector is invalidated and re-embedded once: the embedded text changes.

**Not in scope:** retention and `turns.ingested_at`, ingest batching, the Codebase relabel on re-ingest, per-Store deadlines (all `store-hygiene`); token Budgets, the pack ceiling, per-part clamping (`token-budgets`); the rejected-candidate ledger (`pack-why`).

## Capabilities

### Modified Capabilities

- `thread-store`: what a Turn is embedded as, when a stored vector stops being valid (content change, model change), and what a Conversation-filtered recall guarantees to return.
- `context-assembly`: what a recollection must contain. The spec requires only attribution and position today (`openspec/specs/context-assembly/spec.md:104,111-114`), which a recollection with its tool calls deleted satisfies; the verbatim tail also needs a requirement against replaying an unanswered tool call.

## Impact

- **Schema:** a text hash and an embedding-model column on `turns`, and a partial b-tree on `(conversation_id)` where an embedding exists. `turns_embedding_idx` is left alone — task 1.1 settled the `[INFERENCE]` the other way than this proposal first assumed, and `design.md` records why: the Conversation-scoped path stops going through the approximate index at all rather than being tuned to behave.
- **Migration:** every Turn re-embedded once — 373 Turns here, batched 32 against the embedder's 120 s budget (`src/embedder.ts:66`), off the request path.
- **Assembly:** recollections grow: tool calls are text not carried before. Hence the block on `token-budgets` — the clamp must exist first.
- **Performance:** one hash per Turn per ingest. No `hnsw.ef_search` or `hnsw.iterative_scan` is set, because nothing needs them once the Conversation-scoped read is exact.
- **Configuration:** `PICHART_EMBED_MODEL` becomes a recorded choice, not a silent one. Documenting it stays with `audit-docs-debt`.
- **Triage:** the audit marked the ANN plan choice `[INFERENCE]`; task 1.1 settled it with `EXPLAIN` against a seeded corpus, and the change sidesteps the approximate path rather than asserting a plan for it.
- **Unblocks:** `store-hygiene`. Completes the recall half of the defect the audit pairs with pack size.
