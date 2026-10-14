# Proposal: The verbatim tail evicts to a low-water mark

Triage: ready-for-agent
Blocked by: None

## Why

The verbatim tail keeps as many of the newest Turns as its Budget allows, so every Turn that pushes it over the Budget moves its start forward. Each move changes the first message after the Briefing, and the whole tail is written to the cache again. In the 12-Turn benchmark (`docs/benchmarks/2026-10-13-token-usage-parts-follow-turn.json`) the start moved 5 times per run, and a simulation over the measured Turn sizes put the tail's rewritten tokens at 110k–133k per run. Moving the start also drops the model's thinking after it (ADR-0011).

## What Changes

- The tail gives up its oldest Turns only by **Eviction** (ADR-0013). Between Evictions its start does not move and each new Turn is added behind it. When a new Turn would carry the tail past its token Budget or its count Budget, the oldest Turns are dropped in one step until both are at or under the low-water mark: a share of each Budget, 0.6 by default, rounded down and never below 1 Turn for the count.
- The start is replayed on every Call from the size of every completed Turn, from the Conversation's first held Turn to its newest. It is never stored, so two Packs built from the same Conversation and configuration are identical (ADR-0003).
- Each Turn's size is measured at ingest, on the Turn as the tail carries it, and stored on its `turns` row. A Turn the Store has not ingested yet, and the whole tail on the harness fallback, are sized from the live history. Rows stored before the column exist are sized from their messages when read.
- A new setting, `PICHART_TAIL_LOW_WATER` (share in (0, 1], default 0.6). A mark of 1 gives back the current sliding behaviour.
- An evicted Turn is eligible for recall again, and is recorded in Accounting as excluded by Eviction rather than by a Budget, so `/pack` and `pack why` don't blame a Budget the tail is well under.

Simulated over the benchmark's Turn sizes, the tail carries about 10% fewer tokens across a run and rewrites about 30% fewer (79k–89k). The trade is deliberate.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`: "Packs carry the prompt and an unsplit verbatim tail" no longer carries the most recent N Turns, but at most N from the tail's start; a new requirement states the Eviction rule, its replay, recall of evicted Turns, and that the Ceiling does not move the start.
- `pack-accounting`: "Accounting records what a call did not carry" gains Eviction as a reason a candidate was excluded.
- `pack-inspection`: "An absence can be explained by name" attributes an evicted Turn to Eviction.

## Impact

- `src/assembler.ts`: the tail's start from replayed sizes; the tail selector and recall eligibility use it; an `evicted` exclusion reason; a shared Turn-size function.
- `src/thread-store.ts`, `src/postgres-store.ts`: a `tail_tokens` column (migration 23), written at ingest; a `turnSizes` read on `TurnSource`.
- `src/extension.ts` (`tailFor`): fetches sizes beside the tail, adds sizes for Turns not yet stored.
- `src/config.ts`, `README.md`: `PICHART_TAIL_LOW_WATER`.
- `src/report.ts`, `src/inspection.ts`: render the `evicted` reason and count.
- Acceptance: `bun scripts/bench-tokens.ts --turns 12 --runs 3` against the 2026-10-13 parts-follow-turn run. Cache write on turns 8–12 falls by roughly the simulated 30%, prefix held rises, and the codeword probe and blind quality do not get worse.
