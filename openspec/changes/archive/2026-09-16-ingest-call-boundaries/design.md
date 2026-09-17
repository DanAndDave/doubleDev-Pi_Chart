## Context

`thread-store`'s ingest requirement says content is addressed by Conversation, Turn, **and Call**. Two of those are stored; `turn_messages` is keyed `(conversation_id, turn_index, ordinal)`.

The Call boundary is not missing from the source — the Journal marks it. `readJournal` already counts it (`JournalTurn.callCount`, incremented on each `contextSnapshot`) and then throws the position away. So this is a dropped field rather than an unavailable one, which is why it is worth closing rather than amending away.

## Goals / Non-Goals

**Goals:**

- Stored content that says which Call within its Turn produced it.
- A visible surface for that, so the column is not write-only.

**Non-Goals:**

- Changing what recall retrieves or how it ranks. A Turn remains the unit of retrieval; this is addressing, not relevance.
- Re-ingesting history to backfill Calls that were never recorded.

## Decisions

### A Call ends at the snapshot that recorded it

The harness attaches a `contextSnapshot` to the message a Call produced, and the Assembler's own `addressOf` counts snapshots seen so far to decide which Call it is being asked for. Ingest uses the same arithmetic in the same direction: a message belongs to the current Call, and a message carrying a snapshot is the last of its Call.

Anything else would put ingest and accounting on different definitions of the same word, which is the kind of divergence that only shows up when someone is trying to explain a pack.

### Content whose Call is unknown belongs to the first one

A Journal with no snapshots at all — an older session, or a Turn the harness never reported — yields Call 0 for everything rather than a null. Zero is what such a Turn actually is: one Call, whether or not it was recorded as such. A nullable column here would make every reader handle an absence that carries no information.

That also makes the migration free: existing rows default to 0, which is correct for every Turn that was answered in one Call and honest for the rest.

### The visible surface is how much work a Turn took

Per-message Call indices are the record; what a person can act on is the count. A found Turn reports how many Calls it took, so a recollection can say "this took four Calls" — which is the difference between a question that was answered and one that was fought with.

## Risks / Trade-offs

- **A column nothing reads is dead weight** → hence the count on found Turns; it is one aggregate over data already stored.
- **Older rows claim Call 0 without evidence** → true, and the alternative is a null that every reader must interpret; the spec says so explicitly rather than leaving it implied.

## Testing seams

| Requirement | Seam |
| --- | --- |
| A turn answered in several calls | Store boundary: ingest a Journal with a tool loop, read back the Call of each message. |
| A turn answered in one call | Same seam, over a Journal with no snapshots. |
| Content stored before calls were recorded remains readable | Store boundary: a row written without a Call reads as Call 0. |
| A recollection says how much work its turn took | Store boundary, through the search path. |
| Ingest is repeatable | Store boundary: ingest twice, assert one row per message and the same Calls. |

## Open Questions

None.
