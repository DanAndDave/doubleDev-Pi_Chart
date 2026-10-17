# Proposal: Utilisation

Triage: needs-triage
Blocked by: window-held-and-refetch

## Why

Utilisation is the cheap precision Measure: the share of a Call's tail and summary tokens that its next action drew on, computed on every Call at no model cost. It is the per-Call view the Gate and the Budget sweep can afford, while Ablation's Needed verdicts are too costly to run on every Call.

Decisions: `context-need-measures/questions/19`, `03`, `05`.

## What Changes

- **Judged units**: the tail and summary units Ablation already lists. These are earlier tool-call groups, earlier Pull results (pi-chart), earlier Turns' prose and the compaction summary (plain omp).
  - The Opening, Pins and the current Turn are not judged.
  - A Call with an empty tail and no summary is counted and excluded. So is a Call whose window is unknown.
- **Next action**: the first tool call's arguments, or else the visible reply text. Thinking is excluded.
- **Used rule.** A unit is Used when any lexical signal fires on text the unit contributes:
  - **path**: a path in the action's target appears in the unit;
  - **copied span**: the action contains ≥ *s* consecutive tokens from the unit;
  - **rare identifiers**: the action shares ≥ *k* identifiers, numbers or string literals with the unit. Items also found in the current Turn, or in the Opening and Pins the Call carried, do not count. "Rare" means in fewer than 5% of the Run's units.

  Identical content in two units makes both Used.
- **System prompt.** Run records do not hold the system prompt's text. Ticket 19's exclusion is therefore applied only to the parts the record can rebuild: the Opening and the Pins. The rest of the system prompt is omp's base prompt, the workspace's agent instructions and the tool roster, which both Arms share. Items found there are not excluded, and the report says so.
- **Default *s*, *k*.** A cell of the {6, 8, 12} × {1, 2, 3} grid, chosen in `design.md`. Every report labels Utilisation "uncalibrated" until `utilisation-calibration` lands.
- **Reporting.**
  - Per Call: Used tokens ÷ tail-plus-summary tokens.
  - Per Run: Σ Used ÷ Σ measured.
  - Both broken down by unit kind. Reported raw, never relabelled as Needed.
  - The benchmark report and the Gate report show it per Arm or side. The Gate's Utilisation row stops reading "not measured".
- **The report states the same-Turn caveat.** Earlier tool results of the Call's own Turn are never measured.
- **Shared units and targets.** `ablation` built the (tool, target) table and the unit lister in `scripts/ablation.ts`. They move to a module that both Ablation and the Measures import, so a unit and a target keep one definition.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `measures`: Utilisation per Call and per Run, by unit kind, with its calibration label.
- `regression-gate`: the report gives each side's Utilisation instead of "not measured".

## Impact

- `scripts/measures.ts` computes Utilisation in `measureRun`.
- A new module for the Used rule.
- The units, targets and Pull tool list move out of `scripts/ablation.ts` and `scripts/measures.ts` into a shared module.
- Reports: `scripts/bench-tokens.ts` and the Gate report in `scripts/gate.ts`.
- Tests: one fixture per signal, plus the rare-identifier exclusions.
- No model spend: it recomputes on existing Run records.
