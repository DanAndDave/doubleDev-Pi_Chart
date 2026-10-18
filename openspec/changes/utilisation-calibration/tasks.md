## 1. Per-unit verdicts and the shared loader

- [x] 1.1 Split `utilisationOf` into `judgeRun` and the tally (design §1): `judgeRun` returns per Call `{ window, units, used, unitTokens } | "empty" | "unknown"`, `identity` is exported as `unitIdentity`, and `CallUtilisation` gains `unitTokens`. Verify: `bun test test/utilisation.test.ts` passes unchanged, and one new test checks that a Call's tally equals the tokens of its `used` units and that `unitTokens` counts Opening and Pin units too.
- [x] 1.2 Extract `mainCalls(dir)` from `measureRun` in `scripts/measures.ts`, and have `measureRun` use it. Verify: `bun test test/measures.test.ts` passes unchanged.

## 2. Calibration core (tdd at `test/calibration.test.ts`, design §3, §6)

- [x] 2.1 Create `scripts/calibration.ts` holding `GRID`, cell ids, `CALIBRATION_FILE` and `readCalibration`. Move `setFor`, `keyLabel` and `CalibrationKey` there from `scripts/ablation.ts`, after `xd://lsp` references, repointing every importer with no re-export. Verify: `bun run typecheck` is clean, and `bun test test/ablation.test.ts` passes.
- [x] 2.2 Red, then green, on `agreement`: 8/2/2/88 gives κ 0.78 with precision and recall 80%; κ is NaN when expected agreement is 1; precision is NaN with nothing Used. Verify: those tests pass.
- [x] 2.3 Red, then green, on `comparable` and `chooseCell`: unclear, Opening, Pin and null units are not compared, and a duplicated unit is; a tie goes to the earlier `GRID` cell; a NaN cell never beats a number; per-Arm figures come out beside the pooled ones. Verify: those tests pass.
- [x] 2.4 Red, then green, on `ruleFor`: no set, a set without `rule`, or κ 0.31 gives `DEFAULT_RULE` with no κ; κ 0.52 gives its cell and κ. Verify: those tests pass.
- [x] 2.5 Red, then green, on `ppi`: the 2,000/1,000 example's prediction term is 16.7%; a 30% term minus a 0.10 correction gives 20%; point and bounds clamp to [0, 1]; fewer than 2 residuals gives no figure. Verify: those tests pass.

## 3. The set keeps its Runs and verdicts (design §2, §4)

- [x] 3.1 Add `runs` to `CalibrationSet`, and `folder`, plus the optional `used` map, to `CalibrationUnit`. Add `rule?: { s, k, kappa }` to the set. Change `calibrationSet` to take `folder` per Run. Verify: an `test/ablation.test.ts` case shows each unit carrying its Run's `folder`, and the existing `addSet` refusals still pass.
- [x] 3.2 Write the calibrate function in `scripts/measures.ts` and its `--calibrate` CLI. Red first, on `test/fixtures/runs/` with a set built in the test:
  - a tool-call unit and a `vanilla-compacted` summary unit get the `used` that `judgeRun` gives on their Call;
  - two folders holding the same arm and index resolve by `folder`;
  - a comparable unit missing from its Call throws;
  - a second run stores the same verdicts and cell.
  Verify: those tests pass.
- [x] 3.3 In `ablate.ts --calibrate`, refuse at start when two given Runs share a basename. Once `addSet` accepts the set, copy the Run folders to `bench/ablation/runs/<slug>/`, run the calibrate function, then write the file. Verify: `bun run typecheck` is clean, and the duplicate-basename refusal is shown on a throwaway call with two copies of one fixture folder, with no send.

## 4. Reports (design §5, §7)

- [x] 4.1 Have `measureRun(dir, calibration?)` judge at `ruleFor(setFor(file, key))`, and record `rule` and, when calibrated, `kappa` on `RunUtilisation`. Add `utilisationLabel` and reword `CAVEATS[0]`. Red first in `test/measures.test.ts`: a fixture Run under a calibrated key, under a weak key, and with no model; `utilisationLabel` on mixed Runs and on a `RunUtilisation` with no `rule`. Verify: those tests pass.
- [x] 4.2 Pass `readCalibration()` from the `measures.ts` CLI, `gate.ts` `measureSides` and `runs.ts` `runOne` (which `bench-tokens.ts` runs). Replace the literal "uncalibrated" labels at `measures.ts`, `gate.ts` and `bench-tokens.ts` with `utilisationLabel`. Verify: `bun test test/gate.test.ts test/measures.test.ts` passes, and `bun scripts/bench-tokens.ts --report /tmp/calib-vanilla` still labels its old `bench.json` "uncalibrated".
- [x] 4.3 Add the per-Arm tail-and-summary Needed share and PPI line to `ablate.ts --report`, with the "uncalibrated" and "more than one key" lines. Verify: a `test/ablation.test.ts` case on fabricated draws gives the tail-and-summary share with duplicated units in and unclear units out.
- [x] 4.4 Add the `Needed share (PPI)` row to the `gate.ts` report, filled with or without `--ablate`. Verify: `bun test test/gate.test.ts` passes, and `bun scripts/gate.ts --report /tmp/ablate-gate2` prints the row.

## 5. Migrate the existing set (design §8)

- [x] 5.1 Copy the 10 `/tmp` Run folders into `bench/ablation/runs/gate-v1--anthropic-claude-opus-5-5--omp-18.11.0/`, keeping their basenames. Run the credential scan, which must find nothing before anything is staged. Verify: 10 folders, each with `run.json`, `journal.jsonl` and `ablation.json`, and a clean scan.
- [x] 5.2 Using a throwaway script, set `folder` on every unit and null of the `gate` v1 set, with exactly one matching folder each, then set `runs`. Delete the script. Verify: all 120 entries carry a `folder`; and for `base-0` and `candidate-0` units, the content in each `folder`'s Journal equals the stored content.
- [x] 5.3 Run `bun scripts/measures.ts --calibrate`. Verify: it prints the 9-cell grid with per-Arm counts and stores `used` on the 94 comparable units, plus `rule` on the set. Record the chosen cell and κ in the commit message.

## 6. Close

- [x] 6.1 Update the Utilisation entry in `CONTEXT.md` with how its rule is calibrated and labelled. Verify: the entry names κ, the 0.4 floor and the PPI row, and still says Used is never Needed.
- [x] 6.2 Run `bun run typecheck` and the full `bun test` once. Run the smoke checks: `bun scripts/measures.ts` on a committed Run prints its label; `bun scripts/ablate.ts --report` on the committed pi-chart Runs prints the tail-and-summary share and the PPI line or "uncalibrated"; `bun scripts/gate.ts --report /tmp/ablate-gate2` prints its PPI row. Verify: typecheck is clean, every test passes, and each smoke check prints as stated.
