# Token usage after `keep-thinking-blocks-valid` — 2026-10-13

On a capable model, each Briefing is now sent as a cleared turn-scoped system message and stays in place on later Calls (ADR-0011). With that, prefix held for turns 1–7 is **100%**, the same as vanilla; it was 65% before. Cache writes on turns 1–7 fall to **0.95× vanilla**, from 1.09×. Over the whole Conversation, cost falls to **1.55× vanilla**, from 1.90×, and output to 1.13×, from 1.43×.

- Commit: `aed7a71` plus this change's working tree. The bench loads `src/extension.ts` from the working tree.
- Harness: omp 18.10.4, default model (`claude-opus-5-5`) and thinking level
- Workload: the default 12 turns, `--runs 3`, both arms
- Raw figures: `2026-10-13-token-usage-briefings-kept.json`
- Before: `2026-10-13-token-usage-parts-follow-turn.md`

## Gate

| Figure | Before (pi-chart) | After (pi-chart) | After (vanilla) | Gate | Result |
| --- | ---: | ---: | ---: | --- | --- |
| Prefix held, turns 1–7 | 65% | 100% | 100% | no worse than 65% | pass |
| Cache write, turns 1–7 | 34,854 | 21,777 | 22,808 | — | 0.95× vanilla |

A separate proxied run with the `thinking-binding-controls-2026-08-01` header recorded zero `prefix_binding_mismatch` drops over three Turns, where there were 53 before (`openspec/changes/keep-thinking-blocks-valid/evidence/briefings-kept.md`).

## Per Conversation (median over runs)

| Metric | vanilla | pi-chart | pi-chart / vanilla | Before: pi-chart / vanilla |
| --- | ---: | ---: | ---: | ---: |
| Calls | 34 | 31 | 0.91× | 1.03× |
| Prompt tokens sent | 1,192,582 | 841,480 | 0.71× | 0.85× |
| Uncached input | 92 | 44,297 | 481× | 571× |
| Cache read | 1,143,132 | 699,407 | 0.61× | 0.73× |
| Cache write | 49,358 | 97,776 | 1.98× | 2.30× |
| Output | 10,134 | 11,431 | 1.13× | 1.43× |
| Effective input | 176,103 | 236,458 | 1.34× | 1.58× |
| Cost, USD | $0.8302 | $1.2876 | 1.55× | 1.90× |
| Peak window, tokens | 61,722 | 35,585 | 0.58× | 0.62× |

## Reading it

- Output fell from 1.43× to 1.13× vanilla. The model now keeps its earlier reasoning instead of re-deriving it, which is the quality cost `thinking-binding.md` predicted. The output drop is consistent with that, but this run does not test the cause ([INFERENCE]).
- The whole-Conversation cache write is still 1.98× vanilla, and the excess is on turns 8–12. From turn 8 on, the tail slides and pi-chart's window shrinks below vanilla's: 28,045 tokens against 61,722 at turn 12. Each slide changes the earliest message sent, so that Call writes the cache again. `tail-evicts-to-low-water` covers this.
- Uncached input stays high: the current Briefing comes after the cache breakpoint, so it is billed as input on every Call. A cleared Briefing adds no input tokens.

## Limits

- One model. Models without turn-scoped system messages fall back to the user-message Briefing. On those, the figures are the 2026-10-13 ones.
- The codeword probe recalled 2/3 for pi-chart (vanilla 3/3). Recalling turn 1 at turn 12 is outside this change.
- Three runs per arm. Medians over three runs move with a single cold cache start.
