## 1. Measure before recording anything

- [ ] 1.1 Report `input`, `cacheRead` and `cacheWrite` per Call across this machine's Journals, and verify `input + cacheRead + cacheWrite` equals the reported window size on every Call carrying both, naming any Journal where it does not
- [ ] 1.2 Report both rates over those same Calls — `cacheRead` against total input, and cached tokens above the Floor against the pack size — and record how far the derived figure lands from the audit's 91–93%
- [ ] 1.3 Report how many Calls have recorded Accounting at their address, since only those were governed, and record whether that supply can reach 200 qualifying pairs across 10 Conversations

## 2. Recording the figures

- [ ] 2.1 Read the three figures from the branch entry that already carries a Call's reported window size, and verify a Call with usage yields them while a Call without yields none rather than zeroes
- [ ] 2.2 Add the forward migration for three nullable cache columns on a Call's accounting, and verify it applies to a database already holding accounting rows
- [ ] 2.3 Record the figures alongside the measurements already written, and verify they read back at the same Call address as the pack and Floor figures
- [ ] 2.4 Verify accounting written before those columns existed still reads, with the cache figures absent rather than zero
- [ ] 2.5 Verify recording stays on the background path: a Call assembles and answers with the cache write still outstanding, and a failed write reports rather than failing the Turn
- [ ] 2.6 Verify re-ingesting a Journal backfills the figures for Calls recorded before this slice, and that a second re-ingest changes nothing

## 3. Reporting the rate

- [ ] 3.1 Derive the cached share of a Pack as cached tokens above the Floor over the pack size, and verify a Call whose `cacheRead` falls below its Floor reports no cached Pack rather than a positive share
- [ ] 3.2 Report the rate per Call in the pack inspector, so an inspected Conversation shows where inside a Turn the cache was written rather than read, and verify a Call the provider reported no figures for is shown unmeasured rather than as zero
- [ ] 3.3 Verify deriving and reporting the rate leave every accounting record and every Pack unchanged

## 4. The baseline

- [ ] 4.1 Extend the measurement script to pair consecutive Calls within a Turn, joining Journal figures to recorded Accounting, and verify it keeps only governed Calls and drops pairs spaced wider than the reported cache lifetime
- [ ] 4.2 Classify each pair by whether the leading parts changed, from the recorded part identities, and verify a pair carrying identical recalled Turns, Concepts and symbols classifies as unchanged
- [ ] 4.3 Classify each pair by whether the tail slid, and report tail-slide frequency against head-change frequency
- [ ] 4.4 Report the cached Pack share against Call position within a Turn, against head change, and against tail slide, over a collection window of governed Conversations with `token-budgets` in force
- [ ] 4.5 Report the `cacheWrite` tokens on head-changed, tail-unchanged pairs as a share of total input across the baseline, which is the materiality figure the rule reads

## 5. The decision gate

- [ ] 5.1 Apply the rule from `design.md` to the baseline figures, and record which of justified, refused or inconclusive it returns, with the sample size behind it
- [ ] 5.2 Record the result and the decision as `docs/adr/0004-*` — the refused and inconclusive outcomes included — and open a follow-up change proposing the reorder, with a `context-assembly` delta, only if the rule is met
- [ ] 5.3 Record in that ADR whether the cache figures stay in `/pack` or leave with the instrument, closing the second Open Question

## 6. Verification

- [ ] 6.1 Run a live Conversation over several tool-using Turns, then confirm `/pack` reports a cache rate for each Call it has figures for, and reports the rest unmeasured
- [ ] 6.2 Confirm the audited Journal's Calls read back with cache figures after re-ingest, and that the derived rate matches what task 1.2 reported for them
- [ ] 6.3 Run the default and store-backed suites and the type checker, and confirm `openspec validate pack-order-cache` passes
