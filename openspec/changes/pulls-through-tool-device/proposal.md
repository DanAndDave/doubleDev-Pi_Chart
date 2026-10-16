# Proposal: Pulls through the tool device

Triage: ready-for-agent
Blocked by: pulls-and-recall-lapses

## Why

omp can run any tool through its tool device: the agent writes the tool's arguments to `xd://<tool>`, and the Journal records the call as a `write` whose result details carry `xdev: { tool, mode: "execute", args, inner }`, with `inner` holding the tool's own details. pi-chart's agent makes its recall calls this way. `scripts/measures.ts` recognises a Pull only by the result's `toolName`, so it misses every one of them. On the `gate` v1 probe Runs it reported 0 `recall_earlier_turns` Pulls, where the Journals hold 6 and 8 (`bench/workloads/gate/README.md`, "Plants").

The Gate (`regression-gate`) tests Lapses per Run, and recall Pulls are the second way a Lapse is counted. Until this is fixed, a commit that made pi-chart recall more often, or recall worse, would show no change in Lapses.

## What Changes

- **A call made through the tool device counts as a call to the tool it ran.** This holds wherever the Measures recognise a tool by name:
  - Pull counts per tool, with their tokens;
  - the `write_documentation` count;
  - recall Pulls and their distances, read from the tool's own details;
  - a Plant answer's Pull source;
  - a Revisit's recall Pull;
  - the tool a Re-fetch names.
- **A device call that failed still counts** as a call to its tool, the way a failed direct call already counts as a Pull.
- **Reading a tool's documentation is not a call to that tool.** That covers a `read` of `xd://<tool>` and the device's help mode.
- **The Gate Workload's README** stops reporting the gap. Its Plant sources and recall Pull figures are recomputed from the v1 probe records.
- **`slices.md`** gains this change as slice 14. `regression-gate` becomes blocked by it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `measures`: a tool call made through omp's tool device counts as a call to the tool it ran.

## Impact

- `scripts/measures.ts`: one resolver from a tool result to the tool it ran and that tool's details, used at every place that now reads `toolName`.
- `test/fixtures/runs/`: device-form calls in the Pull, Plant and Revisit fixtures.
- `bench/workloads/gate/README.md`: corrected figures.
- `openspec/changes/context-need-measures/slices.md`, `openspec/changes/regression-gate/proposal.md`: the new blocking edge.
- No model spend, and no change to `src/`.
