## 1. Measure before choosing

- [x] 1.1 Over this machine's Journals, replay recall for each Turn's prompt and report at what rank the Turn a user would ask about appears among the candidates refused by the threshold, and record the figures
- [x] 1.2 Choose how many rejected candidates to retain per part from those figures, and record why the bound is what it is and what the count beyond it costs to lose

> 231 Journals, 403 Turns, pooled into one Conversation because no single Conversation here exceeds 16 Turns. Of the 140 Calls with a plausible asked-about Turn beyond the tail's reach, it was carried in 20, refused in 2, and never a candidate in 118; where it was a candidate its rank ran 1–12. The bound is **12** (`PICHART_EXPLAIN_CANDIDATES`), which is also recall's over-fetch; a head of 5 would have named it in 10 of the 22 reachable cases. Figures and the two side-findings are in `design.md`.

## 2. The rejected-candidate ledger

- [x] 2.1 Record each excluded candidate's identity, its distance or size, and the threshold or Budget that excluded it, and verify a refused Turn reads back by position with its distance rather than as a count
- [x] 2.2 Bound the ledger to the measured head per part, ranked nearest first, and verify a part with more exclusions than the bound keeps the nearest and a count of the rest
- [x] 2.3 Verify no candidate's text is retained anywhere in a Call's record, including for a Concept whose section matched
- [x] 2.4 Verify Accounting written before the ledger existed reads back with the ledger absent and the Call marked unexplainable rather than as having excluded nothing
- [x] 2.5 Verify the ledger survives a write and read-back through the Thread Store, and that recording it does not delay the Call or fail the Turn when the write fails

> `test/explain.test.ts` covers 2.1–2.4 pure; `test/recall-store.test.ts` covers the round trip and the pre-ledger row. The write already runs through `inBackground`, which "an accounting failure leaves the pack intact and the turn running" and "does not wait for accounting before handing back the pack" (`test/extension.test.ts`) hold to.

## 3. Retrieval hands over its near misses

- [x] 3.1 Carry each Concept's distance on its hit and return the refused candidates beside the hits, mirroring `Recollections`, and verify a query with a tight threshold returns no hits, a refusal count, and the ranked near misses
- [x] 3.2 Verify the near misses come from the candidate set the existing nearest-neighbour query already produces, with no second query per Call
- [x] 3.3 Carry recall's near misses beside its refusal count, and verify a Turn refused at a known distance arrives with that distance
- [x] 3.4 Verify a retrieval failure still yields no near misses and no Turn failure, as it does today

> `searchConcepts` returns `{ hits, rejected, misses }` from one statement — the misses are a second aggregate over the same `nearest` CTE, which `test/doc-index.test.ts` pins by showing a 30-section bundle yields exactly the ten the candidate window held. A deprecated Concept is withheld by lifecycle and is deliberately not reported as a near miss.

## 4. Irrelevance for every part

- [x] 4.1 Record the refusal count and the threshold in force per part rather than for recall alone, and verify the curated part carries both
- [x] 4.2 Record that a part has no relevance threshold where it has none, and verify the structure part is not reported as having refused nothing for irrelevance
- [x] 4.3 Record a part's absence with its cause — nothing met the threshold, no candidates, retrieval failed, Budget of zero, or Store not configured — and verify each reads back distinctly
- [x] 4.4 Render those causes in the pack inspector, and verify a Call that refused every Concept against a tight threshold reads differently from one run with no Doc Store configured and from one with an empty bundle

> Every part is now recorded, carrying or not, with `absent` naming the cause. A sixth cause was needed beyond the five the delta lists: candidates that existed and none of which fitted the size Budget, which is neither "nothing met the threshold" nor "no candidates". `unranked` marks a part that has no threshold at all, and the inspector says so only where the shortfall could otherwise be read as irrelevance.

## 5. Addressing a call

- [x] 5.1 Resolve a Call address of a Turn and optional Call against recorded Accounting, defaulting to the latest Call, and verify a Call several Turns back is examined with its own parts and figures
- [x] 5.2 Verify a Turn given without a Call number resolves to that Turn's last recorded Call
- [x] 5.3 Refuse an address the Conversation never recorded, naming what is recorded, and verify no other Call is reported in its place
- [x] 5.4 Accept two addresses for comparison, and verify two named Calls diff correctly whether or not either is the most recent
- [x] 5.5 Verify addressing works against a Conversation read back from the Thread Store, not only against in-memory Accounting

## 6. Explaining an absence

- [x] 6.1 Answer a request naming a subject with a ranked list of excluded candidates, each with identity, distance or size, and the threshold or Budget that excluded it, and verify the nearest appears first
- [x] 6.2 Attribute a Budget exclusion to that Budget rather than to irrelevance in the same answer, and verify a relevant-but-excluded candidate reads as such
- [x] 6.3 Verify a subject matching no recorded candidate is answered as never considered, not as nothing excluded
- [x] 6.4 Verify a Call holding only counts is answered as unexplainable, naming the Call

