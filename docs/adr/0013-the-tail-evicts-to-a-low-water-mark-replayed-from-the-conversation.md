# The tail evicts to a low-water mark, replayed from the Conversation

Partly superseded by ADR-0015: the start is still replayed from the Store's Turn sizes, but the tail's content is the matching slice of the harness's live history, and a Store copy is used only for a Turn that history no longer holds. Evicted Turns are searched by the `recall_earlier_turns` tool rather than recalled into every Pack.

The verbatim tail used to keep as many of the newest Turns as its Budget allowed. Each new Turn that pushed it over the Budget therefore moved its start forward. Each move changed the first message after the Briefing, so the tail was rewritten to the cache in full. In the 12-Turn benchmark (`docs/benchmarks/2026-10-13-token-usage-parts-follow-turn.json`) the start moved 5 times, and a simulation over the measured Turn sizes put the tail's rewritten tokens at 110k–133k per run.

**The tail now gives up its oldest Turns only by Eviction.** Between Evictions the start does not move, and each new Turn is added behind it. When a new Turn would carry the tail past either Budget (tokens or count), the oldest Turns are dropped in one step until both are at or under the low-water mark. The mark is a share of each Budget, 0.6 by default. For the count Budget that share is rounded down, never below 1 Turn (8 × 0.6 → 4). Turns the tail has evicted become eligible for recall again.

**The start is a pure function of the Conversation and the config, not stored state.** On every Call the Assembler replays the eviction rule over every completed Turn's size, from the first Turn up to now. Replay gives exactly the starts a stateful rule would, while two packs built from the same state stay identical (ADR-0003). It costs O(Turns) arithmetic per Call, on sizes alone.

**Each Turn's size is stored in the Thread Store.** At ingest, `approximateTokens` is computed over the Turn as the tail would carry it (its tool calls paired with their results) and stored on the `turns` row. A Store method returns the sizes for a Conversation. Only a Turn the Store has not ingested yet, or the whole tail when the harness fallback is in use, is sized from the live history.

## Considered options

- **Keep the current rule.** It carries the most history, but every Turn past the Budget rewrites the whole tail.
- **A fixed grid of starts.** Allow the start only at points where the running total of Turn sizes crosses multiples of (1 − mark) × Budget. This needs no history, but the grid lines fall wherever the running total happens to land, so two Evictions can come in a row. At a mark of 0.7, two of the three benchmark runs were as bad as the current rule.
- **Store the start.** That puts mutable state in the Assembler's inputs. A pack could then no longer be rebuilt from the Conversation alone.
- **Size Turns from the live history only.** This needs no schema change, but the decision would rest on the harness's copy while the content comes from the Store's copy. Those copies don't always serialise byte for byte (ADR-0011), so a difference near the mark would move the start.

## Consequences

- The tail carries less than its Budget allows, on purpose. In the simulation it carried roughly 10% fewer tokens across a run, while its rewritten tokens fell to 79k–89k. Measured on the same 12-Turn benchmark, pi-chart's cache write on turns 8–12 fell 49% (61,529 → 31,394 tokens) and prefix held rose from 67% to 82%; no blind-judged answer that was correct before was wrong after (`docs/benchmarks/2026-10-13-token-usage-tail-evicts.md`).
- In this workload the mark barely matters: a single 21k Turn against a 25k Budget leaves one Turn in the tail whatever the mark. Tuning the mark needs a workload with smaller Turns.
- The start moves once by itself when retention deletes the oldest Turns (the replay begins at a different first Turn) or when a Budget or the mark changes between Calls.
- The `turns` table gains a size column. Rows ingested before it have no size and are sized from their messages when read.
- Changing the rule again resets every Conversation's start once.
