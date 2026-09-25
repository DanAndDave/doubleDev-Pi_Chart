## 1. Measure before choosing

- [x] 1.1 Re-run the Doc Store threshold measurement with each Concept's summary attached to its section text, and record the genuine and unrelated distances against the recorded 0.244-0.419 and 0.610-0.653
- [x] 1.2 Measure the same corpus with the summary attached to the first section only, and record which Concepts become findable by a paraphrase of their summary under each
- [x] 1.3 Choose where the summary joins the embedded text from those figures, and record why, including whether a query matching one section still ranks that section above the Concept's others

> Three variants — no summary, the summary on every section, the summary on the first section only — over two corpora: this repository's decisions and vocabulary with hand-written summaries, and the vendored `okf-acme-retail` bundle, whose Concepts carry real summaries and several subjects each. Queries were embedded the way the Doc Store embeds them, which is as passages: `searchConcepts` calls `embed`, not `embedQuery`.
>
> **1.1** Baseline reproduces the recorded table closely — genuine **0.244-0.438**, unrelated **0.587-0.651** against the recorded 0.244-0.419 and 0.610-0.653, the difference being one ADR the corpus has since gained. With the summary on every section the genuine range **fell to 0.229-0.427** while the unrelated stayed at **0.597-0.644**: the gap between the worst genuine and the nearest unrelated widened from 0.149 to 0.170.
>
> **1.2** With the summary on the first section only, genuine reads 0.229-0.438 and unrelated 0.587-0.645 — the first section improves and the rest are untouched, which is the shape the option predicts. Both placements found 4 of 4 paraphrase probes; the separation between them is elsewhere.
>
> **1.3** Every section. The deciding measurement is the Concept with several subjects: of six probes aimed at a named section, the summary on every section put the right one first **5 times**, against **3** for first-section-only and 3 for no summary at all — the two it gains are queries worded from the summary but about a later section, which first-section-only cannot serve. The predicted flattening is real and did not cost anything: mean distance between the sections of one Concept fell from **0.239 to 0.100**, while the margin by which the right section beat its siblings held (0.050 against 0.043) and the worst case improved (-0.034 to -0.021). Ranking is relative, so drawing a Concept's sections together moves them all toward the query and leaves the section's own text to decide.

## 2. Writing a Concept

- [x] 2.1 Write one Concept to the bundle through a temporary file renamed into place, and verify the file is conformant, carries an identity, and that no temporary file survives
- [x] 2.2 Verify an interrupted write leaves the previous content intact and readable
- [x] 2.3 Refuse a creation at an identifier the bundle already holds, and verify the existing Concept is unchanged and a reason is returned
- [x] 2.4 Refuse a revision of a Concept the bundle does not hold, and verify nothing is created and a reason is returned
- [x] 2.5 Merge a revision into what the file holds, and verify a body-only revision leaves the title, summary, sources and exclusions untouched
- [x] 2.6 Refuse an identifier that resolves outside the bundle, and verify nothing outside it is written
- [x] 2.7 Register the write as a tool with a description that says what it writes and what it refuses, and verify it is absent when no bundle is configured

> `DocStore.write` takes a draft and returns the Concept or the reason it was refused. The write is a temporary file renamed into place, as identity assignment already writes, and identity is assigned at creation because the index is keyed by it. The interrupted case is exercised by making the Level unwritable: the temporary write fails, the rename never happens, and the Concept reads exactly as it did. Frontmatter is rewritten from the parsed structure rather than patched textually, so key order survives and comments inside it do not — recorded beside the code.

## 3. Trust the agent cannot grant

- [x] 3.1 Record the writing machine and the moment on every authored Concept, and verify an authored Concept is reported unverified and as a draft
- [x] 3.2 Refuse a write that asks for human verification, naming why, and verify no Concept is written or changed by the refused call
- [x] 3.3 Discount a verification older than a Concept's most recent machine-recorded change, and verify a human-reviewed Concept revised by the agent is no longer reported human-reviewed while its recorded review remains in the file
- [x] 3.4 Verify a verification recorded after the most recent change still yields human-reviewed, and that an untouched bundle's trust tiers are unchanged

> `generated: { by: pi-chart@<host>, at: <now> }` on every authored Concept, `status: draft` unless the Concept was already deprecated — a revision corrects a superseded Concept, it does not put it back in service. The refusal is by name: an agent told nothing believes it recorded a review. A verification with no date keeps counting, because this discounts reviews *known* to be older rather than demanding a date the format never required.

