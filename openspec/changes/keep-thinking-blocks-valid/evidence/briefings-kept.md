# Kept Briefings drop no thinking (2026-10-13)

Task 5.4's acceptance run: zero `prefix_binding_mismatch` drops, against 53 before.

## Setup

- omp 18.10.4, `anthropic/claude-opus-5-5`, default thinking level.
- `bun scripts/bench-tokens.ts --turns 3 --runs 1 --parallel 2 --model anthropic/claude-opus-5-5`, both arms. Each Turn is one `omp -p` process, the second and third with `-c`, and every Turn reads files with tools.
- `ANTHROPIC_BASE_URL` pointed at a throwaway proxy. It added the `thinking-binding-controls-2026-08-01` beta header and logged one line per request: the roles sent (a turn-scoped system message shows as `system:next_user_message`), how many thinking blocks it carried, the `input_transformations` from `message_start`, and `usage`. Request bodies were not logged.
- Raw log: [`briefings-kept.jsonl`](briefings-kept.jsonl). The arms are told apart by `cwd`: pi-chart is `/tmp/pichart-bench-jXwiuP`, vanilla `/tmp/pichart-bench-beNeqG`. Lines with `cwd: null` are omp's own `claude-haiku-5-5` side calls.

## Result

| Arm | Calls | Calls carrying thinking | Thinking blocks carried, summed | `prefix_binding_mismatch` drops | Prefix held |
| --- | ---: | ---: | ---: | ---: | ---: |
| vanilla | 9 | 7 | 10 | 0 | 100% |
| pi-chart | 8 | 6 | 17 | 0 | 100% |
| pi-chart before (ADR-0010, [`thinking-binding.md`](../../archive/2026-10-13-pack-parts-follow-the-turn/evidence/thinking-binding.md)) | 13 | 11 | — | 53 | 75% |

pi-chart's Calls, from the log:

| Request | Thinking blocks | Cleared Briefings in the request | Drops |
| ---: | ---: | ---: | ---: |
| 8 | 0 | 0 | 0 |
| 10 | 0 | 0 | 0 |
| 12 | 1 | 1 | 0 |
| 22 | 2 | 2 | 0 |
| 27 | 2 | 3 | 0 |
| 33 | 3 | 4 | 0 |
| 34 | 4 | 5 | 0 |
| 35 | 5 | 6 | 0 |

- The first two Calls assembled nothing, so they carried no Briefing.
- From request 12 on, every request ends in a `system:next_user_message` message, the current Briefing. Every earlier Briefing appears again directly after the `user` message it followed (a prompt or a tool result), and before the `assistant` message that answered it.
- The Journal of the pi-chart run holds six `pi-chart.briefing` entries. The two first-Call entries are `precedes` entries, each the parent of its prompt. The four later-Call entries are `follows` entries naming the tool result before them. Each Call wrote its text inline because no two Briefings were identical.

## What this does not show

- Tail eviction and Elision of the Turn in progress are out of scope (ADR-0011). Three Turns stay within the default tail, so neither happened here.
- A Briefing re-sent from a stored hash-only entry: none was written in this run. `test/briefings.test.ts` and `test/extension.test.ts` cover that path.
