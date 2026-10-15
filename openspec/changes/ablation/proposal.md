# Proposal: Ablation

Triage: needs-triage
Blocked by: window-held-and-refetch, gate-workload, regression-gate

## Why

Utilisation is correlational: text overlap says a part was drawn on, not that the action depended on it. Ablation is the ground truth. It removes one unit from a recorded Call, resends it, and checks whether the next action changes beyond model noise. The replay that makes this possible exists only as evidence scripts in `context-need-measures/evidence/`.

Decisions: `context-need-measures/questions/04`, `05`, `12`.

## What Changes

- **Replay moves into `scripts/`.** `evidence/replay.ts` and `evidence/replay-ext.ts` become the replay wrapper:
  - stub mode answers each Call from the Journal at no model cost;
  - send mode is for Ablation.
  - The original session id and date are pinned.
  - Token savings are checked against the endpoint's count of the unchanged rebuild.
- **Units.** One unit per sampled Call, never from the Call's own Turn.
  - Both Arms: an earlier tool-call group, or an earlier Turn's prose.
  - plain omp only: the compaction summary.
  - pi-chart only: the Opening, one Pin, or one Pull result.
  
  A unit is cut after assembly and not refilled. Units whose identical content is held elsewhere are flagged *duplicated* and reported apart.
- **Sampling.** Calls holding at least one unit; one unit per Call, chosen with probability proportional to its tokens.
- **Next action compared on (tool, target)**, using question 05's target table, with no judge. On a Probe Call, the Probe's checker decides.
- **Noise.** A sham removal at the unit's position, with k = 4 resends per condition.
  - A Call is stable when the sham matches in ≥ 3 of 4. Unstable Calls are counted and redrawn.
  - A unit is **Needed** when the ablated resends match in ≤ 1 of 4; 2 of 4 is *unclear*.
  - Needed share comes with a Wilson 95% interval.
- **Controls.**
  - Positive: ablating the Plant's Turn on Probe Calls must come out ≥ 80% Needed.
  - Negative: 20 null units (a second sham) should show a false Needed rate of about 5%.
- **Calibration set.** Once per Workload version: 50 units per Arm plus 20 null units, about $67, frozen with the Workload version.
- **Cap** $10 per Run; sampling stops at the cap.
- **Gate `--ablate`.** It runs Ablation under its own cap and fills the Gate's Needed-share row.

## Capabilities

### New Capabilities

- `ablation`: replay, units, sampling, the changed-action rule, noise handling, verdicts, controls, the calibration set, and the cap. It is separate from `measures`, whose Measures make no model Call.

### Modified Capabilities

- `regression-gate`: `--ablate` fills Needed share.

## Impact

- New `scripts/ablate.ts` and a replay module; the `evidence/` copies stay as the record of question 04.
- Spend: the calibration set (about $67) once per Workload version, plus control runs.
