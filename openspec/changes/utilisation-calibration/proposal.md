# Proposal: Utilisation calibration

Triage: needs-triage
Blocked by: ablation, utilisation

## Why

The Used rule's thresholds are a guess until they are checked against Needed. Calibrating them against the Ablation calibration set does two things:
- it says how far Utilisation can be trusted, through κ;
- it lets the cheap Measure correct itself into a Needed-share estimate, through prediction-powered inference.

Decisions: `context-need-measures/questions/19`, `05`.

## What Changes

- **κ grid.** Every tail and summary unit of the calibration set gets a Used verdict at each cell of *s* ∈ {6, 8, 12} × *k* ∈ {1, 2, 3}.
  - The chosen cell has the highest Cohen's κ against Needed, pooled across Arms, with unstable and unclear units excluded.
  - κ, precision and recall are reported per Arm.
- **Frozen per Workload version.** The cell is frozen with the calibration set and reset with it. A rule change reruns on old Runs at no cost.
- **Label.** When the best κ is below 0.4, every report labels Utilisation "uncalibrated"; it is still computed.
- **PPI Needed-share row.** Utilisation over all units minus the calibration-set mean of (Used − Needed), with its own 95% interval.
  - Tail and summary only.
  - Shown beside Ablation's Needed share, labelled "PPI", and only when κ ≥ 0.4.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `measures`: calibrated *s*, *k* per Workload version, the κ label, and the PPI row.
- `ablation`: calibration-set units also carry Used verdicts.

## Impact

- `scripts/measures.ts`, `scripts/ablate.ts`, and a stored calibration file per Workload version.
- No new model spend beyond the calibration set that `ablation` already pays for.
