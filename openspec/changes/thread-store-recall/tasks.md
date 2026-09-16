## 1. Embedder

- [ ] 1.1 Define the embedder interface the store depends on, with a deterministic stub for the default suite, and verify the same text yields an identical vector
- [ ] 1.2 Implement the local embedder against a pinned model and dimension, loaded once per process, and verify in a gated test that two paraphrases rank closer than two unrelated sentences
- [ ] 1.3 Record the pinned dimension with the schema and reject a vector of the wrong size, and verify the mismatch is an error rather than a silent write

## 2. Storing vectors

- [ ] 2.1 Add the forward migration creating the vector column and its index, and verify it applies to the existing database without disturbing stored Turns
- [ ] 2.2 Embed each Turn after ingest, away from the request path, and verify an ingested Turn gains a vector
- [ ] 2.3 Verify an embedding failure is reported and leaves the Turn ingested and the request unaffected
- [ ] 2.4 Implement backfill over Turns lacking a vector, and verify a Conversation ingested before embeddings becomes retrievable without re-ingesting
- [ ] 2.5 Verify backfill embeds only what still lacks a vector when it runs again

## 3. Retrieval

- [ ] 3.1 Implement similarity retrieval for a prompt, most similar first, limited to a requested count, and verify the Turn on the matching subject ranks above the others
- [ ] 3.2 Verify retrieval never returns a Turn from another Conversation
- [ ] 3.3 Break ties by Turn order and verify equally similar Turns come back in a stable order across repeated queries
- [ ] 3.4 Verify a Conversation with no vectors retrieves nothing and does not raise

## 4. Recall in the pack

- [ ] 4.1 Extend the Assembler to carry recalled Turns as their own part, attributed with their position in the Conversation, and verify a recalled Turn is distinguishable from the current exchange
- [ ] 4.2 Exclude Turns the verbatim tail already carries, and verify a Turn is never duplicated between parts
- [ ] 4.3 Give each part a Budget and trim to it, dropping the weakest matches first, and verify the tail and current prompt are never dropped
- [ ] 4.4 Verify a recall Budget of zero yields a pack with no recalled Turns and no other change
- [ ] 4.5 Verify assembly remains deterministic with recall in play

## 5. Wiring

- [ ] 5.1 Wire retrieval into the extension so a pack draws recall from the Thread Store, and verify accounting attributes tail and recall to separate parts
- [ ] 5.2 Make retrieval failure fall back to a pack without recall, reported, and verify the Turn completes

## 6. Verification

- [ ] 6.1 Run a real session that states a decision, buries it beyond the verbatim tail, then asks about it, and confirm the agent answers from recall
- [ ] 6.2 Run the default suite with no container and no model, then the store-backed and gated model suites, and confirm all pass
- [ ] 6.3 Run the type checker and confirm `openspec validate thread-store-recall` passes
