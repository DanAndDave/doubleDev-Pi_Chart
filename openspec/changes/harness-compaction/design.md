## Context

Evidence is from the failing session `01a0d935…` (`~/.omp/agent/sessions/-dev-game-factory/`) and its captured request (`~/.omp/logs/http-400-requests/1790548649922-2c8fbcd3ps416.json`), read against omp 18.3.5.

- The failing request had recollections at `messages[0–1]`, the Thread Store tail at `[2–51]`, a converter-inserted `"Continue."` at `[52]`, and then `[compaction, thinking, tool_use]` at `[53]`.
- The compaction entry is `method: "remote"` with `tokensBefore: 852848` and `preserveData.anthropicCompaction.signature`. When omp builds the session context, it turns that entry into a `compactionSummary` message with `providerPayload` set.
- `convertToLlm` renders `compactionSummary` as `{ role: "user", content: <summary template>, providerPayload }`. The Anthropic converter replays a user or developer message whose `providerPayload` is an `anthropicCompaction` as `{ role: "assistant", content: [compaction] }`. Without the payload it is plain user text.
- The threshold estimate is `max(breakdown.usedTokens, nonMessage + countMessages(session.messages()))`. `session.messages()` is the agent's own array, before the `context` hook runs.
- The auto paths emit `auto_compaction_start { reason, action }` to extensions and await it, then emit `session_before_compact`, which may return `{ cancel: true }`. `reason` is `threshold` (pre-prompt and mid-run), `idle`, `overflow`, or `incomplete`. A manual `/compact` emits only `session_before_compact`.

## Goals / Non-Goals

Goals: every Pack is a request the provider accepts after a compaction, and no full-history compaction Call is triggered by a measurement of history the Pack replaced.

Non-goals: recovering a Turn's pre-compaction head from the Journal, and Turn addressing across a mid-Turn compaction.

## Decisions

### Strip the payload, keep the message

The native block has exactly one valid position: the head of the request, replacing what it summarises. Placing it there would mean dropping the Thread Store tail and recollections, which is a harness-governed window. Dropping the message entirely would lose the only account of a current Turn that the compaction cut into. That is the failing session's case: the kept messages start mid-Turn with no prompt. It would also defeat overflow recovery, because the Pack would carry the same current Turn that overflowed. Keeping the message without `providerPayload` makes the harness render it as text, which can sit anywhere.

The strip applies to `compactionSummary` messages only, whatever the payload's `type`. The payload's only purpose on that message is native replay: Anthropic signed or legacy blocks, and OpenAI remote-compaction items. Other messages carry payloads with unrelated meanings (`anthropicMessage` effort and tool changes on developer messages), and those are left alone.

It happens in the adapter, before reconstruction, so the fallback tail, the current Turn and the supplied array all see the same messages.

### Decline by trigger, not by size

The extension cannot see the harness's estimate or its settings. It can see the trigger. `threshold` and `idle` are sizes computed over the harness's history, so they are declined. `overflow` and `incomplete` are the provider's verdict on the Pack, and manual compaction is the operator's request, so all three proceed. The trigger is remembered from `auto_compaction_start` and consumed by the next `session_before_compact`. It is cleared on `auto_compaction_end`, so a manual compaction that follows is never mistaken for an automatic one.

### The harness's history is in charge after a failed assembly

A failed assembly returns the harness's own array, so the next window really is the one the harness measured. The extension tracks whether its last `context` call produced a Pack. It starts in the assembling state, because the first Call after a resumed session has not failed yet, and a pre-prompt threshold check runs before that Call's `context` event.

### Say it once, name the setting

With compaction left enabled, the harness re-checks its threshold on every Call, so the cancel repeats and the harness shows "cancelled" status each time. The system cannot turn that off. It says once which setting does, following the memory-backend precedent (ADR-0004).

## Risks / Trade-offs

- A Pack that genuinely outgrows the window now relies on overflow compaction rather than a pre-emptive one. The Pack ceiling keeps that rare, and overflow still recovers.
- omp's experimental `new_context` tool (off by default) also runs as a `threshold` compaction and would be declined. The trigger event does not distinguish it.

## Testing seams

| Requirement | Seam |
| --- | --- |
| A compacted conversation stays sendable | `test/extension.test.ts` harness: a `context` event led by a `compactionSummary` with an `anthropicCompaction` payload returns a Pack with no payload on it. |
| The summary still reaches the model | Same seam: the summary message is in the returned Pack. |
| Other provider payloads are untouched | Same seam: a developer message's payload survives. |
| A size-triggered compaction is declined | `test/extension.test.ts` harness: `auto_compaction_start {reason: "threshold"}` then `session_before_compact` returns `{ cancel: true }`, announced once. |
| An overflow still compacts | Same seam with `reason: "overflow"`. |
| A requested compaction proceeds | Same seam with no `auto_compaction_start`. |
| An unassembled call leaves the harness in charge | Same seam after an `assemble` that throws. |
| The provider accepts the Pack | Smoke: the captured failing session's branch, rebuilt through the hook, contains no `providerPayload`. |

## Open Questions

None.
