## Context

The Graph Store is wired as if a Codebase were read-only. `refresh()` runs at `session_start` and nowhere else (`src/extension.ts:229-235`); `graph()` caches the parse against the extraction's own modification time, never against a source file (`src/graph-store.ts:157-177`). So every Call after the agent's first edit carries pre-Conversation `file:line` coordinates with no indication of their age, while a stale Concept is stamped (`src/assembler.ts:629`) — the audit's "frozen at session start and served as current" (`docs/audits/2026-09-16-functionality-audit.md:127`).

Three narrower defects share that surface: candidates come from `current.prompt` alone (`src/extension.ts:810`), which a tool-loop Call does not refresh (audit `:152`); truncation keeps edges in extraction order, so a hub class spends the cap on its own members (`:228`); and the Store is built only on the Postgres branch (`:150`), though neither it nor `symbolsInPlay` needs Postgres.

Independent of `token-budgets`, so it runs in parallel: it changes which connections a neighbourhood holds and what marks it carries, not how much of a Pack they may fill. The Spec Store contributing nothing to a Pack stays untouched — a specified boundary (`openspec/specs/spec-store/spec.md:59-65`), not a defect. See `proposal.md` for motivation and the two delta specs for the contract.

## Goals / Non-Goals

**Goals:**

- Structure that follows the Codebase across a Conversation.
- Age disclosed where the agent reads the coordinates.
- Candidates from what the Turn is working with, including files it named.
- Truncation that answers "what uses this" before "what is inside this".
- Structure available in a session that declined Postgres.

**Non-Goals:**

- A token ceiling or clamp on the structure part (`token-budgets`).
- A watcher, a daemon, or a second lifecycle of our own.
- Semantic symbol matching. Names stay exact.
- Changing the edge cap's size, which is measurement-backed (`src/symbols.ts:151-157`).

## Decisions

### Re-extraction runs at `agent_end`, not on a watcher and not per Call

`agent_end` already carries the ingest sweep (`src/extension.ts:362-366`) and is notification-only, so nothing the user waits on grows. Affordable only because graphify's extraction is content-hash incremental — "21 files cached/unchanged, 0 re-extracted" on an untouched tree (`openspec/changes/archive/2026-09-16-graph-store/design.md:76`). Per Call loses: extraction is seconds, on the path a prompt waits on. A watcher loses harder: a debounce policy, a process to own, and a background extraction racing the parse cache. Structure can still be stale within a Turn, which is why the next decision is not optional.

### Staleness is per symbol, measured against the symbol's own file

Freshness compares the extraction's time against the symbol's file, which the graph already names (`src/graph.ts:15`): a few `stat` calls per Call, bounded by the over-fetch limit (`src/extension.ts:810-813`), not a tree walk. Per symbol, so a Pack editing one file still presents untouched files as current; a Codebase-wide probe means a recursive walk on the request path, or one flag staling everything. A file that cannot be examined counts as stale — ADR-0003's rule for an unverifiable invariant. The mark sits in the structure message's heading beside `qualify(symbol)` (`src/assembler.ts:609-620`), phrased as the Concept stamp is (`:629`). Withholding stale structure was rejected: it empties the part during the Turns that edit code.

### Candidates come from the Turn's messages, bounded per message

`structureFor` already receives the current `Turn` with every message of the Call (`src/extension.ts:300-301,801-813`), so the candidate text becomes each message's text — prompt, assistant text, tool names, arguments, results — rather than `Turn.prompt`, which `reconstructTurns` fills only from a `user` message (`src/turns.ts:18-22`). Each message contributes a bounded head, measured in task 1, so one large result cannot outweigh the Turn. Ordering keeps the widening safe: prompt-named symbols, then names elsewhere in the Turn, then symbols reached only through a file in play. The member-name rule (`src/symbols.ts:84-92`) now applies to the whole text.

### A path resolves through the `file` field, not through name fuzzing

Symbols are indexed by `file` beside the name index, and a path-shaped token matches that index by path suffix, so `src/assembler.ts`, `./src/assembler.ts` and an absolute path all resolve; a bare `assembler` matching a file's stem resolves the same way. That is how `assembler` reaches `assemble` without `canonical()` learning morphology (`src/symbols.ts:28-31`): the link is the file the graph states, not a suffix rule that would fire on every noun ending in `-er`.

### Relation informativeness ranks before the existing direction alternation

