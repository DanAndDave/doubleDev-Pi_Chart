# Proposal: Cross-Conversation retrieval

Triage: ready-for-agent
Blocked by: thread-store-recall

## Why

Everything the Thread Store knows is trapped in the Conversation that produced it. A decision made last week in another Codebase is stored, embedded, and unreachable — the agent will rediscover it, or contradict it. That is the case the Doc Store exists for when knowledge is curated deliberately, and it leaves nothing for the far commoner case where it was simply said once and never written down.

Scoping was enforced from the first slice precisely so that widening it would be a deliberate act rather than a drift. This is that act.

## What Changes

- Record which Codebase a Conversation belongs to, so a recollection from elsewhere can say where it came from.
- Add an explicit way to search every Conversation, returning matches with their Conversation and Codebase attached.
- Leave assembly alone. A Context Pack is still built from the current Conversation; reaching wider is an action the agent takes and whose result it sees, not something that silently changes what a pack contains.
- Re-measure the relevance threshold across a corpus of several Conversations, because the value now in force was calibrated within one.

**Not in scope:** making cross-Conversation content part of a pack's automatic recall. The whole design of scoping says widening should be asked for; an automatic wider tier would undo that in the same slice that enables it.

## Capabilities

### Modified Capabilities

- `thread-store`: requirement *Retrieval is scoped to one Conversation* gains the explicit wider search it has been reserving room for, and stored Turns gain the Codebase they belong to so results can be attributed.

### New Capabilities

- `cross-conversation-search`: Searching every Conversation on demand, with results attributed to where they came from, as an action rather than an assembly step.

## Impact

- **Schema:** Conversations gain a Codebase. One forward migration; existing rows read back with it absent until they are next ingested.
- **New surface:** a tool the agent can call. This is the first time the agent reaches for context rather than receiving it, which is a deliberate boundary: assembly stays deterministic and the reach is visible as a tool call in the transcript.
- **Threshold:** the default may need to change once measured across Conversations. Whatever the measurement says is what ships, as with `recall-relevance`.
- **Closes:** the Thread Store's original four acceptance criteria from the slicing session.
