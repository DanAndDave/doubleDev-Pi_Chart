# Proposal: Address ingested content by Call

Triage: ready-for-agent

## Why

`thread-store`'s requirement "The Journal is ingested into the store" says ingested content shall be addressed by Conversation, Turn, **and Call**. Two of the three are stored: `turn_messages` is keyed `(conversation_id, turn_index, ordinal)`.

The Call boundary is known while reading — `JournalTurn.callCount` counts the context snapshots — and then dropped. Nothing observable is broken today, because every scenario in that requirement exercises Conversation and Turn only, but a recalled Turn cannot say which Call within it said a thing, and the archived requirement is not met as written.

## What to build

Ingested messages carry the Call they belong to, so a recollection can cite one. Either that, or the archived requirement is amended to the two dimensions actually stored — but the divergence is not left standing.

## Acceptance criteria

- [ ] An ingested message records which Call within its Turn produced it
- [ ] Re-ingesting a Journal produces the same Call addressing
- [ ] A found Turn reports how many Calls it took, so the stored Call is not write-only
- [ ] A Journal whose Calls cannot be determined still ingests, addressed by Turn

## Non-goals

Changing what recall retrieves or how it ranks. This is an addressing gap, not a retrieval one.
