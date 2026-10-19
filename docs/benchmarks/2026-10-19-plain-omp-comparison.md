# pi-chart vs plain omp — 2026-10-19

Reference: the Gate Workload: pi-chart costs **1.964× [1.853×, 2.082×]** what plain omp costs per Run, with **+25.70 [+24.05, +27.35]** Lapses per Run.

- Commit: `65b9de1`
- Harness: omp/18.12.1
- Reference: the Gate Workload: `anthropic/claude-opus-5-5`, gate v1, 10 complete and 0 void pairs, $73.70 of $80.00
- Second model: the Gate Workload: `anthropic/claude-sonnet-5-5`, gate v1, 10 complete and 0 void pairs, $22.54 of $45.00
- EvoCode subset: `anthropic/claude-opus-5-5`, EvoCode-Bench at 9fcae3e: theme_d10_w8_ml_ai_mlops_security_patch_hardening, theme_d10_w12_ml_ai_mlops_explanation_reporting, theme_d10_w9_ml_ai_mlops_reproducibility_verification, theme_d1_w1_code_build_greenfield_implementation, 7 complete and 1 void pairs, $88.17 of $125.00
- Instrument: `scripts/compare.ts`; figures in [`2026-10-19-plain-omp-comparison.json`](2026-10-19-plain-omp-comparison.json)
- Reproduce: `bun scripts/compare.ts --out <dir> --batch reference`, then `--ablate`, `--batch second` and `--batch evocode` into the same `<dir>`, a stopped EvoCode batch taking `--batch evocode --resume` on the omp it ran on, then `--report`; the Run folders are not committed.

Each pair is one plain-omp Run and one pi-chart Run, started together. An Arm's Cost figures are geometric means over the batch's complete pairs. A ratio is pi-chart over plain omp, exp of the mean log difference; counts and shares are pi-chart minus plain omp. On EvoCode, a difference is the mean of its task means, so each task weighs the same, and it can differ from what the Arm columns, pooled over pairs, suggest. Void pairs count toward spend and in no figure. This is descriptive: no margin, verdict or sequential look applies.

## Reference: the Gate Workload

gate v1 on `anthropic/claude-opus-5-5`; 10 complete pairs, 0 void; spent $73.70 of a $80.00 cap.

| Measure | plain omp | pi-chart | pi-chart vs plain omp [95%] | Pairs | df | Left out |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cost per Run | $2.48 | $4.87 | 1.964× [1.853×, 2.082×] | 10 | 9 | 0 |
| Cost per Pass | $0.41 | $0.81 | 1.964× [1.853×, 2.082×] | 10 | 9 | 0 |
| Lapses per Run | 0.00 | 25.70 | +25.70 [+24.05, +27.35] | 10 | 9 | 0 |
| Retention, 1–5 Turns | 100.0% (20/20) | 55.0% (11/20) | -45.0 pp [-56.3 pp, -33.7 pp] | 10 | 9 | 0 |
| Retention, 6–7 Turns | — | — | — | 0 | 0 | 10 |
| Retention, 8–12 Turns | 100.0% (20/20) | 85.0% (17/20) | -15.0 pp [-32.3 pp, 2.3 pp] | 10 | 9 | 0 |
| Retention, 13–24 Turns | 100.0% (10/10) | 0.0% (0/10) | -100.0 pp [-100.0 pp, -100.0 pp] | 10 | 9 | 0 |
| Retention, ≥25 Turns | 100.0% (50/50) | 40.0% (20/50) | -60.0 pp [-60.0 pp, -60.0 pp] | 10 | 9 | 0 |

Passes per graded step, complete Runs:

| Step | plain omp | pi-chart |
| --- | ---: | ---: |
| buckets | 10/10 | 10/10 |
| turn-sizes | 10/10 | 10/10 |
| histogram | 10/10 | 10/10 |
| weights | 10/10 | 10/10 |
| render | 10/10 | 10/10 |
| summary | 10/10 | 10/10 |

First failing step, complete Runs:

| Step | plain omp | pi-chart |
| --- | ---: | ---: |
| none | 10 | 10 |

One-Arm Measures, mean per complete Run:

