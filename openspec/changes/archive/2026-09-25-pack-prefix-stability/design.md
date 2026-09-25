## Context

`pack-order-cache` measured the cost and ADR-0005 named the mechanism: the harness marks a returned message array for caching only up to the first message that is not deep-equal to its own message *at the same index*, and the Assembler puts an assembled message at index 0 on every Call. So a governed Call is cached at the system-and-tools breakpoint and nowhere else — 20,492 tokens of Floor, 0.0% of the Pack, on 545 measured Calls.

The remedy is not "put retrieval last". It is "put something the harness recognises first", and the only messages that can be recognised are the ones it supplied.

## Goals / Non-Goals

**Goals:**

- A Pack that opens with the harness's own messages, in their own positions, so there is a prefix to cache.
- No message altered in order to qualify. Correct content outranks a cacheable prefix.
- The Budgets, the parts, the accounting and the determinism guarantee unchanged.

**Non-Goals:**

- What is retrieved, or how. The candidates reaching `assemble` are unchanged.
- The ceiling's reduction order, which is about what a Pack drops, not where a part sits.
- Making a prefix exist where none can: a Conversation longer than the tail Budget has no message at index 0 to agree about, and this change does not invent one.

## Decisions

### Only the verbatim tail can lead

Of the five parts, three are written by this extension — recalled Turns, Concepts, structure are prose the Assembler composes — and can never equal a supplied message. That leaves the verbatim tail and the current Turn. The current Turn ends the Pack, which the delta keeps: it is the prompt being answered, and background that follows the question is background the model reads after it has been asked. So the leading run is drawn from the tail, and from nothing else.

### The run is a prefix of the tail, compared by value at the same index

`lead(k)` is the largest `k` such that the tail's first `k` messages are deep-equal to the harness's first `k`. Same index, because that is the comparison the harness makes; by value, because ADR-0005 measured that rebuilding a message costs nothing while moving one costs everything.

The Pack is then: the run, the assembled parts in their existing order, the rest of the tail, the current Turn. Splitting the tail sounds worse than it is — the run is the *oldest* messages of the tail and the remainder the newest, so the tail stays in order, and the assembled parts still sit immediately before the newest Turns and the prompt. The claim the old order encoded, that retrieval is background for what follows, survives: it now precedes the newest Turns and the current one rather than the whole tail.

### Where the Store and the harness disagree, the Store's copy wins and the run ends

The tail is drawn from the Thread Store when it can be, and the Store's copy is the one the rest of this system reasons about — it is what `/pack` reports, what recall deduplicates against, and what elision shortened. A Pack that swapped in the harness's copy to lengthen a prefix would carry content that no part's accounting describes.

So disagreement is not resolved; it ends the run. A shortened message, a Turn reconstructed differently, a Store holding a Turn the harness's array does not: each simply falls outside the run and is carried after it. The prefix is whatever honestly survives, and where nothing does, the Pack is exactly what it is today.

### The run is handed back as the harness's own objects

Measured, not assumed: the harness hangs a symbol property on every message it owns. A Thread Store copy is equal in everything a reader can see and unequal to `Bun.deepEquals`, which compares symbols — and unequal to the harness's own comparison too, since the first live run under this change cached 0.0% with a tail read from the Store and every visible field identical.

So the comparison is structural and ignores symbol keys (a marker this side cannot see or reproduce is not a difference in what a message says), and the run carried is the harness's own objects rather than the equal copies. That substitutes nothing: the comparison is what established the two say the same thing, and where they do not, the Store's copy is carried after the run exactly as before.

### The run's size is recorded, because a cache figure without it explains nothing

`pack-order-cache` records what a Call was charged; nothing records what the harness could recognise, which is the whole mechanism. So the Pack carries `leadingTokens`, a Call records it (migration 21), and `/pack` prints it beside the cache line. In tokens rather than messages, because a cache reads back tokens — and it is what lets the window separate a Pack that led with nothing from one whose run was simply small, which turns out to be the distinction that decides a Call.

### Elision inside the run is not special-cased

Elision applies where a Budget binds. A shortened message is not the harness's message, so it cannot be in the run — but nothing stops it from being carried, and nothing shortens a message *because* it would otherwise lead. The two rules do not interact; the comparison decides.

### The composition happens after the ceiling

`reduceToCeiling` re-runs a part's selection under a smaller Budget, so the tail's messages are not final until it has run. The run is computed from the final parts, in the same pass that flattens them, which is also what keeps `assemble` deterministic: same inputs, same parts, same comparison, same order.

## Risks / Trade-offs

- **A quality regression no cost figure shows** → the assembled parts move from before the whole tail to before its newest Turns and the current prompt, which is a smaller move than the proposal assumed. Judged on answers in live Conversations, recorded either way (task 4.1).
- **A prefix that exists only for short Conversations** → reasoned, not measured: every Conversation in the collected window is four Turns against a tail Budget of eight, so none of them reaches the case. A Conversation past its tail Budget has no index-0 agreement to find, the run is empty, and the Pack is what it always was — which is also the point at which governance is actually reducing the window.
- **A Pack whose `messages` is no longer `parts.flatMap(…)`** → the parts keep their messages and their accounting; only the flattening order changes. One function owns it, and the tests assert that every part's messages are present exactly once.

## Testing seams

| Requirement | Seam |
| --- | --- |
| The harness's own messages come first | `assemble()` — pure, with a supplied array and turns built from it. |
| A shortened message does not lead | `assemble()` with a tail message altered, asserting where it lands. |
| A pack with nothing supplied is still assembled | `assemble()` with no supplied array, asserting the parts are unchanged. |
| A split tail keeps each call with its result | `assemble()` with a tail Budget that shortens a tool result, asserting the result still follows its call. |
| The current turn still ends the pack | `assemble()`. |
| What a pack carries is unchanged by where it sits | `assemble()` — same inputs, parts and Budgets compared before and after. |
| The prefix reaches the harness | `test/extension.test.ts` harness: the `context` event's array leads the returned one. |
| The cached share rises | `scripts/measure-pack-cache.ts` over a governed window collected after the change. |

## Open Questions

None.
