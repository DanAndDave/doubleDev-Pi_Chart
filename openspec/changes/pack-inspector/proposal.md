# Proposal: Pack inspector and Budget tuning

Triage: needs-triage
Blocked by: thread-store-recall, graph-store, doc-store-recall

## What to build

A bad pack becomes diagnosable. An overlay shows the current Context Pack broken down by Store against its Budget, alongside the Floor, and two packs can be diffed. This is what turns the deferred question of how much the Floor actually costs into evidence, and what makes Budget tuning a measurement instead of a guess.

## Acceptance criteria

- [ ] The current pack is inspectable live, itemised by Store, with each Store's share against its Budget
- [ ] The Floor is shown alongside the pack so their ratio is visible
- [ ] Two packs can be diffed to show exactly what entered and what was dropped
- [ ] Budgets can be changed and the effect observed without restarting the session
- [ ] Recorded token accounting over a real session answers whether the Floor is worth addressing

## Non-goals

Planning artifacts for this change — delta specs, design, and tasks — are written by `/opsx-propose`. This file is the slice statement and its blocking edges only.