| Measure | plain omp | pi-chart |
| --- | ---: | ---: |
| Compactions per Run | 0.0 | n/a |
| Pulls per Run: recall_earlier_turns | n/a | 9.3 |
| Pulls per Run: recall_across_conversations | n/a | 0.0 |
| Pulls per Run: search_documentation | n/a | 0.0 |
| Pulls per Run: walk_documentation | n/a | 0.0 |
| Pulls per Run: codebase_structure | n/a | 0.0 |
| Recall Pulls per Run, 1–5 Turns | n/a | 6.0 |
| Recall Pulls per Run, 6–7 Turns | n/a | 0.9 |
| Recall Pulls per Run, 8–12 Turns | n/a | 1.3 |
| Recall Pulls per Run, 13–24 Turns | n/a | 0.9 |
| Recall Pulls per Run, ≥25 Turns | n/a | 0.2 |

## Second model: the Gate Workload

gate v1 on `anthropic/claude-sonnet-5-5`; 10 complete pairs, 0 void; spent $22.54 of a $45.00 cap.

| Measure | plain omp | pi-chart | pi-chart vs plain omp [95%] | Pairs | df | Left out |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cost per Run | $0.97 | $1.27 | 1.313× [1.181×, 1.459×] | 10 | 9 | 0 |
| Cost per Pass | $0.16 | $0.21 | 1.313× [1.181×, 1.459×] | 10 | 9 | 0 |
| Lapses per Run | 0.00 | 20.50 | +20.50 [+18.77, +22.23] | 10 | 9 | 0 |
| Retention, 1–5 Turns | 100.0% (20/20) | 60.0% (12/20) | -40.0 pp [-62.6 pp, -17.4 pp] | 10 | 9 | 0 |
| Retention, 6–7 Turns | — | — | — | 0 | 0 | 10 |
| Retention, 8–12 Turns | 100.0% (20/20) | 20.0% (4/20) | -80.0 pp [-98.5 pp, -61.5 pp] | 10 | 9 | 0 |
| Retention, 13–24 Turns | 100.0% (10/10) | 0.0% (0/10) | -100.0 pp [-100.0 pp, -100.0 pp] | 10 | 9 | 0 |
| Retention, ≥25 Turns | 100.0% (50/50) | 26.0% (13/50) | -74.0 pp [-80.9 pp, -67.1 pp] | 10 | 9 | 0 |

Passes per graded step, complete Runs:

| Step | plain omp | pi-chart |
| --- | ---: | ---: |
| buckets | 10/10 | 10/10 |
| turn-sizes | 10/10 | 10/10 |
| histogram | 10/10 | 10/10 |
| weights | 10/10 | 10/10 |
| render | 10/10 | 10/10 |
| summary | 10/10 | 10/10 |

First failing step, complete Runs:

| Step | plain omp | pi-chart |
| --- | ---: | ---: |
| none | 10 | 10 |

One-Arm Measures, mean per complete Run:

| Measure | plain omp | pi-chart |
| --- | ---: | ---: |
| Compactions per Run | 0.0 | n/a |
| Pulls per Run: recall_earlier_turns | n/a | 2.5 |
| Pulls per Run: recall_across_conversations | n/a | 0.1 |
| Pulls per Run: search_documentation | n/a | 0.6 |
| Pulls per Run: walk_documentation | n/a | 0.0 |
| Pulls per Run: codebase_structure | n/a | 0.0 |
| Recall Pulls per Run, 1–5 Turns | n/a | 1.1 |
| Recall Pulls per Run, 6–7 Turns | n/a | 0.2 |
| Recall Pulls per Run, 8–12 Turns | n/a | 0.4 |
| Recall Pulls per Run, 13–24 Turns | n/a | 0.6 |
| Recall Pulls per Run, ≥25 Turns | n/a | 0.3 |

## EvoCode subset

EvoCode-Bench at 9fcae3e: theme_d10_w8_ml_ai_mlops_security_patch_hardening, theme_d10_w12_ml_ai_mlops_explanation_reporting, theme_d10_w9_ml_ai_mlops_reproducibility_verification, theme_d1_w1_code_build_greenfield_implementation on `anthropic/claude-opus-5-5`; 7 complete pairs, 1 void; spent $88.17 of a $125.00 cap. Resumed, with the stopping pair run again, after: theme_d10_w12_ml_ai_mlops_explanation_reporting-pi-chart-1: the trial holds no main Journal.

