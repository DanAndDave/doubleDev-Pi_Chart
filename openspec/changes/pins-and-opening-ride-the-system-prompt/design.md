## Context

See proposal.md (Why) and ADR-0015 for the decision. The design has to fit the following current state.

- **Assembly runs on every Call, in the `context` hook** (`src/extension.ts`).
  - It fetches the tail (`tailFor`, Store copies, under `tailDeadlineMs`) and the Opening (`openingFor`).
  - It fetches recall, Concepts and structure (`recallFor`, `conceptsFor`, `structureFor`), each as `Supplied<T>`.
  - It calls `assemble()`, then `brief()`. `brief()` stores and places Briefings (`src/briefings.ts`) and returns the messages to send plus `BriefingFigures` for Accounting.
- **`assemble()`** (`src/assembler.ts`):
  - It builds the parts `verbatim-tail`, `current-turn`, `opening`, `recalled`, `curated`, `structure` and `pinned`.
  - `compose()` writes the Briefing as `BRIEFING_FRAMING` → Pins → `BRIEFING_MARKER` → `REFERENCE` parts.
  - `reduceToCeiling()` walks `REDUCTION_ORDER` (`structure, curated, recalled, opening, verbatim-tail`), then elides the current Turn.
  - `openingWithheld` reports the Opening as `carried` while the tail holds Turn 0. `reopenAfterCeiling` reinstates it once the Ceiling takes Turn 0.
- **`before_agent_start` is not declared in `src/harness.ts`.** In the installed harness (omp 18.10.4, read from the binary), `emitBeforeAgentStart(prompt, images, systemPrompt)`:
  - calls each extension's handlers in order with `{type, prompt, images, systemPrompt}`, where `systemPrompt` is a `string[]`;
  - turns a returned `systemPrompt` that is a string into `[string]`, and passes it on as the next handler's input;
  - runs once per agent start, which is once per Turn, before the provider is called.
  - If the base system prompt changes while a handler runs, the harness re-runs the hook, at most 3 times.
  - When any handler returns a `systemPrompt`, it sets `baseXdevCatalogDelivered: false`.
- **Accounting:**
  - `floorTokens = snapshot.nonMessageTokens` and `packTokens = promptTokens − nonMessageTokens` (`src/accounting.ts`).
  - `recordPack(…, tailSource, memoryBackend, briefing?)` writes Briefing columns (`briefing_mode`, `resent_briefings`, `resent_briefing_bytes`, `missing_briefings`) and `leading_tokens` (`src/postgres-store.ts`).
- **Stores:**
  - `TurnRecall.similarTurns(conversationId, prompt, limit, maxDistance)` has no lower bound on Turn index.
  - `ConceptSearch.searchConcepts(query, limit, maxDistance)` requires a distance.
  - `neighbourhoods(graph, symbols)` (`src/symbols.ts`) is one hop deep. `describeEdge` already emits `A (file:line) --rel--> B (file:line)`.
- **Tools** are registered in `register()` behind `pi.registerTool && dep`: `recall_across_conversations`, `walk_documentation` and `write_documentation`. Each returns `{content: [{type: "text", text}]}`.

## Goals / Non-Goals

**Goals:**
- Within a Turn, every Call sends the same system prompt and an unchanged tail prefix, so only the newest messages are uncached.
- Pins and the Opening are sent identically, byte for byte, on every Turn of a process until a Pin changes.
- One assembly path. No per-model fallback, no stored outbound messages.

**Non-Goals:**
- Changing `recall_across_conversations` beyond removing the judge. Its distance threshold and result shape stay.
- Migrating or deleting old `pi-chart.briefing` entries or Briefing columns.
- Recording what the model pulled as Pack parts. Pulled results are Turn content (ADR-0015).
- Tuning recall's embedded text or query. Only the threshold goes, and only for the new tool.

## Decisions

### 1. The hook appends one block; the `context` hook only reads what it appended

`register()` adds `pi.on("before_agent_start", …)`. The handler:

