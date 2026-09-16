# Proposal: Doc Store retrieval

Triage: needs-triage
Blocked by: doc-store-bundle

## What to build

Curated knowledge reaches the agent in whatever Codebase it is working in. Concepts are chunked and embedded — the format defines neither, so both are ours — indexed separately from the Thread Store, and retrieved into the pack under their own Budget.

## Acceptance criteria

- [ ] A Concept authored once is retrieved into a pack while working in an unrelated Codebase
- [ ] Doc Store and Thread Store Budgets are independent and separately enforced
- [ ] Re-indexing after a Concept is edited is incremental, not a full rebuild
- [ ] Retrieval prefers current, human-reviewed Concepts over stale or unverified ones
- [ ] A deprecated Concept is not retrieved unless explicitly asked for

## Non-goals

Planning artifacts for this change — delta specs, design, and tasks — are written by `/opsx-propose`. This file is the slice statement and its blocking edges only.
