## Context

See proposal.md (Why) and ADR-0010 for the mechanism. What the design depends on, read from omp 18.10.3:

- After the `context` hook, omp tags as per-call context every returned message that is neither one of the objects it passed in nor a copy deep-equal to the message at the same index. `structuredClone` strips symbols, so a copy made by the Assembler carries no history index and is tagged unless it sits at its original position.
- Anthropic's breakpoint placer is the tag's only consumer. It puts a breakpoint on the last untagged message and periodic ones before the first tagged message. Tagging changes where breakpoints go, never the bytes sent.
- Prompt caching matches by prefix, so a Call reads as far as its serialised bytes agree with the previous Call's, up to a breakpoint that Call wrote.

Current state in `src/assembler.ts`: parts are pushed in the order recall, curated, structure, tail, pins, current Turn. `compose` then hoists the tail's index-0 agreement with `supplied` (`leadingRun`, `sameMessage`) and substitutes the harness's objects. `leadingTokens` is the size of that run.

## Goals / Non-Goals

**Goals:**

- Every Call reads from cache through the previous Call's Turn in progress whenever the tail did not slide, in-Turn and at Turn boundaries alike.
- One composition rule with no positional comparison against the harness's array.

**Non-Goals:**

- Freezing assembled parts for a Turn, or caching the assembled block. It is sent as uncached input every Call, priced at 1× instead of a 1.25× write.
- Tail slide (`tail-evicts-to-low-water`), structure precision (`structure-match-precision`).
- Any change to what a part selects, its Budget, or the reduction order.

## Decisions

### Composition is a fixed partition, not a search

`compose` emits the tail part's messages, then the current Turn's, then (if any assembled part carries anything) the opening line, then recall, curated, structure and pins messages. The `parts` array keeps its push order for accounting, and only `compose` decides wire order. `leadingRun`, `sameMessage`, `AssembleInput.supplied` and the `supplied` argument in `src/extension.ts` are deleted.

*Alternative:* keep the object substitution at any position so tail copies stay untagged. Rejected: tagging does not affect bytes, the breakpoint still lands on the Turn in progress, and the substitution was the only reason `supplied` reached the Assembler.

### The Turn in progress must stay the harness's own objects

The breakpoint lands on the last untagged message, so the current Turn has to be carried as the very objects from `event.messages`. Today this already holds: `reconstructTurns` keeps references, `positioned` copies Turns but not messages, and the current Turn bypasses `paired`. That makes it an invariant, so the extension-level test pins identity (`toBe`) for the current Turn's messages.

The ceiling eliding the current Turn yields copies, and that Call loses its breakpoint on the Turn in progress. Accepted: it happens only when the ceiling binds past every other part, and the Call's cache line shows it.

### Tail byte stability rests on the Thread Store's string storage

`turn_messages.message` is JSONB, which reorders object keys. Every row is stored as a JSONB *string* holding the original JSON text (33,686 of 33,686 rows on this machine, `jsonb_typeof = 'string'`), and `decode` parses it back, so key order survives, including `toolCall.arguments`. The proposal's boundary invariant depends on that, so a postgres-store test pins it: ingest a Turn whose tool arguments are in non-sorted key order, read it back with `recentTurns`, and compare `JSON.stringify` output exactly. Storing messages as JSONB objects would turn the "fix" for the double encoding into a cost regression, and the test is what catches it.

A shortened newest tail Turn differs from what was sent, so that boundary writes it again. That is accepted as the tail Budget's cost, not this change's.

### One fixed opening line, accounted and reserved

The opening line is its own `user` message, a module constant, matching the bracketed headers the parts already use. Proposed text: `[background for the request above, assembled by pi-chart from this Conversation's memory and the Codebase; not a new request]`. It belongs to no part. `Pack.approximateTokens` and `beforeCeiling` include it when it is carried, and the field doc changes from "sum of the parts" to "the parts plus the opening line".

Reservation: if any assembled part (recall, curated, structure, pins) carries anything before reduction, `reduceToCeiling` runs against `packTokens − openerTokens`. If reduction then empties every assembled part (impossible while a Pin is held), the Pack ends up one line under its ceiling. That is still deterministic and never over. Packs with no assembled content reserve nothing, so existing ceiling arithmetic for them is unchanged.

