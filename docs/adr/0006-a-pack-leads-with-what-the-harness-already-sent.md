# A Context Pack leads with what the harness already sent

ADR-0005 measured a governed Call paying full price for its whole Pack — 0.0% of it read from cache against 97.2% ungoverned — and named the mechanism: the harness marks a returned message array for caching only as far as the first message that is not its own at that index, and the Assembler put an assembled message at index 0 on every Call. It left the remedy to a change that owed a quality argument as well as a cost one.

**A Pack now begins with the longest run of messages the harness itself sent, carried unaltered and in its positions.** The assembled parts follow it, then the rest of the tail, then the Turn in progress.

## What the order is now

The run, then recalled Turns, curated knowledge and structure, then the rest of the tail, then the current Turn. The run is drawn from the verbatim tail because no other part can supply it: recalled Turns, Concepts and structure are prose this Assembler writes, and the Turn in progress is the prompt being answered.

Splitting the tail costs less than it sounds. The run is its *oldest* messages and the remainder its newest, so the tail stays in order and the assembled parts still sit between the Turns already answered and the prompt they are background for. What changed is that the completed Turns the harness itself sent now pass them.

## What it measures

Seven governed Conversations, 51 Calls, collected under the new order and checked in at `openspec/changes/…/pack-prefix-stability/evidence/window.json`. The median cached Pack share over qualifying pairs is **91.0%**, against **0.0%** at the median and both quartiles in the baseline.

At the 0.1 / 1.25 multipliers ADR-0005 used, over this machine's Journals:

| group | Calls | median cached Pack | input share of charged | per Call | Pack |
| --- | --- | --- | --- | --- | --- |
| new order, Concepts carried | 23 | 87.3% | 5.7% | **6,298** | 4,979 |
| new order, tail only | 28 | 89.0% | 0.5% | **4,980** | 4,602 |
| old order (ADR-0005 baseline) | 545 | 0.0% | 36.1% | 13,934 | 6,737 |
| ungoverned control | 72 | 97.2% | 0.0% | 5,271 | 13,079 |

A governed Call carrying Concepts costs **2.2× less** than it did, and about what an ungoverned Call costs while carrying a Pack a third the size. Neither arm carried a recalled Turn, so what recall costs is unmeasured; a recollection is the largest message a Pack assembles, and it follows the run like every other assembled part. ADR-0005 recorded governance at 2.6× the price of not governing; that is now roughly parity.

What decides a Call is whether it has a prefix at all, not how big one is: with none, 0.0% over 19 Calls; under 1,024 tokens, 90.0% over 11; at or above it, 90.0% over 21. The 19 are every Call of the first Turn, where no Turn has completed and there is nothing yet to lead with.

## What the comparison had to be

The first live run under this change cached **0.0%** with a tail read from the Thread Store and every visible field identical to the harness's. The harness hangs a symbol property on every message it owns: `Bun.deepEquals` compares symbol keys, so a faithful copy compares unequal, and the harness's own comparison agrees.

So two rules, and both are load-bearing. The comparison is structural and ignores symbol keys — a marker this side cannot see or reproduce is not a difference in what a message says. And where the comparison says two messages say the same thing, the Pack hands back the harness's own object rather than the equal copy, because only that object carries the marker.

Where they disagree — a message elision shortened, a Turn the Store holds differently, a tail that starts later than the harness's array — the run simply ends there and the Assembler's own copy is carried after it. Correct content outranks a cacheable prefix; nothing is substituted to lengthen one.

## The quality argument

No cost figure can make it, so it was judged on answers: four prompts over two Conversations under each order, against the vendored bundle, including one prompt asking about something said two Turns earlier. Both orders name the standard, both attribute each earlier answer to the right document, both correct a loose title on follow-up, and both describe the same change for revenue year-to-date. No difference in substance was found, over eight Turns — 17 priced Calls — per arm, and none is claimed beyond that.

## Consequences

- A Call's record says what the harness could recognise: `leading_tokens` (migration 21) and a `prefix` line in `/pack`, beside the cache line it explains. A 0% cache reading is now diagnosable rather than mysterious.
- A first Call still caches nothing, and nothing can change that: there is no completed Turn to lead with.
- A Conversation longer than its tail Budget has no message at index 0 to agree about, so the run is empty and the Pack is what it always was. Reasoned rather than measured: every Conversation in the window is four Turns against a tail Budget of eight. That is also the point at which governance is actually reducing the window, and no ordering recovers it.
- The Assembler now reads the harness's array for one purpose beyond reconstructing Turns. It carries nothing from it that the Turns do not already hold: `supplied` decides an order, never a content.
- ADR-0003's determinism guarantee is unchanged — the run is a pure function of the parts and the supplied array — and ADR-0005's figures stay as the before-picture they now are.
