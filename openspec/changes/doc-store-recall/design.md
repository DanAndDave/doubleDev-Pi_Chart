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

So a Concept is split at its top-level headings — level one, which is OKF's own convention, or level two, which hand-written Concepts tend to use — each section embedded with the Concept's title prepended so a section retains what it is about. A piece too short to be a subject (`# Status`, `# Supersedes`) is joined to the one before it rather than dropped: a section nothing embeds is a section nothing can retrieve. Retrieval returns Concepts, deduplicated, ranked by their best-matching section: the agent wants the Concept, the sections are how it is found.

This is the chunking `thread-store-recall` deliberately did not do for Turns. It is justified here and not there because a Turn is already the unit the Assembler serves, while a Concept is a document.

### Trust and lifecycle are filters and tie-breakers, not score adjustments

Deprecated Concepts are excluded in SQL — the spec says withheld, not down-weighted, because a superseded decision presented as current is the specific failure this Store must not have.

Among comparable matches, the ordering prefers current over stale and human-reviewed over unverified. Deliberately a tie-break rather than a weight added to the distance: mixing a trust score into a similarity score produces a number that means neither, and nobody can then say why a Concept was chosen.

"Comparable" is within 0.05 of the best match — relative to that match, not an absolute bucket. A fixed bucket separates 0.249 from 0.251 while joining 0.151 to 0.249, which is an arbitrary line dressed as a rule.

### The index is derived, keyed by content

Each indexed section records a hash of its text. Re-indexing embeds only sections whose hash is absent or changed, and deletes sections no longer present — so an edit costs one Concept, and a deleted Concept leaves. This is the same relationship ADR-0002 establishes for the Thread Store: the bundle is the record, the index is rebuildable, and dropping it loses nothing.

Keyed by the Concept's rename-stable identity rather than its path, which is exactly why `doc-store-bundle` assigned one: a `git mv` must not orphan an index entry.

### The threshold is measured for prose, and lands in the same place

0.50 was measured on conversational Turns twice. Curated prose is longer, more formal, and more uniform in register, so there was no reason to assume the number transfers. Measured against a corpus built from this repo's own ADRs and glossary:

| query | best section | best whole Concept |
| --- | --- | --- |
| "why do we run as an extension instead of owning the agent loop" | **0.255** | 0.280 |
| "is the thread store the source of truth or derived" | **0.244** | 0.258 |
| "what does the term Floor mean in this project" | 0.419 | **0.405** |
| "how do I bake sourdough bread at home" | 0.610 | 0.632 |
| "what is the capital of Peru" | 0.651 | 0.653 |

Genuine 0.244–0.419, unrelated 0.610–0.653 — a wider gap than conversation gave (0.399 to 0.549), because prose says more per document. **0.50** again, measured separately and kept, with its own setting so the two Stores can diverge when evidence says they should.

The same measurement undercuts half the case for sections: they win on focused documents (0.255 against 0.280) and lose slightly on list-shaped ones like the glossary (0.419 against 0.405). Sections stay, but on the functional argument alone — a query matching one section must retrieve its Concept — not on a distance improvement that does not reliably exist.

### Concepts enter the pack as attributed knowledge

A Concept arrives as one message identifying it by Concept ID, the way a recalled Turn identifies its position. Curated knowledge the agent did not just derive must be visibly borrowed, or it cannot be questioned.

## Risks / Trade-offs

- **Sections make the index bigger and the code more complex than one vector per Concept** → the alternative averages distinct subjects into an unmatched blur; the cost is one hash column and a group-by.
- **Trust as a tie-break may be too weak to matter** → it is measurable through the pack inspector, which already shows what a part carried, so the next decision has evidence.
- **A third retrieval per Call** → each is one nearest-neighbour query shaped so the HNSW index can serve it, and the Doc Store's runs in parallel with the Thread Store's rather than after it.
- **One embedder process serves indexing and retrieval** → indexing is therefore not free of the request path: a Call's query embedding queues behind whatever the worker is doing. Indexing runs in batches of 32 sections, so a query waits for a batch rather than for the corpus. A second worker would remove the wait and double the resident model; that trade is worth revisiting only if the wait is ever measured as a problem.
- **A bundle path that is wrong looks exactly like a bundle that is empty** → so the reader refuses to treat a missing directory as an empty corpus, and the index is left alone rather than pruned to nothing.
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
