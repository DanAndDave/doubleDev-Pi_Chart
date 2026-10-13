# Proposal: Recall reaches the start of a Conversation

Triage: needs-triage
Blocked by: None

## Why

The 2026-10-13 benchmark's memory check asked at turn 12 for a codeword given at turn 1. By then turn 1 was outside the tail, so only recall could carry it. Two runs carried it at turn 12; one answered `UNKNOWN` because recall refused turn 1 at distance 0.545 against the 0.52 threshold (`DEFAULT_RECALL_MAX_DISTANCE`) — it ranked fifth of eleven candidates, all refused. The turn-1 prompt mixed the codeword with an unrelated file-reading task, and the Turn is embedded whole, so the codeword is a small share of what its vector means.

## What Changes

- Make a question about something said early in a Conversation recall the Turn that said it, without carrying irrelevant Turns.
- Open for grilling: whether the fix is in the threshold, in how a Turn is embedded (per message or per prompt rather than whole), in the query (the prompt alone vs. the Turn), or in a rule for Turns outside the tail; what evidence decides it (the benchmark Conversations are in the Thread Store); and how the false-recall rate is measured alongside the hit rate.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `thread-store` and/or `context-assembly` ("Packs carry recalled turns under their own budget"), depending on where the fix lands.

## Impact

- `src/thread-store.ts` / `src/postgres-store.ts` (embedding, search), `src/config.ts` (threshold), possibly a re-embed migration.
