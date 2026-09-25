## 1. Measure before choosing

- [x] 1.1 Time `graphify extract --code-only` on this repository unchanged, after a one-file edit, and after a new file, and record each figure against the archived "21 files cached/unchanged" claim
- [x] 1.2 Measure the size of a Call's whole-Turn candidate text across this machine's Journals, and choose the per-message bound from those figures, recording what it costs on the largest Turn
- [x] 1.3 Count, over this repository's own graph, how many over-sized symbols currently spend the twelve-edge cap on `contains` and `method` connections, and record the figure the new ordering is judged against

> **1.1** On this repository (73 code files): a cold extraction takes **1.91 s**; an unchanged tree **0.87–0.95 s** at "73 files cached/unchanged, 5 re-extracted"; a one-file edit **0.92 s** at 72/6; a new file **0.88 s** at 72/7. The archived claim was "21 files cached/unchanged, 0 re-extracted" on a smaller tree; the five re-extracted here are graphify's own outputs under `graphify-out/`, which every run rewrites and the next run re-hashes. They contribute no nodes. So a refresh costs roughly a second of subprocess whatever changed — affordable off the request path, and not affordable on it.
>
> **1.2** Over 423 real Turns: the median Turn offers **91** candidate characters, the p90 4,509, the widest **1,580,818** across 1,805 messages; the largest single message is 71 at the median and 39,435 at worst. Scanning the widest Turn whole costs **89 ms** on the Call's own path — more than recall's entire measured budget of 81 ms — and still matches 413 of 638 symbols, most of the graph. Bounded to the **1,000-character head of each of the 32 most recent messages** it costs **1.1 ms** and matches 95. Both bounds were needed: the per-message head alone left the widest Turn at 44 ms.
>
> **1.3** Of 57 over-sized symbols in this repository's graph, **38** kept at least one `contains`/`method`/`references` connection, **188 of 684** kept connections were membership (27.5%), and **29** had real uses displaced by them.

## 2. Freshness across a Conversation

- [x] 2.1 Refresh the graph at `agent_end` as well as `session_start`, in the background, and verify a Turn's Calls are not delayed by it
- [x] 2.2 Verify a Conversation that edits a file offers structure for the edited file on a later Turn, and the pre-edit structure before it
- [x] 2.3 Verify against the real tool that a refresh over an unchanged tree re-extracts nothing, and one after a single edit costs about that edit
- [x] 2.4 Verify a refresh that cannot run is reported, leaves the previous graph readable, and does not fail the Turn

> A headless run exposed the gap the background refresh leaves: the extraction `agent_end` started was still running when the process exited, and the graph was left **older than the edit that Turn had just made**. `session_shutdown`, which is awaited, now waits for it — `refresh` returns the extraction already in flight for that Codebase, so this waits rather than extracting twice. Live, the same session then carried `probeLiveStructure()` — a function the previous Turn wrote — on the next Turn.

## 3. Structure that says how old it is

- [x] 3.1 Determine a neighbourhood's freshness from the symbol's own file against the extraction, and verify an edited file's neighbourhood is reported as older while an untouched file's is not
- [x] 3.2 Verify a symbol whose file cannot be examined is reported as older rather than current
- [x] 3.3 Mark older structure in the message the Pack carries, beside the symbol it describes, and verify the mark names the reason
- [x] 3.4 Verify one Pack carrying an edited and an untouched file marks only the edited one
- [x] 3.5 Verify structure is carried marked rather than withheld when every symbol in play is older than the Codebase
- [x] 3.6 Verify fresh structure is byte-identical to what the Pack carried before this change

> `GraphStore.changedSince` stats each file once, whatever the over-fetch asked for, and the Pack renders `[codebase structure: assemble() (src/assembler.ts:L92) (older than the codebase)]` — the shape a stale Concept already has. 3.6 holds because the caveat is empty unless the file is older, which the existing assertions on the exact unmarked heading pin.

## 4. The symbols the Turn is working with

- [x] 4.1 Draw candidates from the current Turn's messages — prompt, assistant text, tool names, arguments, results — and verify a tool-loop Call whose prompt names nothing yields structure for the files the Turn read
- [x] 4.2 Bound each message's contribution to the measured head, and verify one outsized tool result does not displace the symbols the prompt and tool arguments name
- [x] 4.3 Order candidates prompt-named first, then named elsewhere in the Turn, then reached only through a file, and verify a directly named symbol outranks a file's other symbols
- [x] 4.4 Verify the rule disregarding an ordinary word matching only a member's name still holds over the wider text
- [x] 4.5 Verify a Turn naming nothing the graph knows still yields no symbols

> The member-name rule is applied over the whole Turn in one pass, and the prompt is scanned a second time only to order the result — so an unambiguous name anywhere in the Turn still disqualifies the bare English words, which is what the requirement asks. The recency bound is its own observable: a symbol named 40 messages back is not found, and one named in the latest message is.

## 5. Paths as symbols

- [x] 5.1 Index symbols by the file the graph already carries, and verify a path in play resolves to the symbols that file defines
- [x] 5.2 Verify a repository-relative, a dot-relative, and an absolute form of the same path all resolve to the same symbols
- [x] 5.3 Verify a bare token matching a file's name resolves through that file, so `assembler` reaches `assemble`
- [x] 5.4 Verify a path no symbol belongs to yields nothing rather than a partial-token match

## 6. Relation-ordered truncation

