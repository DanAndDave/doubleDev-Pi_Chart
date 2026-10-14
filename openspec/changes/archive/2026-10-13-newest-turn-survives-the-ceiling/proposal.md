# Proposal: The newest Turn survives the Pack ceiling

Triage: needs-triage
Blocked by: None

## Why

On 2026-10-13, Conversation `01a13590…` (the `pack-parts-follow-the-turn` apply session) lost its whole history for one Call. Turn 9 was the apply itself: 431 messages, roughly 730k tokens. The Pack for turn 10, call 0, was 1,416 tokens on top of the Floor, with no verbatim tail and no recollection. The agent then told the user there was no earlier message. `call_accounting` records the chain:

1. The tail token Budget is 25,000. Turn 9 alone exceeded it, so the tail fell back to carrying the newest Turn elided.
2. Elision cannot reach that target on a long Turn. It never shortens a user prompt or an assistant's text, and every tool result or tool-call argument it shortens keeps at least 200 tokens. Across 431 messages those floors added up: the elided turn 9 was still ~469,721 tokens.
3. That exceeded the 300,000-token Pack ceiling. The ceiling re-selected the tail under the room left; when the re-selection still didn't fit, it set the part to nothing, so the tail was recorded absent for size.
4. Recall refused all 10 candidates as irrelevant, so nothing stood in for it.

Two flaws, which ship together. Fixing only the second still leaves nothing small enough to carry. Fixing only the first leaves an all-or-nothing ceiling, which still drops a newest Turn whenever a long current Turn squeezes the room:

- **A long Turn cannot meet its Budget.** Per-message floors are honoured even when their sum exceeds the allowance, and nothing gives way at the level of whole messages.
- **The ceiling drops the newest Turn of the tail outright.** The spec says the tail is reduced "from its oldest turn" and "the most recent Turns SHALL remain". When only one Turn is left, the code removes it rather than shortening it further: the worst Pack available, with no history at all.

The rule is decided in ADR-0012 (`docs/adr/0012-the-newest-tail-turn-shrinks-by-its-oldest-actions.md`).

## What Changes

- **Bullet 1: the newest tail Turn fits its Budget.** When the newest tail Turn does not fit even with its payloads elided, its oldest tool-call groups are dropped, each whole: an assistant message with the results of the calls it made, so no call loses its result and no result its call. One marker appended to the Turn's prompt text names what went: a count per tool in order of first use and the estimated tokens dropped, e.g. `[412 earlier messages not carried: read ×140, bash ×52, edit ×13; ~460k tokens]`. Every group may go, the newest included. The Turn's smallest form is its prompt with the marker and its final reply; below that, the final reply is shortened, then the prompt. The marker always survives. Accounting records how many messages each part dropped, and `/pack` shows "N messages dropped".
- **Bullet 2: the ceiling never empties the tail.** When the tail carried a Turn before the ceiling bound, it carries one after: the newest Turn, shrunk to the room left, never below its smallest form. Where that form does not fit, it counts against the ceiling as Pins do, the current Turn is elided around it, and a Pack that still exceeds the ceiling is reported as an overrun, naming both Turns as what could not be reduced.
- Unchanged: the current Turn keeps its rule (shortened by Elision, never shrunk by messages). A tail Budget of zero still disables the tail.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`: "Packs carry the prompt and an unsplit verbatim tail" allows the newest Turn to be shrunk; a new requirement states how it shrinks; "Budgets bound each part of a pack" restates what is irreducible; "A pack fits a ceiling the assembler enforces" keeps the newest tail Turn.
- `pack-accounting`: a part records how many messages it dropped.
- `pack-inspection`: `/pack` reports the dropped messages beside "content shortened".

## Impact

- `src/assembler.ts` (`fitTail`, `tailSelector`, `reduceToCeiling`), `src/elision.ts` (a Turn's smallest form, the marker), `src/accounting.ts`, `src/inspection.ts`, `src/report.ts`, the overrun announcement in `src/extension.ts`.
- No migration: parts are stored as JSON, and a record without the count reads back without it.
- Prompt cache and thinking: a shrunk Turn's prompt differs from what the harness sent, so the leading run ends there (ADR-0012).
- Regression evidence: Conversation `01a13590-9c9e-746d-955c-1144d294cccc` turns 9–10 in the Thread Store and `call_accounting`. Reproduced without the store by a single synthetic Turn of many small tool calls at the assembler seam.