| Measure | plain omp | pi-chart | pi-chart vs plain omp [95%] | Pairs | df | Left out |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cost per Run | $5.14 | $5.39 | 0.996× [0.673×, 1.475×] | 7 | 3 | 0 |
| Cost per Pass | $0.89 | $0.91 | 0.959× [0.648×, 1.419×] | 7 | 3 | 0 |
| Lapses per Run | 0.00 | 0.57 | +0.63 [+0.11, +1.14] | 7 | 3 | 0 |
| Retention | n/a: no Plants | n/a: no Plants | — | — | — | — |

Passes per graded step, complete Runs:

| Step | plain omp | pi-chart |
| --- | ---: | ---: |
| theme_d10_w8_ml_ai_mlops_security_patch_hardening: round-1 | 0/1 | 0/2 |
| theme_d10_w8_ml_ai_mlops_security_patch_hardening: round-2 | 1/1 | 1/2 |
| theme_d10_w8_ml_ai_mlops_security_patch_hardening: round-3 | 1/1 | 2/2 |
| theme_d10_w8_ml_ai_mlops_security_patch_hardening: round-4 | 1/1 | 2/2 |
| theme_d10_w8_ml_ai_mlops_security_patch_hardening: round-5 | 1/1 | 2/2 |
| theme_d10_w8_ml_ai_mlops_security_patch_hardening: round-6 | 1/1 | 2/2 |
| theme_d10_w8_ml_ai_mlops_security_patch_hardening: round-7 | 1/1 | 2/2 |
| theme_d10_w8_ml_ai_mlops_security_patch_hardening: round-8 | 0/1 | 2/2 |
| theme_d10_w12_ml_ai_mlops_explanation_reporting: round-1 | 2/2 | 2/2 |
| theme_d10_w12_ml_ai_mlops_explanation_reporting: round-2 | 2/2 | 2/2 |
| theme_d10_w12_ml_ai_mlops_explanation_reporting: round-3 | 2/2 | 2/2 |
| theme_d10_w12_ml_ai_mlops_explanation_reporting: round-4 | 2/2 | 2/2 |
| theme_d10_w12_ml_ai_mlops_explanation_reporting: round-5 | 2/2 | 2/2 |
| theme_d10_w12_ml_ai_mlops_explanation_reporting: round-6 | 2/2 | 2/2 |
| theme_d10_w12_ml_ai_mlops_explanation_reporting: round-7 | 2/2 | 2/2 |
| theme_d10_w9_ml_ai_mlops_reproducibility_verification: round-1 | 2/2 | 2/2 |
| theme_d10_w9_ml_ai_mlops_reproducibility_verification: round-2 | 2/2 | 2/2 |
| theme_d10_w9_ml_ai_mlops_reproducibility_verification: round-3 | 2/2 | 2/2 |
| theme_d10_w9_ml_ai_mlops_reproducibility_verification: round-4 | 0/2 | 0/2 |
| theme_d10_w9_ml_ai_mlops_reproducibility_verification: round-5 | 0/2 | 0/2 |
| theme_d10_w9_ml_ai_mlops_reproducibility_verification: round-6 | 0/2 | 0/2 |
| theme_d10_w9_ml_ai_mlops_reproducibility_verification: round-7 | 0/2 | 0/2 |
| theme_d10_w9_ml_ai_mlops_reproducibility_verification: round-8 | 0/2 | 0/2 |
| theme_d1_w1_code_build_greenfield_implementation: round-1 | 2/2 | 2/2 |
| theme_d1_w1_code_build_greenfield_implementation: round-2 | 2/2 | 2/2 |
| theme_d1_w1_code_build_greenfield_implementation: round-3 | 2/2 | 2/2 |
| theme_d1_w1_code_build_greenfield_implementation: round-4 | 2/2 | 2/2 |
| theme_d1_w1_code_build_greenfield_implementation: round-5 | 2/2 | 2/2 |
| theme_d1_w1_code_build_greenfield_implementation: round-6 | 2/2 | 2/2 |
| theme_d1_w1_code_build_greenfield_implementation: round-7 | 2/2 | 2/2 |
| theme_d1_w1_code_build_greenfield_implementation: round-8 | 2/2 | 2/2 |
| theme_d1_w1_code_build_greenfield_implementation: round-9 | 2/2 | 2/2 |

