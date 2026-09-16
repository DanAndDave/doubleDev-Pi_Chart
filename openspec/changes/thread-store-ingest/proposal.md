# Proposal: Thread Store ingests the Journal

Triage: ready-for-agent
Blocked by: assembler-owns-window

## Why

The Assembler currently builds its verbatim tail from the message array the harness hands it, so its memory is exactly the harness's memory: clear the Conversation and the tail is gone, and nothing can be retrieved that the harness did not already carry. Every later slice — semantic recall, cross-Conversation retrieval, pack inspection — needs Turns in a store that outlives the process rather than in the argument to a callback.

This is also the slice that proves the seam placed in `assembler-owns-window` was placed correctly. If the Assembler stays untouched while the source of Turns changes underneath it, the boundary is right; if it does not, better to learn that now than four slices later.

## What Changes

- Add the Thread Store: Postgres with pgvector, run from a Compose file this project manages, with a schema and forward-only migrations the project owns.
- Ingest the harness's Journal into it — Turns, their prompts and responses, tool calls, tool results, and artifacts — addressed by Conversation, Turn, and Call, reusing the addressing `pack-accounting` already establishes.
- Source the Assembler's verbatim tail from the Thread Store rather than from the incoming message array, so it survives `/clear`, resume, and restart.
- Keep retrieval scoped to the current Conversation. Reaching wider is not added here and must never happen implicitly.
- Move accounting off its interim local JSONL file and into the same store, which is the shape it was written for.

**Not in scope:** embeddings, semantic search, and ranking — those are `thread-store-recall`. Ingest stores the text; it does not index it.

## Capabilities

### New Capabilities

- `thread-store`: Durable, queryable record of what happened in a Conversation — Turns, tool calls, results, and artifacts — derived from the Journal and rebuildable from it. Covers ingest, addressing, scoping, and the durability guarantees the Assembler now depends on.

### Modified Capabilities

- `context-assembly`: The verbatim tail becomes a retrieval from the Thread Store rather than a slice of the incoming array, which changes what the Assembler guarantees when the harness's own history is absent. Requirement *Packs carry the prompt and a verbatim tail* gains durability across Conversation resets; a new requirement covers behaviour when the store is unreachable.
- `pack-accounting`: Accounting is read from and written to the Thread Store instead of a local file. The observable contract is unchanged; the requirement *Accounting is readable after the fact* is restated against the store so it is not pinned to a file on disk.

## Impact

- **New dependency:** Postgres with pgvector, run via Docker Compose. Requires a working Docker daemon on the developer's machine; recorded as a setup prerequisite in the README.
- **New dependency:** a Postgres client library, and a migration path the project owns.
- **Changed:** the Assembler's input. `assemble()` itself does not change — it already takes Turns — but what produces those Turns does.
- **Removed:** the interim local JSONL accounting file introduced by `assembler-owns-window` as a deliberate placeholder for this slice. Migrated, not kept alongside.
- **Test posture:** the store sits behind an interface narrow enough that the default suite runs with no container, per ADR-0002. Tests that need real SQL are gated like the live model tests.
- **Blocks:** `thread-store-recall`, and through it `cross-conversation-recall` and `pack-inspector`.