## 4. Index freshness within a Conversation

- [x] 4.1 Add an indexing pass scoped to one Concept's identity, pruning only within it, and verify the rest of the index survives
- [x] 4.2 Re-index after each successful write, and verify a Concept authored mid-Conversation is retrievable in that Conversation with nothing restarted
- [x] 4.3 Verify a revision is retrievable by its new content and no longer by the content it removed
- [x] 4.4 Verify the scoped pass embeds only the sections whose content moved, and re-embeds nothing for any other Concept
- [x] 4.5 Verify a revision that leaves a Concept non-conformant removes it from retrieval and leaves the rest of the corpus intact
- [x] 4.6 Report an indexing failure and verify the written Concept remains in the bundle

> `indexConcept` is the whole-bundle pass with the prune confined to one identity and the hash read confined to its rows — the same metadata refresh, the same hash-keyed embed. A revision that broke the frontmatter has no identity left to key on, so those rows are pruned by the path the Concept was indexed under; otherwise it would keep being retrieved as text nobody can read. Indexing runs on the tool's own Call, awaited, because the point of writing from inside a Conversation is that the next Call can retrieve it — and a failure leaves the Concept in the bundle, which is the record the index is derived from.

## 5. What a Concept carries

- [x] 5.1 Carry a Concept's exclusions and sources with it when it is opened, and verify a Concept recording neither gains no placeholder
- [x] 5.2 Carry the exclusions into the curated part of a Pack, and verify a Concept that records what it is not reaches the model with them
- [x] 5.3 Attach the Concept's summary to the embedded section text as task 1 decided, and verify a query paraphrasing the summary retrieves the Concept
- [x] 5.4 Return the matched section's position and the Concept's section count from retrieval, and verify both reach the Assembler

> `not:` and `sources:` are parsed into the Concept and rendered where it is served whole; the exclusions ride the index as one nullable column, so a Pack carries them without reading the bundle on the path the model waits on. The section count is a window count over the Concept's own rows rather than over the candidate window, because a fragment must be able to say what it is a fragment of and the window holds only what came near the query. Findability by the author's summary is asserted under the real model: two Concepts with identical bodies, one stating its subject and one leaving it implicit, and a paraphrase that uses none of the body's wording — the stated one comes first, and alphabetically it would lose a tie.

## 6. Attribution that names the part

- [x] 6.1 Head a carried Concept with the part carried and the Concept it belongs to, and verify a single-part Concept is not marked as partial
- [x] 6.2 Say that more of the Concept exists and how to read it at no Budget, and verify the count of remaining parts is correct
- [x] 6.3 Verify the curated part is still distinguishable from recalled Turns and from the current exchange, and still accounted for as its own part

> `[curated knowledge: metrics/gross-margin — part 2 of 4]`, with the note that the rest is readable through `walk_documentation` at no Budget. A Concept carried whole says nothing about parts, so the marker means something when it appears.

## 7. Unreadable and unlisted Concepts

- [x] 7.1 Report an unreadable Concept as unreadable with its reason, and verify it is not served as a Concept with an empty body
- [x] 7.2 Report a non-conformant Concept with its reason, and verify absence still reads differently from both
- [x] 7.3 Reconcile a curated listing against the Level's files, and verify a Concept the listing omits is listed and marked as absent from it
- [x] 7.4 Verify the listing's own entries keep their order and wording ahead of the reconciled additions, and that an entry naming nothing is not reported
- [x] 7.5 Verify a Level holding one broken Concept still lists the rest, with the broken one marked
- [x] 7.6 Append the new Concept's entry when authoring into a Level with a curated listing, and verify the listing names it afterwards

> A Level now reads its own Concepts, which is how a broken one can be marked as broken; the cost is bounded by the Level, which is the unit the format discloses in, and nothing deeper is read. The listing supplies order and wording, never membership: curated entries first, then what the listing omits, alphabetically, marked. Authoring appends its own entry, so reconciliation shrinks over time.

## 8. Verification

- [x] 8.1 In a live session, reach a conclusion, write it as a Concept, then ask a question it answers later in the same Conversation, and confirm the answer comes from it
- [x] 8.2 Inspect that Call and confirm the curated part names the section carried, says more exists, and is within its Budget
- [x] 8.3 Confirm the Concept written in 8.1 is unverified and a draft, and that a reviewed Concept it sits beside still outranks it
- [x] 8.4 Run the default, store-backed, model, and live suites and the type checker, and confirm `openspec validate doc-authoring` passes

