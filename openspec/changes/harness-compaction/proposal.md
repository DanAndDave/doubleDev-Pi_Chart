# Proposal: A Pack That Survives the Harness Compacting

Triage: ready-for-agent

## Why

A governed Conversation in `game-factory` failed every Call after the harness compacted it:

```
400 messages.53.content.0: `compaction` block must be sent first, in place of the messages it summarizes; remove those messages
```

Two things combined.

**The harness compacted a window pi-chart does not send.** omp's threshold check counts its whole in-memory message history, not the array the `context` hook hands back. The session's compaction entry reads `tokensBefore: 852848` while the Calls just before it reported 48k–85k of Pack. Remote compaction (`compaction.methodOrder` puts `remote` first) then sent the full history to the provider to summarise, which is the most expensive Call a Conversation makes and the one this project exists to make unnecessary. It happened twice in that session.

**The compaction came back as a provider-native block the Pack cannot place.** After remote compaction the harness prepends a `compactionSummary` message carrying `providerPayload: { type: "anthropicCompaction", signature, … }`, and its Anthropic converter replays that as a signed `compaction` block. The provider requires that block to open the conversation *in place of* what it summarises. The Assembler carries the verbatim tail and recollections from the Thread Store ahead of the current Turn, so the block landed at message 53 behind fifty messages it claimed to replace. Every retry rebuilt the same Pack.

## What Changes

- A harness compaction reaches the model as the prose it summarised to, never as its provider-native replay: the `context` hook drops `providerPayload` from `compactionSummary` messages before assembly. The summary text still arrives (the harness renders it as a user message), so a compaction that cut into the current Turn still tells the model what that Turn did.
- pi-chart declines the harness's size-triggered compaction (`threshold`, `idle`) while it is assembling the window, through `session_before_compact`. It tells the operator once, naming `compaction: {enabled: false}` as the setting that stops the harness from trying on every Call.
- A compaction that is not a size estimate over history pi-chart replaces goes ahead: `overflow` and `incomplete` (the provider refused the window actually sent), a manual `/compact`, and any compaction after a Call pi-chart failed to assemble, since that Call sent the harness's own history.

**Not in scope:** rebuilding the head of a Turn a compaction cut into from the Journal, and re-deriving Turn addresses across a mid-Turn compaction. Both predate this change and are not what failed.

## Capabilities

### Modified Capabilities

- `context-assembly`: two added requirements. One says a harness compaction is carried as prose. The other says when the harness's compaction is declined.

## Impact

- **Code:** `src/messages.ts` (`withoutNativeCompaction`), `src/extension.ts` (the `context` hook plus two new handlers), `src/harness.ts` (event types).
- **Harness behaviour:** registering `session_before_compact` also turns off omp's speculative compaction ("Speculation is skipped while an extension registers `session_before_compact`"). That is wanted: a speculative remote compaction is the same full-history Call, only earlier.
- **Risk:** a declined compaction leaves overflow as the only backstop if a Pack really does outgrow the window. The Pack has its own ceiling, and overflow compaction still runs.
- **Blocked by:** nothing.
