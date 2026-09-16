# Proposal: Assembler owns the context window

Triage: ready-for-agent
Blocked by: None (can start immediately)

## Why

A coding agent's context window grows monotonically: every Turn adds to what the next Turn must carry, and the only relief on offer is threshold-triggered compaction that summarizes away detail nobody chose to lose. This project replaces growth with assembly — each Turn gets a Context Pack built for it — and this change is the slice that proves the seam exists and is ours. Every other slice is blocked by it, so it is worth landing before a single Store is designed.

It also starts the measurement the rest of the project depends on. A probe against the harness showed a single 12-token message still costing 30,447 tokens, because system prompt, tool schemas, skills, and rules sit outside the Assembler's reach. Budgets cannot be set honestly until that Floor is recorded per Turn rather than estimated.

## What Changes

- Introduce the project itself: a TypeScript/Bun package that loads into the harness as an extension, plus the test harness every later slice builds on.
- Take ownership of the per-turn message array. The extension registers a `context` handler that discards the accumulated array and returns a Context Pack it constructs: the current prompt plus the last N Turns verbatim, sourced from the incoming array. No Store exists yet.
- Record per-Turn accounting that separates the Context Pack from the Floor, and make those measurements readable.
- Disable the harness's own memory backend (`memory.backend: off`) so exactly one system injects into the Context Window, per ADR-0003.
- Establish that replacement is wire-only: the Journal and the rendered transcript keep the full truth of what happened. This is a property to hold, not a thing to build — the harness already behaves this way, and a regression here would be silent and severe.

Not in scope: any Store, any persistence, any embedding or retrieval, any change to the Floor's contents.

## Capabilities

### New Capabilities

- `context-assembly`: Constructing a Context Pack for a Turn and making it — rather than the accumulated history — what the model receives. Covers pack composition, the verbatim tail, determinism, and the guarantee that replacement never mutates the durable record.
- `pack-accounting`: Recording what each Turn's Context Window was made of, split between the Context Pack and the Floor, so Budgets are set from evidence.

### Modified Capabilities

None. This is the project's first change; `openspec/specs/` is empty.

## Impact

- **New**: the package, its build and test configuration, and its extension entry point. Greenfield — no existing code is touched.
- **Runtime dependency**: the harness's `context` extension event and the shape of the messages it passes. Documented but not contractually stable; `before_provider_request` is the documented fallback and the harness is MIT-licensed, so a fork remains available. Recorded in ADR-0001.
- **Configuration**: the harness's memory backend is turned off for sessions using this extension.
- **Language**: TypeScript on Bun, forced by the extension runtime rather than chosen. Recorded in ADR-0001.
- **Blocks**: every other change in this effort.
