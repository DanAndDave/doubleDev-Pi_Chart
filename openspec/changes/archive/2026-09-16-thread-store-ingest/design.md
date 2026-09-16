## Context

`assembler-owns-window` left three things this slice consumes. `assemble(turns, config)` is pure and takes Turns, so changing where Turns come from should not touch it — this slice is the test of that claim. Calls are already addressed by Conversation, Turn, and Call, derived from the session rather than a counter, so ingest has an addressing scheme it does not need to invent. And accounting already writes an append-only local JSONL file that was explicitly a placeholder for this slice.

Two facts from that slice shape the work. The harness's Journal lives at `~/.omp/agent/sessions/<encoded-cwd>/<id>.jsonl`, one JSON object per line, with `message` entries carrying roles `user`, `assistant`, `toolResult`, and `developer`. And the branch the harness exposes at runtime already contains the full cross-process history, so ingest has a live source as well as an on-disk one.

Docker is a hard prerequisite: the daemon must be running and the user in the `docker` group. That was confirmed with the user rather than worked around.

See `proposal.md` for motivation, the three delta specs for the contract, and ADR-0002 for why the store is derived.

## Goals / Non-Goals

**Goals:**

- Turns survive the process, the harness's `/clear`, and a dropped database.
- The Assembler is untouched. If this slice has to change `assemble()`, the seam was wrong and that is worth knowing loudly.
- A default test suite that still runs with no container and no network.

**Non-Goals:**

- Embeddings, vector search, ranking. The pgvector extension is enabled so the next slice does not need a migration to turn it on, but nothing in this slice writes a vector.
- Cross-Conversation retrieval. Scoping is enforced here precisely so widening it later is a deliberate act.
- Ingesting other agents' sessions, or any Journal this harness did not write.

## Decisions

### Ingest reads the Journal, not the live branch

The branch is available in-process and would be the easy source, but ADR-0002 makes the Journal the record and the store a derived index. Ingesting from the branch would make the store a second original: rebuildable only while a session happens to be live, and never reproducible after the fact. Reading the JSONL means "drop the database and re-ingest" is a real operation rather than an aspiration, and it is what the rebuild scenario tests.

Consequence: ingest needs to locate the Journal for a Conversation. The harness gives the session id at runtime; the path is derived from it.

### Ingest is idempotent by address, not by diffing

Every ingested row is keyed by `(conversation, turn, call, ordinal)` — the addressing `pack-accounting` already computes — with an upsert on that key. Re-ingesting the same Journal rewrites the same rows; a grown Journal adds new ones. No cursor, no high-water mark, no "have I seen this file before" state to get wrong.

Alternative considered: track a byte offset per Journal and append only what is new. Faster, but it makes correctness depend on a second piece of state that can desynchronise from the store, and the volumes here are trivial.

### The Assembler gets a Turn source, not a database

A narrow `TurnSource` interface — "give me the last N Turns of this Conversation" — sits between the adapter and the store. The extension depends on that interface; Postgres implements it; the default test suite uses an in-memory implementation. This is what keeps the suite container-free per ADR-0002, and it is the same shape the Doc and Graph Stores will need.

### Degradation prefers the harness's history over nothing

When the store is unreachable, the tail falls back to the incoming message array — exactly the behaviour of the previous slice. That is a worse pack, not a broken Turn, and it is recorded: the Call's accounting marks the tail's provenance, so a session spent silently running on fallback is visible afterwards rather than mysterious.

### Accounting moves, it does not gain a second home

The JSONL writer is deleted rather than kept as a fallback. Two writers for one record is the ambiguity this project exists to avoid, and ADR-0002's "rebuildable" property means there is nothing to migrate: the Journal regenerates it.

## Risks / Trade-offs

- **The pack now depends on a database being up** → fallback to the harness's array keeps Turns working, and the fallback is recorded rather than silent.
- **Ingest on the hot path would delay the model request**, which `pack-accounting` forbids → ingest runs in the background like accounting writes; the tail read is the only synchronous store access, and it is a single indexed query.
- **A Journal that has not been flushed yet may lag the live Turn** → the current Turn always comes from the incoming array, never from the store; only completed Turns are retrieved. This also avoids a read-your-own-write race.
- **Docker is now required to develop the full suite** → default `bun test` stays container-free; store-backed tests are gated like the live model tests, and the prerequisite is in the README.
- **Postgres-specific SQL is a lock-in** → accepted deliberately. ADR-0002 already chose Postgres, and pgvector makes the next slice cheap.

## Testing seams

One seam per requirement, preferring the highest seam that can actually fail on the behaviour.

| Requirement | Seam |
| --- | --- |
| The Journal is ingested into the store | Ingest function boundary, against recorded Journal fixtures, asserted through the store's own query interface. |
| The store is derived and rebuildable | Ingest + `TurnSource` boundary: ingest, assemble, drop, re-ingest, assemble again, compare packs. |
| Retrieval is scoped to one Conversation | `TurnSource` boundary, two Conversations ingested. |
| The schema is versioned and applied forward | Store-backed test against a real empty database — the only seam where "the schema applies" means anything. |
| An unreachable store degrades safely | Extension handler boundary, with a `TurnSource` that rejects. |
| Packs carry the prompt and a verbatim tail (modified) | `assemble()` boundary for composition, unchanged from the previous slice; the store-backed tail is covered at the `TurnSource` boundary, and survival across a clear at the headless harness seam. |
| Accounting is readable after the fact (modified) | Accounting-reader boundary, now backed by the store. |

Store-backed tests run against a real Postgres from the Compose file, gated behind an environment flag as the live model tests are. The default suite exercises every seam above through the in-memory `TurnSource` except the schema requirement, which is meaningless without a real database.

## Open Questions

- Whether artifacts should be stored inline or by reference to the harness's content-addressed blobs. Deferred: the Journal externalises large tool results already, and the answer changes a column type rather than the specs, the approach, or the task breakdown.
