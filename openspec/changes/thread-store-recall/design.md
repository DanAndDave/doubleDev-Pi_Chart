## Context

The Thread Store already ingests Turns from the Journal, addresses them by Conversation and Turn, and serves the verbatim tail through a narrow `TurnSource` the Assembler depends on. `assemble(turns, config)` is pure and has survived one slice unchanged. The pgvector extension is enabled but nothing writes a vector, and pack parts already exist as a concept with per-part attribution in accounting.

The determining unknown was embeddings. No provider key is configured on this machine and there is no local inference server, so a hosted embedding API was never really available. A local model was smoke-tested before this plan was written: `bge-small-en-v1.5` under Bun, 384 dimensions, 2.1s to load, cosine 0.919 between two paraphrases of the same sentence. That is the basis for the decision below rather than an assumption.

See `proposal.md` for motivation, the two delta specs for the contract, and ADR-0003 for why the Assembler stays deterministic and model-free.

## Goals / Non-Goals

**Goals:**

- Recall that reaches a real decision from far outside the tail, demonstrably.
- Budgets that are enforced structure, not advice — the tail cannot be crowded out.
- Assembly still deterministic: same state, same pack, byte for byte.

**Non-Goals:**

- Reranking, hybrid keyword-plus-vector search, or query expansion. One similarity query, judged on whether it works.
- Cross-Conversation retrieval. Scoping stays enforced so widening it later is deliberate.
- Tuning the model choice. It is behind an interface; swapping it is a later decision with evidence behind it.

## Decisions

### Embeddings are local, and the model is pinned

A local sentence-embedding model, cached on disk, loaded once per process. No key to configure, no network per Turn, no per-token cost, and — the reason that matters most here — the same text always yields the same vector, which is what keeps ADR-0003's determinism claim true through a retrieval step.

Alternative considered: a hosted embedding API. Rejected on availability (no key configured) and on determinism: a remote model can change under a stable name, and a pack that silently changes because a vendor shipped a new revision is exactly the undiagnosable failure this project exists to avoid.

The model name and its dimension count are pinned in one place. Changing either invalidates every stored vector, so the migration that adds the column records the dimension, and a mismatch is an error rather than a silently wrong nearest neighbour.

### The Turn is the unit of embedding

One vector per Turn, over the Turn's prompt and its answer, rather than per message or per chunk. A Turn is already the unit the Assembler serves, the unit the tail counts, and the unit accounting addresses; introducing a second granularity here would mean mapping between them on every query for no demonstrated gain. Chunking is the obvious next lever if recall proves too coarse, and nothing in this design prevents it.

### Retrieval subtracts the tail rather than the store filtering it

The Assembler knows which Turns the verbatim tail already holds; the store does not. So retrieval asks for more than the Budget needs and the Assembler drops what the tail already covers. Pushing the exclusion into SQL would mean the store knowing about Budgets and tails, which is precisely the coupling the `TurnSource` seam exists to prevent.

### Ties are broken by Turn order

Two Turns with identical similarity must not swap places between runs. The query orders by similarity and then by Turn index, so ordering is total and deterministic. Without this, "the same state produces the same pack" is untrue in exactly the case nobody tests.

### Budgets are measured in Turns for now, not tokens

A Budget bounds how many Turns a part may contribute. Tokens are the honest unit and the eventual one, but the only token count available at assembly time is the local approximation already labelled approximate, and `pack-inspector` is the slice that turns measurement into tuning. Counting Turns is a real constraint that is honestly named, rather than a token budget enforced with a number we know to be wrong.

### Embedding runs after ingest, never before a request

Ingest already runs in the background at the end of a Turn; embedding attaches to it. A Turn that has not been embedded yet is simply not retrievable yet — never a reason to delay or fail a request. Backfill is the same operation applied to Turns with no vector, which makes "switch it on for an existing Conversation" the same code path as "keep up with a live one".

## Risks / Trade-offs

- **First use downloads a model** → cached afterwards; the loader is behind an interface, and the default suite uses a deterministic stub so no test depends on a download.
- **Recall could surface something irrelevant and confuse the agent** → recalled content is attributed as a recollection with its position, so the model can discount it, and the Budget bounds how much of the window it can occupy.
- **A model or dimension change invalidates every vector** → the dimension is recorded with the schema and a mismatch is an error; re-embedding is a backfill, which is already resumable.
- **Turn-granularity embeddings may be too coarse for long Turns** → accepted for now; chunking is the next lever and the interface does not preclude it.
- **Similarity search over a growing table** → an index is created with the column; at the scale of one developer's Conversations this is not yet a real constraint, and pretending otherwise would be premature.

## Testing seams

| Requirement | Seam |
| --- | --- |
| Ingested turns are embedded | Store boundary against a real database, with the stub embedder: ingest, embed, assert a vector exists. |
| Embedding backfill is resumable | Store boundary: embed, add a Turn, backfill, assert only the new Turn was embedded. |
| Retrieval ranks turns by similarity | Store boundary against real pgvector — ordering by distance is the database's job, and a fake would only prove our arithmetic. |
| Packs carry recalled turns under their own budget | `assemble()` boundary, with recalled Turns supplied directly. |
| Budgets bound each part of a pack | `assemble()` boundary: over-supply matches, assert trimming and that the tail survives. |
| Assembly is deterministic (modified) | `assemble()` boundary for ordering; store boundary for tie-breaking, which only real SQL can order wrongly. |

The embedder is injected. The default suite uses a deterministic stub — a hash-derived vector — so ranking behaviour is asserted without a model download; one gated test exercises the real model to prove the stub is not the only thing that works. Store-backed tests run against the Compose database as before.

## Open Questions

- Whether recalled Turns should be summarised rather than carried whole once Budgets are measured in tokens. Deferred to `pack-inspector`, which produces the evidence; it changes a Budget policy, not the specs or the task breakdown.
