# Proposal: Token-denominated Budgets

Triage: ready-for-agent

## Why

Every Budget is a count of items — Turns, Concepts, symbols — and the Context Window is measured in tokens. The two are barely correlated, so the mechanism that is supposed to stop the window growing does not bound it. Measured on this machine's real Journals: the default eight-Turn verbatim tail reaches 974,861 approximate tokens, one real Turn produced a 983,339-token Pack through `assemble()` with default Budgets, and nothing raised, clamped, or reported anything.

Worse, the count Budget removes the wrong material. On the audited Conversation, dropping half of it — eight Turns of sixteen — recovered **8.6%** of the bytes, because the Turns dropped were the small early ones and the Turns kept are the giants. A count-denominated Budget deletes history in the order least correlated with cost. The same ceiling denominated in tokens keeps five recent Turns for 87,920 instead of eight for 974,861.

This is also what makes every other retrieval improvement affordable. While the tail can consume the whole window, there is no room for a Turn recalled from early in a Conversation however relevant it is, so the size defect and the recall defect are one defect. Full evidence in `docs/audits/2026-09-16-functionality-audit.md`.

## What Changes

- Each part of a Context Pack gains a token Budget alongside its count Budget. A part is trimmed to whichever binds first. Counts stay: they are meaningful, cheap, and already tuned.
- A Context Pack gains a ceiling. When the parts together exceed it, they are trimmed in a fixed, specified order — structure, then curated knowledge, then the weakest recollections, then the oldest Turns of the verbatim tail — so overflow is resolved by rule rather than by whichever provider refuses first.
- The current Turn is never dropped. When the current Turn alone exceeds the ceiling, its tool results are elided rather than the Turn being lost, and the elision is reported.
- Oversized content is elided visibly, never silently: a clamped tool result or recollection carries a marker naming what was removed, so the agent can tell a truncated file from a short one and ask for the rest.
- The token estimate covers the whole message rather than its `content` field alone. Calibrated against the harness's own reported figures it currently runs 1.35–1.49× low, and it is about to carry decisions rather than only display.
- Accounting records *why* content was excluded — size, count, or relevance — as distinct reasons, and reports when a Pack crosses a configured share of the window it was measured in.

**Not in scope:** what is retrieved or how it ranks (`recall-fidelity`, `doc-authoring`); the rejected-candidate ledger and `/pack` addressing (`pack-why`); reordering the parts for prompt-cache stability (`pack-order-cache`); any change to the Floor, which the Assembler cannot reach by definition.

## Capabilities

### Modified Capabilities

- `context-assembly`: Budgets become denominated in tokens as well as items; a Pack acquires a ceiling and a specified trim order; content too large to carry whole is elided with an explicit marker instead of being carried whole or dropped whole.
- `pack-accounting`: exclusion acquires a recorded reason, the size estimate's basis is specified and comparable to the harness's reported figures, and a Pack approaching the window is reported rather than merely recorded.

## Impact

- **Configuration:** a token Budget per part and a Pack ceiling, each with a default chosen from measurement rather than taste, and each settable in-session through `pack budget` alongside the existing counts.
- **Assembly:** one additional pass over already-estimated parts. `assemble()` stays pure and deterministic — the trim order is fixed, so the same inputs still produce the same Pack.
- **Behaviour change:** a Conversation doing heavy file work will carry fewer verbatim Turns than it does today. That is the point, and `/pack` will say so, but it is a visible change in what the model sees.
- **Not a migration:** no schema change beyond the exclusion reason, which older Accounting rows simply lack.
- **Unblocks:** `recall-fidelity`, `doc-authoring`, `pack-why`, and `pack-order-cache`, all of which assume a Pack whose size is governed. It is the head of the queue for that reason.
