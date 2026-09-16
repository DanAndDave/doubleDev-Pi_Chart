# Proposal: Thread Store semantic recall

Triage: ready-for-agent
Blocked by: thread-store-ingest

## Why

The Thread Store holds every Turn, and the Assembler reads only the last N of them. Everything older is stored and unreachable — the agent forgets a decision made forty Turns ago as completely as if it had never been recorded. That is the gap between having a memory and using one.

This slice closes it: Turns are embedded, the current prompt retrieves the relevant ones, and they enter the Context Pack under a Budget of their own. It is also the first slice where a pack contains something the Conversation did not literally just say, which makes Budgets real rather than theoretical.

## What Changes

- Embed ingested Turns locally with a fixed model, stored as vectors in the Thread Store's existing pgvector column space. No API key, no network after the model is cached, and the same text always yields the same vector.
- Retrieve the Turns most similar to the current prompt, excluding those the verbatim tail already carries, and add them to the Context Pack as a distinct part.
- Give every part of a pack a Budget. Recall spends its own and cannot crowd out the verbatim tail; exceeding a Budget drops the weakest matches, never the tail.
- Attribute recalled content: a Turn lifted out of the past is presented as a recollection with its position, not as something just said.
- Backfill embeddings for Turns already ingested, resumably, so switching this on does not require re-ingesting a Conversation.

**Not in scope:** cross-Conversation retrieval, which stays explicitly out until `cross-conversation-recall`; the Doc Store's own index, which is `doc-store-recall`; and any change to how Turns are ingested.

## Capabilities

### New Capabilities

None. This extends two capabilities that already exist.

### Modified Capabilities

- `thread-store`: gains embedding and similarity retrieval over ingested Turns, and a resumable backfill. Retrieval remains scoped to the current Conversation; the requirement saying so now also governs the new path.
- `context-assembly`: a Context Pack gains a recalled part alongside its verbatim tail, and Budgets become a specified property of assembly rather than an idea in the design. The determinism requirement is restated to cover retrieval, which must not make packs vary between identical states.

## Impact

- **New dependency:** a local embedding runtime and a small sentence-embedding model, cached on disk after first use. Chosen over a hosted embedding API because no key is configured, and because a local model keeps assembly deterministic and offline.
- **Schema:** a vector column and an index on it. The pgvector extension is already enabled, so this is one forward migration with no data change.
- **Ingest path:** embedding happens after ingest, in the background, never on the model request's path.
- **Assembly path:** one similarity query per Call, alongside the existing tail query.
- **Blocks:** `cross-conversation-recall` and `pack-inspector`.