> A numeric subject means a Turn and only a Turn: the live run found `pack why 0` answering with `decisions/0001-settlement-window`, because the id contains a zero. Fixed, with a test. A subject the Call did carry is reported as carried rather than as never considered.

## 7. Compaction

- [x] 7.1 Add a Journal fixture carrying a compaction epoch flip between Calls, drawn from the observed 0→1 at 822,279 reported tokens
- [x] 7.2 Detect an epoch change against the last epoch seen for the Conversation and record it against the Call it affected, and verify the earlier Call is not recorded as compacted
- [x] 7.3 Report the compaction when that Call is examined and in the Conversation summary, and verify an uncompacted Conversation reports none
- [x] 7.4 Read the observed Journal and record whether the harness branch keeps its pre-compaction prompts, resolving whether Turn addressing shifts; if it shifts, record the consequence as its own change rather than fixing it here

> The branch keeps them: the compaction is a node in the parent chain, and walking back from the newest entry reaches all sixteen prompts, ten from before it. Addressing does not shift, so no follow-up change is raised. The epoch is recorded per Call (migration 15, nullable, never backfilled) and the flip is derived in the pure inspector; a Conversation whose first observed epoch is 46 — this machine has one — reports no compaction. Fixture at `test/fixtures/journal-compaction.jsonl`.

## 8. Estimate versus reported

- [x] 8.1 Render the assembly-time estimate, the harness-reported size, and their relationship for a Call, and verify both figures appear and neither is presented as the other
- [x] 8.2 Verify a Call with no reported size is rendered as unmeasured rather than reconciled against the estimate
- [x] 8.3 Report the estimate's relationship to the reported sizes across a Conversation's measured Calls, and verify a Conversation with no measured Call summarises without inventing figures

## 9. Verification

- [x] 9.1 Re-derive the audit's 8.6% governed-versus-ungoverned figure from the inspector alone, against the audited Conversation ingested into a scratch Thread Store, and confirm no throwaway script is needed
- [x] 9.2 Run a live session whose prompt should have recalled a known earlier Turn, ask why it was not carried, and confirm the answer names that Turn with its distance against the threshold
- [x] 9.3 Set the curated threshold tight in a live session and confirm the inspector shows the curated part refused rather than absent
- [x] 9.4 Run the default, store-backed and live suites and the type checker, and confirm `openspec validate pack-why` passes

> **9.1** Replaying the audited Conversation's last Turn under three configurations and reading only `renderCall`: ungoverned **~2,080,291**, count-Budget-only **~1,916,121** (7.9%), shipped defaults **~45,819** (97.8%). The governed figure matches the audit's 45,819 exactly and the ungoverned to six tokens; the audit's 8.6% was the same comparison under the pre-`token-budgets` estimator. The driver only replays — every figure is the inspector's.
>
> **9.2/9.3** A two-Turn live session with both thresholds at 0.05, then the registered `pack` command over the Conversation it recorded: `recalled absent: nothing met the threshold (1 refused against the 0.05 threshold)`, the same for `curated`, `pack why 0` answering `recalled turn 0 distance 0.26 beyond the 0.05 threshold` beside `carried by verbatim-tail: turn 0`, `pack why falcon` answering `nothing matching it was considered`, `pack 9.9` refusing with `This conversation has turns 0 to 1, 2 calls`, and `pack summary` reporting `estimate ran 0.04× the reported size`. Re-run through the command after the review, which is where the grammar defect was.

## 10. Review

Two axes, both against `c9b31ac`. Every finding is fixed or answered here.

**Both axes found the same worst defect.** `pack why 4` read the bare number as an address, left the subject empty, and answered with the usage line — so the command could not ask the question the lead scenario names, while the README said it could. The address is now only an address when a subject follows it, and the case is covered through the command rather than through `explain()` alone. The live evidence in 9.2 above was gathered through the inspector's own function, which is why it did not catch this; the command test does.

Also fixed: `pack diff <a> <b>` was covered by a test that passed under the bare-`diff` fallback too, so it now asserts which two Calls were compared; the registered command description never mentioned `why` or addressing; identity naming was written three ways in `report.ts` and is now one `nameOf`; the sort comment in `explain` claimed Budget exclusions carry no distance, which is true of recall and false of curated; `recordedCalls` put English prose in the pure model and moved to `report.ts` as `describeRecorded`; the estimate-bias test asserted only that a ratio was positive; a re-measured Call could have its recorded epoch overwritten with null, now `coalesce`d and tested; and a test comment said "session" where the vocabulary says Conversation.

Answered rather than changed: `recordPart` names and copies all seventeen fields rather than spreading, which is what keeps a `PackPart`'s messages out of Accounting — the comment now says so. `CallView.explained` reads any part rather than every part, so an unassembled Call with no parts reads unexplainable. The ledger's `ceiling` reason and the sixth absence cause (`size`) go beyond the delta's four; both are recorded above and in `design.md`, and neither changes what the ceiling does.

Two stale planning claims were corrected where they sat: `proposal.md` said "no migration", and `design.md`'s Risks still weighed a bound of 5.
