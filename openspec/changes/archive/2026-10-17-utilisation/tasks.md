## 1. Shared units and targets

- [x] 1.1 Create `scripts/units.ts` and move into it from `scripts/ablation.ts`: `ToolCallLike`, `Target`, `targetOf`/`deviceCall` with `SELECTOR` and `EDIT_HEADER`, `Action`/`actionOf`, `UnitKind`, `Unit`, `unitsOf`/`turnUnits` and `unitContent`, which becomes exported. Move `PULL_TOOLS`/`PullTool` there from `scripts/measures.ts`, keeping the import of `Window` from `measures.ts` type-only. Run `xd://lsp` references first, then repoint every importer: `ablation.ts`, `ablate.ts`, `replay-ext.ts`, `gate.ts`, `bench-tokens.ts`, `measures.ts` and the tests, with no re-exports left behind. Verify: `bun run typecheck` is clean and `bun test test/ablation.test.ts test/measures.test.ts test/gate.test.ts` passes unchanged.

## 2. The Used rule (tdd at `utilisationOf`, design §2–§9)

- [x] 2.1 Write `test/utilisation.test.ts`, with in-code Journal builders, for the units judged: the Call's own Turn is never judged, its earlier results included; Opening and Pin units are dropped; a Pull result is judged as `pull`; a summary is judged as `summary`. Then create `scripts/utilisation.ts` with `utilisationOf`, `DEFAULT_RULE`, `RARE` and the types from design §2, until those tests pass.
- [x] 2.2 Red, then green, on the next action. A value only in thinking makes nothing Used. The first tool call is the action, ahead of the reply text and of later calls. A reply with neither a tool call nor text has an empty next action: the Call is measured, with nothing Used. A device call's parsed content is the action. Verify: those tests pass.
- [x] 2.3 Red, then green, on the path signal: an absolute action path matches a relative mention, `src/a.ts` does not match `src/a.tsx`, `.` and the cwd itself never fire, and `edit`, `grep` and `glob` paths are taken as design §6 says. Verify: those tests pass.
- [x] 2.4 Red, then green, on the copied-span signal through the *s*-gram index (design §7): an 8-token span fires, a 7-token span does not, and `{ s: 6 }` makes the 7-token span fire. Verify: those tests pass.
- [x] 2.5 Red, then green, on rare identifiers over 60 generated units:
  - two rare items fire;
  - one item excluded by the current Turn leaves one, which does not fire at *k* = 2 and fires at *k* = 1;
  - an item in 10 of 60 units does not count;
  - items in the carried Opening or a Pin do not count;
  - prose words are not items, `don't` opens no literal, and an action's raw argument meets a unit's quoted literal.

  Verify: those tests pass.
- [x] 2.6 Red, then green, on identical text in two units making both Used, and on the per-Call and per-Run sums: the 10% and 30% → 25% example; a kind with no judged tokens has no share; `empty` and `unknown` Calls are counted apart and add nothing. Verify: `bun test test/utilisation.test.ts` passes.

## 3. Measures

- [x] 3.1 Call `utilisationOf` from `measureRun` with each main Call's address and window, `compactions`, `pinTexts(entries)` and `record.cwd`. Set `Call.utilisation` and `RunMeasures.utilisation`. Add `measureRun` tests in `test/measures.test.ts`:
  - `pi-chart-evicted`: Turn-0 Calls are `empty`, Calls with no Accounting are `unknown`, subagent Calls have none, and the Run's sums equal the sums of its measured Calls;
  - `vanilla-compacted`: a post-compaction Call judges a `summary`.

  Verify: `bun test test/measures.test.ts` passes.
- [x] 3.2 Print Utilisation in the `scripts/measures.ts` CLI, as design §10 says, with the "uncalibrated" label, the Call counts and both caveats. Verify: `bun scripts/measures.ts /tmp/ablate-gate2/runs/base-0` prints them. Time the run and check it is no more than a few seconds slower than before.

## 4. Reports

- [x] 4.1 Add the "Utilisation per Run (uncalibrated)" table to the `bench-tokens.ts` report: in total and by kind, with "n/a" for a kind the Arm cannot hold, "—" for a missing figure, no ratio column, and both caveats. Verify on a smoke run:
  - `bun scripts/bench-tokens.ts --report /tmp/calib-vanilla` prints "—";
  - a throwaway copy of that folder, with its `bench.json` Measures recomputed by `measureRun`, prints figures, with "n/a" for Pull result.
- [x] 4.2 Replace the Gate's `Utilisation` row with `Utilisation (uncalibrated)`: each side's median of per-Run shares, plus one caveat line. Verify: `bun scripts/gate.ts --report /tmp/ablate-gate2` prints both sides, and `test/gate.test.ts` passes.

## 5. Docs and close

- [x] 5.1 Update `docs/benchmarks/` and the `bench-tokens`/`measures` usage comments wherever they describe the report rows or say Utilisation is not measured. Check that `CONTEXT.md`'s Utilisation and Used entries still hold. Verify: `grep -rn "not measured" scripts docs` finds no Utilisation mention.
- [x] 5.2 Run `bun run typecheck`, the full `bun test` and `openspec validate utilisation --strict`. All pass.