- [x] 6.1 Rank connections by relation before the existing direction alternation, and verify a hub symbol's callers and importers survive while its members are the ones left out
- [x] 6.2 Verify the twelve-edge cap and the inbound/outbound alternation are unchanged, and both directions still appear in a truncated neighbourhood
- [x] 6.3 Verify truncating the same over-sized neighbourhood twice keeps the same connections in the same order
- [x] 6.4 Verify a neighbourhood within the cap carries every connection, and the count of those left out is unchanged where truncation happens
- [x] 6.5 Re-run task 1.3's count against the new ordering and record the improvement

> **6.5** Re-counted over the same graph with the ranking in force: membership connections kept fall from **188 of 684 to 127 of 684** (27.5% → 18.6%), symbols keeping at least one fall from 38 to **28**, and symbols whose uses were displaced by membership fall from **29 to 14**. The remaining fourteen are the direction alternation doing its job: a symbol whose outbound edges are all membership spends its outbound slots on them rather than giving both slots to inbound callers, which is the rule that stopped two of nineteen over-sized symbols coming back with no callers at all.

## 7. Indexes built once per extraction

- [x] 7.1 Build the name, file, and incident-edge indexes beside the cached parse, and verify a second Call over an unchanged extraction rebuilds none of them
- [x] 7.2 Verify a changed extraction invalidates the indexes with the parse, so structure comes from the new graph
- [x] 7.3 Verify symbol selection and neighbourhood construction remain pure functions of the prepared graph and the Turn

> `graph()` now returns a `PreparedGraph` — symbols, edges, `extractedAt`, and the name, file, stem and incident indexes — and the same object comes back until the extraction changes. Both functions take that value and a Turn and nothing else, which the determinism assertions pin.

## 8. Wiring that does not require Postgres

- [x] 8.1 Register from one `Dependencies` literal with only Thread-Store-backed members conditional, and verify a declined Thread Store still registers the Graph Store
- [x] 8.2 Verify a session with no database assembles a Pack carrying structure, and its other parts are unchanged
- [x] 8.3 Report once when a structure Budget is configured and no graph can be reached, naming why, and verify a Codebase with a graph reports nothing
- [x] 8.4 Report structure in the install check from the Store that exists rather than from configuration alone, and verify it reads unavailable with no Store, declined when extraction is off, and on otherwise

> The shared literal carries `graph`, `walk`, `specs`, `codebase`, `report` and `show`; only the Thread-Store-backed members are conditional. 8.2 is what the whole extension suite already exercises — its harness has no database — and the live run below assembled structure with `PICHART_DATABASE_URL=""` throughout.

## 9. Verification

- [x] 9.1 Run a live session that edits a file and then asks about a symbol in it, and confirm the Pack carries the edited file's structure with no older-than-Codebase mark
- [x] 9.2 Run a live session whose Turn reads several files without naming a symbol, and confirm `/pack` shows structure for those files
- [x] 9.3 Run a session with `PICHART_DATABASE_URL=""` and confirm `/pi-chart` reports the Graph Store honestly and `/pack` shows the structure part
- [x] 9.4 Run the default and tool-gated suites (`PICHART_GRAPHIFY=1`) and the type checker, and confirm `openspec validate structure-freshness` passes

> A three-Turn live session over a copy of this project's `src/`, with `PICHART_DATABASE_URL=""` and `PICHART_GRAPH=on`, asked at the end of each Turn to quote back every `[codebase structure:` line it had been given.
>
> **9.1** Turn 1 appended `probeLiveStructure()` to `src/shares.ts`; Turn 2 was given `[codebase structure: shares() (src/shares.ts:L15)]` **and** `[codebase structure: probeLiveStructure() (src/shares.ts:L43)]`, unmarked — a symbol that did not exist when the Conversation began.
>
> **9.2** Turn 3 read `src/elision.ts` and `src/shares.ts` and named no symbol; it was given structure for `ELISION` and `shares`.
>
> **9.3** Both Turns above ran with no Thread Store. Turn 1's first Calls reported `Structure is configured (3 symbols) but this codebase has no graph` — correctly, before the first extraction finished — and said it once per process.

## 10. Review

Two axes, both against `7b6ccf5`.

**Spec.** One finding: `design.md` writes the truncation ranking as a list of twelve preferred relations, while the code tests the complement — three membership relations. They are the same rule, because `PROGRAMMATIC` (`src/graph.ts`) carries exactly those fifteen and nothing else; a second list of twelve would be the same rule written to fall out of step. Said so where the set is defined, with the before-and-after figures beside it. Every delta scenario has a test behind it; the reviewer's note that path resolution is untested is wrong — `test/graph.test.ts`'s "a file in play" covers all four of its scenarios.

**Standards.** One finding acted on: structure reads `(older than the codebase)` while a Concept reads `(stale)`. Kept, with the reason recorded beside it — a Concept's staleness is its author's declaration in the bundle's frontmatter, and structure's is measured against the file the symbol lives in, so one wording would offer a provenance neither has.

Three answered rather than changed. The over-fetch of `graphSymbols * 2` in `structureFor` is the same shape recall and the Doc Store already use in the same function; moving one of the three into its Store would make the Call's own path read three ways. The measured figures in `graph-store.ts`'s deadline comment predate this change and are this project's convention — a deadline with no measurement behind it is a number someone guessed. The "duplicated" staleness is one decision in the extension, one field on the Neighbourhood, and one renderer, which is the shape every other per-part fact already has.
