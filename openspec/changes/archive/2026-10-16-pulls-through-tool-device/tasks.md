## 1. Red: device-form fixtures

- [x] 1.1 In `test/fixtures/runs/pi-chart-pulls/journal.jsonl`, make the device-form rewrites and additions listed in design.md, "Testing seams":
  - device form for one successful recall-Pull `recall_earlier_turns` call, the failed `recall_earlier_turns` call and one `search_documentation` call (assistant `write` to `xd://<tool>`, result `toolName: "write"` with `details.xdev`);
  - one added device `write_documentation`;
  - one `read xd://recall_earlier_turns`;
  - one help-mode result.

  Update `accounting.json` if the fixture's Call boundaries require it. Verify: `bun test test/measures.test.ts` fails on the Pull counts and recall Pulls.
- [x] 1.2 Extend the test's `returned` helper to select device results of the tool (`details.xdev.tool` in execute mode), and change the expected `writes` to 2. Verify: the Pull tests still fail, on counts rather than on the helper.
- [x] 1.3 Rewrite the Plant-sourcing recall in `pi-chart-plants` and the Revisit-recovering recall in `pi-chart-revisits` into device form. Verify: the Plant score with `pull: "recall_earlier_turns"` and the Revisit score with `pull: "recall_earlier_turns"` both fail.

## 2. Green: one resolver

- [x] 2.1 Add `invokedTool(message)` to `scripts/measures.ts`. It returns `{ name, details }` from `details.xdev` when `mode === "execute"` and `tool` is a non-empty string, and from `toolName` / `details` otherwise. Use it at the Plant source, Revisit pull, `write_documentation` count, Pull count and Re-fetch `tool` sites. Change `recallOf` and `recalledTurns` to take the resolved details rather than the raw message. Verify: `bun test test/measures.test.ts` passes, and the file contains no `toolName` read outside `invokedTool` (grep).
- [x] 2.2 Run `bun run typecheck` and the full `bun test`. Verify: both are clean.

## 3. Smoke and docs

- [x] 3.1 Run `bun scripts/measures.ts` over `/tmp/gate-probe-2/runs/pi-chart-0` and `/tmp/gate-probe-3/runs/pi-chart-0`. Verify: `Pulls, recall_earlier_turns` reads 6 and 8 respectively (the counts in the journals), and recall Pulls are banded. If the records are gone, record that and skip to 3.2's fallback.
- [x] 3.2 Update `bench/workloads/gate/README.md`: replace the instrument-gap paragraph and correct the Plant sources and recall figures from 3.1's output, or mark the figures as pre-fix if 3.1 could not run. Verify: no sentence says `scripts/measures.ts` misses device calls.
- [x] 3.3 Add `pulls-through-tool-device` as slice 14 in `openspec/changes/context-need-measures/slices.md` (blocked by 3), make slice 7 `regression-gate` blocked by 6 and 14, and add the edge to `regression-gate/proposal.md`'s `Blocked by:` line. Verify: `openspec validate pulls-through-tool-device` passes.
