# Revisiting workload

Type: grilling
Status: closed
Blocked by: 06-task-suite-source

## Question

Which workload makes re-fetch measurable? It needs Turns that return to files, commands and facts from earlier Turns, at known distances. Does the chosen task suite already provide that, or does the bench need a second workload? If it needs one, how is it built so that a re-fetch on one arm and a direct answer on the other are both scored?

## What's known

- `DEFAULT_WORKLOAD` is built so that "each turn reads something new" (`scripts/bench-tokens.ts:55`). On it, re-fetch rates come out near zero for both arms, whatever the window carries.

## Resolution

- **No second Workload.** Revisits are built into the Gate Workload: about 6 steps that need an earlier tool result again, placed in the Plant distance bands (≤ 5, 8–12, ≥ 25 Turns).
- **What is revisited:** read-only overlay files (a spec, a fixture table) the agent never edits, so a second read returns an identical result and counts as a Re-fetch. Edited files are excluded: re-reading them returns new content, which is not a Re-fetch.
- **Scoring, offline from the per-Call window, identical on both Arms.** Each revisit point is one of:
  - re-fetched while still held: model redundancy, counted apart;
  - re-fetched after it left the window: a recovered Lapse;
  - not re-fetched: answered from the window or from a recall Pull.
- **Correctness** comes from the step's check, so a direct answer and a re-read are both scored. Each point is tagged with where its source sat at that moment: tail, summary or evicted.
