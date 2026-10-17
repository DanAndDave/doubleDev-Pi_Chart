# Proposal: Ablation

Triage: ready-for-agent
Blocked by: window-held-and-refetch, gate-workload, regression-gate

## Why

Utilisation is correlational: text overlap shows a part was drawn on, not that the next action depended on it. Ablation is the ground truth. It removes one unit from a recorded Call, resends the Call, and checks whether the next action changes by more than model noise. Today the replay that makes this possible exists only as throwaway evidence scripts (`context-need-measures/evidence/`), and the Gate's report shows Needed share as "not measured".

Decisions: `context-need-measures/questions/04`, `05`, `12`.

## What Changes

- **Replay moves into `scripts/`.** It rebuilds a recorded Run's Calls through omp's own code path. The replay recreates:
  - the Run's workspace at its original path;
  - a fresh bundle copy;
  - for a pi-chart Run, a fresh Thread Store database migrated before the first Turn, and the same pi-chart commit.

  The session id and date are pinned. A stub answers every Call from the Journal at no model cost.
  - The replay is checked per Call: the endpoint's count of the rebuilt request must sit in the fixed offset band from the Call's `usage`. A Call outside it is *unfaithful* and is never ablated.
  - A free `check` command prints that match for a whole Run.
- **Units.** One unit per sampled Call, never taken from the Call's own Turn.
  - Both Arms: an earlier tool-call group, or an earlier Turn's prose.
  - plain omp only: the compaction summary.
  - pi-chart only: the Opening, one Pin, or one Pull result.

  A unit is cut from the finished request and the space is not refilled. A unit whose identical content is held elsewhere in the request is flagged *duplicated* and reported apart.
- **Sampling.** Calls holding at least one unit are drawn uniformly without replacement. One unit is picked per Call, with probability proportional to its tokens. The seed is recorded.
- **Next action compared on (tool, target)**, with no judge. On a Probe Call, the Probe's checker decides.
- **Noise.** A sham at the unit's position removes nothing, and k = 4 resends are made per condition.
  - The counting endpoint must show sham − ablated equal to the unit's own tokens, or the unit is *miscounted* and excluded before any send.
  - A Call is stable when the sham matches in ≥ 3 of 4. Unstable Calls are counted and redrawn.
  - A unit is **Needed** when the ablated resends match in ≤ 1 of 4. 2 of 4 is *unclear*.
  - Needed share comes with a Wilson 95% interval, and the unstable, unclear and duplicated shares are reported beside it.
- **Controls.**
  - Positive: on every Probe Call whose Plant is still held and answered right, cut the part holding the Plant. At least 80% must come out Needed, or the instrument is not trusted.
  - Negative: null units, whose second condition is a second sham. Their false Needed rate is reported.
- **Cap.** $10 per Run, priced at the rates the Run's own Journal shows. Sampling stops at the cap.
- **Calibration set.** Once per key (Workload name and version, model, omp version): 50 units per Arm, 20 null units and the positive control. It is frozen in `bench/ablation/calibration.json` only when the positive control holds. Each unit keeps its content and the original next action, so `utilisation-calibration` can judge Used on it later. The run itself, about $67 plus five plain-omp Gate Workload Runs, needs the user's go-ahead.
- **Gate `--ablate`.** After the last look, 10 units per side are drawn from the side's complete Runs, under a cap of its own ($10 per side) that is apart from the Gate's $90. They fill the report's Needed share row per side. Without the flag the row still reads "not measured".
- **Run records name the pi-chart commit.** A pi-chart Run's record keeps the commit its pi-chart tree was loaded from, so the replay can load the same tree. This holds only when the tree was clean under `src/`. A record without it can be ablated only when given `--commit`.

## Capabilities

### New Capabilities

- `ablation`: covers the replay and its fidelity check, units, sampling, the changed-action rule, the count check, noise handling and verdicts, Needed share, controls, the cap, the calibration set and each Run's ablation record. It sits apart from `measures`, whose Measures make no model Call.

### Modified Capabilities

- `regression-gate`: `--ablate` fills Needed share per side under its own cap. Without it the row stays "not measured".
- `benchmark-runs`: a pi-chart Run's record names the pi-chart commit it loaded, when that tree was clean.

## Impact

- New files:
  - `scripts/replay.ts`: replay a record, plus the `check` command;
  - `scripts/replay-ext.ts`: the omp extension that stubs, counts, cuts and sends;
  - `scripts/ablation.ts`: units, cut, targets, verdicts and sampling, all pure;
  - `scripts/ablate.ts`: the CLI;
  - `bench/ablation/calibration.json`.
- `scripts/stats.ts` gains the Wilson interval.
- `scripts/runs.ts` exports its database helpers and records the pi-chart commit.
- `scripts/gate.ts` gains `--ablate`.
- The `evidence/` copies stay as the record of question 04.
- Spend:
  - the smoke ablation, a few dollars;
  - the calibration set, about $67 plus about $25 of plain-omp Runs, with the user's go-ahead;
  - `--ablate`, at most $20 per Gate when asked for.
