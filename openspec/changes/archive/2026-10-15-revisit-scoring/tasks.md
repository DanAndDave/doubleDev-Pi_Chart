## 1. Revisit declaration and validation

- [x] 1.1 Red: in `test/workload.test.ts`, using temp Workload folders as the existing tests do, add:
  - a Workload without `revisits` loads with `revisits: []`;
  - a Workload with a Revisit `{ id: "offset", file: "notes/scale.md", earlier: "add-scale", step: "add-shift" }` loads with it intact. In it, `add-scale` comes first and names `notes/scale.md`, `overlay/notes/scale.md` exists, and `checks/add-shift.check.ts` exists;
  - one malformed Workload whose single Error names a Revisit for each of these: a missing id, a missing file, a missing earlier step and a missing step; two Revisits sharing an id; a Revisit naming an unknown step; one whose earlier step comes after its step; one whose earlier step is its step; one whose step has no check; one whose file is missing from `overlay/`; and one whose earlier step never names its file.

  Verify: `bun test test/workload.test.ts` fails on the new cases only.
- [x] 1.2 Green: the `Revisit` type, `Workload.revisits` and `revisitProblems`, run in `loadWorkload` after checks are attached (design decisions 1 and 2). Verify: `bun test test/workload.test.ts` passes; `bun run typecheck` is clean.

## 2. Edits recorded per Turn

- [x] 2.1 Red, then green: `editedFiles(workspace, overlay, files)` in `scripts/workload.ts` returns the files whose workspace copy differs from `overlay/` or is missing (design decision 3). In `test/workload.test.ts`, on temp folders, an unchanged file gives none, and a changed file and a deleted file are both returned. Verify: `bun test test/workload.test.ts` fails, then passes.
- [x] 2.2 `scripts/bench-tokens.ts` `runOne` writes `revisits` into `run.json` from the Workload. After each Turn completes and before its check, it calls `editedFiles` for the Revisit files not yet recorded and sets `record.edited[file] = turn` on the first mismatch. `RunRecord` gains the optional `revisits` and `edited`. Verify: `bun run typecheck` is clean; the real record is checked in 6.2.

## 3. Fixtures

- [x] 3.1 Build `test/fixtures/runs/pi-chart-revisits/`, shaped like `pi-chart-plants`, with `sessionId: "s-own"`, 11 Turns (0–10), one step per Turn, and Accounting on every Call except Turn 10's.
  - **Earlier reads**, as `read` calls whose `path` is the file:
    - Turn 0 reads `notes/spec.md`;
    - Turn 1 reads `notes/scale.md` and `notes/edit.md`;
    - Turn 2 reads `notes/table.md`;
    - Turn 3 reads `notes/grid.md`.
  - **Revisits** (`id`: file, earlier step, step at Turn):
    - `table`: `notes/table.md`, Turn 2's step, Turn 4. The tail is `[1, 2, 3]`, and the step reads `notes/table.md` again.
    - `edit`: `notes/edit.md`, Turn 1's step, Turn 5. `edited` is `{ "notes/edit.md": 2 }`.
    - `scale`: `notes/scale.md`, Turn 1's step, Turn 6. The tail is `[4, 5]`, and the step reads `notes/scale.md` with an offset and limit. Its result text differs from Turn 1's.
    - `grid`: `notes/grid.md`, Turn 3's step, Turn 7. The tail is `[5, 6]`. The step makes a `read` of `notes/grid.md` that returns `isError`, then a `grep` with only a `pattern`, whose result holds a line of the file.
    - `never`: `notes/never.md`, Turn 0's step, Turn 8. Nothing reads it.
    - `spec`: `notes/spec.md`, Turn 0's step, Turn 9. The tail is `[6, 7, 8]`. A `recall_earlier_turns` result has `turnIndices: [0]`.
    - `table2`: `notes/table.md`, Turn 2's step, Turn 10. Turn 10 has no Accounting, and the step reads `notes/table.md`.
  - **Checks**: `table`, `edit`, `scale`, `spec` and `table2` pass. `grid` and `never` fail.

  Verify: a throwaway `readBranch` check gives 11 Turns, and every tool result's `toolCallId` matches a tool call in its Turn.
- [x] 3.2 Build `test/fixtures/runs/vanilla-revisits/`, shaped like `vanilla-plants`, with 9 Turns (0–8), one step per Turn, and one compaction before Turn 7 that keeps from Turn 5 message 0.
  - **Earlier reads**: Turn 1 reads `notes/a.md`, and Turn 2 reads `notes/b.md`.
  - **Revisits**:
    - `a`: `notes/a.md`, Turn 1's step, Turn 3. The step reads `notes/a.md` again.
    - `b`: `notes/b.md`, Turn 2's step, Turn 7. The step makes no tool call.
    - `a2`: `notes/a.md`, Turn 1's step, Turn 8. The step reads `notes/a.md` again.
  - **Checks**: all pass.

  Verify: a throwaway `readBranch` check gives the compaction with its `firstKept` at Turn 5.
