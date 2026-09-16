## Context

`similarTurns` orders by `embedding <=> vector` — cosine distance — with a tie-break on Turn index, and returns the first N. Distance is computed but never looked at, so relevance is entirely relative: the nearest Turn wins whether it is near or not.

The measurement from `pack-inspector` on a five-Turn session: asked about retries, recall returned the retries decision *and* Turns about a river and a colour, and the Budget was never the binding constraint. Both are the same fact seen twice.

Pack parts already carry `carried`, `budget` and `candidates`, and the inspector already distinguishes "trimmed" from "found less than it could carry". That vocabulary is the right shape for this change; it needs one more distinction.

See `proposal.md` for motivation and the two delta specs for the contract.

## Goals / Non-Goals

**Goals:**

- A pack that carries a recollection only when it is worth carrying.
- A threshold chosen from measurement on real Turns, not from a plausible-looking constant.
- Enough reporting that the next person can re-judge it with their own data.

**Non-Goals:**

- A better embedding model, chunking, reranking, hybrid search. The evidence points at a threshold; anything else is a guess wearing a bigger hat.
- Per-Conversation or adaptive thresholds. One number, tunable, until something shows one number is wrong.

## Decisions

### The floor is a distance, applied in SQL

pgvector's `<=>` yields cosine distance in `[0, 2]`; smaller is nearer. The query gains `WHERE embedding <=> $vector < $maxDistance`, so the database rejects what it was already measuring and returns less over the wire. The alternative — filtering in the Assembler — would mean transporting and de-serialising Turns solely to discard them.

Distance, not similarity, because that is what the index computes and what the operator returns. Converting to a friendlier 0-to-1 similarity at the boundary would introduce a second number meaning the same thing, and those diverge.

### The default is measured, not chosen

The threshold ships at whatever value separates the retries decision from the river and the colour on the recorded session, with a margin. Task 1 is to measure the actual distances before writing the constant, because a constant chosen first and justified later is exactly the kind of number nobody dares change.

### Retrieval reports what it rejected

`similarTurns` returns the Turns plus how many it excluded as too distant. Without that number a quiet recall is ambiguous — nothing relevant happened, or the threshold is too tight — and the difference is the whole question when tuning. It flows into the pack part as `irrelevant`, distinct from `dropped`, which remains the Budget's doing.

### A part that finds nothing is absent, not empty

When everything falls below the floor there is no recalled part, exactly as with a Budget of zero. The rejection count is still recorded on the Call, so "recall found nothing relevant" stays visible in the inspector without an empty part cluttering every pack that had nothing to recall.

## Risks / Trade-offs

- **Too tight a threshold silently removes useful recall** → the rejection count makes tightness visible rather than mysterious, and the threshold is configurable per session like the Budgets.
- **Cosine distance on a small embedding model is not a calibrated relevance score** → true, which is why the default is measured on real Turns rather than reasoned about, and why the number is exposed rather than buried.
- **The threshold interacts with the over-fetch** — retrieval asks for more than the Budget so the Assembler can drop tail duplicates → the floor is applied before the limit, so over-fetching still returns only relevant Turns.
- **Distances shift if the model ever changes** → the model and its dimension are already pinned, and a change already invalidates every stored vector; the threshold belongs to the same pin.

## Testing seams

| Requirement | Seam |
| --- | --- |
| Retrieval ranks turns by similarity (modified) | Store boundary against real pgvector: the floor lives in SQL, so only real SQL can prove it filters without disturbing order. |
| A turn below the threshold is not returned | Store boundary, with a threshold tight enough to exclude everything. |
| The threshold does not disturb ranking | Store boundary: same query with and without a permissive floor, compare order. |
| Retrieval reports what the threshold excluded | Store boundary: assert the rejection count against a known corpus. |
| A part reports how much of its budget it spent (modified) | `assemble()` boundary for what a part records; inspection API for how it reads. |
| Irrelevance is distinguished from a budget | Inspection API boundary, with a part that was neither trimmed nor full. |

The stub embedder makes distances predictable enough to assert ordering and exclusion without a model; one gated test confirms the default threshold does the intended thing with the real model, since that is the only place the number means anything.

## Open Questions

None. The threshold's value is task 1's measurement, not a deferred decision.
