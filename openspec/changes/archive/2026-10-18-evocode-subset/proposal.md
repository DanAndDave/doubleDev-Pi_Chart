# Proposal: EvoCode-Bench subset

Triage: ready-for-agent
Blocked by: plants-and-retention

## Why

The Gate Workload and its held-out twin were written by people who know how pi-chart works, and chosen to make it evict. The comparison report needs an outside check: multi-round tasks from a published suite, run on both Arms and measured by the same Measures script. EvoCode-Bench is the closest ready-made fit (ticket 11): each round is one fixed prompt into a workspace that persists, graded by cumulative tests. Nothing in the benchmark can run it today: every Run is a host process over a `bench/workloads/` folder, graded by `bun test`.

Decisions: `context-need-measures/questions/06`, `11`, `16`, `17`.

## What Changes

- **An EvoCode Run.** `scripts/evocode.ts` runs one EvoCode-Bench task on one Arm through Harbor, in the task's own container. Each round is one Turn, sent as written, and every round after the first continues the Conversation. Each round's verifier reward is the round's Graded Task outcome. omp, and for the pi-chart Arm this checkout's pi-chart, are mounted read-only into the container. A pi-chart Run's Thread Store is its own database on the host's Postgres, reached through the Docker host gateway.
- **The same Run record.** An EvoCode Run writes `run.json`, its Journals and its Accounting in the existing format, so `scripts/measures.ts` reads it unchanged. The record names the task as the Workload, with the dataset revision as its commit, and no Plants or Revisits.
- **Admission.** One pi-chart Run per candidate task, on the reference model. A task is admitted only when its Run completed every round and pi-chart evicted at least once. The candidates are the four tasks the published runs make cheapest: `d10_w8`, `d10_w12`, `d10_w9` and `d1_w1`, 7 to 9 rounds each. Admission runs 2 at a time under a $60 cap, and writes `bench/evocode/subset.json`: the dataset revision, the licence, and each candidate's status, cost and round count. How many report pairs run on the admitted tasks is the comparison report's call.
- **Licence.** The dataset is CC BY-NC 4.0. Tasks are fetched at run time from a pinned Hugging Face revision, checked against a pinned hash and cached outside the repository. Nothing from the dataset is committed, including the admission Runs' Journals, which quote the tasks. `subset.json` and the README carry the attribution.

Non-goal: the comparison report's EvoCode pairs. They are run and paid for by `comparison-report`, which calls the EvoCode Run this change builds.

## Capabilities

### New Capabilities

- `evocode-subset`: the pinned dataset, the EvoCode Run (rounds as Turns and Graded Tasks, a failed Turn ending the Run), admission and its cap, and the subset file.

### Modified Capabilities

- `benchmark-runs`: a Run of a Harbor task leaves the same record as a Workload Run, isolated the same way.

## Impact

- New `scripts/evocode.ts` (fetch, Harbor invocation, trial-to-record adapter, admission) and `scripts/harbor/omp_agent.py` (the Harbor installed agent). `scripts/runs.ts`: the Journal lookup takes a session root, so a Run can read Journals that were written outside `~/.omp`. `scripts/measures.ts`: `RunRecord` gains an optional `harbor` version.
- Spend:
  - admission, estimated at about $40 from the published runs of another agent (terminus-2 on Opus 4.8), capped at $60, stopping for the user at the cap;
  - a 2-round smoke Run per Arm on the cheapest candidate, a few dollars;
  - under $1 for a session-layout check.

  Docker image builds and Harbor's oracle check cost nothing.
- Harbor 0.24.0 runs through `uvx`, pinned, with no global install. Docker, `zstd` and the host's Postgres are needed. Neither Harbor nor the dataset becomes a dependency of pi-chart itself.
- New `bench/evocode/subset.json`. README: EvoCode Runs, admission and attribution.