> **8.1** A live Conversation with `PICHART_DOC_BUNDLE=/tmp/cm-live-bundle` — a scratch bundle holding one empty `decisions/index.md` — was told a deployment freeze runs 14–22 December with only security fixes shipping, and asked to record it. It wrote `decisions/freeze-window.md` — `status: draft`, `generated: { by: context-manager@zero }`, an identity, three sections — and appended the entry to `decisions/index.md`. A **second, separate** Conversation was then asked the dates and what may ship, with tools refused: it answered "December 14–22, only security fixes". Nothing but the Doc Store could have told it, because the Conversation that decided it was a different one.
>
> **8.2** That Call's Accounting attributes 151 tokens to the curated part against a 5,000-token Budget, carrying `decisions/freeze-window` and nothing else. The hit the same query produces is **part 1 of 3**, which is what the Pack heads it with.
>
> **8.3** The written Concept is `draft` and unverified. With a human-reviewed Concept on the same subject beside it, retrieval returns the reviewed one first (0.145) and the draft second (0.183) — trust is what the agent cannot grant itself.
>
> **8.4** 525 default tests pass; 652 with `PICHART_DATABASE_URL`; the model suite (`PICHART_EMBED=1`) passes, including both real-model claims; `tsc` clean; `openspec validate doc-authoring --strict` passes. Twenty-six mutations were applied to the new mechanisms — a stale review still counting, verification accepted, each of the four refusals removed, a revision dropping what it did not name, the listing left unmaintained, an unlisted or broken Concept hidden, a broken Concept served empty, exclusions dropped at each of the three places they travel, a fragment presented as whole, the write left unindexed, a scoped pass pruning the corpus or re-embedding it, an invented section count, an undated review counting beneath a machine change, a revision resurrecting a deprecated Concept or keeping its claim to be stable, and a revision reformatting the author's frontmatter — and every one failed a test.

## 9. Review

Two axes, both against `3933157`.

**Standards.** One P1, acted on: the escape test asserted against `/tmp/escaped.md`, a path in the shared temp directory that no run owns — and a mutation run had already written it, so the assertion was false for every later run. The bundle copy now sits one level inside a directory the test makes, and the assertion is over what that directory holds.

Four P2s acted on. Frontmatter was rebuilt from a plain object, so a revision silently reformatted the author's YAML and dropped their comments — exactly what `ensureIdentities` goes textual to avoid; it is now edited as a YAML document, and a test pins a comment and a flow sequence surviving. An undated verification kept counting beneath a dated machine change, which left the hole the rule closes wide open — write beneath an undated signature and the agent's own text is served as human-reviewed; a verification must now be shown to postdate a dated change, with both directions pinned in `concept.test.ts`. `write_documentation` could run while the whole-bundle pass from Conversation start was still going, which would prune a Concept written after that pass took its snapshot; authoring now waits for it. And the figures quoted in three places had no instrument behind them: `scripts/measure-summary-placement.ts` is checked in and reproduces every one.

Six P3s acted on: a source naming only a resource rendered twice and one naming only an author rendered `undefined`; `requirePinnedWidth` had a dead branch that also loosened the check it replaced; `::text::jsonb` stood beside the accounting insert's `::jsonb` with nothing saying why (the driver hands a string parameter to a jsonb site as a JSON string); the scoped pass's comment claimed it was the same code as the whole pass, which is not true of the contested-identity rule; a title could fall back to the model's raw id; and a Level whose listing named only deleted Concepts reported itself as having no listing at all. An unreadable file is now exercised through the tool as well as the parser.

**Spec.** Three P2s acted on. `proposal.md` said "Schema: none new" and `design.md` said "the schema is untouched" while migration 17 adds a column: both now say what the column is for, with the rejected alternative — reading the bundle per hit on the path the model waits on — recorded as a decision. The doc-store delta promised `sources:` "into a Context Pack" while only exclusions travel there; the requirement now says where each goes. And the delta's "a revision SHALL preserve the parts it does not name" contradicted the lifecycle rule the code applies deliberately: it now carves out lifecycle and provenance, with two scenarios and a test behind them.

One finding not acted on: an `addToListing` failure now returns a reason rather than throwing, but it has no test — the failure cannot be provoked through the filesystem without also failing the Concept write that precedes it, since both use the same directory. The outcome carries the reason; nothing fakes a test for it.
