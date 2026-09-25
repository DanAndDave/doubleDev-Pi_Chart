# A Context Pack is cached only as far as its first assembled message

The functionality audit carried one `[INFERENCE]`: volatile per-Call retrieval sits at the head of every Context Pack, caching is prefix-based, and recall changes every Call by construction — so the cached prefix is plausibly invalidated for the whole body beneath. `pack-order-cache` fixed a decision rule before measuring, recorded what each Call costs, and collected a baseline.

**The effect is confirmed and larger than the audit supposed; the mechanism it proposed is not what produces it.** A governed Conversation caches none of its Pack, not because a changing head invalidates a cached prefix at the provider, but because the harness never offers the provider a prefix to cache: it places a message cache breakpoint only before the first message it did not itself send, and the Assembler puts an assembled part there on every Call.

## What was measured

Sixteen Conversations of four Turns each, same prompts, same files, same model, same machine, run back to back — thirteen governed by this extension, three with `--no-extensions` so the harness sent its own accumulating message array. Every figure below is printed by `scripts/measure-pack-cache.ts`; the governed window it paired is checked in beside this change.

The cached share of a Pack is derived against the Floor, because the Floor is most of a window and caches whatever the Pack does: `max(0, cacheRead − floorTokens) / packTokens`. The identity it rests on — `input + cacheRead + cacheWrite = promptTokens` — holds on **7,890 of 7,890** priced Calls in this machine's 370 Journals.

| `--journals` group | Calls | median cached Pack | charged per Call | at 0.1/1.25 multipliers | Pack |
| --- | --- | --- | --- | --- | --- |
| governed | 545 | **0.0%** | 32,572 | **13,934** | 6,737 |
| ungoverned | 72 | **97.2%** | 38,669 | **5,271** | 13,079 |

Governance halves the **Pack** and multiplies what a Call costs by 2.6 at the provider's current multipliers — a cached read is a tenth of an input token, a cache write a quarter more than one. Across governed Calls, **36.1% of everything charged is uncached input**: 6.40M of 17.75M tokens, against 144 input tokens in total for the ungoverned control. Only 8 of 545 governed Calls wrote anything to the cache; all 72 ungoverned ones did.

## What the mechanism actually is

Four throwaway extensions, one Conversation each, differing only in what they hand back from the `context` event:

| variant | what it returns | input | cacheWrite | median cached Pack |
| --- | --- | --- | --- | --- |
| passthrough | the harness's array, untouched | 3,256 | 10,218 | 88.0% |
| rebuilt | the same messages, new objects | 5,205 | 10,178 | 91.1% |
| appended | the harness's array, then one assembled message | 10,907 | 21,353 | 86.6% |
| prepended | one assembled message, then the harness's array | 183,330 | **0** | **0.0%** |

One message moved from the end to the front takes caching from 87% to nothing and multiplies input seventeenfold. Rebuilding every message from scratch costs nothing, so the comparison is by value and not by identity. The harness's own rule, read from the binary, matches: after the `context` hook returns, each message that is not deep-equal to the harness's message at the same index is tagged as per-call context, and the breakpoint scan places a message breakpoint only *before* the first tagged message — which, when that index is zero, is no message breakpoint at all. That leaves `cacheRead` pinned at the system-and-tools breakpoint: **20,492 on every governed Call in the baseline**, whatever the Pack beneath it did.

## Why the pre-registered rule returns inconclusive

The rule read pairs of consecutive Calls within one Turn where the leading parts changed and the tail did not: reorder justified when the median cached Pack share is below 0.25 *and* `cacheWrite` on those pairs is at least 10% of input *and* the tail slides less often than the head changes.

Over 209 qualifying pairs across 12 Conversations — past the rule's floor of 200 and 10 — the median is 0.0%, so the first clause holds. The other two cannot: `cacheWrite` on those pairs is 0.0% of governed input, and the tail slid at 0 of 36 Turn boundaries while the head changed on 4 of 209 within-Turn pairs. **Verdict: inconclusive**, and honestly so — the experiment was built to observe provider-side prefix invalidation, and with no breakpoint inside the Pack there was nothing provider-side to observe. Two of its three clauses were unreachable by construction: `cacheWrite` on a non-first Call is structurally zero once a head part exists, and four Turns never exhaust an eight-Turn tail.

So the inference is neither confirmed nor refused on its own terms. What replaced it is a stronger statement with a cheaper experiment behind it.

## Decision

**The composition order stays for now** — recalled Turns, curated knowledge, structure, the verbatim tail, the current Turn (`src/assembler.ts:312,348,390,424,470`) — because changing it is a separate change that owes a quality argument as well as a cost one, and because a reorder alone does not fix this: the cacheable prefix is the longest run of messages identical to the harness's own, and a tail drawn from the Thread Store or shortened by elision is not identical to it. `pack-prefix-stability` proposes that work with these figures behind it.

**The cache figures stay.** `cacheRead`, `cacheWrite` and `inputTokens` are recorded per Call beside the sizes they are charged against, and `/pack` reports the cached share of the Pack — not of the window, which reads 69.9% on a Call where none of the Pack was cached. They are derived from the Journal, rebuilt by re-ingest, and lost with the database like everything else in it (ADR-0002).

## Consequences

- The cost of governing a window is now a number rather than a worry: 2.6× per Call at current multipliers, against a Pack half the size. ADR-0001 named prompt-cache writes as a reason the stateless-per-Turn design was rejected; this is that cost arriving by another route.
- The remedy is reachable from this extension rather than only from the harness, which is what makes a follow-up worth proposing.
- The evidence outlives the scratch database it was collected in: `openspec/changes/…/pack-order-cache/evidence/window.json` is the paired window, and `scripts/measure-pack-cache.ts` reads it without a store.
- The audit's `[INFERENCE]` is closed. A reader who wonders about Pack order finds this, and the one experiment that settles it, instead of re-running the wrong one.
