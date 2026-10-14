## 1. Before-picture: the 40-Turn workload (on `15f68bc`, before any `src/` change)

- [x] 1.1 In `scripts/bench-tokens.ts`, grow `DEFAULT_WORKLOAD` to 40 Turns: turns 1–39 do read-only work over pi-chart's own source, and turn 40 is `PROBE`.
  - Keep the codeword at turn 1 and the build number at turn 3.
  - Turns 4–39 must push turn 3 out of the tail under the defaults (`PICHART_TAIL_TURNS=8`, `PICHART_TAIL_TOKENS=25000`).
  - Update the header comment.
  - Verify: `bun run typecheck` is clean, and `bun scripts/bench-tokens.ts --turns 3 --runs 1` completes both arms.
- [x] 1.2 Run the full workload, 3 runs per arm (plain omp and pi-chart at `15f68bc`). Save the JSON as `docs/benchmarks/<date>-token-usage-40-turns-before.json`. Verify: the file exists, and `--report` on it prints both arms with probe lines.

## 2. Harness hook and system-prompt additions

- [x] 2.1 Declare `before_agent_start` in `src/harness.ts`:
  - `BeforeAgentStartEvent {type, prompt, images?, systemPrompt: string[]}`;
  - `BeforeAgentStartResult {systemPrompt?: string | string[]}`;
  - its handler type and an `on` overload.
  Teach the fake `pi` in `test/extension.test.ts` to dispatch the event, threading `systemPrompt` through handlers as the harness does.
  Verify: `bun run typecheck` is clean.
- [x] 2.2 Red, in `test/assembler.test.ts`: write cases for `systemAdditions()` covering:
  - Pins in id order under standing-instruction framing, then the Opening inside `OPENING_FRAMING`, then `EVICTION_NOTICE`;
  - each section left out when empty;
  - the notice left out when recall is unavailable;
  - the Opening elided to `openingTokens` with a marker;
  - Budget 0 → `disabled`;
  - byte-identical across two calls;
  - parts carry `placement: "system-prompt"` and `tokens`.
  Verify: the cases fail.
- [x] 2.3 Implement `systemAdditions()`, `OPENING_FRAMING` and `EVICTION_NOTICE` in `src/assembler.ts`, and a system-prompt Pin renderer in `src/pins.ts`. Verify: the 2.2 cases and `test/pins.test.ts` pass.
- [x] 2.4 Red, in `test/extension.test.ts`: write cases covering:
  - the hook returns the given array plus one appended entry and never drops or reorders earlier entries;
  - a `systemPrompt` returned by an earlier handler is kept;
  - nothing to add → `undefined`;
  - a `/pack budget pins-tokens` or `opening-tokens` change made mid-Turn takes effect from the next agent start;
  - a Pin added mid-Turn appears from the next agent start, and the Call's Accounting records the Pins actually sent;
  - Turn 1 uses `event.prompt` as the Opening, and Turn 2 sends the same bytes even when the Store's Turn 0 copy differs (memo);
  - a resumed process reads the Store copy;
  - an Opening fetch that fails or times out → `failed`, not memoised, and retried next Turn;
  - no hook for a Turn → `pinned` and `opening` recorded absent `unhooked`.
  Verify: the cases fail.
- [x] 2.5 Implement the handler in `src/extension.ts` with `turnAdditions` and `openings` maps, and pass `AssembleInput.system` from the `context` hook. Add `unhooked` to `AbsenceCause`. Verify: the 2.4 cases pass.
- [x] 2.6 Smoke on a real omp session with the extension installed: send two Turns, and dump the request the harness sends with the capture extension (`test/capture-extension.ts`) or the Journal's request record. Verify:
  - the system prompt ends with pi-chart's block;
  - the harness's own entries are intact;
  - no Briefing message is sent;
  - what the harness does when `baseXdevCatalogDelivered` is false is written into design.md Risks (via `/opsx-update` if it changes the design).

## 3. Assembler: no Briefing, Ceiling over tail and current Turn

- [x] 3.1 Red, in `test/assembler.test.ts`: write cases covering:
  - the Pack's messages are the tail plus the current Turn only, with no appended message;
  - the Ceiling evicts the oldest tail Turns first, then elides the current Turn;
  - Pins and the Opening count against the Ceiling and are never reduced;
  - Pins plus Opening above the Ceiling are still sent, and the tail and current Turn go to their irreducible minimum.
  Delete the Briefing, `REFERENCE`, recalled/curated/structure, `carried` and `reopenAfterCeiling` cases.
  Verify: the new cases fail.
