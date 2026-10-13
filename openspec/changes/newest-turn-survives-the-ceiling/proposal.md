# Proposal: The newest Turn survives the Pack ceiling

Triage: needs-triage
Blocked by: pack-parts-follow-the-turn

## Why

On 2026-10-13, Conversation `01a13590…` (the `pack-parts-follow-the-turn` apply session) lost its whole history for one Call. Turn 9 was the apply itself: 431 messages, roughly 730k tokens. The Pack for turn 10, call 0, was 1,416 tokens on top of the Floor, with no verbatim tail and no recollection. The agent then told the user there was no earlier message. `call_accounting` records the chain:

1. The tail token Budget is 25,000 (`DEFAULT_TAIL_TOKENS`). Turn 9 alone exceeds it, so `fitTail` (`src/assembler.ts`) falls back to carrying the newest Turn elided.
2. `elideTurn` (`src/elision.ts`) cannot reach that target on a long Turn. It never shortens a user prompt or an assistant's text, and each tool result or tool-call argument it shortens keeps at least `SHORTEST_TOKENS` (200). Across 431 messages those floors add up: the elided turn 9 was still ~469,721 tokens.
3. That exceeded the 300,000-token Pack ceiling. `reduceToCeiling` re-selects the tail under the remaining room. When the re-selection still doesn't fit (`usable` false), it sets the part to nothing, so the tail was recorded absent for `ceiling`.
4. Recall refused all 10 candidates as irrelevant (turn 9 at distance 0.56 against the 0.52 threshold), so nothing stood in for it.

Two flaws, which ship together. Fixing only the second still has nothing small enough to carry. Fixing only the first leaves an all-or-nothing ceiling, which still drops a newest Turn that reaches the ceiling elided:

- **Elision cannot meet its Budget on a long Turn.** Per-message floors are honoured even when their sum exceeds the allowance, and nothing gives way at the level of whole messages.
- **The ceiling drops the newest Turn of the tail outright.** The spec says the tail is reduced "from its oldest turn" and "the most recent Turns SHALL remain". When only one Turn is left, the code removes it rather than shortening it further. The result is the worst Pack available: no history at all.

Neither flaw comes from `pack-parts-follow-the-turn`. Its only change near this code reserves room for the opening line in `reduceToCeiling`. Both flaws trigger on any Turn much larger than the tail Budget, and long apply sessions make such Turns routine.

## What Changes

- An elided Turn fits the allowance it is given, or as close as content that must never be shortened allows. When per-message shortening has reached its floors, whole messages from the middle of the Turn give way, behind a marker that says how many went and which actions they held. The prompt, the Turn's final assistant text, and the actions that remain are kept.
- The ceiling never leaves the verbatim tail empty when the tail selected at least one Turn: the newest Turn is shortened further rather than removed. If the floor that can't be shortened (prompt and kept text) still exceeds the room, the Pack exceeds its ceiling and reports the overrun. That matches the existing rule for the current Turn.
- Open for grilling:
  - What a middle-out drop keeps: the first and last *k* messages, or the actions at the expense of their outputs, as the spec already requires of recollections ("A recollection carries the actions its turn took").
  - Whether the newest tail Turn may cost the current Turn or the Pins any room.
  - How `/pack` and the Accounting tell "dropped by the ceiling" from "shortened by the ceiling".
  - Whether the tail fallback should prefer a recollection-style rendering (`asRecollection`) over `elideTurn` for oversized Turns.
  - Interaction with `tail-evicts-to-low-water`, which also changes `tailSelector`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`:
  - "A pack fits a ceiling the assembler enforces" gains a scenario: the newest Turn of the tail survives reduction, shortened.
  - "Content too large to carry whole is elided visibly" gains a scenario: a Turn too long for its Budget is shortened to fit, and the messages dropped are named.
  - "Budgets bound each part of a pack" may need the tail fallback restated.

## Impact

- `src/elision.ts` (`elideTurn`), `src/assembler.ts` (`fitTail`, `reduceToCeiling`), `src/report.ts` (how `/pack` reports a shortened tail).
- Regression evidence: Conversation `01a13590-9c9e-746d-955c-1144d294cccc` turns 9–10 in the Thread Store and `call_accounting`. A test at the assembler seam with one Turn of many small tool results reproduces it without the store.
