## Context

See `proposal.md` for why. Code state this design starts from:

- `scripts/utilisation.ts` `utilisationOf(turns, calls, compactions, pins, cwd, rule)` already takes the rule as a parameter. Inside, `usedBy` returns each Call's Used units as a `Set` of identities (`identity(unit, window)`: `call <turn> <callId>`, `prose <turn>`, `summary <compaction>`), and the tally loop sums them. Nothing outside sees per-unit verdicts. `DEFAULT_RULE` is used only as that default, and `measureRun` is the only caller that omits `rule`.
- `scripts/measures.ts` `measureRun(dir)` builds the main Calls, their windows, compactions, Pins and cwd from a Run folder, then calls `utilisationOf`. `gate.ts --report` re-measures from Run folders. `bench-tokens.ts --report` prints the Measures stored in `bench.json` at Run time.
- `bench/ablation/calibration.json` holds one set: `gate` v1, `anthropic/claude-opus-5-5`, `omp/18.11.0`, made 2026-10-17. Its 100 units and 20 nulls carry `arm`, `run` (index), `call`, `turn`, `unit`, `content`, `original` and `verdict`. `call` indexes the Run's main Calls, which are the same list `measureRun` builds (`ablate.ts` `planning` asserts the counts agree).
- The set's 10 source Runs exist only in `/tmp`: `/tmp/calib-vanilla/runs/vanilla-{0..4}` and `/tmp/gate-aa-real/runs/{base-0,candidate-0,base-2,base-3,base-4}`. `base-0` and `candidate-0` are both pi-chart index 0 calibration records, and both drew Calls 126 and 136. So (arm, index, call) does not find a unit's Run.
- The set's comparable units, meaning tail and summary units judged Needed or not Needed: pi-chart 45 (2 Needed), vanilla 49 (2 Needed). Unclear: 1 per Arm. Duplicated: 5, all not Needed.
- `ablation.ts` imports `measures.ts` at runtime (`answerOf`). `measures.ts` therefore cannot import `ablation.ts` at runtime.
- Ablation draws a uniform eligible Call, then one unit in proportion to its tokens, over all kinds (`ablation` spec, "Calls and units are sampled"). The `duplicated` flag comes from locating the unit in the live request body, so it can't be recomputed offline.

## Goals / Non-Goals

**Goals:**
- Used verdicts for calibration units that equal what `measureRun` would judge on the same Call at the same cell, with the same code path.
- One place that maps a key to the rule and label every report uses.
- A PPI estimate whose prediction term and correction describe the same population.

**Non-Goals:**
- A larger or stratified calibration set. With 4 Needed units the first κ is noisy; buying more is a separate, paid decision.
- An interval on κ.
- Recording the system prompt. The third caveat stays.
- Re-measuring old `bench.json` files in `bench-tokens --report`.
- A PPI line in `measures.ts` or the benchmark report, which have no Needed share to sit beside.

## Decisions

### 1. Per-unit verdicts come out of `utilisation.ts`

`utilisationOf` splits in two:
- `judgeRun(turns, calls, compactions, pins, cwd, rule)` returns, per Call, `{ window, units: { id, unit }[], used: Set<string>, unitTokens } | "empty" | "unknown"`. `unitTokens` is the tokens of all the Call's units, Opening and Pins included, which the PPI weighting needs (§6).
- `utilisationOf` tallies `judgeRun`'s result as it does today, and `CallUtilisation` gains `unitTokens`.

`identity` is exported as `unitIdentity`. Calibration looks a unit up in its Call's `units` by `unitIdentity(unit, window)`. The window comes from the Run, so a summary unit's identity (its compaction id) resolves too. A comparable unit missing from its Call's judged units is an error, never a silent skip: it means the Run folder or the code disagrees with the set.

`measures.ts` gains `mainCalls(dir)`, which returns turns, main Calls with address and window, compactions, pins and the record, and `measureRun` uses it. Calibration reads a Run through `mainCalls`, so it can never take a different path from the Measures.

*Alternative considered:* recomputing Used from the set's frozen `content` and `original`. Rejected: the rarity table, the current-Turn exclusions, the cwd and the next action's argument text all live in the Run, and `original` holds only tool and target.

### 2. The set keeps its Runs

Layout: `bench/ablation/runs/<slug>/<folder>/`, each a full copy of a Run folder (`run.json`, `journal.jsonl`, `ablation.json`, `accounting.json` when present, `subagents/` when present). The slug comes from the key: `<workload>-v<version>--<model with / as ->--<omp with / as ->`.

`CalibrationSet` gains `runs` (the repo-relative directory), and `CalibrationUnit` gains `folder`, for nulls too. `ablate.ts --calibrate` takes `folder` from each Run's basename. It refuses at start, before any send, when two given Runs share a basename. Only after `addSet` accepts the set does it copy the folders, judge the grid (§4) and write the file. A refused set copies nothing.

