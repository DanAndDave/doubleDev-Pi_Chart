# Structure audit after `structure-match-precision` — 2026-10-14

**Pass.** With test and script files out of reach of plain words (design §6), structure is right more often: **52.7%** of slots correct against 43.6%. It also changes less: **45.0%** of consecutive-Call pairs against 52.1%. And it costs less to re-write: **214** structure tokens re-written per pair against 255.

- Commit: `78fb197` plus this change's working tree
- Baseline: bench Conversations whose first Call falls in 2026-10-13 00:00 – 2026-10-14 06:00 UTC, run on commits `67b59fe`–`b84e4fa`. Every one of those commits has the selection code as of `e6c0dfb`.
- After, run 3 (the result): 2026-10-14 15:19:03 – 15:28:19 UTC, `bun scripts/bench-tokens.ts --runs 9 --parallel 6`, the default 12 turns. Raw figures: `2026-10-14-structure-match-precision-run3.json`
- History, the first audit: run 1, 2026-10-14 14:31:08 – 14:34:07 UTC, was the design as first written, with plain words disregarded entirely beside code (`…-run1.json`). Run 2, 14:45:07 – 14:49:25 UTC, added the method-only rule inside the fallback (`…precision.json`). Both used `--runs 3`, and neither had the test-file rule.
- Query: `openspec/changes/structure-match-precision/audit.sql`, run as `psql … -v since=… -v until=… -f audit.sql`. The archived copy of the change is the record. On the baseline window it reproduces every baseline figure below.

## Gate

The bar (design §5) is that correct % rises, changed % falls, and structure tokens re-written per pair of consecutive Calls do not rise.

| Figure | Baseline | Run 1 | Run 2 | Run 3 | Bar | Result (run 3) |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Conversations | 25 | 3 | 3 | 9 | — | — |
| Slots | 1,689 | 249 | 270 | 810 | — | — |
| Correct | 737 (43.6%) | 104 (41.8%) | 114 (42.2%) | 427 (52.7%) | rises | pass |
| Correct, re-reads excluded | 737 (43.6%) | — | — | 417 (51.5%) | reported | — |
| Changed pairs | 202 of 388 (52.1%) | 26 of 56 (46.4%) | 27 of 62 (43.5%) | 85 of 189 (45.0%) | falls | pass |
| Re-written tokens per pair | 255 | 219 | 211 | 214 | does not rise | pass |
| Structure tokens per Call | 378 | 393 | 415 | 428 | reported | — |
| Slots in test or script files | 36.2% | 30.9% | 33.3% | 23.7% | reported | — |

### Why the token bar changed

The first audit was judged on "average structure tokens per Call do not rise" (Round 1 Q7), and failed on it: 378 → 415. That bar predates the cache measure. Since `pack-parts-follow-the-turn`, an unchanged structure part is read from cache and a changed one costs only its own tokens. So what a Call pays for structure is the part re-written, not the part's size. The bar now measures that. Tokens per Call still rise, to 428, because a file's most-connected symbol now comes first (design §4) and carries more edges [INFERENCE: per-slot edge counts were not measured]. The query still reports the figure.

## Where the slots go

| Directory | Baseline slots | correct | Run 2 slots | correct | Run 3 slots | correct |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `src/` | 1,078 | 56.9% | 180 | 63.3% | 618 | 67.2% |
| `test/` | 490 | 22.4% | 82 | 0.0% | 190 | 6.3% |
| `scripts/` | 121 | 11.6% | 8 | 0.0% | 2 | 0.0% |

## What is still wrong

The most frequent wrong symbols in run 3:

- **Capitalised domain words reach test helpers.** "Read src/journal.ts. How is a Conversation's active branch found?" carries `conversation()` and four `CONVERSATION` from `test/`, ahead of `journal.ts`. "… the Thread Store?" carries `store()` from three test files. A capital counts as written as code when the name matches something other than a method (design §2), so the test-file rule, which covers only plain words, does not apply. That is 142 of the 190 `test/` slots (`store()` 62, `CONVERSATION` 52, `conversation()` 28). This was checked by running `symbolsInPlay` on both prompts against this repository's graph. A follow-up could stop a capital alone from reaching test files, or from counting as code at all. The domain's own nouns (Conversation, Turn, Store) are capitalised by convention in this repo's prose.
- **Imports of a file the Turn read.** `Turn` (43) and `messageText()` (34) in `src/messages.ts` reach the part when a tool result writes them as code, after the agent reads a file that imports them. The audit counts them wrong because the Turn spells the file `./messages.ts`, never `src/messages.ts`. That judgement is arguable either way.
- **Method slots.** There are 32 method slots and 27 of them are wrong, `.read()` on 18 of those. [INFERENCE: these come from `.read(` written as code in tool results; not traced per slot.]

## Limits

- 9 Conversations against 25 in the baseline. The 9-point gain in correct % is well clear of the under-1-point spread between the first audit's two runs [INFERENCE: no confidence interval was computed].
- The baseline spans several commits that changed the tail and the Opening, though not selection. Other parts of the Pack do not affect which symbols are chosen, but they do change the Turns an agent takes, and so the text the audit judges.
- Correct slots can be inflated by re-reads. pi-chart trims old Turns, so an agent may read a file again that it saw Turns ago, and that re-read marks the file's slots correct. The query's `correct_first` (design §5) counts file evidence only from the prompt or from a file that no earlier Turn showed. It moves the baseline by 0 slots and run 3 by 10 (52.7% → 51.5%), so the gain holds. The effect is small because each benchmark Turn names a different file. A workload that came back to the same files would show a larger gap.
- A slot that causes its own file to be read still counts as correct. Separating that out needs an ablation run, the same Turns with the structure part switched off, which is a change to the benchmark and not part of this change.
