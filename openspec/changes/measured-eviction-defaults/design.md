## Context

- The eviction rule (ADR-0013, `tailStart` in `src/assembler.ts`) evicts when a completed Turn carries the tail past either Budget. It then drops down to the mark on both Budgets. Defaults in `src/config.ts`: `DEFAULT_TAIL_TOKENS = 25_000`, `DEFAULT_TAIL_TURNS = 8`, `DEFAULT_TAIL_LOW_WATER = 0.6`. Each is read from `PICHART_TAIL_TOKENS`, `PICHART_TAIL_TURNS` and `PICHART_TAIL_LOW_WATER`.
- `scripts/bench-tokens.ts --arm pi-chart` runs one arm alone and passes the environment through to omp. That is how the 2026-10-14 low-water sweep was run. `--report <file>` prints medians per arm. On a single-arm file the pi-chart column is complete and the vanilla column is empty.
- Measured so far, on the 40-Turn workload at 25,000 / 8 Turns: mark 0.4 cost $3.93, 0.6 cost $4.09 and $4.14 (two runs), 0.8 cost $4.92. The build number was 0/3 at every mark and the codeword 3/3.
- The workload's Turns are about 3,000 tokens each [INFERENCE]. Over turns 1–7, pi-chart's window grows from 15.6k to 35.8k against a Floor of 12.6k. At that size, 8 Turns come to about 25,000 tokens, so the count and token Budgets fill at about the same Turn.

## Goals / Non-Goals

**Goals:**
- Change the three defaults to the cheapest measured cell, chosen by a rule fixed before the sweep runs.
- Write up the sweep so that every table row can be reproduced from a committed raw file.

**Non-Goals:**
- Changing the eviction rule, the replay or the rounding of the count mark.
- Getting the build number back. It leaves even a 60,000-token tail long before turn 40, and the probe forbids tools. That is a recall problem, outside this change.
- Explaining pi-chart's 1.06× output (option 6). Read calls per Conversation are reported, but only as context.
- Changing `scripts/bench-tokens.ts` beyond its comment.

## Decisions

### 1. The count Budget scales with the token Budget

| Cell | `PICHART_TAIL_TOKENS` | `PICHART_TAIL_TURNS` |
| --- | ---: | ---: |
| small (current) | 25,000 | 8 |
| medium | 40,000 | 13 |
| large | 60,000 | 19 |

The count is the token Budget ÷ ~3,100, the workload's Turn size. If only the token Budget were raised, the count of 8 would fill first at about 25,000 tokens and trigger every Eviction. The 40k and 60k cells would then measure the current tail again.

Rejected: an unbounded count. That removes a Budget the spec and README document, which is a different decision from tuning numbers.

### 2. Marks 0.2, 0.4 and 0.6

0.4 was the cheapest of the marks measured, and it was also the lowest one swept, so the optimum may be below it. 0.6 is the current default and the baseline. 0.8 was already measured as the most expensive and is not run again. At 0.2 the count mark is ⌊8 × 0.2⌋ = 1 Turn at the small size, which the rule already allows.

### 3. All 9 cells run on one commit

Each cell is 3 runs, `--arm pi-chart --parallel 3`, written to `docs/benchmarks/<date>-eviction-defaults-<tokens>-<mark>.json`. The 2026-10-14 files are not reused. `src/` may have changed since `af9c30d`, and same-commit runs are the only comparison with a known noise floor.

### 4. Decision rule, fixed before the sweep

1. A cell is eligible only if the codeword is 3/3. The Opening must still survive.
2. Find the eligible cell with the lowest median cost.
3. Any eligible cell within $0.10 of that cost counts as tied. $0.10 is twice the $0.05 gap between the two 0.6 runs on 2026-10-14.
4. Among tied cells, take the smallest tail size first, then the highest mark. That cell sends the least per Call and stays closest to the current defaults.

The chosen cell's tokens, turns and mark become the defaults.

- If the chosen mark is not 0.4, revise the delta spec with `/opsx-update` before any code changes. The delta names the default, and its "The default mark" scenario gives the mark × 25,000.
- If the chosen cell is small/0.6, the current defaults, no default changes. Remove the delta, set `skip_specs: true`, and ship only the write-up.

### 5. Spec scenarios name their mark

The eviction scenarios used "the default mark", so their numbers changed whenever the default did. They now say "a mark of 0.6". One new scenario, "The default mark", pins the default. Tests follow the same split: the eviction-rule tests pass `tailLowWater: 0.6` explicitly, and one test covers the default.

### 6. ADR-0013 is amended, not superseded

A dated paragraph at the top of ADR-0013 gives the new defaults and links the write-up. Its line "0.6 by default" and its consequence "Tuning the mark needs a workload with smaller Turns" are left as history. Rejected: a new ADR. Defaults are cheap to reverse and the decision has no new trade-off, so it doesn't meet the bar for an ADR.

## Risks / Trade-offs

- **[Risk]** The workload cannot measure quality. The codeword arrives through the Opening and the build number is lost in every cell. A cell could therefore drop context the model needed without the result showing it. → Read calls per Conversation are reported. A low mark that leads to re-reading evicted files shows up there, and in output tokens and cost.
- **[Risk]** A larger tail costs more on every Call, and only on short Conversations, where Evictions are rare. → Peak window and cost are reported per cell. The rule chooses on cost over 40 Turns, the workload ADR-0015 measures against.
- **[Risk]** Turn size is inferred, not measured. If real Turns are larger, the count may still never fill at the large size. → Either way the token Budget then triggers Eviction, which is the intent. The write-up states the inference.
- **[Trade-off]** Defaults tuned on one read-heavy workload over pi-chart's own source. → Operators keep all three variables. README states which workload the defaults came from.
- **[Cost]** 27 Conversations at about $4 each, roughly $110, and several hours at `--parallel 3` [INFERENCE].

## Migration Plan

An operator who sets the variables sees no change. Any other operator's Conversations move their tail start once on the first Call after upgrading, a one-time cache rewrite (ADR-0013). Rollback: set the old values through the environment, or revert the constants.

## Testing seams

| Requirement / scenario | Seam |
| --- | --- |
| Eviction drops to the mark in one step (mark 0.6) | `assemble()` with `budgets({tailTurns: 8, tailTokens: 25_000, tailLowWater: 0.6})` (`test/assembler.test.ts`) |
| The count budget evicts to its mark (mark 0.6) | same seam, explicit `tailLowWater: 0.6` |
| The default mark | `assemble()` with `assemblerConfig(loadConfig({PICHART_TAIL_TOKENS: "25000"}))`, no mark set, and a tail that crosses 25,000 tokens. The tail ends at or under the default mark × 25,000 |
| Mark out of range falls back to the default | `loadConfig` (`test/extension.test.ts`, the existing low-water block) |
| Chosen defaults are cheaper | the sweep itself, not a test: `bun scripts/bench-tokens.ts --report <cell>.json` per cell |