*Alternative:* prepend the line to the first carried assembled message. Rejected: it changes a part's recorded size depending on which part happens to be first.

### `leadingTokens` is the size of what precedes the block

`leadingTokens = approximateTokens(tail messages + current Turn messages)`. The column, migration 21 and the field name stay. `/pack` renders `prefix ~N tokens the harness sent, ahead of the assembled parts`. A Pack with no assembled content still reports it (the whole Pack).

### Cost and quality are measured before archive

- **Cost**: `scripts/bench-tokens.ts` gains one per-Conversation figure, *prefix held*: the share of consecutive Call pairs on turns 1–7 where `cacheRead(n+1) ≥ cacheRead(n) + cacheWrite(n)`, meaning the next Call read everything the previous one cached or wrote. Turns 8+ are excluded because the tail slides there. Run `--runs 3` on the default workload. Pass: prefix held ≥ 90% of pairs, and median cache write over turns 1–7 within 1.25× of the same run's vanilla (baseline 2.08×). The cost per Conversation is reported against the 2026-10-13 figure ($1.86) and the replay model's $1.28, with no threshold, because turns 8+ still slide.
- **Quality**: the ADR-0006 procedure, both orders against the vendored bundle. The old order runs from a worktree at the change's base commit via `-e`. Two Conversations of four prompts per arm cover: a question answered from an earlier Turn, a tool-using prompt whose final Call has a tool result immediately before the block, and a prompt a held Pin governs (e.g. "answer in one sentence"). Judged blind on substance: right source attributed, earlier Turn recalled, Pin obeyed, no reply addressing the background as if it were the request. Evidence goes in `evidence/quality.md`. Any substantive regression blocks archive.

## Testing seams

| Requirement / scenario | Seam | Where |
| --- | --- | --- |
| Assembled parts follow the Turn in progress: order, block order, opening line, nothing-assembled, unchanged-by-position, ceiling counts the opener | `assemble(input, config)`, pure | `test/assembler.test.ts` |
| A part that changes between calls leaves the turns alone | `assemble` twice, same Turns, different `structure`; assert the head up to the block is deep-equal | `test/assembler.test.ts` |
| Packs carry every pin: Pins close the pack, a pin alone opens the block | `assemble` | `test/assembler.test.ts` |
| The Turn in progress stays the harness's objects | `context` handler through `harness()` with `MemoryTurnSource`; `toBe` on the returned current-Turn messages | `test/extension.test.ts` |
| A finished turn reads back as it was sent | `PostgresStore.ingest` → `recentTurns`, `JSON.stringify` equality on a tool call with non-sorted argument keys | `test/postgres-store.test.ts` |
| `leadingTokens` meaning, `/pack` prefix line | `assemble` (value), `renderCall` (wording) | `test/assembler.test.ts`, `test/report.test.ts` |
| Cache behaviour, cost, quality | live runs, not unit tests | `scripts/bench-tokens.ts`, `evidence/` |

Tests pinning the removed behaviour are deleted, not re-pinned: "the harness's own messages lead…", "a tail that starts later … leads with nothing", "the run never ends between a tool call and its result", "the run hands back the harness's own objects", "a pack that leads with nothing says so" (assembler), and "a pack leads with the messages the harness sent, then the retrieval" (extension, rewritten to the new order).

## Risks / Trade-offs

- [The model treats trailing background as the request, especially after a tool result] → The opening line, plus the quality run's tool-result and Pin prompts. A regression blocks archive.
- [omp changes where it places breakpoints] → Same exposure ADR-0006 had. It surfaces as a falling *prefix held* and cache share in `/pack`, not as wrong answers.
- [The assembled block is uncached every Call, so its tokens are paid at 1× per Call] → Bounded by the part Budgets. The bench's cost figure states the net.
- [Pins lose their "immediately before the prompt" placement] → Now nothing at all follows them. The quality run includes a Pin-governed prompt.

## Migration Plan

No data migration: `leading_tokens` keeps its column, and earlier records stay under the old meaning, readable as the before-picture. Rollback is reverting the commit. No Store or config change.