1. Resolves the Conversation from `ctx.sessionManager`, as the `context` hook does.
2. Builds `SystemAdditions` with `systemAdditions({pins, opening, recallAvailable}, config)`, a pure function in `src/assembler.ts`. It returns `{text, pins: PackPart, opening: PackPart, tokens}`. The text is the Pins (`renderPin`, standing-instruction framing), then the Opening inside `OPENING_FRAMING`, then `EVICTION_NOTICE`. A section is left out when empty. `EVICTION_NOTICE` is left out when `recall_earlier_turns` is not registered.
3. Returns `{systemPrompt: [...event.systemPrompt, additions.text]}`. When there is nothing to add, it returns `undefined`, which leaves the system prompt alone.
4. Stores `additions` in `turnAdditions: Map<conversationId, SystemAdditions>`, replaced on every agent start.

The `context` hook passes `turnAdditions.get(conversationId)` into `assemble()` as `AssembleInput.system`.

- When the entry exists, `pinned` and `opening` are recorded from it, with `placement: "system-prompt"`, and their tokens count against the Ceiling.
- When it is missing, both are recorded absent with the new cause `unhooked`.

`assemble()` never builds the system text itself, so what Accounting records is exactly what was sent.

Why one block appended rather than several array entries: one entry makes "pi-chart's additions" a single, measurable unit, and the harness joins entries anyway.

Rejected alternative: rebuild the additions in the `context` hook on every Call. Pins changed mid-Turn would then be recorded as sent when they were not.

### 2. The Opening's text comes from the first place it is known, then stays fixed

`openingText(conversationId, event)`:

- Memoised per Conversation in `openings: Map<conversationId, string>`.
- On a miss, it reads `deps.opening.openingPrompt()` under `inTime("Thread Store (opening)", tailDeadlineMs)`.
- If the Store has no Turn 0 and this agent start is the Conversation's first Turn (the branch holds no user message yet), it uses `event.prompt` and memoises it.
- Elision (`elidedOpening`, `openingTokens`) is applied to whatever text results, so the result is deterministic.
- On a Store failure or timeout, the Opening is left out for this Turn, recorded as `failed`, and not memoised.

Why memoise: the Store copy of Turn 0 and `event.prompt` may differ in joining or whitespace. Without the memo, Turn 2 would change the system prompt and rewrite the whole cache. A resumed process reads the Store copy once, and the cache it rewrites then is already cold after a restart.

Rejected alternative: always read the session branch's first user message. It is not yet in the branch on Turn 1, and ADR-0014 makes the Store's Turn 0 the Opening.

### 3. Tail content is the live slice; the Store fills only what the live history lacks

`tailFor` keeps computing the start from Store sizes (`tailFrom`/`tailStart`, ADR-0013). Content is then taken per Turn index:

- If `live` (from `reconstructTurns(event.messages)`) holds the Turn, the live messages are used, unchanged.
- Otherwise the Store's `recentTurns` copy is used. This happens when a compaction cut it from live history.

`TailSource` becomes:

- `"harness"` when every tail Turn came from live history;
- `"thread-store"` when at least one Turn is a Store copy;
- `"harness-fallback"` when Store sizes were unavailable. The meaning of `"harness-fallback"` is unchanged.

`/pack` prints a line only for the last two.

Why per Turn: after an overflow compaction, the live history starts with a compaction summary. The Store copies are the only verbatim form of the Turns before it.

### 4. The Ceiling reduces the tail, then the current Turn

- `REDUCTION_ORDER` becomes `["verbatim-tail"]`.
- `reduceToCeiling` subtracts `system.tokens` (Pins and Opening) from the Ceiling before fitting the tail and the current Turn.
- `openingWithheld`'s `carried` branch, `reopenAfterCeiling`, `carriesFirstTurn`, `REFERENCE`, `compose`, `FENCE_TOKENS`, `BRIEFING_*` and `leadingTokens` are deleted.
- If Pins plus Opening alone exceed the Ceiling, they are still sent. The tail and the current Turn shrink to their irreducible minimum, as today when the current Turn alone is too large. In practice Pins (2k) plus Opening (1k) against 300k cannot do this.

### 5. Three tools, each a thin call into an existing Store query

