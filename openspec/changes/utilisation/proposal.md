# Proposal: Utilisation

Triage: needs-triage
Blocked by: window-held-and-refetch

## Why

Utilisation is the cheap precision Measure: the share of a Call's tail and summary tokens that its next action drew on, computed on every Call at no model cost. It is the per-Call view the Gate and the Budget sweep can afford, while Ablation's Needed verdicts are too costly to run on every Call.

Decisions: `context-need-measures/questions/19`, `03`, `05`.

## What Changes

- **Judged units**: earlier tool-call groups, earlier Turns' prose, and the compaction summary.
  - The Opening, Pins and the current Turn are not judged.
  - A Call with an empty tail and no summary is counted and excluded.
- **Next action**: the first tool call's arguments, or else the visible reply text. Thinking is excluded.
- **Used rule.** A unit is Used when any lexical signal fires on text the unit contributes:
  - **path**: a path in the action's target appears in the unit;
  - **copied span**: the action contains ≥ *s* consecutive tokens from the unit;
  - **rare identifiers**: the action shares ≥ *k* identifiers, numbers or string literals with the unit, excluding any also in the system prompt or the current Turn. "Rare" means in fewer than 5% of the Run's units.

  Identical content in two units makes both Used.
- **Default *s*, *k*.** A cell of the {6, 8, 12} × {1, 2, 3} grid, chosen in `design.md`. Every report labels Utilisation "uncalibrated" until `utilisation-calibration` lands.
- **Reporting.**
  - Per Call: Used tokens ÷ tail-plus-summary tokens.
  - Per Run: Σ Used ÷ Σ measured.
  - Both broken down by unit kind. Reported raw, never relabelled as Needed.
- **The report states the same-Turn caveat.** Earlier tool results of the Call's own Turn are never measured.
- **Target extraction.** The (tool, target) table from question 05 is built here as shared code, and `ablation` reuses it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `measures`: Utilisation per Call and per Run, by unit kind, with its calibration label.

## Impact

- `scripts/measures.ts`, plus a module for target extraction and the Used rule.
- `scripts/bench-tokens.ts` report; the Gate's Utilisation row stops reading "not measured".
- Tests: one fixture per signal, plus the rare-identifier exclusions.
- No model spend: it recomputes on existing Run records.
