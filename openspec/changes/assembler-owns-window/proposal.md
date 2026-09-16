# Proposal: Assembler owns the context window

Triage: needs-triage
Blocked by: None (can start immediately)

## What to build

The agent's Context Window stops accumulating. A loadable omp extension replaces the per-turn message array with a Context Pack it builds itself: the current prompt plus the last N Turns verbatim, taken from the incoming array. No Store exists yet; this slice proves the seam, establishes the project scaffold and test harness, and starts the measurement that every Budget decision later depends on.

omp's own memory backend is switched off (`memory.backend: off`) so only one system injects into the window. Per-turn token accounting is recorded, splitting the pack from the Floor, because the Floor was measured at roughly 30k tokens and no Budget can be set honestly without that ratio.

## Acceptance criteria

- [ ] A conversation can be held through the TUI with the extension loaded, and the agent behaves normally
- [ ] A Turn far outside the verbatim tail is provably invisible to the model, while the TUI transcript and the Journal still show it in full
- [ ] Pack size and Floor size are recorded per Turn and can be read back
- [ ] Two packs assembled from the same state are byte-identical
- [ ] The test harness runs without a database, a container, or a live model

## Non-goals

Planning artifacts for this change — delta specs, design, and tasks — are written by `/opsx-propose`. This file is the slice statement and its blocking edges only.
