# Proposal: A Concept's Vector Says Which Model Made It

Triage: ready-for-agent

## Why

`recall-fidelity` gave every Turn's vector the model that produced it, so swapping the embedder is a re-embedding rather than a corruption: `similarTurns` ranks only vectors from the model in use, counts the rest as `unsearched` so a thin recall is explained rather than mysterious, and `embedPending` re-embeds them in the background.

`concept_sections` never got the same treatment, and nothing noticed until `audit-docs-debt` tried to write down what a model swap costs. The table has `hash`, `text` and `embedding` and no model; `searchConcepts` orders by distance with no model predicate; and `embedSections` re-embeds a section only when its text hash moves. So after a same-width swap — `CM_EMBED_MODEL` set to another model of 384 dimensions — curated knowledge ranks the new model's query against the old model's vectors, and keeps doing it until the bundle's text changes or someone drops the index. Two vector spaces compared as one is the failure ADR-0003 calls undiagnosable: the Concept that comes back is wrong for a reason nothing reports.

A differing *width* is already refused (`embedPending`, `indexConcepts`), so this is only about models that fit the schema and mean different things by the same coordinates.

## What Changes

- Each indexed section records the model that embedded it, as a Turn does.
- Concept search ranks only sections embedded by the model in use. A section from another model is not a near miss and is not reported as one — it was not searched.
- A section whose recorded model differs from the model in use is re-embedded by the next indexing pass, whether or not its text changed. The pass stays hash-keyed for everything else, so an unchanged corpus under an unchanged model still embeds nothing.
- What a search could not see is reported, as recall already reports `unsearched`: a Call whose curated part came back thin because half the index belongs to another model should say so rather than read as a corpus with nothing relevant.

**Not in scope:** the width refusal, which already exists; re-embedding Turns, which `recall-fidelity` shipped; changing what is retrieved or how it is ranked once the candidates are the right ones.

## Capabilities

### Modified Capabilities

- `doc-store`: gains the provenance requirement `thread-store` already carries for Turns — a vector is ranked only against vectors from the same model, and one from another model is re-embedded rather than compared.

## Impact

- **Schema:** one nullable `embedding_model` column on `concept_sections`, and one nullable `concepts_unsearched` on `call_accounting` so a Call's own record says what its curated part could not see — both through the existing migration list. Derived and rebuildable on ADR-0002's terms; rows written before it read as belonging to no known model, which is exactly what they are.
- **Migration:** every existing section is re-embedded once, on the first indexing pass after this lands, because a section with no recorded model cannot be shown to match the model in use. That is one pass over the bundle, off the request path, and it is the same price `recall-fidelity` paid for Turns.
- **Assembly:** unchanged. The predicate is inside the search the Doc Store already runs.
- **Performance:** one more column in one index write; no extra statement, no extra round trip.
- **Completes:** the provenance rule across both embedded Stores, so "swap the embedder" has one answer instead of two.
