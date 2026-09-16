# Proposal: Cross-Conversation retrieval

Triage: needs-triage
Blocked by: thread-store-recall

## What to build

Knowledge crosses Conversations, but only when asked. Retrieval can reach into other Conversations and other Codebases explicitly; the default scope stays the current Conversation and never widens on its own.

## Acceptance criteria

- [ ] An explicit cross-Conversation query recalls work from a different Conversation and Codebase
- [ ] Default retrieval remains scoped to the current Conversation with no cross-Conversation results
- [ ] Results carry their originating Conversation and Codebase
- [ ] Cross-Conversation results are budgeted separately from same-Conversation recall

## Non-goals

Planning artifacts for this change — delta specs, design, and tasks — are written by `/opsx-propose`. This file is the slice statement and its blocking edges only.
