# Comparison report shape

Type: grilling
Status: closed
Blocked by: 03-measuring-both-arms-alike, 06-task-suite-source, 09-model-pinning

## Question

Which claims does the plain-omp comparison report make, on how many Runs, at what cost, and which caveats must it carry?

## What's known

- Ticket 06: the Gate Workload plus a probed EvoCode-Bench subset back the report.
- Ticket 09: the headline claim needs a second model; the Gate does not.
- Ticket 08: the Gate compares pi-chart with pi-chart; plain omp appears only in this report.
- Ticket 03: one-Arm Measures report "n/a" and feed no headline; the Arms recover Lapses by different routes.
- Cost reference per 40-Turn Conversation: $3.77 pi-chart, $4.89 plain omp (`docs/benchmarks/2026-10-14-token-usage-40-turns-mark-0.2.md`).
- Existing reports live in `docs/benchmarks/<date>-<slug>.md` with raw JSON beside them.

## Resolution

- **Headline Measures**, each a paired difference with a 95% interval: Cost per Run, Cost per Pass, Lapses per Run, Retention by distance band. Pass counts are given per step but are not a headline; at this n they only catch a collapse (ticket 13).
- **Runs:**

  | Batch | Model | Workload | Pairs |
  |---|---|---|---|
  | main | reference | Gate Workload | 10 |
  | main | reference | EvoCode subset | sized by its probe Run |
  | replication | second model | Gate Workload | 10 |

  Fixed n, no sequential looks: the report is descriptive, not a verdict. Cap about $250 for the whole report.
- **Location:** `docs/benchmarks/<date>-plain-omp-comparison.md`, raw JSON beside it, in the existing format.
- **Fixed caveats section:**
  1. The Workloads were written knowing how pi-chart works; the EvoCode subset is the outside check.
  2. The Workloads were chosen to make pi-chart evict, so they show long sessions, not typical short ones.
  3. The Arms recover Lapses by different routes; zero Pulls on plain omp is not zero Lapses.
  4. Plain omp runs at its default compaction settings, untuned.
  5. Each Run is isolated (ticket 16), which removes pi-chart's benefit from earlier Conversations.
  6. The exact model ids, thinking level, n and interval method.

## Amendment (ticket 05)

- Needed share comes from 40 Ablation units per Arm (20 on each of 2 Runs), reference model only, ≈ $49 on top of the $250 cap.
