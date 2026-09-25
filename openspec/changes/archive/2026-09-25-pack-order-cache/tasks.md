## 1. Measure before recording anything

- [x] 1.1 Report `input`, `cacheRead` and `cacheWrite` per Call across this machine's Journals, and verify `input + cacheRead + cacheWrite` equals the reported window size on every Call carrying both, naming any Journal where it does not
- [x] 1.2 Report both rates over those same Calls — `cacheRead` against total input, and cached tokens above the Floor against the pack size — and record how far the derived figure lands from the audit's 91–93%
- [x] 1.3 Report how many Calls have recorded Accounting at their address, since only those were governed, and record whether that supply can reach 200 qualifying pairs across 10 Conversations

> Everything below is printed by `bun scripts/measure-pack-cache.ts --journals`, which needs no store: it reads `usage` and `contextSnapshot` off the Journals themselves.
>
> **1.1** 370 Journals, **7,890 priced Calls**. The identity holds on **every one of them** — no Journal is off by a token — so cached Pack tokens can be derived as what `cacheRead` has left once the Floor has taken its share.
>
> **1.2** Over those Calls, `cacheRead` against everything charged reads a median of **92.2%**, which agrees with the audit's 91–93% and decides nothing: the population is mostly ungoverned Conversations, whose windows cache by construction. Derived against the Pack the same population reads **85.0%** median but **1.0% at the first quartile**, and **1,945** Calls have a `cacheRead` below their own Floor — none of their Pack was cached at all. The spread is the finding: an aggregate rate hides two populations.
>
> **1.3** None. Every store this project's Accounting has been written to was a scratch database, dropped with the change that used it, so no historical Call has recorded parts — and without recorded parts there is no way to say whether a Call's leading parts changed. The supply had to be collected rather than mined, which is what task 4 does, and the collected window is checked in beside this change so the next reader does not have to collect it again.

## 2. Recording the figures

- [x] 2.1 Read the three figures from the branch entry that already carries a Call's reported window size, and verify a Call with usage yields them while a Call without yields none rather than zeroes
- [x] 2.2 Add the forward migration for three nullable cache columns on a Call's accounting, and verify it applies to a database already holding accounting rows
- [x] 2.3 Record the figures alongside the measurements already written, and verify they read back at the same Call address as the pack and Floor figures
- [x] 2.4 Verify accounting written before those columns existed still reads, with the cache figures absent rather than zero
- [x] 2.5 Verify recording stays on the background path: a Call assembles and answers with the cache write still outstanding, and a failed write reports rather than failing the Turn
- [x] 2.6 Verify re-ingesting a Journal backfills the figures for Calls recorded before this slice, and that a second re-ingest changes nothing

> `measurementsOf` now carries `usage` beside the snapshot it already read from the same branch entry, and `measurementsOfJournal` makes the same walk over the record on disk, so ingest backfills Calls made before anything read the cost. Migration 18 adds `cache_read`, `cache_write` and `input_tokens`, nullable and never backfilled with zeroes: a Call the provider priced nothing for is unmeasured, not free. A re-measurement that carries no figures keeps the ones already recorded, for the same reason the compaction epoch does. Recording rides `recordMeasurements`, which already runs off the request path — "does not wait for accounting before handing back the pack" still holds.

## 3. Reporting the rate

- [x] 3.1 Derive the cached share of a Pack as cached tokens above the Floor over the pack size, and verify a Call whose `cacheRead` falls below its Floor reports no cached Pack rather than a positive share
- [x] 3.2 Report the rate per Call in the pack inspector, so an inspected Conversation shows where inside a Turn the cache was written rather than read, and verify a Call the provider reported no figures for is shown unmeasured rather than as zero
- [x] 3.3 Verify deriving and reporting the rate leave every accounting record and every Pack unchanged

> `/pack` gains one line: `cache  20492 read, 0 written (0% of the pack read from cache)`. The audited Call — 20,488 read against a 25,588-token Floor — reads 69.9% against the window and **none** against the Pack, which is the order-of-magnitude the derivation was fixed in advance to avoid. A Call the provider priced nothing for reads `not reported for this call`.

## 4. The baseline

