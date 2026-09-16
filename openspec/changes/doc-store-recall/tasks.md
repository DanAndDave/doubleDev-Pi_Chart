## 1. Measure before choosing

- [ ] 1.1 Build a Concept corpus from this repo's own ADRs and glossary, and report the distances from a query to its genuine Concept and to the nearest unrelated one, and record the figures
- [ ] 1.2 Choose the Doc Store's relevance threshold from those figures, and record why it differs from or matches the Thread Store's

## 2. Sections

- [ ] 2.1 Split a Concept at its top-level headings, each section carrying the Concept's title, and verify a multi-section fixture yields one section per heading
- [ ] 2.2 Verify a Concept with no headings yields a single section covering its body
- [ ] 2.3 Verify a non-conformant Concept produces no sections

## 3. The index

- [ ] 3.1 Add the forward migration for indexed Concept sections keyed by Concept identity, and verify it applies to the existing database
- [ ] 3.2 Index a bundle's Concepts and verify a Concept is retrievable by a query sharing its meaning but not its wording
- [ ] 3.3 Verify a query matching one section of a multi-subject Concept retrieves that Concept
- [ ] 3.4 Verify emptying the index and indexing again retrieves the same Concepts
- [ ] 3.5 Re-index only sections whose content changed, and verify a second pass over an unedited bundle embeds nothing
- [ ] 3.6 Verify an edited Concept is retrievable by its new content, and a deleted Concept is no longer retrievable

## 4. Retrieval

- [ ] 4.1 Retrieve Concepts by meaning, deduplicated by Concept and ranked by their best section, subject to the measured threshold, and verify ordering
- [ ] 4.2 Exclude deprecated Concepts, and verify one is withheld even when it is the closest match
- [ ] 4.3 Prefer current, human-reviewed Concepts among comparable matches, and verify against a stale and an unverified rival
- [ ] 4.4 Verify nothing relevant returns nothing, and an unindexed bundle returns nothing rather than raising

## 5. Into the pack

- [ ] 5.1 Carry Concepts as their own pack part with their own Budget, attributed by Concept ID, and verify they are distinguishable from recalled Turns
- [ ] 5.2 Verify exhausting the Doc Store Budget leaves the tail and recalled Turns untouched
- [ ] 5.3 Verify a Doc Store Budget of zero yields no Concepts and no other change
- [ ] 5.4 Verify accounting attributes the Doc Store part separately, and the inspector shows it

## 6. Wiring

- [ ] 6.1 Index the configured bundle on session start, away from the request path, and verify a session indexes without delaying its first Call
- [ ] 6.2 Draw Concepts into the pack during assembly, and verify a retrieval failure costs the Concepts and not the Turn

## 7. Verification

- [ ] 7.1 Author a Concept in the machine-wide bundle, then in an unrelated Codebase ask a question it answers, and confirm the agent answers from it
- [ ] 7.2 Inspect that Call and confirm the Doc Store part is present, attributed, and within its Budget
- [ ] 7.3 Run the default, store-backed, model, and live suites, and the type checker, and confirm `openspec validate doc-store-recall` passes