First failing step, complete Runs:

| Step | plain omp | pi-chart |
| --- | ---: | ---: |
| theme_d10_w8_ml_ai_mlops_security_patch_hardening: round-1 | 1 | 2 |
| theme_d10_w9_ml_ai_mlops_reproducibility_verification: round-4 | 2 | 2 |
| none | 4 | 4 |

One-Arm Measures, mean per complete Run:

| Measure | plain omp | pi-chart |
| --- | ---: | ---: |
| Compactions per Run | 0.0 | n/a |
| Pulls per Run: recall_earlier_turns | n/a | 0.4 |
| Pulls per Run: recall_across_conversations | n/a | 0.0 |
| Pulls per Run: search_documentation | n/a | 0.0 |
| Pulls per Run: walk_documentation | n/a | 0.0 |
| Pulls per Run: codebase_structure | n/a | 0.0 |
| Recall Pulls per Run, 1–5 Turns | n/a | 0.4 |
| Recall Pulls per Run, 6–7 Turns | n/a | 0.0 |
| Recall Pulls per Run, 8–12 Turns | n/a | 0.0 |
| Recall Pulls per Run, 13–24 Turns | n/a | 0.0 |
| Recall Pulls per Run, ≥25 Turns | n/a | 0.0 |

## Ablation and Utilisation, reference batch

4 Runs of the reference batch's lowest-indexed complete pairs (vanilla-0, pi-chart-0, vanilla-1, pi-chart-1), 20 units and at most $10.00 each; $30.96 spent in all.

| Arm | Needed share [95%] | Unclear | Unstable Calls | Spend | Utilisation | PPI Needed share |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| plain omp | 1/37 2.7% [0.5%, 13.8%] | 2.7% | 6/44 | $19.41 | 14.1% | uncalibrated (gate v1, anthropic/claude-opus-5-5, omp/18.12.1) |
| pi-chart | 4/40 10.0% [4.0%, 23.1%] | 0.0% | 11/51 | $11.55 | 29.0% | uncalibrated (gate v1, anthropic/claude-opus-5-5, omp/18.12.1) |

Utilisation is uncalibrated: Used tokens over judged tokens, pooled over each Arm's complete Runs. Utilisation is lexical: Used is not Needed. Earlier tool results of a Call's own Turn are never measured. Items found in the system prompt outside the Opening and Pins are not excluded; the record does not hold that text.

## Caveats

1. The Gate Workload was written knowing how pi-chart works; the EvoCode subset is the outside check.
2. The Workloads were chosen to make pi-chart evict, so they show long sessions rather than typical short ones.
3. The Arms recover Lapses by different routes: zero Pulls on plain omp is not zero Lapses.
4. Plain omp runs at its default compaction settings, untuned.
5. Each Run is isolated, which removes any benefit pi-chart draws from earlier Conversations.
6. How each batch ran:
   - Reference: the Gate Workload: model anthropic/claude-opus-5-5; thinking high (the harness default, from the Journals); omp/18.12.1; 10 complete pairs, 0 void; interval: two-sided 95% paired t over the batch's own pairs. No multiplicity correction applies.
   - Second model: the Gate Workload: model anthropic/claude-sonnet-5-5; thinking high (the harness default, from the Journals); omp/18.12.1; 10 complete pairs, 0 void; interval: two-sided 95% paired t over the batch's own pairs. No multiplicity correction applies.
   - EvoCode subset: model anthropic/claude-opus-5-5; thinking high (the harness default, from the Journals); omp/18.12.1; 7 complete pairs, 1 void; interval: two-sided 95% paired t pooled within the 4 tasks (theme_d10_w8_ml_ai_mlops_security_patch_hardening, theme_d10_w12_ml_ai_mlops_explanation_reporting, theme_d10_w9_ml_ai_mlops_reproducibility_verification, theme_d1_w1_code_build_greenfield_implementation), which describes these tasks, not EvoCode-Bench as a whole. No multiplicity correction applies.
