## 1. Measure before choosing

- [ ] 1.1 Re-run the Doc Store threshold measurement with each Concept's summary attached to its section text, and record the genuine and unrelated distances against the recorded 0.244-0.419 and 0.610-0.653
- [ ] 1.2 Measure the same corpus with the summary attached to the first section only, and record which Concepts become findable by a paraphrase of their summary under each
- [ ] 1.3 Choose where the summary joins the embedded text from those figures, and record why, including whether a query matching one section still ranks that section above the Concept's others

## 2. Writing a Concept

- [ ] 2.1 Write one Concept to the bundle through a temporary file renamed into place, and verify the file is conformant, carries an identity, and that no temporary file survives
- [ ] 2.2 Verify an interrupted write leaves the previous content intact and readable
- [ ] 2.3 Refuse a creation at an identifier the bundle already holds, and verify the existing Concept is unchanged and a reason is returned
- [ ] 2.4 Refuse a revision of a Concept the bundle does not hold, and verify nothing is created and a reason is returned
- [ ] 2.5 Merge a revision into what the file holds, and verify a body-only revision leaves the title, summary, sources and exclusions untouched
- [ ] 2.6 Refuse an identifier that resolves outside the bundle, and verify nothing outside it is written
- [ ] 2.7 Register the write as a tool with a description that says what it writes and what it refuses, and verify it is absent when no bundle is configured

## 3. Trust the agent cannot grant

- [ ] 3.1 Record the writing machine and the moment on every authored Concept, and verify an authored Concept is reported unverified and as a draft
- [ ] 3.2 Refuse a write that asks for human verification, naming why, and verify no Concept is written or changed by the refused call
- [ ] 3.3 Discount a verification older than a Concept's most recent machine-recorded change, and verify a human-reviewed Concept revised by the agent is no longer reported human-reviewed while its recorded review remains in the file
- [ ] 3.4 Verify a verification recorded after the most recent change still yields human-reviewed, and that an untouched bundle's trust tiers are unchanged

## 4. Index freshness within a Conversation

- [ ] 4.1 Add an indexing pass scoped to one Concept's identity, pruning only within it, and verify the rest of the index survives
- [ ] 4.2 Re-index after each successful write, and verify a Concept authored mid-Conversation is retrievable in that Conversation with nothing restarted
- [ ] 4.3 Verify a revision is retrievable by its new content and no longer by the content it removed
- [ ] 4.4 Verify the scoped pass embeds only the sections whose content moved, and re-embeds nothing for any other Concept
- [ ] 4.5 Verify a revision that leaves a Concept non-conformant removes it from retrieval and leaves the rest of the corpus intact
- [ ] 4.6 Report an indexing failure and verify the written Concept remains in the bundle

## 5. What a Concept carries

- [ ] 5.1 Carry a Concept's exclusions and sources with it when it is opened, and verify a Concept recording neither gains no placeholder
- [ ] 5.2 Carry the exclusions into the curated part of a Pack, and verify a Concept that records what it is not reaches the model with them
- [ ] 5.3 Attach the Concept's summary to the embedded section text as task 1 decided, and verify a query paraphrasing the summary retrieves the Concept
- [ ] 5.4 Return the matched section's position and the Concept's section count from retrieval, and verify both reach the Assembler

## 6. Attribution that names the part

- [ ] 6.1 Head a carried Concept with the part carried and the Concept it belongs to, and verify a single-part Concept is not marked as partial
- [ ] 6.2 Say that more of the Concept exists and how to read it at no Budget, and verify the count of remaining parts is correct
- [ ] 6.3 Verify the curated part is still distinguishable from recalled Turns and from the current exchange, and still accounted for as its own part

## 7. Unreadable and unlisted Concepts

- [ ] 7.1 Report an unreadable Concept as unreadable with its reason, and verify it is not served as a Concept with an empty body
- [ ] 7.2 Report a non-conformant Concept with its reason, and verify absence still reads differently from both
- [ ] 7.3 Reconcile a curated listing against the Level's files, and verify a Concept the listing omits is listed and marked as absent from it
- [ ] 7.4 Verify the listing's own entries keep their order and wording ahead of the reconciled additions, and that an entry naming nothing is not reported
- [ ] 7.5 Verify a Level holding one broken Concept still lists the rest, with the broken one marked
- [ ] 7.6 Append the new Concept's entry when authoring into a Level with a curated listing, and verify the listing names it afterwards

## 8. Verification

- [ ] 8.1 In a live session, reach a conclusion, write it as a Concept, then ask a question it answers later in the same Conversation, and confirm the answer comes from it
- [ ] 8.2 Inspect that Call and confirm the curated part names the section carried, says more exists, and is within its Budget
- [ ] 8.3 Confirm the Concept written in 8.1 is unverified and a draft, and that a reviewed Concept it sits beside still outranks it
- [ ] 8.4 Run the default, store-backed, model, and live suites and the type checker, and confirm `openspec validate doc-authoring` passes
