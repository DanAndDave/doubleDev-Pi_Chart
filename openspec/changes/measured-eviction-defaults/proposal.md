# Proposal: The tail's eviction defaults are set from a measured sweep

Triage: ready-for-agent
Blocked by: None

## Why

Every Eviction moves the first message of the pack, so the next Call rewrites the cache from there. On the 40-Turn workload, pi-chart's cache write is 1.72× plain omp's (`docs/benchmarks/2026-10-14-token-usage-40-turns.md`). The low-water sweep in that write-up already found the default mark too high. 0.4 cost $3.93 against $4.09 and $4.14 at 0.6, and the two 0.6 runs put the noise at $0.05. No probe answer changed. The write-up deferred changing the default to a separate change, and this is that change.

The tail's size Budget (`PICHART_TAIL_TOKENS`, 25,000) sets how often the tail fills, so it also sets how often it evicts. It has never been measured. A larger Budget evicts less often but sends more on every Call. Only a sweep can say which effect wins, and the mark and the Budget have to be measured together because they interact.

## What Changes

- A sweep over tail size and low-water mark on the 40-Turn workload, pi-chart arm only, 3 runs per cell, all cells on one commit:
  - tail size: 25,000 tokens / 8 Turns, 40,000 / 13 and 60,000 / 19. The count Budget scales with the token Budget, so the count never becomes the Budget that triggers Eviction;
  - mark: 0.2, 0.4 and 0.6.
- The new defaults are the cell a decision rule picks, and the rule is fixed in `design.md` before the sweep runs.
- **BREAKING (defaults only)** `DEFAULT_TAIL_LOW_WATER` changes from 0.6 to 0.2. The sweep kept the tail size: `DEFAULT_TAIL_TOKENS` stays 25,000 and `DEFAULT_TAIL_TURNS` 8, now measured rather than assumed. An operator who sets these variables sees no difference. Any other operator sees each Conversation's tail start move once, as ADR-0013 says happens whenever a Budget or the mark changes.
- A dated amendment to ADR-0013 records the new defaults and points to the write-up. The rule itself does not change.
- README's settings table, the comments on the defaults in `src/config.ts` and the workload comment in `scripts/bench-tokens.ts` give the new numbers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`: "The verbatim tail evicts to a low-water mark" now names the new default mark. Its scenarios state their mark explicitly, so they no longer change with the default.

## Impact

- `src/config.ts`: `DEFAULT_TAIL_LOW_WATER`, and the comments on all three defaults.
- `test/extension.test.ts`: the low-water default test. `test/assembler.test.ts`: the eviction tests that rely on the fixture default mark (`test/fixtures.ts` uses `DEFAULT_TAIL_LOW_WATER`).
- `README.md`, `docs/adr/0013-…`, `scripts/bench-tokens.ts` (comment only).
- New write-up `docs/benchmarks/<date>-eviction-defaults.md`, with one raw JSON per cell and an SVG.
- Cost of the sweep: 27 Conversations of 40 Turns at about $4 each, roughly $110 at harness pricing [INFERENCE from the 2026-10-14 per-Conversation cost].
