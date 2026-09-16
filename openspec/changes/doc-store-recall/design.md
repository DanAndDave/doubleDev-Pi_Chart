## Context

`doc-store-bundle` left a reader: Concepts parsed from markdown with frontmatter, conformance checked, trust tiers and staleness derived, `Level` listings walked, and rename-stable identity assigned. None of it is indexed and none of it reaches a pack.

Everything the indexing needs already exists elsewhere. The embedder runs out-of-process behind an interface; pgvector is enabled; `Pack` already supports parts with their own Budgets and per-part accounting; retrieval with a relevance threshold and a stable tie-break is written twice over.

What is genuinely new is that a Concept is not a Turn. It is curated prose with a lifecycle, it is long enough that one vector per Concept would average several subjects together, and it carries trust signals the Thread Store has no equivalent of.

See `proposal.md` for motivation and the two delta specs for the contract.

## Goals / Non-Goals

**Goals:**

- Curated knowledge reaching packs in any Codebase, attributed as curated.
- An index that stays current at the cost of the edit, not the corpus.
- Retrieval that will not hand the agent a decision that has been superseded.

**Non-Goals:**

- Re-ranking models, query expansion, or hybrid keyword search.
- Multiple bundles or cross-bundle search. One machine-wide bundle.
- Writing to the bundle beyond the identity assignment already in place.

## Decisions

### The unit of retrieval is a section, not a Concept

OKF's own body convention is structural markdown — `# Schema`, `# Examples`, `# Computation` — and a Concept that covers a definition, a rationale and a migration note in three sections has three subjects. One vector for all three is the average of three things and matches none of them well.

So a Concept is split at its top-level headings, each section embedded with the Concept's title prepended so a section retains what it is about. Retrieval returns Concepts, deduplicated, ranked by their best-matching section: the agent wants the Concept, the sections are how it is found.

This is the chunking `thread-store-recall` deliberately did not do for Turns. It is justified here and not there because a Turn is already the unit the Assembler serves, while a Concept is a document.

### Trust and lifecycle are filters and tie-breakers, not score adjustments

Deprecated Concepts are excluded in SQL — the spec says withheld, not down-weighted, because a superseded decision presented as current is the specific failure this Store must not have.

Among comparable matches, the ordering prefers current over stale and human-reviewed over unverified. Deliberately a tie-break rather than a weight added to the distance: mixing a trust score into a similarity score produces a number that means neither, and nobody can then say why a Concept was chosen. "Comparable" is a small distance band, so relevance still dominates.

### The index is derived, keyed by content

Each indexed section records a hash of its text. Re-indexing embeds only sections whose hash is absent or changed, and deletes sections no longer present — so an edit costs one Concept, and a deleted Concept leaves. This is the same relationship ADR-0002 establishes for the Thread Store: the bundle is the record, the index is rebuildable, and dropping it loses nothing.

Keyed by the Concept's rename-stable identity rather than its path, which is exactly why `doc-store-bundle` assigned one: a `git mv` must not orphan an index entry.

### The threshold is measured for prose, not inherited

0.50 was measured on conversational Turns twice. Curated prose is longer, more formal, and more uniform in register, so its distance distribution is a different shape. Task 1 measures against real Concepts — this repo's own ADRs and `CONTEXT.md` make a corpus that exists — and the Doc Store ships with whatever that says, even if it matches.

### Concepts enter the pack as attributed knowledge

A Concept arrives as one message identifying it by Concept ID, the way a recalled Turn identifies its position. Curated knowledge the agent did not just derive must be visibly borrowed, or it cannot be questioned.

## Risks / Trade-offs

- **Sections make the index bigger and the code more complex than one vector per Concept** → the alternative averages distinct subjects into an unmatched blur; the cost is one hash column and a group-by.
- **Trust as a tie-break may be too weak to matter** → it is measurable through the pack inspector, which already shows what a part carried, so the next decision has evidence.
- **A third retrieval per Call** → each is one indexed query, and the Doc Store's runs in parallel with the Thread Store's rather than after it.
- **A bundle that is never indexed silently contributes nothing** → retrieval against an empty index returns nothing rather than failing, and the inspector shows the part absent, which is the same signal as a Conversation with nothing relevant.

## Testing seams

| Requirement | Seam |
| --- | --- |
| Concepts are indexed for retrieval | Store boundary against real pgvector, over a fixture bundle. |
| A long concept is divided rather than averaged | Section-splitting boundary, plus a store test retrieving one section's subject. |
| Re-indexing covers only what changed | Store boundary: index, edit one Concept, index again, assert what was embedded. |
| Retrieval respects lifecycle and trust | Store boundary: a deprecated Concept as nearest match; a stale and a current Concept at comparable distance. |
| Packs carry curated knowledge under its own budget | `assemble()` boundary. |
| The doc budget is independent of the others | `assemble()` boundary: exhaust one Budget, assert the others intact. |
| The pack is accounted for by part | Inspection API boundary. |

## Open Questions

None. The threshold and the section size are task 1's measurement.