- [x] 4.1 Extend the measurement script to pair consecutive Calls within a Turn, joining Journal figures to recorded Accounting, and verify it keeps only governed Calls and drops pairs spaced wider than the reported cache lifetime
- [x] 4.2 Classify each pair by whether the leading parts changed, from the recorded part identities, and verify a pair carrying identical recalled Turns, Concepts and symbols classifies as unchanged
- [x] 4.3 Classify each pair by whether the tail slid, and report tail-slide frequency against head-change frequency
- [x] 4.4 Report the cached Pack share against Call position within a Turn, against head change, and against tail slide, over a collection window of governed Conversations with `token-budgets` in force
- [x] 4.5 Report the `cacheWrite` tokens on head-changed, tail-unchanged pairs as a share of total input across the baseline, which is the materiality figure the rule reads

> `scripts/measure-pack-cache.ts`, over a window collected for it and exported to `evidence/window.json`: **12 governed Conversations, 257 Calls, 209 qualifying pairs**, every Call priced. A Call counts as governed when its Accounting records parts, which is what having been assembled by this system means.
>
> The cached Pack share is **0.0% at the median and at both quartiles**, and 0.0% at every Call position within a Turn (n = 45, 43, 43, 33, 23, 22). The head changed on **4 of 209** within-Turn pairs — the same Concepts come back Call after Call — and the tail slid at **0 of 36** Turn boundaries, because four Turns never exhaust an eight-Turn tail. `cacheWrite` on the deciding pairs is **0.0%** of governed input, against the rule's 10% bar: only **3 of 257** governed Calls wrote anything at all, and `cacheRead` takes exactly **two distinct values** across the whole window.
>
> The control is what makes it legible — `--journals --group governed=cm-cache-run --group ungoverned=cm-cache-control`, three ungoverned Conversations on the same prompts and files:
>
> | group | Calls | median cached Pack | input share of charged | per Call at 0.1/1.25 | Pack |
> | --- | --- | --- | --- | --- | --- |
> | governed | 545 | 0.0% | 36.1% | 13,934 | 6,737 |
> | ungoverned | 72 | 97.2% | 0.0% | 5,271 | 13,079 |
>
> Then the experiment that names the mechanism, four extensions differing only in what they hand back from `context`: passing the array through caches **88.0%**, rebuilding every message from scratch caches **91.1%**, appending one assembled message at the end caches **86.6%**, and prepending that same message caches **0.0%** with `cacheWrite` of zero and seventeen times the input. Comparison is by value, not identity, and what costs is a message the harness did not send arriving before one it did.

## 5. The decision gate

- [x] 5.1 Apply the rule from `design.md` to the baseline figures, and record which of justified, refused or inconclusive it returns, with the sample size behind it
- [x] 5.2 Record the result and the decision as `docs/adr/0004-*` — the refused and inconclusive outcomes included — and open a follow-up change proposing the reorder, with a `context-assembly` delta, only if the rule is met
- [x] 5.3 Record in that ADR whether the cache figures stay in `/pack` or leave with the instrument, closing the second Open Question

> **5.1 Inconclusive.** Over 209 pairs across 12 Conversations the sample floor passes (200 and 10), and the median on head-changed, tail-unchanged pairs is 0.0% — below the 0.25 bar. The verdict falls to the middle branch because the other two clauses fail: materiality is 0.0% against 10%, and the tail slid at 0 of 36 boundaries against 4 head changes. Two of the three clauses were in fact unreachable by construction — once an assembled part leads the array there is no breakpoint after it, so `cacheWrite` on a non-first Call is structurally zero, and four Turns cannot exhaust an eight-Turn tail. The rule was applied as written; it could only ever have returned refused or inconclusive.
>
> The pre-registered experiment looked for provider-side prefix invalidation and found nothing to look at, because the provider was never offered a breakpoint inside the Pack. The A/B in task 4 settles what the rule could not.
>
> **5.2** `docs/adr/0005-a-pack-is-cached-only-to-its-first-assembled-message.md` — 0004 is taken by `single-injector-enforcement`, which archived first. The follow-up **is** opened, because the figures justify it and the remedy is reachable from this extension: `openspec/changes/pack-prefix-stability`, proposing that a Pack lead with the longest run of messages the harness itself sent, with a `context-assembly` delta fixing the order and the cached share as its acceptance test.
>
> **5.3** The figures stay. They are what makes a 2.6× per-Call price visible while it stands, and they cost one line of `/pack` and three nullable columns; being derived, they leave with the database whenever it is dropped.

