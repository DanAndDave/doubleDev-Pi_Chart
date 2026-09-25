## 1. Recording which model made a vector

- [x] 1.1 Add the forward migration for a nullable model column on the section index, and verify it applies to a database already holding indexed sections

  Migration 19 in `MIGRATIONS` (`src/postgres-store.ts`): `ALTER TABLE
  concept_sections ADD COLUMN IF NOT EXISTS embedding_model TEXT`. Checked
  against a database already holding an indexed section by dropping the
  column and the migration row and migrating again: the existing row kept
  its hash and text, read back with no model, and the next indexing pass
  embedded it again.

- [x] 1.2 Write the model in use with every section vector, and verify a freshly indexed section reads back carrying it

  `embedSections` asks the embedder for its identity and writes `model`
  alongside the vector, in both the insert and the conflict update.
  Verified by mutation: writing `NULL` instead of the model fails "a vector
  from another model is never a hit" and "a model change is repaired by the
  next pass" in `test/doc-index.test.ts`, because a section nobody can
  attribute is a section no search may rank.

- [x] 1.3 Verify a section indexed before the column existed reads back with no model rather than with the model in use

  The migration check above, and "a section indexed before provenance
  existed is re-embedded": a row set back to `embedding_model = NULL`
  stops being a hit and is embedded again by the next pass.

## 2. Ranking only what the model in use produced

- [x] 2.1 Withhold sections embedded by another model from search, and verify one that would otherwise be the nearest match is not returned

  The predicate sits inside `searchConcepts`'s `nearest` CTE, beside
  `embedding IS NOT NULL`, rather than after the candidate window — a
  stranger filtered afterwards still costs a Concept its place in the
  window. "A vector from another model is never a hit" searches the same
  corpus under a second model and gets nothing; dropping the predicate
  fails it.

- [x] 2.2 Verify a section from another model is not reported as a near miss, since it was not refused for distance

  Same test: `misses` is empty and `rejected` is 0 while `unsearched` is 2.

- [x] 2.3 Report how many Concepts the search could not rank, and verify the count reaches the caller beside what was refused

  `ConceptMatches.unsearched`, counted by identity so one Concept's several
  sections are one Concept, past deprecated ones, which are withheld
  anyway, and only where this model can see none of that Concept's
  sections — a Concept part-way through a repair is returned as a hit, so
  counting it as unseen would contradict the hit beside it ("a concept
  part-way through a repair counts as seen, not as unseen"). Inverting the
  count's predicate, and dropping the part-way clause, each fail a test.

  It travels the way recall's does: `Pack.conceptsUnsearched` into the
  Call's record, written and read back over the store ("what a call's
  curated part could not see survives the write", migration 20) and over
  the file-backed accounting ("a call records how much of the bundle its
  search could not see"), and rendered as its own line by `renderCall` —
  beside recall's, not merged with it, because the two Stores embed on
  their own schedules ("a curated part mid-repair is named apart from a
  thin recall"). The extension also says it once per Conversation ("an
  index mid-swap says so once, and still serves what it can"), because the
  condition lasts until the background pass catches up.

- [x] 2.4 Verify a corpus embedded entirely by the model in use returns exactly what it returned before, with nothing reported unsearched

  The suite's existing ranking, threshold and lifecycle tests all search a
  corpus this model embedded and are unchanged. Measured under the real
  models by `scripts/measure-model-swap.ts`: before the swap, five hits,
  top `metrics/gross-margin` at 0.197, nothing unsearched.

## 3. Repairing what a model change left behind

- [x] 3.1 Treat a differing recorded model as a differing hash in the indexing pass, and verify a section whose text did not change is embedded again after a model change

  "A model change is repaired by the next pass, text or no text change":
  all 3 sections are embedded again though not a word of the bundle moved.

- [x] 3.2 Verify an unchanged corpus under an unchanged model still embeds nothing

  The seam design.md names: the existing "indexing an unchanged bundle
  embeds nothing the second time". Making the changed-set unconditional
  fails it, so the repair cannot be bought with a re-embedding every pass.
  The delta modifies "Re-indexing covers only what changed" to say so — a
  model change is a reason to re-index, and its idempotence scenario now
  reads "no edits and no change of embedding model between".

- [x] 3.3 Verify the scoped single-Concept pass repairs the same way, so authoring a Concept after a model change does not leave the rest of that Concept behind

  "The scoped pass repairs one concept the same way": `indexConcept`
  re-embeds that Concept's 2 sections, and the Concept it was not given
  stays unsearchable rather than being silently ranked.

- [x] 3.4 Verify a section with no recorded model is treated as belonging to no model in use and is embedded again

  Covered by 1.3's test: absent provenance is not evidence of a match.

## 4. Verification

- [x] 4.1 Run the default and store-backed suites and the type checker, and confirm `openspec validate concept-vector-provenance` passes

  `bunx tsc --noEmit` clean; 534 default tests pass; 671 pass with
  `CM_DATABASE_URL` set; `openspec validate --all --strict` passes.

- [x] 4.2 Under the real model, index a bundle, swap `CM_EMBED_MODEL` to another model of the same width, and confirm the index repairs itself and search returns the same Concepts afterwards

  `scripts/measure-model-swap.ts`, over the vendored `okf-acme-retail`
  bundle (9 Concepts, 33 sections) asking "how is gross margin calculated
  for a period", between `Xenova/bge-small-en-v1.5` and
  `Xenova/all-MiniLM-L6-v2` — both 384 dimensions, so no width check could
  have told them apart:

  | | hits | rejected | unsearched |
  | --- | --- | --- | --- |
  | pinned model, its own vectors | 5 (top 0.197) | 0 | 0 |
  | swapped model, previous model's vectors | 0 | 0 | 8 |
  | ranked anyway, as the old code did | 0 carried, 8 too distant (nearest 0.820) | — | — |
  | swapped model, after one indexing pass | 4 (top 0.340) | 4 | 0 |
  | back to the pinned model, after one pass | 5 (top 0.197) | 0 | 0 |

  The repair costs one pass: 33 sections in 3.0s under the second model,
  5.8s back under the pinned one, and 0 sections on any pass after that.
  Swapping back returns the identical five Concepts at the identical
  distances.

  The third row is what this change was opened for, and the instrument
  prints it from its own statement, since the Store no longer ranks that
  way. Both models are 384 dimensions, so nothing refused the swap.
  Ranked across models, the Concept that actually answers the question
  measures 0.820 — outside the threshold — so the old behaviour carried
  nothing and reported eight refusals at plausible distances. Curated
  knowledge went dark, the Call's record blamed the threshold, and the
  indexing pass re-embedded nothing, because no text had changed.

  Confirmed in a governed Conversation, not only by the instrument: with
  the bundle indexed under the pinned model and `CM_EMBED_MODEL` set to
  `Xenova/all-MiniLM-L6-v2`, the Conversation printed "8 concepts are held
  only as vectors from another embedding model" once, its first Call
  recorded `concepts_unsearched = 8`, and `/pack` rendered "curated
  searched all but 8 concepts of the bundle (awaiting embedding)". The
  next Call of the same Conversation, after the background pass finished,
  carried 2 Concepts — `metrics/gross-margin` and
  `computations/gross-margin-period` — with nothing unsearched.

- [x] 4.3 Confirm the README's `CM_EMBED_MODEL` row is now true of both Stores, and correct the sentence `audit-docs-debt` had to write about the Concept index

  The row now says both Stores record the model, that a swap costs one
  background re-embedding on each side, and that a search says how much of
  the index it could not see meanwhile.