- [x] 3.2 In `src/assembler.ts`, delete:
  - `compose`, `BRIEFING_FRAMING`, `BRIEFING_MARKER`, `SEPARATOR`, `FENCE_TOKENS`, `REFERENCE`, `carriesBriefing`, `Pack.briefing` and `Pack.leadingTokens`;
  - the recalled, curated and structure selectors and renderers that are not reused by the tools (keep `asRecollection`, `fitRecollection` and `asCuratedKnowledge`);
  - `openingWithheld`'s `carried`, `reopenAfterCeiling` and `carriesFirstTurn`.
  Set `REDUCTION_ORDER = ["verbatim-tail"]` and subtract `system.tokens` from the room. Verify: `bun test test/assembler.test.ts test/recollection.test.ts test/elision.test.ts` passes.

## 4. Tail from live history

- [x] 4.1 Red, in `test/extension.test.ts`: write cases covering:
  - with the Store answering, the tail messages are the live messages' own objects, byte-identical to `event.messages` for those Turns, and `tailSource` is `"harness"`;
  - after a compaction that removed tail Turns from live history, those Turns come from the Store and `tailSource` is `"thread-store"`;
  - Store sizes unavailable → `"harness-fallback"`, as today.
  Replace the `tailSource: "thread-store"` assertion at the existing context test.
  Verify: the cases fail.
- [x] 4.2 Change `tailFor` to take content per Turn index from `live`, falling back to `recentTurns` copies, and change `TailSource` to `"harness" | "thread-store" | "harness-fallback"`. Verify: the 4.1 cases pass.

## 5. Pull tools

- [x] 5.1 Red, in `test/extension.test.ts`, over `MemoryTurnSource`: write cases for `recall_earlier_turns` covering:
  - registered only with a `recall` dep;
  - returns only Turns below the latest Call's tail start, even when tail Turns are more similar;
  - no cutoff (a distant Turn is returned);
  - default 5 and clamp to 20;
  - each result shows its Turn number and actions, elided to `recallTokens` with a marker;
  - before any Eviction → "nothing has left the window";
  - Store timeout or throw → text naming the Thread Store, not a throw.
  Verify: the cases fail.
- [x] 5.2 Implement `recall_earlier_turns` with `tailStarts` recorded by the `context` hook. Verify: the 5.1 cases pass.
- [x] 5.3 Red then green: `search_documentation`. Cases:
  - registered only with a `concepts` dep;
  - passes `NO_CUTOFF`;
  - keeps lifecycle and trust order;
  - default and clamp of `limit`;
  - each Concept attributed, with exclusions and sources, and elided to `docTokens` with the `walk_documentation` note;
  - failure → text naming the Doc Store.
  Change the `asCuratedKnowledge` footer. Verify: the cases pass.
