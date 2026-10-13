# Proposal: The verbatim tail evicts to a low-water mark

Triage: needs-triage
Blocked by: None

## Why

From turn 8 of the 2026-10-13 benchmark, the cache stops paying: pi-chart wrote 38k and 47k tokens on turns 8 and 11 against vanilla's 5k, and its turn-12 cache read was exactly the 12,567-token Floor in all three runs. Each time the tail drops its oldest Turn, the head of the Pack changes, the leading run is empty (recorded `leading_tokens` 0 on turns 8–12 in every run), and the whole window is written fresh. Under the 25,000-token tail Budget the tail slid on almost every Turn from 8 on, often by two or three Turns at once.

## What Changes

- When the tail must drop Turns, it drops down to a lower mark rather than just below its Budget, so the next several Turns append to an unchanged head instead of sliding it every Turn. The cost is a smaller tail right after an eviction; the gain is a cached prefix on the Turns between evictions.
- Open for grilling: the mark (share of the Budget, or Turn count), whether it applies to the count Budget, the token Budget or both, determinism under ADR-0003, how `/pack` reports the slack, and whether it interacts with recall covering what eviction drops.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`: "Packs carry the prompt and a verbatim tail" and "Budgets bound each part of a pack" gain the eviction rule.

## Impact

- `src/assembler.ts` (`tailSelector`), `src/config.ts` (a setting for the mark, if configurable), `src/report.ts`.
- Re-measured with `scripts/bench-tokens.ts` on a workload long enough to evict more than once.
