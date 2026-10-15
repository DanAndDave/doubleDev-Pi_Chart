## 1. Turn identities in cross-conversation details

- [x] 1.1 Red: in `test/extension.test.ts`, extend the existing `recall_across_conversations` details test so that a fake search returns Turn 3 of `conversation-a` and then Turn 7 of `conversation-b`. Expect `details.turns` to equal `[{ conversationId: "conversation-a", turnIndex: 3 }, { conversationId: "conversation-b", turnIndex: 7 }]`, alongside `results` and `conversations`. Verify: `bun test test/extension.test.ts` fails on the missing `turns`.
- [x] 1.2 Green: `searchCorpus` in `src/extension.ts` adds `turns` in result order (design decision 1). Verify: `bun test test/extension.test.ts` passes.

## 2. Fixture

- [x] 2.1 Build `test/fixtures/runs/pi-chart-pulls/`: `run.json` with `arm: "pi-chart"`, `sessionId: "s-own"` and 10 Turns; a Journal shaped like `pi-chart-evicted`'s; and `accounting.json` keyed `s-own`. Its Pulls, each answering an assistant tool call with the same id:
  - Turn 9, a Call whose tail is `[7, 8]`: `recall_earlier_turns` with `turnIndices: [2, 5]` (recall, distance 4); `recall_across_conversations` with turns `s-own` 8, `s-own` 3, `other` 4 (recall, distance 6).
  - Turn 8, a Call whose tail is `[6, 7]`: `recall_across_conversations` with only `other` 1 (no class); `recall_across_conversations` with only `s-own` 7 (no class: carried).
  - Turn 7, a Call with no Accounting: `recall_across_conversations` with `s-own` 1 (unknown, distance 6); `recall_earlier_turns` with `turnIndices: [0]` (recall, distance 7).
  - Turn 6: `recall_across_conversations` with `{ results: 1, conversations: ["s-own"] }` and no `turns` (unknown, no distance).
  - Turn 5: `search_documentation` twice, `walk_documentation`, `codebase_structure` and `write_documentation` once each.
  - Turn 4: `recall_earlier_turns` with `isError: true` and `details: { failed: true }` (a call, no class).

  Verify: a throwaway `readBranch` check gives 10 Turns, and every Pull result's `toolCallId` matches a tool call in its Turn.

## 3. Pulls and recall Pulls

- [x] 3.1 Red: `test/measures.test.ts` asserts on `pi-chart-pulls`:
  - `pulls`: `recall_earlier_turns` 3 calls, `recall_across_conversations` 5, `search_documentation` 2, `walk_documentation` 1, `codebase_structure` 1. Each tool's `tokens` is the sum of `approximateTokens([result])` over its results, and `search_documentation`'s is the sum of its two.
  - `writes` is 1.
  - `recalls` lists, in order, the 5 classified Pulls above, with Turn, Call, tool, distance and class.
  - `recall` is `{ recall: { total: 3, bands: [1, 2, 0, 0, 0] }, unknown: { total: 2, bands: [0, 1, 0, 0, 0] } }`. The unknown total exceeds its bands by the Pull with no distance.

  It also asserts that `pi-chart-evicted` has every tool at zero calls and zero recall Pulls, present rather than absent, and that `vanilla-compacted` has no `pulls`, `writes`, `recalls` or `recall`. Verify: the tests fail.
- [x] 3.2 Green: `PULL_TOOLS`, Pull counting and recall classification in `scripts/measures.ts` (design decisions 2 and 3), reusing `callerOf`, `windowAt` and the band counting. Verify: `bun test test/measures.test.ts` passes; `bun run typecheck` is clean.

## 4. Report

- [x] 4.1 CLI: `bun scripts/measures.ts <run-dir>` prints the Pull, `write_documentation` and recall lines on pi-chart, and `Pulls: n/a` on plain omp (design decision 5). Verify: on `test/fixtures/runs/pi-chart-pulls` it prints recall Pulls 3 and unknown 2; on `vanilla-compacted` it prints `Pulls: n/a`.
- [x] 4.2 `scripts/bench-tokens.ts` `report()` (design decisions 4 and 5) gains:
  - the Pulls per Run table;
  - the recall and recall-unknown band columns;
  - the routes line.

  Verify with a throwaway `bench.json`, deleted afterwards, built from `pi-chart-pulls` and `vanilla-compacted`. `bun scripts/bench-tokens.ts --report <dir>` should print plain-omp Pull cells as "n/a" with no ratio, the recall columns, and the routes line. Run it again with `pulls` removed from the pi-chart Run: its cells should print "—".
- [x] 4.3 `README.md`: the Measures paragraph names Pulls per tool, `write_documentation` calls and recall Pulls as pi-chart-only figures. Verify: the paragraph reads true against the 4.1 output.

## 5. Acceptance

- [x] 5.1 `bun test` and `bun run typecheck` pass. `bun scripts/measures.ts /tmp/bench-ro40/runs/pi-chart-0` prints zero calls for every Pull tool, zero recall Pulls, and Re-fetch figures unchanged (3 Lapses in 8–12). `…/vanilla-0` prints `Pulls: n/a`.
