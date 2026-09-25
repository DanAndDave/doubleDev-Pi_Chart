## 1. Decide what may lead

- [x] 1.1 Establish, for each part the Assembler composes, whether its messages can be carried byte-identical to what the harness supplied, and record which of them ever can

  Recalled Turns, Concepts and structure are prose the Assembler writes —
  `asRecollection`, `asCuratedKnowledge`, `asStructure` — and can never be
  a supplied message. The current Turn could be, but it ends the Pack.
  That leaves the verbatim tail, and the run is drawn from it alone.

- [x] 1.2 Decide what happens when the Thread Store's copy of a Turn disagrees with the harness's — prefer the supplied message, prefer the Store's, or carry the Store's after the run — and record why, since this is the case that decides whether a prefix exists at all

  Disagreement is not resolved: it ends the run, and the Store's copy is
  carried after it. The Store's copy is what every other part reasons
  about — what `/pack` reports, what recall deduplicates against — so
  swapping in the harness's text to lengthen a prefix would carry content
  no part's accounting describes.

  Agreement, though, is handed back as the harness's own object. That was
  not in the plan; it came out of the first live run, which cached **0.0%**
  with a tail read from the Store and every visible field identical. The
  harness hangs a symbol property on each message it owns: `Bun.deepEquals`
  compares symbols, so a faithful copy compares unequal, and the harness's
  own comparison evidently agrees. The fix is both halves — compare
  structurally, ignoring symbol keys, and carry the harness's object where
  the comparison says the two say the same thing.

- [x] 1.3 Decide whether elision may apply to a message inside the leading run, given that a shortened message is not the harness's message

  No special case. A shortened message is not the harness's message and
  falls outside the run by the same comparison as anything else; nothing
  declines to shorten a message because it would otherwise lead.

## 2. Ordering the pack

- [x] 2.1 Lead a Pack with the longest run of supplied messages the Assembler carries unaltered, and verify the assembled parts follow it in their existing order

  `compose` in `src/assembler.ts`: the run, then recalled, curated and
  structure in their existing order, then the rest of the tail, then the
  current Turn. "The harness's own messages lead, in the positions it sent
  them" in `test/assembler.test.ts`; end to end in "a pack leads with the
  messages the harness sent, then the retrieval" in
  `test/extension.test.ts`, where the tail comes from the Thread Store.
  Removing the run restores the old order and fails both.

- [x] 2.2 Verify a message the Assembler altered is carried after the run rather than breaking it

  "A message the assembler altered ends the run rather than breaking it":
  the first Turn agrees and leads, the second is carried after the
  assembled parts, and the harness's version of it is nowhere in the Pack.

- [x] 2.3 Verify a Pack whose supplied messages are all altered still carries every part, with its Budgets and accounting unchanged

  "A tail that starts later than the harness's array leads with nothing" —
  two Turns of tail against four supplied, so there is no index-0
  agreement — and "every part's messages are carried exactly once, wherever
  they sit". Comparing from the end of the array rather than the same index
  fails the first.

- [x] 2.4 Verify the Turn in progress is still last

  "What the assembler added still comes before the prompt it is background
  for": the prompt ends the Pack and the curated part precedes it.

- [x] 2.5 Verify two Packs assembled from the same inputs are still identical, and that the ceiling's reduction order is unchanged

  "Assembling the same inputs twice still gives the same pack" — messages
  and parts both. `reduceToCeiling` is untouched and runs before
  composition, which is what keeps a reduced Pack's run honest: the run is
  computed from the messages the parts finally carry.

## 3. Proving it at the cache

- [x] 3.1 Collect a governed window under the new order with `scripts/measure-pack-cache.ts`, and verify the median cached Pack share rises from the 0.0% ADR-0005 recorded

  Seven governed Conversations, 51 Calls, every one priced, collected under
  the new order and checked in at `evidence/window.json`. The median cached
  Pack share is **91.0%** over qualifying pairs, against **0.0%** at the
  median and both quartiles in `pack-order-cache`'s baseline.

  The window splits exactly where the mechanism says it should:

  | the prefix the harness could mark | Calls | median cached Pack |
  | --- | --- | --- |
  | none | 19 | 0.0% |
  | under 1024 tokens | 11 | 90.0% |
  | 1024 tokens or more | 21 | 90.0% |

  The 19 with no prefix are first Calls, where no Turn has completed and
  the tail is empty — the Call that fills a cache rather than reads one.
  Size is not what decides: a prefix of a few hundred tokens reads back as
  much of the Pack as one of several thousand. Having a prefix is.

- [x] 3.2 Report what the change costs per Call against the baseline's 13,934 tokens at the provider's multipliers, and record the figure whichever way it goes

  `bun scripts/measure-pack-cache.ts --journals --group …`, this machine's
  Journals, at the 0.1 / 1.25 multipliers ADR-0005 used:

  | group | Calls | median cached Pack | input share of charged | per Call | Pack |
  | --- | --- | --- | --- | --- | --- |
  | new order, retrieval carried | 23 | 87.3% | 5.7% | **6,298** | 4,979 |
  | new order, tail-only | 28 | 89.0% | 0.5% | **4,980** | 4,602 |
  | old order (ADR-0005 baseline) | 545 | 0.0% | 36.1% | 13,934 | 6,737 |
  | ungoverned control | 72 | 97.2% | 0.0% | 5,271 | 13,079 |

  A governed Call carrying recalled Turns and Concepts costs **6,298**
  against the baseline's **13,934** — 2.2× less — and a governed Call now
  costs about what an ungoverned one does while carrying a Pack a third the
  size. Uncached input falls from **36.1%** of everything charged to
  **5.7%**.

- [x] 3.3 Verify a Conversation whose tail comes from the Thread Store rather than the harness is measured separately, since it is the case that may have no prefix to protect

  The instrument reports it, from `tailSource` recorded on the Call:
  thread-store **90.0%** median over 32 Calls, harness-fallback **0.0%**
  over 19. The split is not Store-versus-harness quality — it is first
  Calls, which have no completed Turn to lead with and so fall back. A
  Store copy round-trips faithfully enough to lead, which is the thing this
  task existed to doubt.

  What the Call's own record says is now `prefix ~3673 tokens the harness
  sent itself, carried unaltered at the head of the pack`, beside
  `cache 31583 read, 1386 written (75% of the pack read from cache)` —
  recorded through migration 21 so a cache figure can be explained rather
  than only reported.

## 4. The argument the figures do not make

- [x] 4.1 Record what moving retrieval after the Turns already answered does to an answer, from live Conversations judged on their answers rather than on their token counts

  The move is smaller than the proposal assumed: the assembled parts leave
  the head of the Pack but still sit between the Turns already answered
  and the prompt they are background for. Only the completed Turns the harness itself sent
  pass them.

  Judged live, four prompts over two Conversations under each order,
  against the vendored bundle: both orders name the standard, both
  attribute the second answer to the Revenue Recognition Policy rather than
  to the Cost Allocation Standard when asked which answer depended on
  which, both correct the loose title to `Cost Allocation & Margin Standard
  (FY2026)` on the follow-up, and both describe the same change for revenue
  year-to-date. The third prompt is the one that matters — it asks about
  something said two Turns earlier — and it is answered correctly under
  both. No difference in substance was found, and none is claimed beyond
  these eight Turns — 17 priced Calls — per arm.

- [x] 4.2 Record the decision either way as an ADR, including the outcome where the cost is won and the quality is not

  `docs/adr/0006-a-pack-leads-with-what-the-harness-already-sent.md`.
