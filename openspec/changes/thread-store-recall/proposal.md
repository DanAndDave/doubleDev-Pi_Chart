# Proposal: Thread Store semantic recall

Triage: needs-triage
Blocked by: thread-store-ingest

## What to build

The agent remembers things that fell out of the verbatim tail. Ingested Turns are embedded, the current prompt retrieves the most relevant of them, and they enter the pack under the Thread Store's own Budget — separate from, and tunable against, every other Store.

## Acceptance criteria

- [ ] A decision made far outside the verbatim tail is recalled correctly when the prompt refers to it
- [ ] Retrieved Turns are attributed to their Conversation and position, not presented as the present moment
- [ ] The Thread Store's Budget is enforced: exceeding it drops the weakest matches, never the verbatim tail
- [ ] Embedding backfill over an existing Journal is resumable
- [ ] Retrieval quality is exercised by tests that would fail if ranking regressed to arbitrary order

## Non-goals

Planning artifacts for this change — delta specs, design, and tasks — are written by `/opsx-propose`. This file is the slice statement and its blocking edges only.
