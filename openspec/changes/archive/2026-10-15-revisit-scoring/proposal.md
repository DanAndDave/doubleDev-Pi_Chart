# Proposal: Revisit scoring

Triage: needs-triage
Blocked by: window-held-and-refetch

## Why

The `read-only-40` Workload reads something new every Turn, so Re-fetch rates come out near zero on both Arms whatever the window carries. Re-fetch measures something only when a Workload deliberately returns to earlier content at known distances. It must also score a direct answer from the window as fairly as a re-read.

Decisions: `context-need-measures/questions/10`.

## What Changes

- **Revisits declared in the Workload.** Each Revisit names:
  - the step that needs the content again, which must be a Graded Task;
  - the overlay file it needs, such as a spec or a fixture table;
  - the earlier step whose prompts first send the agent to it.
- **Edited files are recorded, then excluded.** Whether the agent edits a file cannot be checked before a Run. Instead, the benchmark records the first Turn after which each Revisit file stopped matching `overlay/`. A Revisit whose file changed by the end of its step is scored `edited` and counts in none of the three outcomes below.
- **Scored offline, the same way on both Arms.** The agent fetched the file again when a tool call in the step named its path. A ranged read counts; a search that never names the file does not. Each Revisit is one of:
  - fetched while held: model redundancy;
  - fetched after it left the window: a recovered Lapse, reported apart from the other Lapse counts;
  - not fetched: answered from the window or from a recall Pull.
- Each Revisit is tagged with where the earlier read sat at the step's first Call: tail, summary or evicted.
- **Correctness** comes from the step's check, so a direct answer and a fetch are both scored.
- **`smoke` becomes version 2**, carrying one Revisit, so the scoring is proved on a real Run on both Arms.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-runs`: Workloads declare Revisits, validated against steps, checks and the overlay. Records keep the Revisits and when each Revisit file was edited.
- `measures`: Revisit scores with class, position, distance, Pull and the step's outcome, reported per Arm.

## Impact

- `scripts/workload.ts`, `scripts/measures.ts`, `scripts/bench-tokens.ts`, `bench/workloads/smoke/`.
- Tests: Workload validation, and Revisit fixtures covering every class on both Arms.
- The Gate Workload's Revisits are authored in `gate-workload`. This slice proves the scoring on fixtures and on `smoke`.
