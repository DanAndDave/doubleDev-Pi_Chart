# Assembled parts follow the Turn in progress

Superseded by ADR-0015: pi-chart no longer sends assembled parts as a message. The Pins and the Opening ride the system prompt, and recall, curated knowledge and structure are tools the model calls.

Supersedes ADR-0006's order. Below, "closing block", "opening line" and "Pins last" describe the order this ADR decided; ADR-0011 later made the parts one Briefing, and ADR-0015 removed the Briefing.

ADR-0006 led every Pack with the longest run of messages the harness itself sent, so the harness could mark that run for caching, and put the assembled parts between the run and the rest of the tail. The 2026-10-13 token benchmark (`docs/benchmarks/2026-10-13-token-usage.md`) measured what that costs: pi-chart wrote 2.5× as much cache as plain omp over turns 1–6, and cost 2.3× as much over twelve turns while sending 26% fewer prompt tokens.

**A Pack now carries everything the harness sent first — the verbatim tail, then the Turn in progress — and every assembled part after it, as a closing block.** The block opens with one fixed line saying it is background for the request above it and not a new request, then carries recalled Turns, curated knowledge, structure, and Pins last.

## Why the run was the wrong target

ADR-0006 read the harness as caching "as far as the first message that is not its own". omp 18.10.3 does something else. After the `context` hook it tags as per-call context every returned message that is not one of its own (a message it passed in, at any position, or a copy equal to the message at the same index). The provider then places a cache breakpoint on the **last untagged message**, plus one just before the first tagged message. Prompt caching matches by prefix, so a Call reads from cache as far as its bytes agree with the previous Call's, up to the furthest breakpoint the previous Call wrote.

In a Pack the last untagged message is the end of the Turn in progress, so a Call already caches through whatever sits before it, run or no run. What breaks the cache is an assembled part *changing* when something follows it. The benchmark shows exactly this: across 64 consecutive Call pairs within a Turn, the 34 where no assembled part changed read 100% of the previous prompt from cache; the 30 where structure re-matched on a tool result stopped reading where structure sits. From turn 8 on, structure sat ahead of the whole tail, so every re-match wrote the tail again. Recall changes at every Turn boundary, so with the old order the previous Turn was always written again there too.

Behind the Turn in progress, an assembled part that changes costs only its own tokens. Ahead of it, it costs everything after it.

## Pins move into the block

Pins sat immediately before the Turn in progress so nothing assembled stood between them and the prompt. Left there, the previous Turn would pass them at every boundary and be written again. They are now the block's last message: nothing stands between them and the model's reply, which is what the old placement was for.

## What goes, and what has to hold instead

The run, the structural comparison that found it, and the hand-back of the harness's own objects are removed. They existed to stretch an index-0 prefix the harness no longer cares about. A tail message the Assembler carries is its own copy, so the harness tags it as per-call context, and that changes nothing about caching: the breakpoint on the Turn in progress still covers it.

What has to hold instead is byte stability. A Turn is sent as the harness's own messages while it is in progress and as the Assembler's copy once it is in the tail, so the copy must serialise exactly as the harness's message did, or the first Call of every Turn writes the previous Turn again. That is now the tail's invariant, and the change's cache check is what proves it.

`leading_tokens` (migration 21) stays and now records the tokens ahead of the assembled block. `/pack` reports them under that meaning.

## What it measures

`docs/benchmarks/2026-10-13-token-usage-parts-follow-turn.md`, same 12-turn workload, 3 runs per arm:

| Figure | ADR-0006 order | This order | Plain omp |
| --- | ---: | ---: | ---: |
| Prefix held, turns 1–7 | 18% | 65% | 100% |
| Cache write, turns 1–7 (median) | 46,588 | 34,854 | 31,932 |
| Cost per Conversation | $1.86 | $1.62 | $0.85 |
| Peak window, tokens | 37,857 | 35,502 | 57,478 |

Quality held: judged blind across 8 Turns, the two orders tied on every one, including a tool result right before the block and a Pin-governed prompt (`openspec/changes/archive/2026-10-13-pack-parts-follow-the-turn/evidence/quality.md`).

Prefix held stops at 65% for a reason this ADR's account of caching missed. On Claude Opus 5.5 a thinking block stays valid only while everything sent before it is unchanged. The closing block sits before the thinking the model produces on each Call, and the next Call replaces that block, so the API drops the thinking and restarts the cache there (`…/evidence/thinking-binding.md`: every thinking block in a pi-chart Conversation dropped, none in plain omp). Any per-Call content does this, wherever it is placed. Making the block something the next Call can leave in place is `keep-thinking-blocks-valid`.

## Considered options

- **Freeze assembled parts for a Turn, keep ADR-0006's order.** Stops structure following each tool result, but recall still changes at every Turn boundary and the tail behind it is written again on every Turn's first Call.
- **Move only structure to the end.** Fixes within-Turn churn; leaves recall's boundary cost.

## Consequences

- The design now relies on omp placing a breakpoint on the last untagged message. That depends on omp internals the same way ADR-0006 did. A harness that stopped doing it would leave the Turn in progress uncached and show up in the Call's cache line, not as wrong answers.
- The last thing the model reads after a tool result is background, not the result. The opening line and the judged comparison required by the change (`pack-parts-follow-the-turn`) are what argue this costs no quality.
- ADR-0003's determinism is unchanged. The order is a fixed function of the parts.
- ADR-0006's positional run, and the figures it measured, are the before-picture.
