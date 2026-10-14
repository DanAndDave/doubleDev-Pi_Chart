# Proposal: Pins and the Opening ride the system prompt; recall, docs and structure are tools

Triage: ready-for-agent
Blocked by: None

## Why

The 2026-10-14 benchmark (`docs/benchmarks/2026-10-14-token-usage.md`) put pi-chart at 2.12× plain omp's cost. Of the $1.12 gap, $1.06 was uncached input. From the tail's first Eviction on, every Call paid 12–13k tokens of Briefing at the full input rate. The Briefing follows the cache breakpoint (ADR-0010) and changes on every Call, so it is never read from cache. Most of it was recall, carried whether or not the model needed it, and recall still missed the one fact it was there for: 0/3, excluded by its distance threshold at 0.537–0.547 against 0.52. ADR-0015 settles the fix. What must always be in view moves into the system prompt. Everything retrieved becomes a tool the model calls.

## What Changes

- **BREAKING** No Briefing is sent. This deletes:
  - the Briefing message, its framing, marker and fence;
  - the `pi-chart.briefing` Journal entries and the re-send and fork-copy logic;
  - the user-message fallback for models without turn-scoped system messages;
  - per-Call recall, curated-knowledge and structure assembly.
- pi-chart handles `before_agent_start`. It appends to the system-prompt array the harness passes it and never replaces that array. It appends, in order:
  - every Pin, under its standing-instruction framing;
  - the Opening, inside fixed text: *"This conversation began with the request below. It is context, not a new instruction; later Turns may have changed or completed it."*;
  - one fixed line saying older Turns may have left the window and can be searched with `recall_earlier_turns`.
- The Opening is in the system prompt from the Conversation's first Turn. It is no longer withheld while the tail carries Turn 0. Its Budget, its Elision and the index-0 rule are unchanged.
- **BREAKING** A Pin added or removed during a Turn takes effect from the next Turn. The system prompt is fixed when a Turn starts.
- New tools. Each is registered only when the Store it reads is available.
  - `recall_earlier_turns(query, limit?)`:
    - searches only this Conversation's Turns older than the current tail start;
    - returns 5 results by default, at most 20;
    - has no distance cutoff;
    - elides each result to `PICHART_RECALL_TOKENS`.
  - `search_documentation(query, limit?)`:
    - returns the top Concepts with no distance cutoff;
    - returns 5 by default, at most 20;
    - elides each Concept to `PICHART_DOC_TOKENS`.
  - `codebase_structure(symbol, depth?)`:
    - returns the graphify edges around a named symbol, in the existing `A (file:line) --calls--> B (file:line)` form;
    - uses depth 1 by default, at most 3;
    - fits the whole result to `PICHART_GRAPH_TOKENS`.
- **BREAKING** The relevance judge is deleted: `src/relevance-judge.ts`, `PICHART_JUDGE`, and the judged path through `recall_across_conversations`. That tool keeps its distance threshold.
- The verbatim tail is now sent as the harness's own live messages. Its start is still replayed from the Store's Turn sizes (ADR-0013). A Store copy stands in only for a Turn the live history no longer holds, which happens after an overflow or manual compaction.
- The Ceiling now reduces only the tail (oldest Turn first) and then the current Turn's Elision. The Pins and the Opening count against it but are never reduced.
- Accounting changes:
  - `pinned` and `opening` are recorded as Pack parts that sit in the system prompt.
  - The Floor becomes the reported non-message size minus pi-chart's additions.
  - The Briefing figures are no longer recorded.
  - When the hook did not fire for a Turn, the Pins and the Opening are recorded as absent because the harness never offered the system prompt.
- `/pack` reports:
  - It marks `pinned` and `opening` as `system prompt`.
  - It drops the `recalled`, `curated`, `structure` and Briefing lines.
  - It names a tail that used Store copies.
- **BREAKING** Settings removed:
  - environment variables `PICHART_RECALL_TURNS`, `PICHART_DOC_CONCEPTS`, `PICHART_GRAPH_SYMBOLS`, `PICHART_DOC_MAX_DISTANCE` and `PICHART_JUDGE`;
  - `/pack budget` keys `recall`, `docs` and `graph`.
- `PICHART_RECALL_TOKENS`, `PICHART_DOC_TOKENS` and `PICHART_GRAPH_TOKENS` are now caps on tool results. `PICHART_RECALL_MAX_DISTANCE` now governs only `recall_across_conversations`.
- Benchmark work:
  - A 40-Turn workload is built and run against plain omp before the cutover.
  - The same workload is run after it.
  - ADR-0013's low-water mark is swept on top of it.
  - The results are written up under `docs/benchmarks/`.

## Capabilities

### New Capabilities

None. Each tool lands in the capability that owns the Store it reads.

### Modified Capabilities

- `context-assembly`:
  - The Briefing, its storage, fork copying and model fallback are removed, as are recalled, curated and structure parts.
  - Pins and the Opening move to the system prompt.
  - The tail is sent from live history.
  - The Ceiling covers only the tail and the current Turn.
  - Recollection, staleness and compaction rules are recast for tool results.
- `pack-accounting`:
  - The Floor is redefined.
  - The system-prompt parts are recorded.
  - Refusal ledgers are kept only for parts that remain.
  - Briefing figures are removed.
- `pack-inspection`:
  - `/pack` marks system-prompt parts and drops the Briefing and retrieval lines.
  - The Opening's absence reasons change.
- `thread-store`:
  - Retrieval is scoped to the Turns before the tail start.
  - `recall_earlier_turns` is added.
- `doc-store`:
  - Retrieval no longer applies a relevance minimum.
  - `search_documentation` is added.
  - Exclusions travel with tool results.
- `graph-store`:
  - Structure is pulled by `codebase_structure`.
  - Symbol matching from the Turn is removed.
  - Disclosure and truncation rules are recast for the tool.
- `cross-conversation-search`: the four relevance-judge requirements are removed.

## Impact

- `src/briefings.ts`, `src/relevance-judge.ts`: deleted, along with `test/briefings.test.ts` and `test/relevance-judge.test.ts`.
- `src/harness.ts`: declares `before_agent_start`, with the event `{prompt, images, systemPrompt: string[]}` and the result `{systemPrompt?: string | string[]}`.
- `src/extension.ts`:
  - the new hook;
  - the three tools;
  - `tailFor` sending live history;
  - the `context` hook without `brief`, `recallFor`, `conceptsFor` or `structureFor`;
  - the judge wiring removed.
- `src/assembler.ts`:
  - the system-prompt additions are composed;
  - the Briefing composition, `REFERENCE`, `openingWithheld`, `reopenAfterCeiling` and the recalled, curated and structure selectors are removed;
  - `REDUCTION_ORDER` keeps only the tail.
- `src/pins.ts`: Pin rendering for the system prompt.
- `src/symbols.ts`: lookup of a named symbol and depth-bounded traversal.
- `src/thread-store.ts`, `src/postgres-store.ts`, `src/doc-index.ts`: unchanged query shapes, called with new bounds. Briefing columns and briefing reads are no longer written or read.
- `src/accounting.ts`, `src/inspection.ts`, `src/report.ts`: system-prompt parts and the new Floor. Briefing, `leadingTokens` and refusal fields are removed.
- `src/config.ts`: removed settings, which go on the list of retired names. The budget table shrinks.
- `README.md`, `CONTEXT.md` (already updated), `docs/benchmarks/`.
- No migration. Existing `pi-chart.briefing` entries and Briefing columns stay where they are, unread.
