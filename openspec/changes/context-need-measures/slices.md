# Slices: building the context-need measures

`to-tickets` output for the map in `map.md`. Each slice is its own change folder under `openspec/changes/<change-id>/`, opened with a `proposal.md` carrying its `Blocked by:` line and `Triage: needs-triage`. A slice is on the frontier when every slice it is blocked by is archived; `/opsx-propose <change-id>` then continues the existing folder, revising the proposal against what the archived slices actually built and writing its delta specs, `design.md` and `tasks.md`. Until then `openspec validate` rejects the folder for having no deltas, which is expected.

| # | Change id | Blocked by | Delivers |
| --- | --- | --- | --- |
| 1 | `measures-walking-skeleton` | None | Workload folders under `bench/workloads/`; Runs from a pinned commit plus overlay with a per-Run Thread Store and bundle; step checks; a Measures script over one finished Run reporting Cost per Run, Pass per step, Cost per Pass and Retention per Plant. The 40-Turn default becomes a Workload. |
| 2 | `window-held-and-refetch` | 1 | Window parts per Call for both Arms; Re-fetch held / left; first Lapse route; Lapses and Re-fetches per Run by band; "n/a" for one-Arm Measures. |
| 3 | `pulls-and-recall-lapses` | 2 | Pull counts, `write_documentation` apart, recall Pulls by result (second Lapse route); `recall_across_conversations` result Turn identities in details. |
| 4 | `plants-and-retention` | 3 | Plant kinds and placement, distance bands, source attribution × right/wrong, leaks, failed Probe as third Lapse route. |
| 5 | `revisit-scoring` | 2 | Revisits declared in the Workload, scored held / left / not re-fetched with source and correctness. |
| 6 | `gate-workload` | 4, 5 | The frozen ~40-Turn, 6-step Gate Workload v1, probed on both Arms (evicts, ≤ $3.75 per pi-chart Run). |
| 7 | `regression-gate` | 6 | Paired Gate against the previous commit, Holm-corrected Cost and Lapse tests, two looks, pooled σ from an A/A batch, $75 cap, workflow step. |
| 8 | `ablation` | 2, 6, 7 | Replay moves into `scripts/`; unit cut with sham, k = 4, Needed verdicts, calibration set, controls; Gate `--ablate`. |
| 9 | `utilisation` | 2 | Lexical Used rule at default *s*, *k*; Utilisation per Call and Run by unit kind, "uncalibrated". |
| 10 | `utilisation-calibration` | 8, 9 | κ grid against Needed, frozen per Workload version, PPI Needed-share row. |
| 11 | `budget-sweep` | 7 | Sweep script on the Gate's objective, screen plus held-out confirm Workload. |
| 12 | `evocode-subset` | 4 | omp agent for Harbor, probed EvoCode-Bench subset feeding the Measures script. |
| 13 | `comparison-report` | 7, 10, 12 | Headline paired differences with intervals, second model, Ablation units, six caveats. |