`balance`'s alternation is measurement-backed — plain truncation left two of nineteen over-sized symbols with no callers at all (`src/symbols.ts:151-173`) — but each direction is filtered in `links` order, and `contains` and `method` are in the allow-list (`src/graph.ts:38-54`). The sort key gains a first component: `calls`, `imports`, `imports_from`, `re_exports`, `dynamic_import`, `inherits`, `extends`, `implements`, `mixes_in`, `embeds`, `depends_on`, `requires` above `contains`, `method`, `references`. Alternation and the twelve-edge cap are unchanged; ties break by extraction order, so truncation stays deterministic. The omitted count is not re-specified: `openspec/specs/context-assembly/spec.md:203-206` already requires it and `asStructure` renders it.

### The name, file and incident-edge indexes are cached with the parse

`symbolsInPlay` builds a name index over every symbol per Call (`src/symbols.ts:42-47`) and `neighbourhoods` an incident-edge index over every edge per Call (`:127-136`), both on the request path, while the parse they walk is cached for its measured ~370ms on a 50k-node graph (`openspec/changes/archive/2026-09-16-graph-store/design.md:80`). The indexes move into the cached value behind `graph()`: one artifact, one invalidation rule. A memo inside `symbols.ts` gives two caches over one file with no shared trigger, so a stale index outlives its graph. Both functions then take a prepared graph.

### One `Dependencies` literal, with only store-backed members conditional

`piChart` builds two literals and the no-database branch omits `graph` (`src/extension.ts:927-946,961-983`). It becomes one: `graph`, `walk`, `specs`, `codebase`, `report` and `show` unconditional, `turns` and `accounting` from the in-memory implementations without a database. `docs`, `bundle`, `ingest`, `recall`, `search`, `embed`, `ready` and `close` stay conditional — the Doc Store's index lives in Postgres; the Graph Store needs none. `check` then reports structure from what exists rather than from `config.graphExtract` alone (`src/install.ts:112-118`), so it cannot print `extraction on` for a Store never constructed, while a declined extraction still reads as declined (`:78-79`).

## Risks / Trade-offs

- **A subprocess per Turn** → incremental, in the background, and a failure costs the structure rather than the Turn, as extraction already does (`src/extension.ts:229-235`). Task 1 measures its unchanged-tree cost.
- **Wider candidate text matches more noise** → the member-name rule, prompt-first ordering, the per-message bound and the structure Budget each cap it, and `/pack` names every symbol carried.
- **Per-symbol `stat` calls on the request path** → bounded by the over-fetch limit, and cheaper than the parse the same Call avoids.
- **Relation ranking can bury a member** → the omitted count is disclosed, and "what calls this" is the question the Store exists for.
- **Structure without a Thread Store has no durable Accounting** → `MemoryAccounting` serves that branch, so the part stays visible in-session.

## Testing seams

| Requirement | Seam |
| --- | --- |
| The graph keeps up with the Codebase | Extension boundary: assert `refresh` is invoked at `agent_end` against a stub Store; `PICHART_GRAPHIFY=1` for the incremental-cost claim on an unchanged tree. |
| Structure older than the Codebase is disclosed as such | Graph Store boundary over a temporary Codebase with controlled modification times, including a file that cannot be read. |
| The symbols in play are those the Turn is working with | `symbolsInPlay` pure boundary over the fixture graph, with a Turn carrying tool calls and results. |
| A truncated neighbourhood keeps its most informative connections | `neighbourhoods` pure boundary over a fixture hub symbol with more members than the cap. |
| Structure does not depend on a Thread Store | Extension boundary registered with no database URL, plus the install-check boundary for the report. |
| Packs carry the structure around the symbols in play | `assemble()` boundary for the part, extension boundary for the Turn-wide trigger on a later Call. |
| A pack declares structure older than the Codebase | `assemble()` boundary: a marked and an unmarked neighbourhood in one Pack. |

`symbolsInPlay`/`neighbourhoods` is the target seam: pure, and where candidate widening, path matching and truncation order are observable. Only the incremental-re-extraction row needs `PICHART_GRAPHIFY=1`; none needs `PICHART_DATABASE_URL`, `PICHART_EMBED=1` or `PICHART_OPENSPEC=1`, and `PICHART_LIVE=1` serves only the last task group.

## Open Questions

None. Two recorded for later evidence: whether `agent_end` is frequent enough for a very long editing Turn, which the mark answers with data — how often a Pack carries older structure is visible in the inspector; and whether relation ranking should weight each kind rather than group them in two tiers.
