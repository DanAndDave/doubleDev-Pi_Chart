## 1. Baseline

- [x] 1.1 Run `bun test test/elision.test.ts test/assembler.test.ts test/recollection.test.ts test/extension.test.ts test/graph.test.ts test/measures.test.ts test/utilisation.test.ts` (every file that calls `approximateTokens` or reaches `elide`) and record the pass count, so the refactor is checked against the same figure. Recorded: 423 pass, 0 fail, 1,678 expectations.

## 2. One copy-without-keys helper

- [x] 2.1 In `src/tokens.ts`, add `copyWithout(source, unsent, sent)` per the design, use it for a message (with `UNSENT` and `sentContent` on `content`) and for a block (with `UNSENT_IN_BLOCK`), and fold away `serialized` and `withoutUnsent`, which the helper leaves as one-line wrappers. Verify the baseline files stay green.

## 3. The calibration has one home

- [x] 3.1 In `src/config.ts`, make the `DEFAULT_PACK_TOKENS` doc carry the whole derivation: median 1.57× and p90 1.84× over 624 vanilla Calls, headroom 1.85, the ~28,000 Floor, `≈ 583,000` and `≈ 93,000`. Reduce the `tailTokens` doc to a pointer to it.
- [x] 3.2 In `src/tokens.ts`, replace the figures in `approximateTokens`'s doc with the fact that the estimate under-counts the reported window and a pointer to `DEFAULT_PACK_TOKENS`.
- [x] 3.3 In `README.md`, rewrite only the `PICHART_PACK_TOKENS` row: keep the ~583,000 presumed window and the ~93,000 guidance, drop the 1.85× bias and the ~28,000 Floor, and name `DEFAULT_PACK_TOKENS` in `src/config.ts` for the derivation.
- [x] 3.4 Verify `grep -rn '1\.85\|583,000\|93,000' src README.md` finds the `DEFAULT_PACK_TOKENS` doc, the README row, and nothing else but the README's unrelated comparison interval. Found: `src/config.ts` 217, 219, 221; `README.md` 144 and 335 (the comparison table's `[1.85×, 2.08×]` interval).

## 4. `floor` as a parameter

- [x] 4.1 In `src/elision.ts`, change `elide` to `elide(text, characters, floor = 1)`, move the `floor` doc onto the function, delete `Elision`, and pass the floor positionally at its three callers. Confirm no caller in `src/`, `test/` or `scripts/` still passes an object. Verify the baseline files stay green.

## 5. Close

- [x] 5.1 Run `bun run typecheck` and the baseline files once more, and verify both are clean with the pass count from 1.1. Recorded: `tsc --noEmit` clean; 423 pass, 0 fail, 1,678 expectations.
