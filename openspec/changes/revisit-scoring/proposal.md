# Proposal: Revisit scoring

Triage: needs-triage
Blocked by: window-held-and-refetch

## Why

The `read-only-40` Workload reads something new every Turn, so Re-fetch rates come out near zero on both Arms whatever the window carries. Re-fetch measures something only when a Workload deliberately returns to earlier content at known distances. It must also score a direct answer from the window as fairly as a re-read.

Decisions: `context-need-measures/questions/10`.

## What Changes

- **Revisits declared in the Workload.** Each revisit point names:
  - the step that needs the content again;
  - the read-only overlay file it needs, such as a spec or a fixture table;
  - the earlier step that first read it.

  Validation rejects a revisit of a file the Workload edits, since re-reading an edited file returns new content and is not a Re-fetch.
- **Scored offline, the same way on both Arms.** Each revisit point is one of:
  - re-fetched while held: model redundancy;
  - re-fetched after it left the window: a recovered Lapse;
  - not re-fetched: answered from the window or from a recall Pull.
- Each point is tagged with where its source sat at that moment: tail, summary or evicted.
- **Correctness** comes from the step's check, so a direct answer and a re-read are both scored.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-runs`: Workloads declare revisit points, validated against the overlay.
- `measures`: revisit outcomes, source tags and correctness per Run.

## Impact

- `scripts/workload.ts`, `scripts/measures.ts`, `scripts/bench-tokens.ts`.
- Tests: Workload validation and revisit-scoring fixtures for all three outcomes on both Arms.
- The revisits themselves are authored in `gate-workload`. This slice proves the scoring on fixtures and `smoke`.