- [x] 3.3 Add the Revisit `{ id: "late", file: "notes/x.md", earlier: "one", step: "two" }` to `test/fixtures/runs/failed-early/run.json`. Its step's Turn 1 failed. Verify: the existing `failed-early` assertions still pass.

## 4. Revisit scores

- [x] 4.1 Red: `test/measures.test.ts` asserts `revisits` (`RevisitScore[]`, design decision 4) in declaration order.
  - On `pi-chart-revisits`:
    - `table`: held, read 2, distance 2, fetched 4, tail, Pass.
    - `edit`: edited, read 1, distance 4, Pass.
    - `scale`: left, read 1, distance 5, fetched 6, evicted, Pass.
    - `grid`: unfetched, read 3, distance 4, evicted, Fail, no `fetched`.
    - `never`: unread, position unread, no distance, Fail.
    - `spec`: unfetched, read 0, distance 9, evicted, `pull: "recall_earlier_turns"`, Pass.
    - `table2`: unknown, read 4 (the most recent read), distance 6, fetched 10, position unknown, Pass.
  - On `vanilla-revisits`:
    - `a`: held, distance 2, tail.
    - `b`: unfetched, distance 5, summary.
    - `a2`: left, read 3, distance 5, fetched 8, summary.
  - `failed-early` and `complete` have `revisits: []`.

  Verify: the new assertions fail.
- [x] 4.2 Green: in `scripts/measures.ts`, add `revisitsOf` and the shared `firstWindow` and `recalledTurns` (design decision 4), and set `RunMeasures.revisits`. `scoresOf` and `recallOf` move onto the shared helpers. Verify: `bun test test/measures.test.ts` passes, with the existing Plant and recall assertions unchanged; `bun run typecheck` is clean.

## 5. Aggregate and report

- [x] 5.1 Red, then green: `aggregate()` gives `revisits` with `each`, `byClass` and `byPosition` (design decision 5). In `test/measures.test.ts`, on constructed Runs:
  - three complete pi-chart Runs score one Revisit left and Pass, unfetched and Pass, and unfetched and Fail. This gives `byClass.left` 1/1, `byClass.unfetched` 1/2, and `each` with left 1 and unfetched 2;
  - an incomplete Run's score is excluded;
  - a score whose outcome is not graded counts in `each` and not in `of`;
  - a complete Run whose measures lack `revisits` leaves `revisits` absent.

  Verify: `bun test test/measures.test.ts` fails, then passes.
- [x] 5.2 CLI: `bun scripts/measures.ts <run-dir>` prints one `revisitLine` per score after the Plant lines (design decision 5). Verify: on `pi-chart-revisits` it prints `scale (notes/scale.md, step …): left, fetched at Turn 7, read at Turn 2, 5 Turns back, evicted, Pass` and `never …: unread, Fail`.
- [x] 5.3 `scripts/bench-tokens.ts` `report()` gains the Revisit scores, Revisit Passes by class and Revisit Passes by position tables, and the Lapse note. The `breakdown` helper moves out of the Probe branch. Verify with a throwaway `bench.json`, deleted afterwards, built from `pi-chart-revisits` and `vanilla-revisits`. `bun scripts/bench-tokens.ts --report <dir>` should print plain omp's `b` in summary and pi-chart's `spec` as unfetched. With `revisits` stripped from one Arm's measures, its cells should print "—".
- [x] 5.4 `README.md`: the Measures paragraph describes Revisits: declared per Graded Task, edits excluded, scored held, left or unfetched against the step's check, and left Revisits as recovered Lapses counted apart. The Workload sentence names Revisits. Verify: the paragraph reads true against the 5.2 output.

## 6. `smoke` v2 and acceptance

- [x] 6.1 `bench/workloads/smoke` becomes version 2, as in design decision 6:
  - it gains `overlay/notes/scale.md`, the `add-scale` and `add-shift` steps and their checks, and the `offset` Revisit;
  - `add-double.check.ts` is removed.

  Verify: a throwaway `loadWorkload` prints the Revisit and both graded steps.
- [x] 6.2 `bun test` and `bun run typecheck` pass. `bun scripts/bench-tokens.ts --workload smoke --runs 1` completes on both Arms:
  - each `run.json` holds the `offset` Revisit and no `edited`;
  - `bun scripts/measures.ts` on each Run prints an `offset` line with read at Turn 1, distance 3 and position tail, and the class and outcome the Run produced;
  - the report prints the Revisit tables;
  - the codeword Probe still scores.
