# Token usage after `tail-evicts-to-low-water` — 2026-10-13

With the verbatim tail evicting to a low-water mark of 0.6 (ADR-0013), pi-chart's cache write on turns 8–12 falls **49%**: 31,394 tokens against 61,529 in the parts-follow-turn run. Prefix held on those turns rises from 67% to 82%. The codeword probe went from 1/3 to 3/3, and blind quality on turns 8–11 did not get worse.

- Commit: `e019c04` plus this change's working tree
- Harness: omp 18.10.4, default model and thinking level
- Workload: the default 12 turns, `--runs 3 --parallel 6`, both arms
- Raw figures: `2026-10-13-token-usage-tail-evicts.json` (mark 0.6); `2026-10-13-token-usage-tail-slides.json` (the same tree with `PICHART_TAIL_LOW_WATER=1`)
- Before: `2026-10-13-token-usage-parts-follow-turn.md`

The baseline predates two other changes (ADR-0011 kept Briefings in place, ADR-0012 kept the newest tail Turn under the ceiling). Both are on turns 1–7 too, so prefix held there rose from 63% to 94% for reasons other than this change. The **slide** control isolates this change: it runs the same tree with the mark at 1, which reproduces the old sliding tail.

## Gate

pi-chart arm, medians over 3 runs of per-Conversation sums over turns 8–12. Subagent Calls are excluded.

| Figure | Baseline | Slide (mark 1) | Evict (mark 0.6) | Gate | Result |
| --- | ---: | ---: | ---: | --- | --- |
| Cache write | 61,529 | 62,504 | 31,394 | falls ~30% | pass (−49% vs baseline, −50% vs slide) |
| Prefix held | 67% | 67% | 82% | rises | pass |
| Codeword probe | 1/3 | 3/3 | 3/3 | not worse | pass |
| Blind quality | — | — | see below | not worse | pass |

Median cache write by turn, pi-chart:

| Turn | Baseline | Slide | Evict |
| ---: | ---: | ---: | ---: |
| 8 | 18,328 | 18,624 | 4,113 |
| 9 | 20,181 | 16,990 | 13,011 |
| 10 | 15,911 | 14,459 | 4,847 |
| 11 | 4,648 | 13,926 | 9,670 |
| 12 | 0 | 0 | 0 |

Turns 8, 10 and 11 fall because the tail's start holds, so the cache read covers every finished Turn back to the start. Turn 9 is where the default count Budget (8 Turns) evicts down to 4, and that Call writes a new prefix. Where that write lands depends on how large each Turn is, so per-turn medians are noisy across runs.

## Per Conversation, mark 0.6 (median over runs)

| Metric | vanilla | pi-chart | pi-chart / vanilla |
| --- | ---: | ---: | ---: |
| Calls | 33 | 31 | 0.94× |
| Prompt tokens sent | 1,135,202 | 916,075 | 0.81× |
| Uncached input | 90 | 149,621 | 1662× |
| Cache read | 1,076,055 | 686,441 | 0.64× |
| Cache write | 59,057 | 74,012 | 1.25× |
| Output | 8,976 | 10,022 | 1.12× |
| Effective input | 181,517 | 313,443 | 1.73× |
| Cost, USD | $0.8675 | $1.5357 | 1.77× |
| Peak window, tokens | 59,061 | 39,430 | 0.67× |

Over the whole Conversation, cache write is 2.30× vanilla in the baseline, 2.00× in slide and 1.25× in evict. The Store bills the Call after an eviction at the uncached rate, which is why uncached input stays high. That is the cost ADR-0013 accepts in exchange for not rewriting every Turn after it.

## Blind quality, turns 8–11

Same method as the `pack-parts-follow-the-turn` quality check. Each Turn's final answer from the baseline pi-chart run and from this run went to the default model blind, as X/Y in seeded random order. The model was given the files each prompt names, as of `e019c04`, as ground truth. Turn 12 is the probe and is scored above.

| Turn | Prompt reads | Correct (before / after) | Better: before / tie / after |
| ---: | --- | :-: | :-: |
| 8 | `src/report.ts` | 0/3 / 3/3 | 0 / 0 / 3 |
| 9 | `src/journal.ts` | 3/3 / 3/3 | 0 / 2 / 1 |
| 10 | `src/turns.ts`, `src/thread-store.ts` | 3/3 / 3/3 | 2 / 0 / 1 |
| 11 | `src/accounting.ts` | 3/3 / 3/3 | 0 / 0 / 3 |

No answer was correct before and wrong after. Turn 8's "before" answers predate the Briefing section in `report.ts`, which landed with ADR-0011, so that row measures source drift, not this change. Without it, turns 9–11 come to 2 before, 2 tie, 5 after. The sample is 12 pairs, and nothing is claimed beyond that.

## Limits

- One model, one workload, 3 runs per arm.
- A Conversation of 12 Turns evicts once under the count Budget. Longer Conversations, and Turns large enough to hit the token Budget, were not benchmarked here; the replay test in `test/assembler.test.ts` covers both mechanically.
