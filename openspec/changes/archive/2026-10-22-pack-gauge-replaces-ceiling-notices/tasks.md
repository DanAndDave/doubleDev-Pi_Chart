## 1. One view of the live pack

- [x] 1.1 Export `tokenFigure` from `src/elision.ts` and add `viewPack(pack, warnShare)` to `src/inspection.ts`, building each part as `viewPart(recordPart(part))` and computing `mark` in the precedence over → reduced → near → none (none whenever `ceiling <= 0`, near strictly past the share, as the log line is). Write `test/report.test.ts` cases first: one per mark, a reduced pack still over the ceiling reads `over`, and a zero ceiling reads none. Verify red, then green.
- [x] 1.2 Factor `renderCall`'s pinned-part skip into one predicate in `src/report.ts` and verify the existing `renderCall` tests still pass unchanged.

## 2. Renderers

- [x] 2.1 Write `renderGauge` tests in `test/report.test.ts` for the design's six footer forms, plus `undefined` (cleared), and bar fill at 0%, at 41% and over 100% (full, never longer than 8 cells). Implement `renderGauge` and verify green.
- [x] 2.2 Write `renderPackWidget` tests: a header with the same mark as the gauge, one line per listed part in `pack.parts` order, `system prompt` on `pinned` and `opening`, and a ceiling-reduced tail whose reason text equals what `renderCall` prints for the same part. Cover the `"unassembled"` and `undefined` lines, an over-ceiling pack whose bars stay within 20 cells, and a widget of at most 5 lines. Implement it, reusing `carriedOf` / `reasonsOf` / `absenceOf` and the 1.2 predicate, and verify green.

## 3. Extension wiring

- [x] 3.1 Declare `setWidget` on `HarnessUI` in `src/harness.ts` (string-array form, optional `placement`). Give the fake UI in `test/extension.test.ts` a `widgets: { key, lines }[]` log. Verify with `bun run typecheck`.
- [x] 3.2 Write `test/extension.test.ts` cases for the gauge: after an assembled Call the `pi-chart.pack` status shows the figures; a following Call updates it; a throwing `assemble` replaces it with `pack: not assembled`; `session_switch` clears it; a UI whose `setStatus` throws still returns the Pack. Add `lastPack`, a guarded `showPack(target)`, and the calls in `session_start`, `context` (both paths), `session_switch` and `session_branch`. Verify green.
- [x] 3.3 Rework `describe("a pack approaching its ceiling")`: crossing the share leaves one `reported` line, no `notified` ceiling line, and a `near ceiling` gauge on each crossing Call; two overrunning Calls leave two `reported` lines, no `notified` line, and an `over ceiling` gauge; the throwing reporter gains an overrunning Call whose Pack is returned unchanged. Verify red, switch `warnIfNearCeiling` from `announce` to `reportSafely`, and verify green.
- [x] 3.4 Write tests for `/pack show` and `/pack hide` through `commands.pack.handler`: no widget before `show`; `show` before any Call writes the no-call line; `show` then a Call writes that Call's lines under `belowEditor`; `hide` writes `undefined` and later Calls write no widget; a UI without `setWidget` gets the cannot-show answer naming `/pack`; `show` works with no Thread Store. Implement the verbs ahead of the Accounting read, pass `commandCtx.ui` into `inspect`, and add both verbs to the `/pack` description. Verify green.

## 4. Close

- [x] 4.1 Update `README.md` "Inspect a pack": the footer gauge with its marks, `/pack show` / `/pack hide`, and that ceiling conditions are logged rather than posted. Verify the README example lines match what 2.1 and 2.2 assert.
- [x] 4.2 Run `bun run typecheck` and the full `bun test` once, and verify both are green.
- [x] 4.3 Smoke in the real harness: start `omp` with this extension and `PICHART_PACK_TOKENS=2000`, send a prompt that makes several tool calls, and verify the footer shows `· over ceiling`, no ceiling warning appears in the transcript, the log holds an overrun line per Call, `/pack show` opens the widget below the editor and it refreshes on the next Call, and `/pack hide` closes it.
