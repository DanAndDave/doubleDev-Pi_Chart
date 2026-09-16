# Proposal: Doc Store retrieval

Triage: ready-for-agent
Blocked by: doc-store-bundle

## Why

The Doc Store is readable and validated, and nothing reads it. It is the one layer that outlives every Codebase — the place a standard or a hard-won conclusion lives once and applies everywhere — and today it reaches no Context Pack at all.

It is also the layer where retrieval quality matters most. The Thread Store recalls what was said; the Doc Store recalls what was *decided*, deliberately written down and reviewed. A pack carrying a stale or deprecated Concept as though it were current is worse than one carrying nothing, which is why trust and freshness — already parsed and unused — become part of what retrieval considers.

## What Changes

- Index the bundle: Concepts are chunked, embedded, and stored so they can be found by meaning. The index is derived from the bundle and rebuildable from it, exactly as the Thread Store is derived from the Journal.
- Re-index only what changed. A corpus that must be rebuilt whole every time is a corpus nobody keeps current.
- Retrieve Concepts into the Context Pack as their own part, under their own Budget, subject to a relevance threshold measured for curated prose rather than inherited from conversational Turns.
- Let trust and freshness count: a deprecated Concept is not retrieved at all, and among Concepts of comparable relevance, current and human-reviewed ones come first.
- Attribute what is carried. A recalled Concept enters the window as knowledge with a source, not as something the agent apparently already knew.

**Not in scope:** authoring or editing Concepts, cross-bundle search, and any change to how the Thread Store retrieves.

## Capabilities

### Modified Capabilities

- `doc-store`: gains an index over its Concepts, incremental re-indexing, and retrieval by meaning that respects lifecycle and trust.
- `context-assembly`: a Context Pack gains a Doc Store part with its own Budget, alongside the verbatim tail and recalled Turns.

## Impact

- **Schema:** a table of Concept chunks with vectors, in the same database. Derived and rebuildable; dropping it loses nothing the bundle does not hold.
- **Configuration:** a Budget for the Doc Store part and a relevance threshold for it, both measured before a default is written.
- **Assembly:** one more retrieval per Call, in parallel with the Thread Store's, and one more part competing for the window.
- **Completes:** the Doc Store, and with it the third of the four Stores.
