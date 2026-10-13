# Proposal: Structure is matched precisely enough to stay put

Triage: needs-triage
Blocked by: None

## Why

In the 2026-10-13 benchmark the structure part carried about 13,000 tokens per Conversation across ~33 Calls, and was the only assembled part that changed between Calls of one Turn: 30 of 64 consecutive-Call pairs. `symbolsInPlay` (`src/symbols.ts`) reads the Turn's 32 most recent messages, so every tool result that names an identifier can reshuffle which symbols the part carries. Each reshuffle is uncached input, and — until `pack-parts-follow-the-turn` lands — a cache invalidation of everything beneath it. Whether the symbols it picks are the ones the Turn is working with has not been checked against these runs.

## What Changes

- Audit what the structure part carried on the benchmark Calls against what each Turn actually worked with, and tighten the match where it carries symbols the Turn did not need.
- Open for grilling: what counts as a correct pick, whether the part should stabilise within a Turn (carry forward what it already carried unless displaced), and the evidence bar for changing `MESSAGE_HEAD`/`RECENT_MESSAGES` or the name-splitting fallback.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`: "Packs carry the structure around the symbols in play", if the selection rule changes observably.

## Impact

- `src/symbols.ts`, `src/assembler.ts` (structure selection), tests under the existing structure seams.