## 6. Verification

- [x] 6.1 Run a live Conversation over several tool-using Turns, then confirm `/pack` reports a cache rate for each Call it has figures for, and reports the rest unmeasured
- [x] 6.2 Confirm the audited Journal's Calls read back with cache figures after re-ingest, and that the derived rate matches what task 1.2 reported for them
- [x] 6.3 Run the default and store-backed suites and the type checker, and confirm `openspec validate pack-order-cache` passes

> **6.1** Sixteen live Conversations of four Turns each, every Turn a chain of tool calls — 257 governed Calls with figures in the checked-in window, rendered through the same inspection the command uses: `cache  20492 read, 0 written (0% of the pack read from cache)`, with the parts and Budgets beside it. A Call the provider priced nothing for reads `not reported for this call`, and one priced with no Pack to measure against reads `share of the pack unmeasured`.
>
> **6.2** The captured Journal fixture's Calls reconcile to the token — asserted in the default suite, not only in the script — and a sweep over an already-ingested Conversation writes no cost at all, so re-ingest costs what ticket 3 measured.
>
> **6.3** 531 default tests pass; 662 with `PICHART_DATABASE_URL`; `tsc` clean; `openspec validate pack-order-cache --strict` passes under `skip_specs`. Thirteen mutations were applied to the new instrumentation — usage dropped from each of the two walks, the cost unrecorded, a missing price recorded as zero, the share taken against the window instead of the Pack, the cost unwritten, erased by a re-measurement, or dropped on read, an unmeasured Call rendered as cached, a share nobody could derive rendered as zero, the backfill inventing rows for Calls this system never assembled, and the backfill running on an unchanged Conversation — and every one failed a test.

## 7. Review

Two axes, both against `6b4929f`.

**Standards.** Two P1s acted on. The backfill wrote through `recordMeasurements`, which inserts: the Journal numbers its Calls by walking a file that keeps abandoned branches, so an address it named that Accounting did not hold would have invented a row carrying a cost with no Pack beside it — and the baseline's whole join is cost against Pack at one address. It is now `recordCosts`, an UPDATE that touches Calls this system recorded and no others. And every figure the ADR quoted came from throwaway scripts; `measure-pack-cache.ts` now computes all of them, including the corpus identity check and the ungoverned control, which needs no store because an ungoverned Conversation has no Accounting by definition.

Three P2s: the backfill was awaited inside `ingestJournal`, so a diagnostic write that failed was reported as a failed ingest and stopped recall catching up — it is its own phase now, with its own report; it re-walked the whole Journal on every sweep, undoing ticket 3's "one statement, writing nothing" on an unchanged Conversation — it now runs only on what ingest just stored; and its test asserted nothing about the property that makes backfill worth having, which is that the cost lands beside the Pack.

Three P3s: a share nobody could derive rendered as `0%`, which is the "zero reads as free" the columns are nullable to avoid; the clamp to 1 hid a mis-reported Floor behind a plausible 100%; and a type comment cited 7,009 Calls no checked-in instrument produced.

**Evidence.** One P0, which changed the conclusion. The ADR claimed the harness does not mark a supplied array for caching; the reviewer read the rule out of the binary — a message breakpoint is placed only before the first message that is not deep-equal to the harness's own at that index — and the four-variant A/B confirms it live. So part order *is* what defeats the cache, one layer up from where the audit put it, and the remedy is reachable from this extension. The ADR was rewritten around the measurement, and `pack-prefix-stability` opened.

Four more acted on: figures mixing a 14-Journal population with the script's 13 (now one window, exported and checked in); `0.6%` quoted as the materiality the script computes when the script computes `0.0%`; a verdict blamed on a sample floor that in fact passed; "halves the window" where the Pack halves and the window is 16% smaller; and price multipliers folded in unstated, now named at the table.

One finding recorded rather than fixed: the store-backed suite truncates, so a reviewer's own test run destroyed the collected window mid-review. That is why the window is checked in and why the script reads a file as readily as a store.
