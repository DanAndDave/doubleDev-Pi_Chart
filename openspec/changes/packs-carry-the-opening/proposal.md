# Proposal: Packs carry the Conversation's Opening

Triage: needs-triage
Blocked by: None

## Why

The 2026-10-13 benchmark's memory check asked at turn 12 for a codeword given at turn 1. By then turn 1 was outside the verbatim tail, so only recall could carry it. Two runs carried it; one answered `UNKNOWN` because recall refused turn 1 at distance 0.545 against the 0.52 threshold. A Conversation's first prompt usually states its goal and constraints, and every later Turn is read against them, so whether the model sees it should not depend on how much it resembles the current question (ADR-0014).

## What Changes

- Every Context Pack carries the **Opening**: the prompt of the Conversation's first Turn (index 0), once neither the verbatim tail nor the Turn in progress carries that Turn. It holds the prompt only; the reply stays reachable through recall.
- The Opening is reference data. It sits in the Briefing after the marker, first among the reference parts, ahead of recalled Turns.
- It has its own Budget: 1 item and 1,000 tokens, set by `PICHART_OPENING_TOKENS` (0 turns it off) and by `/pack budget opening-tokens <n>` within a session. A longer prompt is shortened by Elision, not dropped for its Budget.
- Under the Ceiling it is reduced after recalled Turns and before the verbatim tail: structure → curated → recalled → Opening → tail.
- It is fetched by its own Thread Store query, run alongside the tail's under the tail's deadline. It is absent, with a reason, when the Turns already carry it, when the first prompt is empty, when the first Turn is no longer stored, when no Store is configured, when the query misses its deadline or fails, when its Budget is zero, and when the Ceiling leaves it no room.
- The Opening is always the Turn at index 0. The oldest remaining Turn never stands in for it, and it is never rebuilt from the harness's own history.
- `/pack` shows an `opening` line, and Accounting records it as its own part.
- Recall does not change. If recall also picks Turn 0, its prompt is sent twice.
- The benchmark's default workload gives a second fact at turn 3, and the turn-12 probe asks for both facts, scored separately. Probes are scored only in the default workload.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`: a new requirement for the Opening; the Briefing's order and the Ceiling's reduction order gain the Opening.
- `thread-store`: a new requirement that the store answers a Conversation's first prompt.
- `pack-inspection`: a new requirement that the Opening is examined like any other part, with its own reasons for being absent.

## Impact

- `src/assembler.ts`: new `opening` part, its absence causes, Briefing and reduction order.
- `src/thread-store.ts`, `src/postgres-store.ts`: a query for a Conversation's first prompt. No schema change: the `turns` table already holds the prompt by `turn_index`.
- `src/extension.ts`: fetch the Opening alongside the tail; no Store means unconfigured.
- `src/config.ts`: `PICHART_OPENING_TOKENS`, default 1,000; `opening-tokens` in-session Budget.
- `src/accounting.ts`, `src/inspection.ts`, `src/report.ts`: record and render the part and its absence reasons. Parts are stored as JSONB, so no migration.
- `scripts/bench-tokens.ts`: turn-3 fact, two-fact probe, probes only in the default workload.
- `README.md`: the new setting and Budget name.
