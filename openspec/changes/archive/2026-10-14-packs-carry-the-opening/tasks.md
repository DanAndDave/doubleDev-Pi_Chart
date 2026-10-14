## 1. Store: a Conversation's first prompt

- [x] 1.1 Add `OpeningSource { openingPrompt(conversationId): Promise<string | undefined> }` to `src/thread-store.ts`, widen `ContractSubject` in `test/turn-source-contract.ts` to `TurnSource & TurnSink & OpeningSource`, and add contract cases (red first): Turn 0's prompt answered; empty prompt answered as `""`; Turn 0 removed by `rewind`-style removal answers `undefined`, never Turn 1's prompt; another Conversation answers `undefined`; re-ingested Turn 0 answers its new prompt. Verify: the cases fail for `memory` and `postgres`.
- [x] 1.2 Implement `openingPrompt` on `MemoryTurnSource` and on `PostgresStore` (`SELECT prompt FROM turns WHERE conversation_id = $1 AND turn_index = 0`). Verify: `bun test test/thread-store.test.ts test/postgres-store.test.ts` passes.

## 2. Configuration

- [x] 2.1 Add `Config.openingTokens = count(env.PICHART_OPENING_TOKENS, 1_000)`, `PICHART_OPENING_TOKENS` in `SETTINGS`, `AssemblerConfig.opening: Budget` from `assemblerConfig()` as `{ count: openingTokens > 0 ? 1 : 0, tokens: openingTokens }`, and `openingTokens` in `test/fixtures.ts` `budgets()` defaulting to 0. Verify: `bun run typecheck` is clean and `bun test test/assembler.test.ts` is unchanged.
- [x] 2.2 Add `"opening-tokens": "openingTokens"` to `BUDGET_FIELDS` and to `setBudget`'s refusal message, with a case beside the existing `setBudget` tests in `test/inspection.test.ts`. Verify: that test passes.

## 3. Assembler: the Opening part

- [x] 3.1 Red: in `test/assembler.test.ts`, add a `describe("the opening")` covering the context-assembly scenarios: carried once Turn 0 has left the tail, whatever the prompt; absent `carried` while the tail or the Turn in progress carries Turn 0; prompt only; after the marker and before recalled Turns, with no Opening text before the marker; long prompt elided with a marker and not absent; Budget 0 → `disabled`; empty or whitespace prompt → `empty`; `opening: undefined` → `missing`; `unavailable.opening` → `unconfigured`/`failed`; recall carrying Turn 0 too; byte-identical across two assemblies; part recorded as `{ source: "opening", turnIndices: [0], budget }`. Verify: the new cases fail.
- [x] 3.2 Add `"opening"` to `PackSource`, `carried | empty | missing` to `AbsenceCause`, `opening?: string` to `AssembleInput`, and `opening` to `Pack.budgets`. Add `openingSelector()` (header `[the opening of this conversation: the user's prompt at turn 0]`, whole if it fits, else `elide()`d, nothing below `SHORTEST_TOKENS` or count < 1). Push the part after `recalled` with the precedence `disabled → carried → unavailable → missing → empty → size`. Verify: the 3.1 cases pass.
- [x] 3.3 Put `"opening"` first in `REFERENCE` and between `"recalled"` and `"verbatim-tail"` in `REDUCTION_ORDER`, and add its entry to the reducible map. Extend the `everything` fixture's order test, and add ceiling cases: reduction order with the Opening; shortened to the room left; absent `size` when the room is below a readable prompt. Verify: `bun test test/assembler.test.ts` passes.

## 4. Extension: fetch beside the tail

- [x] 4.1 Red: in `test/extension.test.ts`, add cases using the `harness` with an `opening` dep: a stored first prompt reaches the Pack once the tail has evicted Turn 0; a never-resolving `openingPrompt` is reported as a missed deadline, the Opening is recorded `failed`, and the tail is still carried; a rejecting one is reported and recorded `failed`; no `opening` dep records `unconfigured` even when harness history holds the first prompt. Verify: the cases fail.
- [x] 4.2 Add `opening?: OpeningSource` to `Dependencies`, wire it to the store only on the Store-backed path of `piChart()`, and add `openingFor()` returning `Supplied<string | undefined>` under `inTime(…, tailDeadlineMs, …)`, run in `Promise.all` with `tailFor()`, skipping the query when `openingTokens <= 0`. Pass `opening` and `unavailable.opening` to `assemble()`. Verify: the 4.1 cases pass.

## 5. Accounting, inspection, report

- [x] 5.1 Add the three wordings to `ABSENCE` in `src/report.ts` (`absent: the turns carry it`, `absent: the first prompt is empty`, `absent: the first turn is no longer stored`), make `CallAccounting.budgets.opening` optional, and confirm `recordPart`, `viewPart`, compare and summary carry the part. Add `test/report.test.ts` cases: a carried Opening renders an `opening` line with Turn 0 and no refusals; the `carried`, `empty`, `missing` and `unconfigured` reasons each render distinct text. Add a `test/inspection.test.ts` comparison case where the Opening enters between two Calls. Verify: `bun test test/report.test.ts test/inspection.test.ts` passes.

## 6. Benchmark probe

- [x] 6.1 In `scripts/bench-tokens.ts`, append `Also remember this build number for later: 7341.` to turn 3, make `PROBE` ask for the codeword and the build number, score `recalled` (codeword) and `fact` (build number) separately on `Run.probe`, score probes only when no `--workload` file was given, and print the build-number line only when some run has `fact`. Update the header comment. Verify: `bun run typecheck` is clean, and `bun scripts/bench-tokens.ts --report docs/benchmarks/2026-10-13-token-usage-tail-evicts.json` still prints the codeword line.

## 7. Docs and close

- [x] 7.1 Add `PICHART_OPENING_TOKENS` to the README settings table and `opening-tokens` to the `/pack budget` list. Verify: both appear in `README.md`.
- [x] 7.2 Run `bun run typecheck`, the full `bun test`, and `openspec validate packs-carry-the-opening --strict`. Verify: all clean.
- [x] 7.3 Smoke: `bun scripts/bench-tokens.ts --runs 1 --out /tmp/opening.json` and `/pack` on a pi-chart turn past Turn 0's eviction. Verify: the pi-chart arm answers the codeword at turn 12, the report prints separate codeword and build-number lines, and `/pack` shows an `opening` line with Turn 0.
- [x] 7.4 Code-review fixes: when the Ceiling takes Turn 0 from the tail, re-select the Opening into the room the tail left (`reopenAfterCeiling`; red then green in `assembler.test.ts` "when it takes Turn 0 from the tail"); decide what the Opening withholds once (`openingWithheld`, `absence()` for Budget and carried); share the elision shrink loop (`shrinkingRooms`); export `OPENING_HEADER` for tests; use glossary vocabulary in `/pack` wording, tests, README, ADR-0014 and the delta specs. Verify: typecheck, full `bun test`, `openspec validate packs-carry-the-opening --strict`.
