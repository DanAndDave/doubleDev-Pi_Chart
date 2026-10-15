# Proposal: Plants and Retention

Triage: needs-triage
Blocked by: pulls-and-recall-lapses

## Why

Retention per Plant today scores the codeword and build-number Probe by substring match, with no record of distance, fact kind or where the answer came from. A right answer could come from the window, from a recall Pull, or from a leak, and a wrong one could be a Lapse or a misreading. This slice turns Plants into a controlled matrix and attributes every answer, which also gives the third Lapse route: a failed Probe.

Decisions: `context-need-measures/questions/07`, `14`.

## What Changes

- **Plant kinds** declared in the Workload:
  - **literal**: a fictional token;
  - **superseded**: a value later replaced, with the old value serving as the near-miss distractor;
  - **constraint**: a rule the agent must follow later, probed silently and checked by a deterministic rule.
- **Placement**: in a prompt, or in a tool result (an overlay file). A Workload validates that each Plant's value appears where it is declared.
- **Distance bands**: ≤ 5, 8–12 and ≥ 25 Turns between Plant and Probe. Each Probe is tagged with where its Plant sat when the Probe ran: Opening, Pin, tail or evicted.
- **Probes**:
  - direct Probes run with tools allowed, so they measure the window plus recall;
  - one tools-forbidden Probe at the end measures the window alone.
  
  Scoring is deterministic only, with no judge.
- **Attribution, offline from the per-Call window.** Each answered Plant gets a source and a result (right or wrong). Possible sources:
  - a window part (Opening, Pin, tail);
  - a recall Pull whose result contains the value;
  - a Re-fetch of the file holding it;
  - none.

  Right with no source is flagged as a leak. Wrong despite a source is reported apart from Lapses.
- **Third Lapse route**: a Plant that was evicted and not brought back, whose Probe failed.
- Retention is reported per Probe, by band and by part.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-runs`: the Workload's Plant declaration gains kind, placement, superseded value and constraint rule; validation covers them.
- `measures`: "Retention per Plant" gains bands, position tags, source × result attribution, leaks, and the failed-Probe Lapse route.

## Impact

- `scripts/workload.ts`, `scripts/measures.ts`, `scripts/bench-tokens.ts`.
- `bench/workloads/read-only-40/` and `smoke/`: their Plants must still load. `design.md` decides whether that is a default kind or a new Workload version.
- Tests: Workload validation cases and attribution fixtures, including a leak.