`calibrationSet(key, runs, date)` takes `{ record, turns, folder }` per Run.

### 3. `scripts/calibration.ts`, pure apart from one reader

It holds the grid and everything that reads a set to choose or apply a rule:
- `GRID`: *s* ∈ {6, 8, 12} × *k* ∈ {1, 2, 3}, in that order. A cell's id is `s<s>k<k>`.
- `comparable(units)`: units of kind tool-call, pull, prose or summary, with verdict `needed` or `not-needed`. Duplicated units are kept, so the population matches §6.
- `agreement(pairs)`: Cohen's κ, precision and recall, with the four counts. κ is NaN when expected agreement is 1, and precision or recall is NaN when its denominator is 0.
- `chooseCell(units)`: pooled κ per cell, then the highest, with ties to the earlier cell in `GRID` and NaN never beating a number. It returns every cell's pooled and per-Arm figures for printing.
- `ruleFor(set)`: the set's cell and κ when κ ≥ 0.4, else `DEFAULT_RULE` with no κ.
- `ppi(calls, residuals)`, as in §6.
- `setFor` and `keyLabel` move here from `ablation.ts`, and `CalibrationKey` moves with them. `ablation.ts` imports them, so `measures.ts` can reach a set without importing `ablation.ts`.
- `CALIBRATION_FILE` and `readCalibration()`: one reader for the four scripts.

Its imports from `ablation.ts` are type-only.

### 4. Judging the grid: `measures.ts --calibrate`

`bun scripts/measures.ts --calibrate` walks every set in `calibration.json` that has `runs`:
1. For each Run folder, it loads `mainCalls` once, then calls `judgeRun` once per cell. The *s*-gram index depends on *s*, so the Run's index is rebuilt per cell.
2. It sets each comparable unit's `used` to `{ s6k1: boolean, … }`, chooses the cell, and stores `rule: { s, k, kappa }` on the set.
3. It prints, per set, the 9 cells' pooled κ and per-Arm κ, precision, recall and counts, the chosen cell, and the previous cell if it changed.
4. It writes the file.

The same function ends `ablate.ts --calibrate`. Running it again replaces the stored cell: that is how a rule change is calibrated, and git keeps the old cell. Decision 19 placed Utilisation in the Measures script, and this keeps calibration there too.

### 5. Reports read the rule from the key

`measureRun(dir, calibration?: CalibrationFile)` builds the key from `run.json` and judges at `ruleFor(setFor(file, key))`. A record with no `model` gets the default. `RunUtilisation` gains `rule` and, when calibrated, `kappa`.

The callers that pass `readCalibration()` are the `measures.ts` CLI, `gate.ts` `measureSides`, `bench-tokens.ts` at Run end, and the Ablation report.

`utilisationLabel(runs)` in `utilisation.ts` returns `κ 0.52, s 6, k 1` when every Run carries the same `rule` and `kappa`. Otherwise it returns `uncalibrated`, which covers a missing `rule` (an old `bench.json`). It replaces the literal `(uncalibrated)` at `measures.ts`, `gate.ts` and `bench-tokens.ts`. `CAVEATS[0]` becomes "Utilisation is lexical: Used is not Needed.", because the label now carries the calibration.

*Alternative considered:* using the chosen cell even below κ 0.4. Rejected: a cell chosen on noise would move every reported figure (today 12% on `vanilla-0`, Gate 4% / 3%) for no evidence. The defaults keep the figures comparable until a calibration earns the change.

### 6. PPI: one population on both sides

Ablation's Needed share estimates P(Needed) for a unit drawn as a uniform Call, then a token-proportional unit. Restricted to tail and summary draws, the calibration units are a sample of that draw conditioned on kind. The prediction term must average Used over the same conditioned draw.

