# Gate statistics and cost

Type: grilling
Status: closed
Blocked by: 01-name-the-measures, 13-error-bars-small-n-agent-evals

## Question

How does the regression gate decide? Settle the following:

- **Measures.** Which measures are in the gate, and which are only reported.
- **Sample size.** Runs per arm, and whether runs are paired by workload.
- **Statistics.** The interval or test method, and the regression threshold for each gated measure.
- **Baseline.** What the gate compares against: a saved baseline, or a fresh run of the previous commit.
- **Cost.** The cost cap per gate run.
- **Trigger.** Whether the gate runs by hand before a change archives, or automatically. This repo has no remote and no CI today.

## What's known

- A 40-Turn run with 3 runs per arm costs about $26 and takes 804 s at parallel 6 (`docs/benchmarks/2026-10-14-token-usage-40-turns-mark-0.2.md` at `5c3275b`).
- Recall distance for the same Turn ranged from 0.478 to 0.541 across six identical runs, so run-to-run noise is material.
- The 2026-10-13 benchmark could not tell low-water marks 0.5 to 0.7 apart (the earlier `DEFAULT_TAIL_LOW_WATER` doc comment). The 2026-10-14 sweep settled 0.2 only because each of its runs cost less than each 0.6 run, not through a statistical test (`src/config.ts:160-166`).

## Resolution

- **Baseline:** fresh Runs of the previous commit, paired with the change's Runs by Workload and alternated in time. A saved baseline would lose both the pairing and the same-time blocking against cost drift and infrastructure noise (ticket 13). The Gate compares pi-chart with pi-chart; plain omp appears only in the comparison report.
- **Gated Measures:** two, with a Holm correction between them.
  - **Cost per Run:** one-sided paired t test on each pair's log cost ratio, non-inferiority margin ×1.10.
  - **Lapses per Run:** one-sided paired test, so the Gate cannot pass on cost by forgetting.
- **Reported only:** Utilisation, Needed share, Re-fetches, Pulls, Retention by Plant cell, Pass rate and Cost per Pass. At n ≤ 10, pass rates can only catch a collapse (ticket 13).
- **Verdict:** pass, fail or inconclusive.
- **Sample size and looks:** two looks with O'Brien–Fleming boundaries, at 5 pairs and then at 10.
- **Variance:** a one-time A/A batch of about 10 Runs (≈ $38) pins σ first. Each Gate then uses a variance pooled from every past Gate and A/A Run. At the observed 3.6% CV, ×1.10 is reachable at about 4 pairs; at 10% CV it needs about 15.
- **Cost cap:** about $38 at the first look and about $75 per Gate in total.
- **Trigger:** by hand, as a required step before `/opsx-archive` for any change that touches `src/`. Changes to docs, specs or tooling only skip it. There is no CI or remote, and a Gate costs real money.

## Amendment (ticket 05)

- Needed share is shown as "not measured" in the Gate report unless `--ablate` is given; with it, Ablation runs under its own $10-per-Run cap on top of this Gate's cap.
