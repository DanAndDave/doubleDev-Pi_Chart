# Proposal: Thread Store ingests the Journal

Triage: needs-triage
Blocked by: assembler-owns-window

## What to build

Recall survives the session. Postgres with pgvector runs from a Compose file this project manages, and omp's append-only Journal is ingested into it: prompts, responses, tool calls, and artifacts, keyed by Conversation. The Assembler's verbatim tail now comes from the database instead of the incoming array, so it outlives `/clear`, resume, and restart.

Per ADR-0002 the Thread Store is a derived index. The Journal stays the record; the database is rebuildable from disk at any time.

## Acceptance criteria

- [ ] Turns, tool calls, and artifacts from a real session are queryable in Postgres, scoped by Conversation
- [ ] Dropping the database and re-ingesting from the Journal produces an identical pack
- [ ] The verbatim tail survives `/clear` and session resume
- [ ] Retrieval defaults to the current Conversation and never silently widens
- [ ] Storage sits behind an interface narrow enough that the suite runs without a container

## Non-goals

Planning artifacts for this change — delta specs, design, and tasks — are written by `/opsx-propose`. This file is the slice statement and its blocking edges only.