For Call *c* in the reported Runs (main, known window, `unitTokens` > 0), let *T* be the tokens of all its units, *A* its judged tokens and *U* its Used tokens:
- prediction term θ̂_f = Σ(*U*/*T*) / Σ(*A*/*T*), a ratio over Calls;
- correction r̄ = mean of (Used − Needed) over the Arm's comparable units, at the chosen cell's `used`;
- θ̂ = θ̂_f − r̄;
- variance: Var(*U*/*T* − θ̂_f · *A*/*T*) / (*N* · mean(*A*/*T*)²), the delta-method ratio variance over *N* Calls, plus sampleVariance(r) / *n*;
- interval θ̂ ± 1.96 · √variance, and the point and both bounds clamped to [0, 1].

Duplicated units stay in both terms, because the prediction side can't drop them (Context). So PPI is compared with Ablation's own tail-and-summary share, duplicated included, which the Ablation report prints beside it. Faithful-band eligibility can't be known offline, so every main Call with units stands in for the eligible ones.

The correction is per Arm. Gate sides are both pi-chart, so both use the pi-chart units.

### 7. Where PPI prints

- **`ablate.ts --report`:** per Arm, after the Needed line: `tail and summary: k/n x% [lo, hi]; PPI y% [lo, hi]`. It reads the given Runs through `measureRun` with the calibration. When the key is uncalibrated it prints `PPI: uncalibrated (<keyLabel>)` instead. When the Runs hold more than one key it prints `PPI: Runs of more than one key`.
- **`gate.ts` report:** a row `Needed share (PPI)` under `Needed share`, per side over complete Runs, filled whether or not `--ablate` ran. It reads "uncalibrated" when the Gate key's set has κ < 0.4 or no set exists.

### 8. Migrating the existing set

1. Copy the 10 `/tmp` Run folders into `bench/ablation/runs/gate-v1--anthropic-claude-opus-5-5--omp-18.11.0/`, keeping their basenames.
2. Scan the copies for credentials (`sk-`, `Bearer `, `api_key`, `ANTHROPIC`, `.env` contents) before committing.
3. A throwaway script sets `folder` on each of the 120 units and nulls. It picks the folder whose `ablation.json` has a judged draw with the same condition, arm, index, call and unit (kind, turn, callId, text), and whose Journal renders `unitContent` equal to the stored `content`. Exactly one folder must match. The script is deleted afterwards.
4. Set `runs`, run `measures.ts --calibrate`, and commit the folders, the file and the code together.

## Testing seams

| Requirement | Seam | Test |
| --- | --- | --- |
| The Used rule is calibrated against Needed per key | `agreement`, `chooseCell`, `comparable`, `ruleFor` in `test/calibration.test.ts` on built units | 8/2/2/88 gives κ 0.78, precision and recall 80%. An unclear unit and Opening, Pin and null units are not compared; a duplicated one is. A tie goes to the earlier `GRID` cell. A NaN cell never beats a number. κ 0.31 gives `DEFAULT_RULE`; κ 0.52 gives its cell. |
| (same) | `measures.ts`'s calibrate function on `test/fixtures/runs/` with a set built in the test | A fixture unit, including a summary unit of `vanilla-compacted`, gets the `used` that `judgeRun` gives on its Call. Two folders holding the same arm and index resolve by `folder`. A unit missing from its Call throws. A second run stores the same verdicts and cell. |
| The PPI Needed share | `ppi` in `test/calibration.test.ts` | The 2,000/1,000 example gives 16.7%. A 30% term minus 0.10 gives 20%. Bounds clamp to [0, 1]. Below κ 0.4, or with fewer than 2 residuals, there is no figure. |
| Utilisation is reported raw and labelled by its calibration | `measureRun(dir, file)` in `test/measures.test.ts`; `utilisationLabel` | A fixture Run under a calibrated key records its cell and κ, and under a weak one records the defaults with no κ. Mixed Runs or a missing `rule` give `uncalibrated`. |
| A calibration set is frozen per key | `calibrationSet` and `addSet` in `test/ablation.test.ts` | Units carry their Run's `folder`. A refused set leaves the file unchanged. |
| Needed share is reported with its interval; Every Gate leaves a record and a report | smoke | `bun scripts/measures.ts --calibrate` on the committed set prints the grid. `bun scripts/measures.ts` on a committed Run prints its label. `bun scripts/ablate.ts --report` on the committed pi-chart Runs and `bun scripts/gate.ts --report /tmp/ablate-gate2` print the PPI row or "uncalibrated". |

## Risks / Trade-offs

- **[4 Needed units in 94 comparable]** κ swings by tenths on a single unit, and the first calibration will probably read below 0.4. → Counts are printed beside every κ. Below 0.4 the defaults stay, so a noise-chosen cell moves no figure.
- **[PPI assumes the calibration Runs and the reported Runs come from one population]** Gate sides run newer commits than the set's Runs. → This is the accepted cost of freezing per Workload version (decision 19). A κ floor gates the row.
- **[Eligible Calls approximated]** Offline, unfaithful Calls can't be told apart. → It affects only the prediction term, which is computed over every Call rather than sampled.
- **[Journals committed to the repo]** They hold Workload source and model output. → A credential scan before the commit (§8).
- **[Repository grows]** About 11.5 MB of files, roughly 1.5–2.5 MB packed. → One set per key, and new sets are rare and paid.
- **[A rule change silently changes a stored cell]** → `--calibrate` prints the old and new cell, and git keeps the history.

## Migration Plan

§8 converts the existing set. Rollback: revert the commit; `calibration.json` without `runs`, `folder` or `rule` reads as uncalibrated everywhere. An old `bench.json` reads as uncalibrated at the defaults, as it was measured.
