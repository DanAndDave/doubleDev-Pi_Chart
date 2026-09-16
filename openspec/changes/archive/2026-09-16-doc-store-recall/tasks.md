## 1. Measure before choosing

- [x] 1.1 Build a Concept corpus from this repo's own ADRs and glossary, and report the distances from a query to its genuine Concept and to the nearest unrelated one, and record the figures
- [x] 1.2 Choose the Doc Store's relevance threshold from those figures, and record why it differs from or matches the Thread Store's

## 2. Sections

- [x] 2.1 Split a Concept at its top-level headings, each section carrying the Concept's title, and verify a multi-section fixture yields one section per heading
- [x] 2.2 Verify a Concept with no headings yields a single section covering its body
- [x] 2.3 Verify a non-conformant Concept produces no sections

## 3. The index

- [x] 3.1 Add the forward migration for indexed Concept sections keyed by Concept identity, and verify it applies to the existing database
- [x] 3.2 Index a bundle's Concepts and verify a Concept is retrievable by a query sharing its meaning but not its wording
- [x] 3.3 Verify a query matching one section of a multi-subject Concept retrieves that Concept
- [x] 3.4 Verify emptying the index and indexing again retrieves the same Concepts
- [x] 3.5 Re-index only sections whose content changed, and verify a second pass over an unedited bundle embeds nothing
- [x] 3.6 Verify an edited Concept is retrievable by its new content, and a deleted Concept is no longer retrievable

## 4. Retrieval

- [x] 4.1 Retrieve Concepts by meaning, deduplicated by Concept and ranked by their best section, subject to the measured threshold, and verify ordering
- [x] 4.2 Exclude deprecated Concepts, and verify one is withheld even when it is the closest match
- [x] 4.3 Prefer current, human-reviewed Concepts among comparable matches, and verify against a stale and an unverified rival
- [x] 4.4 Verify nothing relevant returns nothing, and an unindexed bundle returns nothing rather than raising

## 5. Into the pack

- [x] 5.1 Carry Concepts as their own pack part with their own Budget, attributed by Concept ID, and verify they are distinguishable from recalled Turns
- [x] 5.2 Verify exhausting the Doc Store Budget leaves the tail and recalled Turns untouched
- [x] 5.3 Verify a Doc Store Budget of zero yields no Concepts and no other change
- [x] 5.4 Verify accounting attributes the Doc Store part separately, and the inspector shows it

## 6. Wiring

- [x] 6.1 Index the configured bundle on session start, away from the request path, and verify a session indexes without delaying its first Call
- [x] 6.2 Draw Concepts into the pack during assembly, and verify a retrieval failure costs the Concepts and not the Turn

## 7. Verification

- [x] 7.1 Author a Concept in the machine-wide bundle, then in an unrelated Codebase ask a question it answers, and confirm the agent answers from it
- [x] 7.2 Inspect that Call and confirm the Doc Store part is present, attributed, and within its Budget
- [x] 7.3 Run the default, store-backed, model, and live suites, and the type checker, and confirm `openspec validate doc-store-recall` passes
