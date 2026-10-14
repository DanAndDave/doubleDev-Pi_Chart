## Context

See proposal.md (Why) and ADR-0011 for the decision. What the design depends on, read from omp 18.10.4 (`evidence/turn-scoped-feasibility.md`, and the binary):

- If a `context` hook returns a message with `role: "developer"` and `providerPayload: { type: "anthropicMessage", clearAt: "next_user_message" }`, it reaches the API as a turn-scoped system message. omp adds the `mid-conversation-system-clear-at-2026-08-21` beta itself.
- omp sends it this way only when `model.compat.supportsMidConversationSystem && model.compat.supportsTurnScopedSystem`, and only when an assistant message or the end of the array follows it.
- The handler context exposes `ctx.model` (a getter over the session's current model), so the mode can be decided per Call.
- `pi.appendEntry` called inside the hook lands, on a Turn's first Call, *before* the prompt it belongs to: the prompt is flushed after the hook returns. On a later Call it lands after the tool result that ends the array (`evidence/entry-ext.ts`).
- Tail messages come either from `event.messages` or from the Thread Store, which stores each message's whole JSON (`turn_messages.message`), timestamp included.

## Goals / Non-Goals

**Goals:** no thinking block is dropped because of a Briefing; one Briefing message per Call; a stored Briefing survives restarts, `/tree`, forks and `/btw`.

**Non-Goals:** drops caused by tail eviction, Elision of the Turn in progress, a tail copy that does not serialise byte for byte, or a Call that fails open (ADR-0011's last consequence; eviction is `tail-evicts-to-low-water`). No new Store, no Thread Store table.

## Decisions

### 1. One Briefing text, two ways to send it

`compose()` in `src/assembler.ts` builds one text for the block: `OPENING` (framing and preamble), the Pin part, a fixed marker line, then recalled Turns, curated knowledge and structure. `Pack.messages` becomes `[...leading, briefing]` when anything is assembled. The current flags (`cmCurated`, `cmRecalled`, `cmPinned`) move off messages, which no longer exist per part. Per-part attribution already lives in `Pack.parts`, so accounting is unaffected.

The role is decided in `src/extension.ts`, not the assembler. In turn-scoped mode the briefing becomes `{ role: "developer", content: [{ type: "text", text }], providerPayload: { type: "anthropicMessage", clearAt: "next_user_message" } }`. In fallback mode it stays `role: "user"`. Keeping the assembler role-free keeps it pure and lets both modes share every assembler test.

*Alternative:* let the assembler emit the developer message. Rejected: the provider envelope is harness knowledge, and ADR-0001 confines that to the adapter.

### 2. Mode per Call from `ctx.model.compat`

`turnScoped(ctx) = compat.supportsMidConversationSystem === true && compat.supportsTurnScopedSystem === true`, read through `HandlerContext.model?.compat` (added to `src/harness.ts`). An absent model or flag means fallback. So does a harness without `pi.appendEntry` or `sessionManager.getEntries`: a Briefing that can't be stored can't be sent again byte for byte, so it is sent the fallback way and recorded as `replaced`. Nothing is cached across Calls, so a model switch takes effect on the next Call.

### 3. `pi-chart.briefing` Journal entries, written in the hook

Each turn-scoped Call writes one custom entry with `pi.appendEntry("pi-chart.briefing", data)` before returning its messages:

```ts
type BriefingEntry =
  | { v: 1; follows: string; hash: string; text?: string }   // entry id of the followed message
  | { v: 1; precedes: true; hash: string; text?: string };   // first Call: followed message is the entry's next message child
```

`hash` is sha256 (hex) of the text. `text` is written only when no earlier entry in the Journal file holds that hash. Writing in the hook rather than at the next event (ADR-0011's original consequence) leaves no window in which a sent Briefing exists only in memory. On a first Call the entry is an ancestor of its prompt, so it lies on every path that copies the prompt.

`follows` vs `precedes` is chosen by comparing the array's last message with the branch's last `message` entry (role and timestamp). If they match, the message is already flushed and is named by id. Otherwise it is the prompt, not yet written.

### 4. Resolving and placing stored Briefings

A new pure module, `src/briefings.ts`, mirrors `src/pins.ts`:

- `replayBriefings(entries)` folds every `pi-chart.briefing` entry of the whole Journal, in file order, into `Map<messageEntryId, { hash, text | undefined }>`. A `precedes` entry resolves to the first `message` entry, in file order, whose `parentId` is that entry's id. A later entry for the same message replaces an earlier one (a retried Call). A hash whose text appears nowhere stays `text: undefined`, which makes it missing.
- `placeBriefings(messages, keyOf, stored)` returns the messages with a cleared Briefing inserted after each message whose key has a stored text, and counts the ones sent again (with their bytes) and the ones missing. `keyOf` maps a Pack message to its Journal entry id. The extension builds it from the branch: role and timestamp → entry id.
- `briefingMessage(text, followed)` is the one constructor of the cleared message: `role: "developer"`, one text block, the `providerPayload` above, and the followed message's timestamp. Re-sending runs the same function on the same text, so the bytes match.

Placement runs in the extension after `assemble()`, over the tail and the Turn in progress, and before the current Briefing is appended. The assembler stays free of Journal ids. Matching uses role and timestamp because `Pack.messages` are copies, not the hook's objects. A message evicted from the tail is not in the Pack, so its Briefing is not sent (scenario "A Briefing leaves with its message").

### 5. Forks and `/btw` carry Briefings explicitly

This follows the Pin carry-over in `src/extension.ts` (around line 732), which already handles branch, fork-at-entry and `/btw` promotion. The new Journal receives one `pi-chart.briefing` entry for each Briefing whose message is on the copied path, written as `follows` with the text inline, because the parent's hash-only entries may reference texts the copy lacks. A `precedes` entry already copied as an ancestor of its prompt is resolved the same way in the new file, so carrying it again only adds a later identical entry, and last-write-wins makes that harmless.

### 6. Accounting: four nullable figures per Call

`recordPack` gains `briefing: { mode: "kept" | "replaced" | "none"; resent: number; resentBytes: number; missing: number }`. `none` is a capable Call that assembled nothing: it sends no Briefing of its own but may still send earlier ones again, so `/pack` doesn't claim a Briefing was kept. Postgres adds four nullable columns to `call_accounting` in a new migration: `briefing_mode`, `resent_briefings`, `resent_briefing_bytes`, `missing_briefings`. `MemoryAccounting` keeps the same object.

Bytes, not tokens: a cleared Briefing costs no tokens, and what matters is the request size against the 32 MB limit. The pack size, Budgets, Ceiling and Floor stay computed from the current Briefing alone, so `leading_tokens` and pack-vs-window comparisons keep their meaning.

### 7. Fallback is ADR-0010 plus the new text

On a model without both flags, the Call sends the same Briefing text as one `user` message, as `Pack.messages` do today. It writes no entry and re-sends nothing. Stored entries stay in the Journal, and the next Call on a capable model re-sends them. The fence and the Pin position are therefore the same in both modes, so no assembler branch depends on the model.

## Risks / Trade-offs

- **omp's prompt-flush order changes.** A `precedes` entry would then land after its prompt and resolve to the next message (the assistant reply), so the Briefing would move. Mitigation: if a `precedes` entry has a message parent that matches its own Call's prompt by timestamp, resolve to that instead. A test with a captured Journal of each order pins this.
- **Matching by role and timestamp collides.** Two messages of the same role with the same millisecond timestamp on one branch would share a Briefing. omp stamps each message as it is created, so this does not happen in practice [INFERENCE]. On a collision, the first match wins.
- **Request growth.** At most one cleared Briefing per Call in the verbatim tail; the tail Budget bounds it. `resentBytes` makes the growth visible before it nears 32 MB.
- **Retrieved text gains system authority.** It is fenced behind the marker, which reduces prompt injection but does not prevent it (ADR-0011). Accepted.

## Migration Plan

No data migration: the Journal gains a new custom entry type, and nothing existing changes. Postgres gains four nullable `call_accounting` columns through the existing migration list, and earlier rows read back with the figures absent. Rollback is reverting the commit: omp never sends `pi-chart.briefing` entries, and an older pi-chart ignores them.

## Testing seams

- **`src/briefings.ts` (pure, new).** `replayBriefings` over hand-built entry lists: hash-only reference resolves to an earlier text; unresolved hash becomes missing; last write wins per message; `precedes` resolves to the first message child; malformed entries are skipped.
- **`placeBriefings` (pure).** Given messages plus their entry ids and a replay map: inserts each Briefing immediately after its message; a message absent from the Pack sends nothing; missing ones are counted and not substituted; the output is byte-stable across two calls.
- **`assemble()` in `test/assembler.test.ts`.** The Briefing is one message; order framing, Pins, marker, recalled, curated, structure; no Pins means framing then marker; nothing assembled means no Briefing.
- **`register()` in `test/extension.test.ts`** with the existing fake session (`appendEntry` writes `journal`, `getEntries` reads it) and a fake `ctx.model.compat`: first Call writes `precedes`, later Call writes `follows`; the next Turn's Pack re-sends both byte for byte in place; a `replaced` model sends one user Briefing and writes nothing; switching back re-sends; fork/`/btw` carries only on-path Briefings with their text.
- **Accounting** in `test/postgres-store.test.ts` and `test/report.test.ts`: the four figures round-trip; older rows read back absent and print no Briefing line.
- **Acceptance (manual, not a test).** A proxied run with `thinking-binding-controls-2026-08-01`: three `omp -p -c` Turns with tool calls, zero `prefix_binding_mismatch`; then `scripts/bench-tokens.ts`, with prefix held for turns 1–7 no worse than the 2026-10-13 figure. Logs go in `evidence/`.
