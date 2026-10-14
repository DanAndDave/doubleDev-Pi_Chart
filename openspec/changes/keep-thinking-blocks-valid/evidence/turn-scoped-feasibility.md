# Can a pi-chart `context` hook emit a turn-scoped system message? (2026-10-13)

Yes, on omp 18.10.4 with `anthropic/claude-opus-5-5`.

## How omp does it (read from the binary)

- A message returned from the `context` hook as `role: "developer"` with
  `providerPayload: { type: "anthropicMessage", clearAt: "next_user_message" }` passes through
  `convertToLlm` unchanged. omp's own `custom`/`hookMessage` entries become `developer` the same way.
- The Anthropic converter rewrites it to `{ role: "system", clear_at: "next_user_message", content }`
  when `model.compat.supportsMidConversationSystem && model.compat.supportsTurnScopedSystem`, and adds
  the `mid-conversation-system-clear-at-2026-08-21` beta itself. The catalog sets both for the `opus`
  family at revision 4.8 or later, `fable` 5.0 or later, and `mythos`, on `anthropic`, `cloudflare-ai-gateway`, and `google-vertex`.
- It rewrites only a message whose previous message is `user` (a prompt or a `tool_result`), whose next
  message is `assistant` or the end of the array, and whose content is text blocks only. Otherwise it
  goes out as a plain `user` message without any error. **Consequence:** the block must be one `developer`
  message holding several text blocks. Two adjacent ones fail the "next is assistant" test for the first.
- omp already sends `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` on its own (seen in
  every proxied request), so the stub's question about sending it explicitly is moot.
- The hook's `ctx.model.compat` exposes `supportsMidConversationSystem`, `supportsTurnScopedSystem`, and
  `supportsThinkingBindingControls` (all `true` for `claude-opus-5-5`), so the extension can gate on them.

## Proxied runs

Probe extension: `probe-ext.ts`. After every user message, it inserts a deterministic developer message.
The proxy adds `thinking-binding-controls-2026-08-01` and logs `input_transformations`.
Three Turns use `omp -p -c`, each a fresh process.

| Run | Block bytes across Calls | `prefix_binding_mismatch` drops | Cache read, Calls 1→2→3 |
| --- | --- | ---: | --- |
| `turn-scoped-stable.jsonl` | identical, left in place | 0 | 0 → 12,266 → 12,412 |
| `turn-scoped-varying.jsonl` (control: text includes `Date.now()`) | changed every Call | 1 on Call 2, 2 on Call 3 | 11,945 → 12,267 → 12,339 |

- In the stable run, every earlier block went out as `role: "system"`, `clear_at: "next_user_message"`, in its original position.
- Turn 3 asked for the "secret word" in the block. The model answered `HERON`, so it reads the live block.
- The control drops at `messages.2.content.0` and `messages.5.content.0`, the same thinking blocks the stable run kept.
  This confirms that the zero in the stable run is a real result, not missing logging.

## What this does not settle

- pi-chart re-sends each earlier Call's block in its original position, byte-identical. Anything that changes an earlier block, or any message before a thinking block, still drops that thinking. This covers tail eviction, Elision of the Turn in progress, and a tail copy that serialises differently.
- Each `-c` Turn is a fresh process. The earlier blocks therefore have to come from something durable, not from memory.

## Where a block could be kept: `appendEntry` from inside the `context` hook

Probe `entry-ext.ts`: one `-p` Turn with one tool call, and a `custom` entry appended on every Call. Resulting Journal order:

```
custom probe.block {"messages":1}   <- Call 1: lands BEFORE the prompt it belongs to
message user
message assistant toolCall
message toolResult
custom probe.block {"messages":3}   <- Call 2: lands after the tool result it follows
message assistant
```

The entry survives in the Journal. On a Turn's first Call, though, the prompt is written after the hook runs. That matches the existing note in `extension.ts`: the Journal has not been flushed for the current Turn. Journal order therefore can't place a block. A stored block has to name the message it follows.
