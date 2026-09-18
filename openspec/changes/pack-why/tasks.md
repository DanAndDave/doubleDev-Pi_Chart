## 1. Measure before choosing

- [ ] 1.1 Over this machine's Journals, replay recall for each Turn's prompt and report at what rank the Turn a user would ask about appears among the candidates refused by the threshold, and record the figures
- [ ] 1.2 Choose how many rejected candidates to retain per part from those figures, and record why the bound is what it is and what the count beyond it costs to lose

## 2. The rejected-candidate ledger

- [ ] 2.1 Record each excluded candidate's identity, its distance or size, and the threshold or Budget that excluded it, and verify a refused Turn reads back by position with its distance rather than as a count
- [ ] 2.2 Bound the ledger to the measured head per part, ranked nearest first, and verify a part with more exclusions than the bound keeps the nearest and a count of the rest
- [ ] 2.3 Verify no candidate's text is retained anywhere in a Call's record, including for a Concept whose section matched
- [ ] 2.4 Verify Accounting written before the ledger existed reads back with the ledger absent and the Call marked unexplainable rather than as having excluded nothing
- [ ] 2.5 Verify the ledger survives a write and read-back through the Thread Store, and that recording it does not delay the Call or fail the Turn when the write fails

## 3. Retrieval hands over its near misses

- [ ] 3.1 Carry each Concept's distance on its hit and return the refused candidates beside the hits, mirroring `Recollections`, and verify a query with a tight threshold returns no hits, a refusal count, and the ranked near misses
- [ ] 3.2 Verify the near misses come from the candidate set the existing nearest-neighbour query already produces, with no second query per Call
- [ ] 3.3 Carry recall's near misses beside its refusal count, and verify a Turn refused at a known distance arrives with that distance
- [ ] 3.4 Verify a retrieval failure still yields no near misses and no Turn failure, as it does today

## 4. Irrelevance for every part

- [ ] 4.1 Record the refusal count and the threshold in force per part rather than for recall alone, and verify the curated part carries both
- [ ] 4.2 Record that a part has no relevance threshold where it has none, and verify the structure part is not reported as having refused nothing for irrelevance
- [ ] 4.3 Record a part's absence with its cause — nothing met the threshold, no candidates, retrieval failed, Budget of zero, or Store not configured — and verify each reads back distinctly
- [ ] 4.4 Render those causes in the pack inspector, and verify a Call that refused every Concept against a tight threshold reads differently from one run with no Doc Store configured and from one with an empty bundle

## 5. Addressing a call

- [ ] 5.1 Resolve a Call address of a Turn and optional Call against recorded Accounting, defaulting to the latest Call, and verify a Call several Turns back is examined with its own parts and figures
- [ ] 5.2 Verify a Turn given without a Call number resolves to that Turn's last recorded Call
- [ ] 5.3 Refuse an address the Conversation never recorded, naming what is recorded, and verify no other Call is reported in its place
- [ ] 5.4 Accept two addresses for comparison, and verify two named Calls diff correctly whether or not either is the most recent
- [ ] 5.5 Verify addressing works against a Conversation read back from the Thread Store, not only against in-memory Accounting

## 6. Explaining an absence

- [ ] 6.1 Answer a request naming a subject with a ranked list of excluded candidates, each with identity, distance or size, and the threshold or Budget that excluded it, and verify the nearest appears first
- [ ] 6.2 Attribute a Budget exclusion to that Budget rather than to irrelevance in the same answer, and verify a relevant-but-excluded candidate reads as such
- [ ] 6.3 Verify a subject matching no recorded candidate is answered as never considered, not as nothing excluded
- [ ] 6.4 Verify a Call holding only counts is answered as unexplainable, naming the Call

## 7. Compaction

- [ ] 7.1 Add a Journal fixture carrying a compaction epoch flip between Calls, drawn from the observed 0→1 at 822,279 reported tokens
- [ ] 7.2 Detect an epoch change against the last epoch seen for the Conversation and record it against the Call it affected, and verify the earlier Call is not recorded as compacted
- [ ] 7.3 Report the compaction when that Call is examined and in the Conversation summary, and verify an uncompacted Conversation reports none
- [ ] 7.4 Read the observed Journal and record whether the harness branch keeps its pre-compaction prompts, resolving whether Turn addressing shifts; if it shifts, record the consequence as its own change rather than fixing it here

## 8. Estimate versus reported

- [ ] 8.1 Render the assembly-time estimate, the harness-reported size, and their relationship for a Call, and verify both figures appear and neither is presented as the other
- [ ] 8.2 Verify a Call with no reported size is rendered as unmeasured rather than reconciled against the estimate
- [ ] 8.3 Report the estimate's relationship to the reported sizes across a Conversation's measured Calls, and verify a Conversation with no measured Call summarises without inventing figures

## 9. Verification

- [ ] 9.1 Re-derive the audit's 8.6% governed-versus-ungoverned figure from the inspector alone, against the audited Conversation ingested into a scratch Thread Store, and confirm no throwaway script is needed
- [ ] 9.2 Run a live session whose prompt should have recalled a known earlier Turn, ask why it was not carried, and confirm the answer names that Turn with its distance against the threshold
- [ ] 9.3 Set the curated threshold tight in a live session and confirm the inspector shows the curated part refused rather than absent
- [ ] 9.4 Run the default, store-backed and live suites and the type checker, and confirm `openspec validate pack-why` passes