All three:

- are registered in `register()` beside `walk_documentation`;
- run under the existing per-Store deadlines (`recallDeadlineMs`, `docDeadlineMs`, `graphDeadlineMs`) via `inTime`;
- on failure, return a text result naming the Store and the reason, as `recall_across_conversations` does;
- clamp `limit` to `1..MAX_SEARCH_RESULTS` (20), with a default of `DEFAULT_SEARCH_RESULTS` (5).

**`recall_earlier_turns(query, limit?)`.** Registered when `deps.recall` exists.

- It reads `tailStarts.get(conversationId)`, the tail start the most recent `context` Call recorded for this Conversation.
- It calls `similarTurns(conversationId, query, limit + (currentTurnIndex − tailStart + 1), NO_CUTOFF)`, keeps Turns with `turnIndex < tailStart`, and takes `limit`.
- If no Call has recorded a start yet, nothing has been evicted, and the result says so.
- Each result is rendered with the existing `asRecollection` and elided to `recallTokens` (`fitRecollection`).
- `NO_CUTOFF = 2`, the largest cosine distance.

Why over-fetch rather than add a `before` bound to the SQL: the over-fetch is bounded by the tail's Turn count (≤ 9), the Assembler already does it today, and the Store contract stays unchanged.

**`search_documentation(query, limit?)`.** Registered when `deps.concepts` exists.

- It calls `searchConcepts(query, limit, NO_CUTOFF)` and renders each hit with `asCuratedKnowledge`, elided to `docTokens`.
- The footer `(the rest … is readable with walk_documentation, at no budget)` becomes `(the rest is readable with walk_documentation)`.
- Lifecycle and trust ordering stay in the Store query.

**`codebase_structure(symbol, depth?)`.** Registered when `deps.graph` exists.

- `depth` defaults to 1 and is clamped to `1..3`.
- The symbol is resolved through a new `findSymbol(graph, name)` in `src/symbols.ts`, using `PreparedGraph.byName`. A qualified `Class.method` name, or a name with `()`, is normalised first.
- It expands breadth-first with `neighbourhoods(graph, frontier)` per hop and de-duplicates edges. Each hop keeps `MAX_EDGES` balancing.
- It renders with `qualify` and `describeEdge`, in the existing form, with the stale caveat.
- The whole result is cut to `graphTokens` at a line boundary, with an elision marker.
- An unknown name returns the five nearest names by prefix.
- A graph still loading returns "structure is not loaded yet", as the Call path did.

Rejected alternative: a single `search` tool over all three Stores. The results differ in kind, and the model choosing which Store to ask is the point of ADR-0015.

### 6. Settings shrink to what the tools use

- **Removed:** `recallTurns`, `docConcepts`, `graphSymbols`, `docMaxDistance` and `judge`, their environment variables, and the `/pack budget` keys `recall`, `docs` and `graph`. The removed variables join the retired-names list in `src/config.ts`, so a variable that is still set produces the existing "no longer read" warning.
- **Kept, with a new meaning:** `recallTokens`, `docTokens` and `graphTokens` (caps on tool results), and `recallMaxDistance` (`recall_across_conversations` only).
- `DEFAULT_EXPLAIN_CANDIDATES`' comment, which cites recall's over-fetch, is reworded. The value stays.

### 7. The Floor subtracts what pi-chart added

`recordMeasurement` sets:

- `floorTokens = max(0, nonMessageTokens − systemTokens)`;
- `packTokens = promptTokens − floorTokens`.

`systemTokens` is the `SystemAdditions.tokens` recorded with the Call's Pack. That is an estimate subtracted from a measurement. The estimator's bias on 3k tokens is at most a few hundred tokens of Floor, and Accounting already labels the Pack as estimated.

`RecordedPart` gains `placement?: "system-prompt"`. Records that lack it read as message parts.

### 8. Deletions are clean

The following are deleted:

