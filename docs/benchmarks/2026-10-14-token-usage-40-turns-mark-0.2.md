# Token usage over 40 Turns at the 0.2 default mark — 2026-10-14

With the default low-water mark at 0.2, pi-chart costs **0.77× plain omp** on the 40-Turn workload: **$3.7710** against **$4.8895** per Conversation. At 0.6 it cost 0.84× ($4.1397 against $4.9516, [after `af9c30d`](2026-10-14-token-usage-40-turns.md)). pi-chart's cost falls 9%. Cache write falls from 329,206 to 293,591 tokens. This run matches the sweep's 25,000 / 8 / 0.2 cell ($3.7343, [eviction defaults](2026-10-14-eviction-defaults.md)) to within 1%. The probe is unchanged: the codeword comes back 3/3, the build number 0/3.

- Commit: `c6fe516` (Archive measured-eviction-defaults), clean tree, no `PICHART_TAIL_*` overrides
- Harness: omp 18.10.4, default model and thinking level
- Workload: `DEFAULT_WORKLOAD` in `scripts/bench-tokens.ts`, 40 Turns of read-only work over pi-chart's own source; turn 40 is the probe
- Run: `bun scripts/bench-tokens.ts --runs 3 --parallel 6 --out docs/benchmarks/2026-10-14-token-usage-40-turns-mark-0.2.json`, 804 s, 3/3 complete runs per arm
- Reproduce the tables: `bun scripts/bench-tokens.ts --report docs/benchmarks/2026-10-14-token-usage-40-turns-mark-0.2.json`

## pi-chart against plain omp

Per Conversation, median over 3 runs per arm:

| Metric | vanilla | pi-chart | pi-chart / vanilla |
| --- | ---: | ---: | ---: |
| Calls | 129 | 125 | 0.97× |
| Prompt tokens sent (input + cache read + cache write) | 12,948,030 | 3,430,149 | 0.26× |
| Uncached input | 338 | 330 | 0.98× |
| Cache read | 12,761,785 | 3,136,220 | 0.25× |
| Cache write | 185,088 | 293,591 | 1.59× |
| Output | 41,554 | 39,518 | 0.95× |
| Effective input (read ×0.1, write ×1.25) | 1,508,900 | 680,949 | 0.45× |
| Cost, USD (harness pricing) | $4.8895 | $3.7710 | 0.77× |
| Peak window, tokens | 192,469 | 40,487 | 0.21× |
| Floor, tokens | 12,101 | 12,642 | 1.04× |
| Cache write, turns 1–7 | 32,861 | 30,443 | 0.93× |
| Prefix held, turns 1–7 (next Call read all the last read or wrote) | 100% | 95% | 0.95× |

Codeword recalled at the probe: vanilla 3/3, pi-chart 3/3.
Build number recalled at the probe: vanilla 3/3, pi-chart 0/3.

pi-chart's three runs cost $3.5472, $3.7710 and $3.7869.

## Against the 0.6 mark

pi-chart / vanilla on the two 40-Turn runs, each against its own vanilla arm:

| Run | Commit | Mark | pi-chart cost | vanilla cost | Ratio | pi-chart cache write | Peak window | Prefix held, turns 1–7 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [after](2026-10-14-token-usage-40-turns.md) | `af9c30d` | 0.6 | $4.1397 | $4.9516 | 0.84× | 329,206 | 39,683 | 100% |
| this run | `c6fe516` | 0.2 | $3.7710 | $4.8895 | 0.77× | 293,591 | 40,487 | 95% |

Vanilla's cost moved by 1.3% between the runs, so pi-chart's 9% drop comes from the mark and not from run-to-run drift.

Prefix held over turns 1–7 falls from 100% to 95% because the first Eviction now lands inside that window. pi-chart's window falls from 31,426 tokens at turn 5 to 17,253 at turn 6, and the Call after an Eviction writes the cache from the tail's new start. After that, each Eviction drops the tail further, so Evictions come less often. Over the run the window falls by more than 20% at turns 6, 9, 13, 18, 21, 25, 29, 32 and 39.

## The probe and the tools

The build number, given at turn 3, is evicted at turn 6 and comes back 0/3. All three runs answered `UNKNOWN`, as they did at 0.6. The probe ends "Do not use any tools", so it measures only what is in the window.

Across the pi-chart arm the model made 208 `read` and 78 `grep` calls. It called none of `recall_earlier_turns`, `search_documentation` or `codebase_structure`. The vanilla arm made 226 `read`, 74 `grep` and 1 `bash` call.

## Window size per turn

Median prompt tokens of each turn's last Call.

| Turn | vanilla | pi-chart |
| ---: | ---: | ---: |
| 1 | 15,203 | 15,734 |
| 2 | 19,302 | 19,803 |
| 3 | 27,380 | 27,904 |
| 4 | 28,307 | 28,901 |
| 5 | 30,678 | 31,426 |
| 6 | 32,071 | 17,253 |
| 7 | 40,240 | 24,571 |
| 8 | 46,613 | 31,084 |
| 9 | 48,638 | 21,786 |
| 10 | 56,175 | 28,936 |
| 11 | 59,627 | 30,396 |
| 12 | 64,918 | 33,863 |
| 13 | 70,502 | 27,029 |
| 14 | 77,825 | 39,661 |
| 15 | 82,441 | 33,256 |
| 16 | 88,016 | 28,379 |
| 17 | 92,095 | 35,087 |
| 18 | 94,588 | 27,789 |
| 19 | 105,207 | 40,487 |
| 20 | 115,018 | 36,514 |
| 21 | 117,903 | 25,840 |
| 22 | 119,632 | 27,311 |
| 23 | 123,949 | 31,103 |
| 24 | 126,647 | 33,181 |
| 25 | 131,131 | 21,821 |
| 26 | 135,543 | 22,762 |
| 27 | 141,773 | 29,348 |
| 28 | 150,290 | 34,707 |
| 29 | 153,748 | 23,884 |
| 30 | 160,348 | 28,871 |
| 31 | 166,921 | 34,592 |
| 32 | 169,456 | 21,428 |
| 33 | 170,826 | 22,944 |
| 34 | 173,200 | 24,200 |
| 35 | 175,889 | 26,766 |
| 36 | 179,141 | 29,908 |
| 37 | 180,284 | 30,882 |
| 38 | 190,154 | 33,734 |
| 39 | 191,891 | 23,949 |
| 40 | 192,469 | 24,274 |

## Limits

- 3 runs per arm, one model, one workload. pi-chart's runs span $0.24, wider than the $0.05 between the two 0.6 runs in the [40-Turn sweep](2026-10-14-token-usage-40-turns.md#low-water-mark).
- Eviction turns are read from drops in the median window, not from the Accounting.
- Runs use the default session root, so the bench Conversations were ingested into the Thread Store like any other.
