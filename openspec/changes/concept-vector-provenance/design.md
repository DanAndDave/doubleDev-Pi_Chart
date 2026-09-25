## Context

`recall-fidelity` established what a stored vector is worth: valid for the content that produced it and the model that made it, invalid otherwise, and repaired by the same pass that embeds a new one (the Thread Store's "A stored vector is valid only for the content and the model that produced it"). The Doc Store's index predates that rule and never acquired it — `concept_sections` records `hash` but no model, and `searchConcepts` has no model predicate where `similarTurns` has one.

## Goals / Non-Goals

**Goals:**

- One rule about stored vectors across both embedded Stores.
- A model change that costs a re-embedding rather than a silent mis-ranking.
- A thin curated part that says why it is thin.

**Non-Goals:**

- The width refusal: already enforced before anything is written.
- Choosing or pinning a model; `CM_EMBED_MODEL` is the operator's.
- Changing ranking, thresholds, or what a search returns once the candidates are the right ones.

## Decisions

### The column, and what absent means

One nullable `embedding_model` on `concept_sections`, written with the vector. Absent means a row written before this rule existed, which cannot be shown to match the model in use — so it is not ranked and is re-embedded on the next pass. That costs one pass over the bundle when this lands, which is the same price Turns paid, and the alternative — treating absent as "probably the pinned model" — assumes the one thing the column exists to stop assuming.

### The predicate sits where `similarTurns` puts it

Inside the `nearest` CTE, beside `embedding IS NOT NULL`, so the nearest-neighbour stage never considers a stranger and the candidate window is filled with sections that can actually be returned. Filtering after the window would let strangers crowd out real candidates and return fewer Concepts than the Budget allows, which is the failure mode the width refusal already exists to prevent one level up.

### Staleness is decided where hashes already are

`embedSections` compares each section's hash against the indexed one. It now reads the model with it and treats a differing model exactly as a differing hash: the section is re-embedded. That keeps one notion of "out of date" in one place, and keeps the pass hash-keyed — an unchanged corpus under an unchanged model still embeds nothing, which is the property `doc-store-recall` measured and this must not cost.

### What could not be searched is counted, not named

`ConceptMatches` already carries `rejected` and `misses` for Concepts the threshold refused. A section from another model was not refused — it was not searched — so it is reported as a count beside them, the way recall reports `unsearched` for Turns. Naming them would suggest they are near misses, and they may be anything at all.

## Risks / Trade-offs

- **One re-embedding of every bundle on first run** → off the request path, hash-keyed afterwards, and the same cost Turns paid. A bundle of a few hundred sections is seconds.
- **A search during that pass returns less** → and says so, which is the requirement's second half. The alternative is returning something wrong quietly.
- **A second column that must be written everywhere a vector is** → there is exactly one place that writes vectors into this table.

## Testing seams

| Requirement | Seam |
| --- | --- |
| A vector from another model is never a hit | Store boundary (`CM_DATABASE_URL`), two stub embedders naming different models. |
| A section left behind by a model change is repaired | Store boundary: index under one model, re-index under another, count what was embedded. |
| An unchanged corpus under an unchanged model embeds nothing | Store boundary: the existing idempotence test, which must keep passing. |
| What the search could not see is reported | Store boundary: assert the count, not the identities. |

`StubEmbedder` already takes a model name for exactly this purpose (`src/embedder.ts`), so none of it needs the real model.

## Open Questions

None.
