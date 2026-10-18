# Proposal: Utilisation calibration

Triage: ready-for-agent
Blocked by: ablation, utilisation

## Why

The Used rule's *s* = 8, *k* = 2 are a guess until they are checked against Needed. Calibrating them against the Ablation calibration set does two things:
- it says how far Utilisation can be trusted, through κ;
- it lets the free Measure correct itself into a Needed-share estimate, through prediction-powered inference (PPI).

The first calibration set exists (`gate` v1, `anthropic/claude-opus-5-5`, `omp/18.11.0`, made 2026-10-17), but Used can't be computed for its units: the rule needs each unit's whole Run, and those 10 Runs exist only in `/tmp`.

Decisions: `context-need-measures/questions/19`, `05`.

## What Changes

- **A calibration set keeps its Runs.** The records of a set's source Runs are committed beside it, under `bench/ablation/runs/`, and each unit names its Run's folder. A unit's arm and index alone can't find its Run: the `gate` v1 set holds two pi-chart Runs with index 0. The existing set's 10 Runs move in from `/tmp`, and `ablate.ts --calibrate` copies them in when it makes a set from now on.
- **κ grid.** Every tail and summary unit of a set gets a Used verdict at each cell of *s* ∈ {6, 8, 12} × *k* ∈ {1, 2, 3}, computed on its own Run.
  - The chosen cell has the highest Cohen's κ against Needed, pooled across Arms, with unclear units excluded. Unstable units never enter a set.
  - κ, precision and recall are printed per Arm, with the counts behind them.
  - It runs free and offline (`measures.ts --calibrate`), and again after any change to the rule.
- **Frozen per key.** The chosen cell and its κ are stored with the set and reset with it. Every Measure of a Run under that key uses the cell.
- **Label.** With no set for the key, or a best κ below 0.4, Utilisation keeps *s* = 8, *k* = 2 and every report labels it "uncalibrated"; it is still computed. Otherwise reports label it with its κ and cell, and still never as Needed.
- **PPI Needed-share row.** Tail and summary only, per Arm: the Used share of the reported Runs, weighted the way Ablation draws, minus the calibration set's mean of (Used − Needed), with its own 95% interval.
  - Shown beside Ablation's Needed share in the Ablation and Gate reports, labelled "PPI", only when κ ≥ 0.4.
  - It needs no Ablation of the reported Runs, so a Gate without `--ablate` gets one too.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `measures`: the Used rule's cell is calibrated per key; Utilisation is labelled by calibration; the PPI Needed share is defined.
- `ablation`: a calibration set keeps its source Runs and each unit's Used verdicts; the Ablation report gives the PPI row.
- `regression-gate`: the report labels Utilisation by calibration and gives each side's PPI Needed share.

## Impact

- `scripts/utilisation.ts` (per-unit Used verdicts), a new `scripts/calibration.ts` (κ grid, choice, PPI), `scripts/measures.ts`, `scripts/ablation.ts`, `scripts/ablate.ts`, `scripts/gate.ts`, `scripts/bench-tokens.ts`.
- `bench/ablation/calibration.json` gains each unit's Run folder, its Used verdicts and the set's chosen cell. `bench/ablation/runs/` holds the 10 Runs of the `gate` v1 set: about 11.5 MB raw, 1.4 MB compressed.
- No model spend: the calibration set is already paid for.
