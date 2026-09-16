# Proposal: Recall earns its place

Triage: ready-for-agent
Blocked by: None (pack-inspector is archived)

## Why

`pack-inspector` measured what recall actually does, and it does the wrong thing. Asked "what did we decide about retries?", a pack recalled turns 1, 3 and 0 — the retries decision, and two unrelated Turns about a river and a colour. Recall carried 2.25 of its Budget of 3 across the session and was never trimmed.

Both facts say the same thing: retrieval returns the nearest Turns whether or not they are near. A Budget is a ceiling, not a filter, so with nothing else to say, recall fills the window with whatever ranked highest — and every irrelevant recollection is window spent on noise plus an invitation for the model to follow it.

This slice gives recall a floor: a Turn must be similar enough to be worth carrying, not merely more similar than the alternatives.

## What Changes

- Retrieval takes a minimum similarity and returns only Turns that meet it. Ranking is unchanged; what changes is that ranking alone no longer qualifies a Turn.
- A Conversation with nothing relevant to say contributes no recollections, rather than its three least-irrelevant Turns.
- The threshold is configurable, and the inspector reports how many candidates it excluded, so the setting can be tuned from evidence exactly as the Budget now is.

**Not in scope:** changing the embedding model, chunking Turns, reranking, or hybrid keyword search. The inspector's evidence points at a threshold, and this slice does only what the evidence supports.

## Capabilities

### Modified Capabilities

- `thread-store`: requirement *Retrieval ranks turns by similarity to the prompt* gains a relevance floor, so retrieval returns what is relevant rather than what is nearest.
- `pack-inspection`: a part's report distinguishes candidates excluded for being irrelevant from those excluded by the Budget, which is what makes the threshold tunable rather than a magic number.

## Impact

- **Behavioural:** packs will carry fewer recollections, sometimes none. That is the point, and the inspector is how we confirm it is an improvement rather than a regression.
- **Configuration:** one new setting, with a default chosen from measurement rather than taste.
- **No schema change:** similarity is computed at query time; nothing new is stored.
- **Unblocks judgement on `cross-conversation-recall`:** widening retrieval across Conversations before it had a relevance floor would have multiplied the noise this slice removes.