- `src/briefings.ts`, `BriefingFigures`, and `CallAccounting.briefing`;
- the Briefing columns from the schema's `ADD COLUMN` list and from the insert and select statements;
- `leading_tokens`, `concepts_unsearched`, `rejected` and `unsearched` from the write path, where only retrieval parts fed them;
- the `compat.supportsMidConversationSystem` and `supportsTurnScopedSystem` checks;
- `src/relevance-judge.ts`, `judgeWith`, `resolveJudge`, `judgeAll`, and `SearchJudgement` in `report.ts`;
- the `session_switch` and `session_branch` refresh of stored Briefings.

Existing columns stay in old databases. They are nullable and no longer named.

## Risks / Trade-offs

- **[Risk]** Five recall results at 8,000 tokens each make a 40k-token tool result, and `PICHART_RECALL_TOKENS` was a total Budget before. → ADR-0015 fixes the per-result cap. The 40-Turn benchmark records `recall_earlier_turns` result sizes. If they are large, lowering the cap is a settings change, not a design change.
- **[Risk]** Returning `systemPrompt` sets the harness's `baseXdevCatalogDelivered: false`. → Read in omp 18.10.4's bundled source: the flag only chooses which pending tool-roster and xdev-mount notices the harness inserts, as hidden messages before the Turn's prompt, and counts them against the last announced state instead of the base catalog. No message is added unless a tool or mount change is pending, so a Turn with an unchanged roster sends nothing extra. The design is unchanged.
- **[Risk]** Recall now depends on the model choosing to search. → The benchmark's turn-3 probe measures this, and the eviction notice names the tool.
- **[Risk]** No distance cutoff means `recall_earlier_turns` always returns something, even when it is irrelevant. → The model asked, and results carry their Turn number. That is the same trade `search_documentation` makes.
- **[Trade-off]** A Pin added mid-Turn waits for the next Turn. Applying it immediately would rewrite the system prompt mid-Turn and drop thinking.
- **[Trade-off]** Turn 1's prompt is sent twice until it leaves the tail. It is at most 1,000 tokens and cached.

## Migration Plan

- Run the 40-Turn workload against plain omp and against pi-chart at `15f68bc` **before** any code changes (tasks group 1). It is the before-picture.
- There is no data migration. On the first Call after upgrading, a resumed Conversation sends no Briefing and rewrites the cache once.
- Rollback is a revert of the change's commits. The old code ignores what this change writes, because the parts JSON stays a superset.

## Testing seams

| Requirement area | Seam |
|---|---|
| System-prompt text, ordering, omission rules, Opening framing, Elision | `systemAdditions()` in `src/assembler.ts`, a pure function (`test/assembler.test.ts`) |
| Hook appends and never replaces; additions recorded per Turn; `unhooked` absence; Pin change takes effect next Turn; Opening memo and Turn-1 source | the fake `pi` in `test/extension.test.ts`, extended with `on("before_agent_start")` and a dispatcher |
| Tail sourced live per Turn, Store copy after compaction, `TailSource` values | `context` hook through the fake `pi` (`test/extension.test.ts`) |
| Ceiling reduces only tail, then current Turn; Pins and Opening never reduced | `assemble()` (`test/assembler.test.ts`) |
| `recall_earlier_turns` scope below the tail start, no cutoff, per-result cap, deadlines | the tool's `execute` via the fake `pi` registry, over `MemoryTurnSource` |
| `search_documentation` no cutoff, per-Concept cap, ordering | tool `execute` via the fake `pi`, over the Doc Store test doubles in `test/doc-index.test.ts` style |
| `codebase_structure` lookup, depth, cap, unknown name | `findSymbol` plus traversal in `src/symbols.ts` (`test/graph.test.ts`); registration gate via the fake `pi` |
| Floor subtraction, `placement`, no Briefing figures | `MemoryAccounting` (`test/accounting.test.ts`) and `PostgresStore` (`test/postgres-store.test.ts`) |
| `/pack` marks system-prompt parts and names the tail source | `report.ts` renderers (`test/report.test.ts`) |
| Removed settings warn; refused `/pack budget` keys | `loadConfig` cases in `test/extension.test.ts` (beside the retired `CM_*` names) and the settings-list test in `test/install.test.ts`; `setBudget` in `test/inspection.test.ts` |
