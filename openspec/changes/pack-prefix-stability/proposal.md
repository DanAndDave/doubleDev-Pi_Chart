# Proposal: A Context Pack the Harness Can Cache

Triage: needs-triage

## Why

`pack-order-cache` measured what a Context Pack costs, and the answer is that a governed Call pays full price for its whole Pack on every Call. Over 545 governed Calls against 72 ungoverned ones, same prompts and same model: the median cached share of a Pack is **0.0% governed against 97.2% ungoverned**, **36.1% of everything charged governed is uncached input** against 0.0%, and a Call costs **2.6×** as much at the provider's current multipliers while carrying a Pack half the size (ADR-0005).

The cause is not provider-side prefix invalidation, which is what the audit inferred and what the pre-registered experiment was built to observe. It is the harness's breakpoint rule: after the `context` hook returns, every message that is not deep-equal to the harness's own message at the same index is tagged as per-call context, and a message cache breakpoint is placed only before the first tagged message. Put an assembled part at index 0 and there is no message breakpoint at all — `cacheRead` stays pinned at the system-and-tools breakpoint, 20,492 tokens on every governed Call of the baseline.

One measurement isolates it. Four extensions differing only in what they hand back: passing the array through caches 88.0% of the Pack, rebuilding every message from scratch caches 91.1%, appending one assembled message at the end caches 86.6%, and **prepending that same message caches 0.0%** while multiplying input seventeenfold. Comparison is by value, not identity, so a rebuilt message costs nothing — what costs is a message the harness did not send arriving before one it did.

## What Changes

- The Assembler's output begins with the longest run of messages the harness itself sent, unaltered and in place, so the harness has a prefix to mark. Everything assembled — recalled Turns, Concepts, structure — follows it.
- Where the verbatim tail is drawn from the Thread Store or shortened by elision, it is not the harness's own message and cannot lead. The tail's composition therefore becomes part of the decision rather than an implementation detail: a Pack that reuses the harness's messages where they agree with the Store's keeps a cacheable prefix; one that always rebuilds does not.
- A Pack's parts keep their identity and their Budgets. This changes where parts sit, not what they carry or what bounds them.
- The claim the current order encodes — that retrieval is background for the Turn that follows — is what has to be argued against, not merely outspent. A pack whose background sits after the exchange is a different pack for the model, and no Journal figure reports what that does to an answer.
- The cache figures already recorded become the acceptance test: a governed Conversation's median cached Pack share must rise from 0.0%, measured by the script that established the baseline.

**Not in scope:** what is retrieved or how (`recall-fidelity`, `doc-authoring`); Budgets and the ceiling (`token-budgets`); the accounting columns and the `/pack` line, which shipped with `pack-order-cache`.

## Capabilities

### Modified Capabilities

- `context-assembly`: gains a requirement fixing the order of a Pack's parts, which no requirement states today — the specs name the parts, their distinctness and their Budgets, never their sequence. It is worth writing once a figure stands behind it, and one does.

## Impact

- **Schema:** none. The columns this reads shipped with `pack-order-cache`.
- **Assembly:** the reduction order under the ceiling is stated in `context-assembly` and is independent of composition order; both must be re-stated together so a reader cannot confuse them.
- **Risk:** a quality regression no cost figure would show. The measurement here is cheap and the quality argument is not, which is why this is its own change rather than a line in the one that measured.
- **Blocked by:** nothing. `pack-order-cache` shipped the instrument, the baseline and ADR-0005.
