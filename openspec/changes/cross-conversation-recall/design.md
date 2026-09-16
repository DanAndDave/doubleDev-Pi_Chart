## Context

`similarTurns` already does everything this slice needs except the scoping: it embeds a query, applies the relevance threshold in SQL, orders by distance with a tie-break, and reports what it refused. The only thing keeping it inside one Conversation is a `WHERE conversation_id = $1`.

What is missing is attribution. A Turn's row knows its Conversation but not the Codebase that Conversation happened in, and "we decided this in another project" is only useful if you can say which.

The harness gives `ctx.cwd`, and ingest already runs per Conversation, so the Codebase is available exactly where it needs recording.

See `proposal.md` for motivation and the two delta specs for the contract.

## Goals / Non-Goals

**Goals:**

- Reach the whole corpus when asked, with results that say where they came from.
- Leave assembly untouched, so the scoping guarantee the project has enforced since its first slice is still true of packs.
- Re-measure the relevance threshold across Conversations rather than assuming the within-Conversation number transfers.

**Non-Goals:**

- An automatic wider recall tier. Scoping exists so that widening is asked for; adding an automatic tier in the slice that enables widening would undo the point of both.
- Ranking that prefers or penalises other Conversations. One ordering, by distance, until evidence says otherwise.
- Searching Conversations the Thread Store has never ingested.

## Decisions

### The reach is a tool, and that is a deliberate boundary

The agent calls it; the result comes back as a tool result. That keeps two promises at once: assembly stays deterministic and model-free (ADR-0003), because nothing the agent does here changes how a pack is built; and the reach is visible in the transcript, so a session that went looking elsewhere can be read back later.

The alternative — a second, wider recall tier inside assembly — was rejected twice over. It would make packs depend on a corpus that grows without the Conversation changing, so "the same state produces the same pack" would quietly stop being true. And it would spend window on other projects' content on every Call rather than when someone wanted it.

Cost: the agent must decide to look, and it will sometimes not bother. That is the honest trade, and a deterministic assembler that occasionally misses beats a nondeterministic one that occasionally surprises.

### Codebase is recorded on the Turn, not in a separate table

One column beside the Conversation. A Conversations table would be the normalised answer, but the only attribute is the Codebase, it never changes for a given Conversation, and a join on every retrieval buys nothing. If Conversations grow attributes, the table can arrive then.

Rows ingested before the column existed read back with it absent — the spec says so explicitly — rather than being backfilled, because ADR-0002 makes the Journal the record and a re-ingest restores it for free.

### The threshold is re-measured, not inherited

`recall-relevance` calibrated 0.50 within a single Conversation, and closed noting that a cross-Conversation corpus would stress it hardest: matches now compete against everything ever said, so the nearest thing to a query is far more likely to be a coincidence. Task 1 measures against a corpus of several real Conversations and the search ships with whatever that says — the same discipline, applied to the case it was flagged for.

### Search is bounded and reports nothing rather than something weak

Same relevance threshold, same behaviour when nothing qualifies: return nothing. A cross-Conversation search that always finds something would be worse than useless, because the agent asked precisely because it did not know.

## Risks / Trade-offs

- **A wider corpus makes coincidental matches likelier** → the threshold is re-measured for this case, and results carry their origin so a recollection from an unrelated project is recognisable as one.
- **The agent may not think to search** → accepted; the alternative costs determinism. A later slice can measure how often searching would have helped, now that the inspector exists.
- **Recording the Codebase makes the store's rows machine-specific** → they already are: the store is a derived index of one machine's Journals.
- **Searching every Conversation scans more rows** → the same ANN index serves it; the query loses only its `conversation_id` predicate.

## Testing seams

| Requirement | Seam |
| --- | --- |
| Every conversation can be searched on request | Store boundary against real pgvector, with two Conversations ingested. |
| Results say where they came from | Store boundary, including a Turn ingested before Codebases were recorded. |
| Retrieval is scoped to one Conversation (modified) | Store boundary for retrieval; `assemble()` boundary for the pack, which must be unchanged. |
| The Journal records its Codebase (modified) | Store boundary: ingest with a Codebase, read it back. |
| Searching is an action, not an assembly step | Extension handler boundary: register the tool, assert a pack assembled with it available is identical to one without. |
| A search failure is reported, not fatal | Tool boundary with a rejecting store. |

## Open Questions

None. The threshold's cross-Conversation value is task 1's measurement.
