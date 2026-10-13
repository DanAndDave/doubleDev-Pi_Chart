# Quality: assembled parts after the Turn in progress vs ADR-0006's order

Run 2026-10-13 on omp 18.10.3 with the default model and thinking level. Both orders saw the same Conversations:

- **old**: a worktree at `bcb4a6d` (ADR-0006's order: harness run, assembled parts, then the Turn in progress)
- **new**: this change's working tree (tail, Turn in progress, then the opening line and the assembled block)

Both used the vendored bundle (`test/fixtures/okf-acme-retail`, through `PICHART_DOC_BUNDLE`) and a scratch Thread Store database, so neither touched the live store.

## Conversations

Two scripted Conversations per arm, four Turns each. A Pin goes in before each Conversation's third Turn through `/pins add` in print mode, and is checked against the journal (`pi-chart.pin`, 1 entry per Conversation).

| Turn | Kind | What it checks |
| --- | --- | --- |
| 1 | bundle | The answer cites the right policy document (curated knowledge in the block) |
| 2 | tool result before block | The agent reads a file; that tool result is the last harness message before the block |
| 3 | Pin-governed | The Pin (A: "end with a `Source:` line"; B: "answer in one sentence") is obeyed with nothing following it |
| 4 | earlier-Turn recall | The answer uses a figure from Turn 1 |

`call_accounting` confirms both arms carried what was being tested: `curated:2` on the bundle Turns and `curated:2,pinned:1` on every Call from Turn 3 on.

## Judging

Each Turn's two answers went to the default model blind, labelled X/Y in a seeded random order, with the bundle's policy, metric and computation files as ground truth. Per answer: correct against the bundle, Pin obeyed (where one applied), and whether it treated the background block as the request. Per pair: substantive difference and which was better.

## Result

| Conversation | Turn | Kind | old correct | new correct | Pin obeyed (old / new) | Background taken as request | Substantive difference |
| --- | ---: | --- | :-: | :-: | :-: | :-: | :-: |
| A | 1 | bundle | yes | yes | — | no / no | none |
| A | 2 | tool result before block | yes | yes | — | no / no | none |
| A | 3 | Pin-governed | yes | yes | yes / yes | no / no | none |
| A | 4 | earlier-Turn recall | yes | yes | yes / yes | no / no | none |
| B | 1 | bundle | yes | yes | — | no / no | none |
| B | 2 | tool result before block | yes | yes | — | no / no | none |
| B | 3 | Pin-governed | yes | yes | yes / yes | no / no | none |
| B | 4 | earlier-Turn recall | yes | yes | yes / yes | no / no | none |

All 8 pairs were judged ties. No substantive regression, over 8 Turns per arm. Nothing is claimed beyond that sample.
