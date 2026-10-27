# Proposal: Tidy the estimate and elision

Triage: ready-for-agent
Blocked by: None

## Why

The code review of `estimate-counts-what-is-sent` left three findings that change no behaviour but make the next edit harder than it needs to be.

- `src/tokens.ts` copies an object without a set of keys twice: `serialized` copies a message without its `UNSENT` keys, and `withoutUnsent` copies a content block without its `UNSENT_IN_BLOCK` keys. The two loops differ only in the denylist and in `serialized` passing `content` through `sentContent`.
- The Ceiling's calibration is written out four times: the estimator's measured bias (median 1.57×, p90 1.84×, headroom 1.85), the ~28,000 Floor, the presumed window of ~583,000 and the ~93,000 figure for a 200,000-token window appear in the `approximateTokens` doc comment, the `tailTokens` doc on `Config`, the `DEFAULT_PACK_TOKENS` doc and the README's `PICHART_PACK_TOKENS` row. The last re-measurement had to edit all four, and missing one leaves two derivations that disagree.
- `elide(text, characters, { floor = 1 }: Elision = {})` takes an options object that has one field. Every caller that passes it passes only `floor`.

## What Changes

- **One copy-without-keys helper.** `src/tokens.ts` gets one function that copies an object's own entries in order, skipping a denylist and `undefined` values and mapping each kept value. The message copy uses it with `UNSENT` and `sentContent` on `content`; a block uses it with `UNSENT_IN_BLOCK`. Key order, the `undefined` rule and the content-array reuse are unchanged, so every estimate is byte-for-byte the same.
- **The calibration has one home.** The derivation stays on `DEFAULT_PACK_TOKENS` in `src/config.ts`, the default it justifies. The `approximateTokens` doc and the `tailTokens` doc keep why the estimate under-counts and point to `DEFAULT_PACK_TOKENS` for the figures. The README row keeps what an operator needs to act on, the presumed ~583,000 window and "lower it to about 93,000 on a 200,000-token window", and drops the formula's inputs (the 1.85× bias and the ~28,000 Floor).
- **`elide` takes `floor` as a plain optional parameter.** `elide(text, characters, floor = 1)`. The `Elision` interface goes. The three callers in `src/elision.ts` that pass a floor pass it positionally; the callers in `src/assembler.ts` and `src/embed-text.ts` pass none and do not change.
- Unchanged: every estimate, every elision's output, every default and every Budget.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. No requirement text changes: `pack-accounting` already specifies what the estimate counts, and the refactor keeps the estimate and elision output identical. So `.openspec.yaml` declares `skip_specs: true`.

## Impact

- `src/tokens.ts`: one helper replaces two copy loops; the doc comment's calibration figures become a pointer.
- `src/config.ts`: the `tailTokens` doc becomes a pointer; `DEFAULT_PACK_TOKENS` keeps the full derivation.
- `src/elision.ts`: `elide`'s signature and its three floor-passing callers; `Elision` deleted.
- `README.md`: the `PICHART_PACK_TOKENS` row only.
- Tests: none change. No test calls `elide` directly, and the estimate's tests in `test/assembler.test.ts` already pin its output.
- No migration, no Accounting change, and no change to what is sent to the model.
