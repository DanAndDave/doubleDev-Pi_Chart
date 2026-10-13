# Why prefix held stops at ~65%: dropped thinking blocks

Task 5.2's gate failed at 65% prefix held (vanilla 100%). The cause: the Anthropic API rejects pi-chart's thinking blocks as bound to a different prefix, drops them, and restarts the prompt cache there.

## The rule

On Claude Opus 5.5, a thinking block stays valid only while `system`, `tools`, and every message sent before it are unchanged on later requests ([Preserved thinking: Keeping the prefix unchanged](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#prefix-check)). The edit table lists "Add a text block to an earlier user turn, or remove one you added last time" as invalid. With `drop_block`, "the prompt cache restarts at the edit", and the page says outright: "the edits that invalidate thinking are the edits that restart the cache."

pi-chart makes exactly that edit on every Call. Call *n* ends with the assembled block. The model's thinking is produced after it. On Call *n+1* that block is gone, and a new one follows the grown Turn. So every earlier thinking block now sits on a prefix it was not produced on.

## Evidence

**1. Thinking can't be turned off on this model.** `bun scripts/bench-tokens.ts --thinking off --turns 7 --runs 3`: omp recorded `thinkingLevel: off`, but `claude-opus-5-5` still returned signed thinking blocks with empty text (vanilla 3–5 per run, pi-chart 7–9). Prefix held: vanilla 100%, pi-chart 64%, the same as with thinking on.

**2. Misses follow thinking, and only in pi-chart.** Consecutive Call pairs from that run, by whether Call *n*'s response held a thinking block:

| Arm | After a thinking response | After no thinking |
| --- | ---: | ---: |
| vanilla | 9 held, 0 missed | 38 held, 0 missed |
| pi-chart | 6 held, 15 missed | 23 held, 0 missed |

**3. The API says so.** A throwaway proxy added the `thinking-binding-controls-2026-08-01` beta header, which only adds reporting, and logged each response's `input_transformations`. The bench ran through it: `--turns 5 --runs 1`; raw log in [`thinking-binding.jsonl`](thinking-binding.jsonl), with no request bodies.

| Arm | Calls | Calls carrying thinking | Calls with blocks dropped | Prefix held |
| --- | ---: | ---: | ---: | ---: |
| vanilla | 13 | 11 | 0 | 100% |
| pi-chart | 13 | 11 | 11, every block each time (53 drops) | 75% |

Every drop is `{"type": "thinking_dropped", "reason": "prefix_binding_mismatch"}`. Each Call drops all the thinking blocks it carries, starting at the Conversation's first (`messages.3.content.0`).

## What it means

- **Quality, not only cost.** Dropped blocks don't reach the model, so the model loses its own earlier reasoning on every Call. Anthropic warns this "can significantly increase the output tokens generated". pi-chart's output ran 1.08–1.09× vanilla's in both benchmarks. `evidence/quality.md` saw no answer-level regression on its 8 short Turns.
- **No ordering of the block passes the gate.** Any per-Call text block that is removed on the next Call invalidates the thinking produced after it. Anthropic's replacement for "injecting a reminder and deleting it on the next request" is a turn-scoped system message (`role: "system"`, `clear_at: "next_user_message"`, beta `mid-conversation-system-clear-at-2026-08-21`). It is left in place on later requests, where it costs no input tokens once cleared. Whether omp can emit that message role from an extension is unverified.
- **The tail has the same problem.** Dropping old Turns and keeping the rest verbatim is "keep-tail compaction" in Anthropic's terms, and the kept Turns' thinking fails the check. This bears on `tail-evicts-to-low-water`.
- **Untested:** whether the old order (before this change) also had its blocks dropped. It also edited messages in front of the Turn, so it likely did ([INFERENCE]).
