## 1. The start is replayed in the Assembler

- [x] 1.1 Write `assemble()` tests in `test/assembler.test.ts` for "the start holds between evictions", "eviction drops to the mark in one step" (25,000-token Budget, default mark) and "the count budget evicts to its mark" (count 8 → newest 4), asserting the tail part's `turnIndices`. Verify they fail on the current code.
- [x] 1.2 Export `tailTokens(turn)` (`approximateTokens(paired(turn).messages)`) and implement `tailStart(sizes, budget, mark)` in `src/assembler.ts` as design.md states; add `tailSizes?` to `AssembleInput` and `tailLowWater` to `AssemblerConfig`, sizing from the completed Turns when `tailSizes` is absent. Select the tail from the start and run `fitTail` over it. Verify 1.1 passes.
- [x] 1.3 Add tests for "a newest turn larger than the mark is kept alone", "a mark of one slides the tail" and "the ceiling does not move the start". Verify they pass.
- [x] 1.4 Add the replay test: assemble a Conversation Call by Call, then once from scratch with the same `tailSizes`, and assert equal starts at every step. Verify it passes.
- [x] 1.5 Compute recall eligibility from the Turns the tail carries rather than `completed.slice(-count)`. Verify tests for "an evicted turn can be recalled" and "a turn in the tail is not recalled" pass.
- [x] 1.6 Update existing tail tests that assert sliding by count or size: set the mark to 1 where the test means "the newest N", and rewrite where it asserts the old slide itself. Verify the assembler suite is green.

## 2. Eviction is recorded and explained

- [x] 2.1 Add `evicted` to `ExclusionReason` and `evicted?: number` to `PartExclusion`; record Turns before the start as `evicted` in `excludedCandidates` and `excluded`, in place of the tail's `count` exclusions. Verify an `assemble()` test asserting evicted Turns are named with that reason and none with `count` or `size`.
- [x] 2.2 Render `${n} evicted` in `REASONS` and `evicted from the tail` in the why line in `src/report.ts`. Verify a `test/report.test.ts` case and a `test/explain.test.ts` case for "an evicted turn is attributed to eviction", and that an older record without the reason renders as before.

## 3. Sizes come from the Thread Store

- [x] 3.1 Add migration 23 (`tail_tokens INTEGER` on `turns`), write it from `tailTokens` in `ingest`'s insert and `DO UPDATE`, and add `turnSizes(conversationId)` to `TurnSource`, `PostgresStore` and `MemoryTurnSource`. Verify a `test/ingest-store.test.ts` case: sizes match `tailTokens` of the stored Turns, in order, and change when the head Turn is re-ingested larger.
- [x] 3.2 Size rows with a null `tail_tokens` from their messages in `turnSizes` and write the size back. Verify a test that nulls the column, reads sizes, and finds them stored afterwards.
- [x] 3.3 In `tailFor`, read `recentTurns` and `turnSizes` together under the tail deadline, append live sizes for Turns newer than the Store's newest, and pass `tailSizes` to `assemble`; on any failure or missed deadline keep the existing fallback with `tailSizes` absent. Verify a `test/extension.test.ts` case with a Store lagging one Turn, and that the existing fallback tests still pass.

## 4. Configuration and docs

- [x] 4.1 Add `tailLowWater` to `Config` via `share(env.PICHART_TAIL_LOW_WATER, DEFAULT_TAIL_LOW_WATER)` with default 0.6, add the variable to the known list, and map it in `assemblerConfig`. Verify `loadConfig` returns 0.6 unset, 1 for `"1"`, and 0.6 for `"0"` and `"1.5"`.
- [x] 4.2 Add `PICHART_TAIL_LOW_WATER` to the README configuration table and note under `PICHART_TAIL_TOKENS` that the tail evicts to the mark. Verify the README names ADR-0013.

## 5. Verification

- [x] 5.1 Run `bun run typecheck` and the full suite once. Verify both are green.
- [x] 5.2 Run `bun scripts/bench-tokens.ts --turns 12 --runs 3 --parallel 6 --out /tmp/evict.json` and compare against `docs/benchmarks/2026-10-13-token-usage-parts-follow-turn.json`. Verify cache write on turns 8–12 falls by roughly 30%, prefix held rises, and the codeword probe and blind quality do not get worse; record the result in `docs/benchmarks/`.