- [x] 5.4 Red then green, in `test/graph.test.ts`: cases for `findSymbol` (bare, `Class.method`, trailing `()`, unknown → up to five nearest names) and depth traversal (depth 1 equals today's neighbourhood, depth 2 adds second hops without duplicate edges, depth clamped to 3), with output cut at a line boundary to `graphTokens` with a marker and the stale caveat kept. Then add `codebase_structure` (registered only with a `graph` dep; still loading → "not loaded yet") with a case in `test/extension.test.ts`. Verify: `bun test test/graph.test.ts test/extension.test.ts` passes.

## 6. Deletions

- [x] 6.1 Delete from `src/extension.ts`:
  - `brief`, `storedBriefings`, `recallFor`, `conceptsFor`, `structureFor`, the compat checks, the `session_switch`/`session_branch` Briefing refresh;
  - every judge path (`judgeWith`, `resolveJudge`, `judgeInForce`, `judgeAll`, judged `searchCorpus`).
  Delete `src/briefings.ts`, `src/relevance-judge.ts`, `test/briefings.test.ts`, `test/relevance-judge.test.ts`, the `describe("briefings")`, pins-Briefing and `describe("a judged search")` blocks in `test/extension.test.ts`, and `SearchJudgement` with its refusal notes in `src/report.ts`.
  Verify: `bun run typecheck` is clean, and grep finds no `Briefing`, `BRIEFING`, `briefing`, `judge` or `Judge` in `src/` or `test/` other than the retired-names list.
- [x] 6.2 Add a test that `recall_across_conversations` still applies `recallMaxDistance` and returns results without judging. Verify: it passes.

## 7. Configuration

- [x] 7.1 Make the configuration changes:
  - Remove `recallTurns`, `docConcepts`, `graphSymbols`, `docMaxDistance` and `judge` from `Config`, `SETTINGS`, `loadConfig`, `assemblerConfig` and `BUDGET_FIELDS`.
  - Add `PICHART_RECALL_TURNS`, `PICHART_DOC_CONCEPTS`, `PICHART_GRAPH_SYMBOLS`, `PICHART_DOC_MAX_DISTANCE` and `PICHART_JUDGE` to the retired-names list.
  - Reword `DEFAULT_EXPLAIN_CANDIDATES`' comment, and the comments on `recallTokens`, `docTokens` and `graphTokens` as tool-result caps.
  - Add cases: each retired variable warns, and `/pack budget recall 3` is refused with the remaining keys listed.
  Verify: `bun test` on the config and inspection files passes.

## 8. Accounting, inspection, report

- [x] 8.1 Red, then green, for Accounting:
  - In `test/accounting.test.ts` and `test/postgres-store.test.ts`, write cases covering:
    - `floorTokens = max(0, nonMessageTokens − systemTokens)` and `packTokens = promptTokens − floorTokens`;
    - `pinned` and `opening` parts are recorded with `placement: "system-prompt"` and read back;
    - `unhooked` is recorded and read back;
    - a record written before this change, with Briefing columns and without `placement`, still reads.
  - Then remove `BriefingFigures`, `CallAccounting.briefing`, the Briefing `ADD COLUMN`s, and the insert and select columns for the Briefing, `leading_tokens` and the retrieval refusal fields.
  - Verify: the cases pass.
- [x] 8.2 Change `/pack` in `src/report.ts` and `src/inspection.ts`:
  - mark `pinned` and `opening` as `system prompt`;
  - add `ABSENCE` wording for `unhooked` ("the harness never offered the system prompt") and drop `carried`;
  - print the tail-source line for `"thread-store"` ("some tail Turns are the store's copies") and `"harness-fallback"`;
  - remove the Briefing, prefix and retrieval-refusal lines;
  - `/pack why` candidates come only from the parts that remain.
  Update `test/report.test.ts` and `test/inspection.test.ts`, deleting the Briefing and FENCE arithmetic cases. Verify: those files pass.

## 9. Docs

- [x] 9.1 Update `README.md`:
  - the settings table (remove the retired variables; reword the token caps);
  - the `/pack budget` list;
  - the tools section (the three new tools; no judge);
  - the description of what a Pack carries.
  Verify: grep `README.md` finds no `Briefing`, `PICHART_JUDGE`, `PICHART_RECALL_TURNS`, `PICHART_DOC_CONCEPTS`, `PICHART_GRAPH_SYMBOLS` or `PICHART_DOC_MAX_DISTANCE`.

## 10. Close: full checks, after-picture, low-water sweep

- [x] 10.1 Run `bun run typecheck`, the full `bun test`, and `openspec validate pins-and-opening-ride-the-system-prompt --strict`. Verify: all clean.
- [x] 10.2 Smoke on a real omp session past the first Eviction. Verify:
  - `/pack` shows `pinned` and `opening` as `system prompt` and no Briefing line;
  - the model can call `recall_earlier_turns` and get an evicted Turn;
  - the Accounting Floor is the non-message size minus the additions.
- [x] 10.3 Run the 40-Turn workload, 3 runs per arm, on the change. Write up `docs/benchmarks/<date>-token-usage-40-turns.md` (plus JSON and SVG, in the 2026-10-14 format) against 1.2's before-picture. It covers:
  - cost ratio and uncached input;
  - the cache prefix held across Calls;
  - probe results for the codeword and build number;
  - how often and with what the model called each tool;
  - `recall_earlier_turns` result sizes.
  Verify: the write-up exists, and `--report` reproduces its tables.
- [x] 10.4 Sweep `PICHART_TAIL_LOW_WATER` over 0.4, 0.6 and 0.8 on the 40-Turn workload (pi-chart arm, 3 runs each), and add the results to the 10.3 write-up. Verify: one table compares cost, uncached input and probe results per value. Changing the default is a separate change.
