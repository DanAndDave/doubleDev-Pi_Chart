# Judging Utilisation

Type: grilling
Status: closed
Blocked by: 05-ablation-design

## Question

What makes a window part Used: lexical or path overlap with the next action, or a rule calibrated against Ablation?

## What's known

- Ticket 03: Utilisation is a share of the Context Window, measured on tail plus summary on both Arms, per Call and token-weighted over the Run.
- Ticket 02: computed offline, so the rule can be retuned and rerun on old Runs at no model cost.

## Resolution

- **Units:** Ablation's units restricted to tail and summary (ticket 03): an earlier tool-call group, an earlier Turn's prose, or the compaction summary. Opening, Pin and the current Turn are not judged. Caveat in the report: earlier tool results of the *same* Turn sit in the current Turn and are never measured, though they are likely the most-referenced content.
- **Next action:** as in ticket 05: the first tool call's arguments, else the visible reply text. Thinking excluded (redacted or summarised; not comparable across Arms).
- **Coverage:** every unit on every Call, offline, no model cost. A Call with empty tail and no summary is counted and excluded.
- **Rule:** a unit is Used if any of three lexical signals fires, using only text the unit contributes:

  | Signal | Fires when |
  |---|---|
  | Path | a path in the action's target (ticket 05's target table) appears in the unit |
  | Copied span | the action contains ≥ *s* consecutive tokens copied from the unit |
  | Rare identifiers | the action shares ≥ *k* identifiers, numbers or string literals with the unit, excluding any also in the system prompt or current Turn |

  "Rare": in fewer than 5% of the Run's units. Identical content in two units makes both Used (matches Ablation's duplicated flag). No judge model, no embeddings.
- **Calibration:** grid *s* ∈ {6, 8, 12} × *k* ∈ {1, 2, 3}; the cell with the highest Cohen's κ between Used and Needed on the calibration set's tail and summary units, pooled across Arms, unstable and unclear units excluded. One rule for both Arms; κ, precision and recall reported per Arm. The cell is frozen with the Workload version and reset with the calibration set; rule changes rerun on old Runs for free. Best κ < 0.4 labels Utilisation "uncalibrated" in every report (still computed).
- **Reporting:** Utilisation per Call = Used tokens ÷ tail-plus-summary tokens; per Run Σ Used ÷ Σ measured; broken down by unit kind. Reported raw, never relabelled as Needed.
- **PPI row:** Needed share = Utilisation over all units − calibration-set mean of (Used − Needed), ARES's prediction-powered estimator with its own 95% interval. Shown beside the plain Ablation Needed share, labelled "PPI", tail and summary only, only when κ ≥ 0.4.
- **Where:** a function in ticket 02's Measures script; nothing new recorded.
