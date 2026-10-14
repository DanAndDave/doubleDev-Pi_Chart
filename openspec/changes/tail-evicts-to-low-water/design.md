## Context

See proposal.md (Why) and ADR-0013 for the rule. Current code:

- `tailSelector` (`src/assembler.ts`) slices `completed.slice(-count)`, then `fitTail` keeps whole Turns newest-first under the token Budget, shrinking the newest via `shrinkTurn` when none fits whole. Turns beyond the count are recorded as excluded with reason `count`, Turns `fitTail` gave up as `size`.
- Recall eligibility (`eligibleRecollections`) is computed against `inTail = completed.slice(-count)`, before the tail is selected.
- `tailFor` (`src/extension.ts`) reads `recentTurns(conversationId, tailTurns)` under `tailDeadlineMs`, appends live Turns newer than the Store's newest, and falls back to the live history when the Store is absent, empty, late or failing.
- `turns` rows are written by `ingest` with an upsert (`src/postgres-store.ts`); the highest Turn can be re-ingested as it grows. The last migration is version 22. `MemoryTurnSource` (`src/thread-store.ts`) is the in-process `TurnSource` used by tests and the no-store path.
- `approximateTokens` is the serialised length over four, so key order does not change a size.
- `ExclusionReason` is `irrelevant | count | size | ceiling`; `PartExclusion` counts each; `src/report.ts` renders both.

## Goals / Non-Goals

**Goals:**
- One pure function owns "where the tail starts", and `assemble()` is the only caller.
- The start is identical in every process that assembles the same Conversation under the same configuration.

**Non-Goals:**
- The newest-Turn shrink (ADR-0012) and the ceiling's reduction order: unchanged.
- Briefing placement: an evicted Turn's Briefings already leave with their messages.
- Tuning the default mark: the benchmark cannot tell 0.5–0.7 apart (ADR-0013).

## Decisions

### The start is replayed inside `assemble()`

`AssembleInput` gains `tailSizes?: { index: number; tokens: number }[]`: every completed Turn the Conversation holds, oldest first. A new pure function `tailStart(sizes, budget, mark)` returns the index of the first Turn the tail carries:

```
start = 0, tokens = 0
for i in 0..n-1:
  tokens += size[i]
  if tokens > budget.tokens or (i - start + 1) > budget.count:
    while start < i and (tokens > markTokens or (i - start + 1) > markCount):
      tokens -= size[start]; start++
```

`markTokens = floor(mark × budget.tokens)`, `markCount = max(1, floor(mark × budget.count))`. `start < i` is what keeps the Turn just completed. A count or token Budget of 0 still disables the tail before this runs.

When `tailSizes` is absent, sizes are taken from the completed Turns passed in. That covers the harness fallback and every existing test without a second path.

The tail is then the completed Turns with `index >= start`, and `fitTail` runs over them unchanged. By construction they fit both Budgets, so `fitTail` only acts on a newest Turn larger than the Budget (shrunk) or on a Store-versus-live size difference (a safety net, not a policy). Recall eligibility uses the same Turns, so an evicted Turn is recallable and a carried one is not.

Alternatives: compute the start in `tailFor` and pass only the Turns from it. Rejected: it splits the policy across the extension and the Assembler, and the determinism test would need the extension.

### A Turn's size is one function

`tailTokens(turn) = approximateTokens(paired(turn).messages)`, exported from `src/assembler.ts`. Ingest, `MemoryTurnSource`, `tailFor` and the fallback all call it, so a Turn has one size wherever it is measured.

### Sizes live on `turns`

- Migration 23: `ALTER TABLE turns ADD COLUMN IF NOT EXISTS tail_tokens INTEGER`.
- `ingest` writes `tail_tokens` in the insert and in `DO UPDATE`, so a re-ingested head Turn gets its new size.
- `TurnSource` gains `turnSizes(conversationId): Promise<{ index: number; tokens: number }[]>`, ordered by `turn_index`. One indexed read of two integer columns.
- Rows with a null `tail_tokens` (ingested before migration 23) are sized from their messages on that read, and the size is written back, so each old row is read in full once rather than on every Call. No backfill migration (ADR-0013).
- `MemoryTurnSource` computes sizes at ingest.

### `tailFor` returns sizes beside the tail

`tailFor` runs `recentTurns` and `turnSizes` together under the tail deadline. It appends live sizes for Turns newer than the Store's newest, the same Turns it already appends to the tail. Either read failing or missing the deadline is the existing fallback, with `tailSizes` absent. `recentTurns(tailTurns)` still fetches enough, because the start is never further back than `count` Turns.

### Configuration

`tailLowWater` on `Config` and `AssemblerConfig`, read by the existing `share()` parser from `PICHART_TAIL_LOW_WATER` (default `DEFAULT_TAIL_LOW_WATER = 0.6`), added to the known-variable list and the README table. Not a `pack budget` name: it is a share of the Budgets, not a Budget.

### Eviction as an exclusion reason

`ExclusionReason` gains `evicted`; `PartExclusion` gains `evicted?: number`. Turns before the start that the tail was offered are recorded with `reason: "evicted"`, replacing the `count` exclusions the tail recorded for Turns beyond its count. `REASONS` in `src/report.ts` gains `${n} evicted`; the why line reads `evicted from the tail`. Parts are JSONB, so older records read back with the old reasons and no migration.

## Risks / Trade-offs

- [The newest Turn is sized live while the Store lags, then from the Store once ingested] → Both use `tailTokens` over the same messages; length is key-order independent. A difference would move the start once. Accepted.
- [The harness fallback replays from the first Turn the live history still holds, which after a harness compaction is not the Store's first] → The fallback is already a worse Pack and is recorded as such. Accepted.
- [Retention deletes the oldest Turns, or a Budget or mark changes] → The start moves once (ADR-0013 consequence).
- [The first Call on an old Conversation reads every pre-migration Turn's messages] → Bounded by the tail deadline; a late read falls back and the next Call retries with whatever sizes were written back.
- [Tests that pinned sliding by count now see eviction] → Updated where they assert the sliding behaviour; tests meaning "the newest N" set the mark to 1.

## Migration Plan

Migration 23 is additive. Rollback: `PICHART_TAIL_LOW_WATER=1` restores the sliding tail without a code change; the column is ignored by older code.

## Testing seams

| Requirement | Seam |
| --- | --- |
| The verbatim tail evicts to a low-water mark: holds, drops to the mark, count mark, newest alone, mark of one, recall of evicted / not of carried, ceiling does not move the start | `assemble()` in `test/assembler.test.ts`, asserting the tail part's `turnIndices` and the recall part's. The "same however reached" scenario assembles a Conversation Call by Call and then once from scratch with the same `tailSizes`, and compares the starts. |
| Sizes are stored and read back; old rows sized and written back | `test/ingest-store.test.ts` against the store (PGlite), through `ingest` and `turnSizes`. |
| `tailFor` merges stored and live sizes; failures fall back | One test in `test/extension.test.ts` with a `MemoryTurnSource` that lags by a Turn, asserting the recorded tail's `turnIndices`. |
| Packs carry … at most N from the start | Existing `assemble()` tail tests, updated. |
| Accounting records evicted Turns; an absence is attributed to Eviction | `assemble()` for the recorded `excludedCandidates` and `excluded.evicted`; `test/report.test.ts` and `test/explain.test.ts` for the rendering. |

Acceptance beyond the tests: `bun scripts/bench-tokens.ts --turns 12 --runs 3 --parallel 6` against `docs/benchmarks/2026-10-13-token-usage-parts-follow-turn.json`.
