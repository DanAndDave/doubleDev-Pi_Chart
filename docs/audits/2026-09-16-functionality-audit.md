# Functionality audit — 2026-09-16

What works, what is wrong, and what to build next. Read against `src/` at the commit this file was added; every claim carries `file:line` so it can be rechecked or found to have moved.

Scope: functionality only — missing capability, wrong behaviour, silent degradation, retrieval quality, Budget and Accounting accuracy. Not style, not coverage, not refactors.

## Method

Five read-only subsystem passes (Thread Store, Doc Store, Graph and Spec Stores, Assembler and Accounting, spec-versus-code drift), plus measurements taken against this machine's real Journals using the project's own code rather than fixtures. Fixtures are small and synthetic, so they cannot show the failure that matters.

```sh
bun test          # 328 pass, 112 skip, 0 fail
bun run typecheck # clean
```

Measured over 219 Journals under `~/.omp/agent/sessions` (373 Turns), via `readJournal` and `approximateTokens`:

| Quantity | Approximate tokens |
| --- | --- |
| Median Turn | 36 |
| p90 Turn | 1,229 |
| p99 Turn | 70,069 |
| Largest Turn | **526,302** (1,805 messages: 380,471 assistant, 146,257 toolResult) |
| Worst eight consecutive Turns — the default `CM_TAIL_TURNS` | **974,861** |

Calling `assemble()` on that largest Turn with default Budgets produced a **526,303-token pack** from one tail slot, with no error and no clamp. The same session, re-ingested the way `runSweep` does it, costs **25,069 sequential statements** across sixteen Turns.

The median Turn is tiny. The distribution is the point: the failure is confined to tool-heavy Turns, which is the work this project exists to support.

### How the eight-Turn figure is derived

`readJournal` groups each Journal into Turns, each Turn is sized with the project's own `approximateTokens` (`src/assembler.ts:290-296`), and an eight-Turn window — the default `CM_TAIL_TURNS` — slides across every Journal. The maximum lands on one session, `2026-09-16T04-20-35…01a0a871`, the session that wrote this project, at Turns 7–14:

| Turn | Messages | Calls | Approximate tokens |
| --- | --- | --- | --- |
| 7 | 662 | 328 | 249,497 |
| 8 | 472 | 236 | 111,142 |
| 9 | 1,805 | 902 | **526,302** |
| 10 | 18 | 9 | 3,126 |
| 11 | 8 | 4 | 485 |
| 12 | 64 | 31 | 36,714 |
| 13 | 16 | 8 | 3,947 |
| 14 | 176 | 88 | 43,648 |

`249,497 + 111,142 + 526,302 + 3,126 + 485 + 36,714 + 3,947 + 43,648 = 974,861`, three Turns carrying 91% of it. Those Turns are large because they wrote this codebase: a `write` call carries the whole file in its arguments, which is why 380,471 of Turn 9's tokens are assistant content rather than tool results.

### The estimator understates by 35–49%

That Journal records a `contextSnapshot` per Call, so the estimator can be checked against the provider's own accounting — cumulative estimate at the end of each Turn against the harness's reported `promptTokens − nonMessageTokens`:

| Turn | Estimate | Harness reported | Ratio |
| --- | --- | --- | --- |
| 0 | 12,029 | 17,905 | 1.49 |
| 2 | 46,422 | 67,331 | 1.45 |
| 4 | 82,018 | 116,571 | 1.42 |
| 6 | 92,070 | 128,113 | 1.39 |
| 7 | 341,567 | 459,865 | 1.35 |
| 8 | 452,709 | 628,391 | 1.39 |

Real tokens run 1.35–1.49× the estimate, consistently and in one direction, because `approximateTokens` counts only `content` and ignores `details`, `role`, `toolName` and `toolCallId`. **974,861 approximate is therefore roughly 1.3–1.4 million real tokens.** Every figure in this audit is the low one.

### What these numbers are and are not

- One session, not a distribution. The median Turn is 36 approximate tokens and p90 is 1,229; this is a tail-risk measurement, and the tail is where the work happens.
- That session was not governed by the extension — it was the session writing it. So 974,861 is what a tail *would* carry if those eight Turns were the most recent eight, derived from recorded content rather than from an observed pack.
- It assumes ingest captured every message, which `recentTurns` replays whole.
- Not reproduced live: no governed session has been driven to provider refusal. The reachable proof is this arithmetic plus `assemble()` returning a 526,303-token pack from one real Turn, which was run.

## Spec conformance

41 of 45 requirements across the eight capability specs are implemented as written, and no requirement is genuinely unbuilt — none lacks both code and test. The four partial rows are the whole of the specified drift:

| Spec | Requirement | Why partial |
| --- | --- | --- |
| context-assembly | Assembly is the only memory injection | Observed and reported, never enforced (`src/extension.ts:197-221`; the `context` handler behaves identically either way, `:224-274`) |
| context-assembly | Structure around symbols in play | The Graph Store is only wired on the Postgres branch (`src/extension.ts:864`) |
| graph-store | Structure available without being asked for | Same wiring, plus opt-in extraction by design (`src/config.ts:64`) |
| pack-inspection | Irrelevance distinguished from trimming | `irrelevant` is set on the recalled part only (`src/assembler.ts:133`); curated and structure never set it (`:139-169`) |

## The structural defect: Budgets count items, the window is measured in tokens

`AssemblerConfig` is four integers (`src/assembler.ts:6-24`), each applied with `slice()` (`:114,139,155`). `loadConfig` parses all four with `count()` (`src/config.ts:56-70`) and `setBudget` accepts nothing else (`:83-112`). `approximateTokens` (`src/assembler.ts:290-296`) is consumed only by `recordPart`/`recordPack` (`src/accounting.ts:109,182`) and `report.ts:33`; it never reaches a decision. The only size-shaped limit in the repository is `MAX_EDGES = 12` (`src/symbols.ts:20`), which bounds the structure part alone.

There is therefore no token ceiling, no per-part clamp, and no tool-result truncation anywhere in `src/`. A Turn carries an unbounded number of tool calls, and the tail carries whole Turns verbatim, so pack size is unbounded by configuration — 526,303 approximate tokens from a single real Turn, on top of a Floor measured at 27,457 in that session and 25,588 in `test/fixtures/multi-turn.json:49`. Nothing in the Assembler knows what the model's window is, so the limit is discovered by hitting it.

"The context window stops growing" holds per Turn count and fails per byte. What overflow costs depends on the provider: in the one session measured here the harness compacted at 822,279 tokens rather than refusing, which is the lossy salvage this project exists to replace; a model with a smaller window refuses outright. Either way `/pack` reports it only afterwards, and the only mitigation a user has is to lower `tail` to a number that guesses at bytes.

### Measured: the Turn-count Budget removed 9% of the bytes

The same Journal records what an ungoverned window actually cost, Turn by Turn — the harness's own reported pack size, with nothing assembling it:

| Turn | 0 | 4 | 6 | 7 | 8 | 9 | 14 | 15 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Max pack tokens | 17,905 | 116,571 | 128,113 | 459,865 | 628,391 | **822,279** | 707,831 | 716,988 |

Monotonic accumulation, with `compactionEpoch` flipping 0→1 during Turn 9 — the harness compacting at 822k, which is the lossy salvage this project exists to make unnecessary. The problem is real and this is the measurement of it.

Applying the Assembler to that session's last Turn:

| | Approximate tokens |
| --- | --- |
| Ungoverned, all sixteen Turns | 1,075,409 |
| Governed, eight-Turn tail plus the current Turn | 983,339 |
| Reduction | **8.6%** |

Dropping half the Conversation bought 9% of the bytes, because the Turns dropped were the small early ones and the Turns kept are the giants. A count-denominated Budget deletes history in the order least correlated with cost. The same ceiling denominated in tokens bites immediately:

| Tail ceiling | Turns kept | Actual spend |
| --- | --- | --- |
| 60,000 | 13, 14 | 47,595 |
| 120,000 | 10–14 | 87,920 |

Five recent Turns for 88k instead of eight for 974k. The tail is the right idea; counting it in Turns is what fails. This is also what makes whole-Conversation recall affordable: while the tail can consume the entire window, there is no room left for a Turn retrieved from early in the Conversation, however relevant — so the size defect and the recall defect are one defect.

**The fix** is a token Budget per part alongside the count, plus a pack ceiling, enforced in `assemble` after the count slice: drop whole Turns from the front of the tail and the weakest recollections first until the estimate fits, and record "dropped for size" as a reason distinct from "not relevant enough". Each recollection and each tool result gets a head-and-tail cap with an explicit elision marker. This is the one change that makes every other Budget claim true, and it should land before anything else here.

## Bugs

**Recollections keep the tool output and drop the tool call.** `asRecollection` renders each message as `` `${role}: ${messageText(message)}` `` and filters lines with no text (`src/assembler.ts:272-276`). `messageText` returns only `type: "text"` blocks (`src/messages.ts:55-66`), and an assistant tool call is a `toolCall` block with none (`test/fixtures/journal-tool-session.jsonl:13`), so the line becomes `"assistant: "` and is dropped, while the `toolResult` survives whole. Reproduced against that fixture: the file contents come back, the `write(...)` and `read(...)` invocations do not. A recalled Turn arrives as a wall of output with no record of why anything was read — the expensive half kept, the explanatory half discarded. Render tool calls from the block's `name`/`arguments`.

**Re-ingest relabels a Conversation's Codebase with the current working directory.** `codebase = COALESCE(EXCLUDED.codebase, turns.codebase)` lets EXCLUDED win whenever the caller passes a value (`src/postgres-store.ts:263`), the caller always passes `process.cwd()` (`src/extension.ts:869`), and every sweep re-ingests all Turns of the Conversation (`:663-670`). Resume from a different directory — or a subdirectory, since `/repo` and `/repo/sub` are different strings — and every historical Turn is re-attributed. `recall_across_conversations` then reports a provenance that never happened, which is the one thing its spec promises. Set `codebase` on insert only.

**A Turn whose content changes keeps its old vector forever.** `embedPending` selects `WHERE embedding IS NULL` (`src/postgres-store.ts:306`) and ingest's `DO UPDATE` never nulls the embedding when the prompt or messages change (`:259-289`). `readJournal` drops a partially flushed final line (`src/journal.ts:47-50`), and both `agent_end` and `session_shutdown` sweep (`src/extension.ts:288-297`): the `agent_end` pass can embed a truncated Turn, the shutdown pass repairs the rows, and the vector stays wrong. `concept_sections` already does this correctly with a `hash` column (`src/postgres-store.ts:687-700`); apply the same pattern to `turns`.

**A model swap silently corrupts recall.** `CM_EMBED_MODEL` overrides the pinned model (`src/embedder-worker.ts:17`) and `Bun.spawn` inherits the environment (`src/embedder.ts:147-151`). `dimensions` is the hardcoded constant rather than the running model's (`src/embedder.ts:57`), the schema pins width only (`src/postgres-store.ts:96-97,296-301`), and no migration records which model produced a vector (`:50-165`). Any other 384-dimension model passes every check, after which old and new vectors share one table in different spaces and ranking against the 0.5 threshold is arbitrary. Nothing errors. Record the producing model per vector, treat a mismatch as pending so `embedPending` re-embeds, and fail loudly on a mid-corpus swap.

**The graph is frozen at session start and served as current.** `refresh()` is called only from `session_start` (`src/extension.ts:163-169`), and `graph()` keys its cache on `graph.json`'s own mtime without ever comparing it to a source file (`src/graph-store.ts:159-181`). In any session where the agent edits code, packs keep emitting pre-session `file:line` coordinates: line numbers drift with the first insertion, new symbols are absent, deleted ones are presented as live callers. A Concept gets an explicit `(stale)` stamp (`src/assembler.ts:259`); structure gets nothing. Re-`refresh()` on `agent_end` — graphify's extraction is content-hash incremental, so an unchanged tree is nearly free — and stamp a neighbourhood whose graph predates the newest source mtime.

**A Concept is injected as one section but labelled as the whole Concept.** `searchConcepts` returns the single best section per identity via `DISTINCT ON` (`src/postgres-store.ts:806-812`), and the Assembler heads it `[curated knowledge: <id>]` with no section marker (`src/assembler.ts:258-268`). The model cannot tell a fragment from a Concept and has no pointer to the rest. Name the section in the attribution and say that more exists.

**`CM_PG_PORT` is documented and read by nothing in `src/`.** `README.md:131` offers it as an override; `compose.yaml:10` honours it; `DEFAULT_DATABASE_URL` hardcodes `localhost:55432` (`src/config.ts:51-52`) and `loadConfig` never consults it (`:54-70`). `CM_PG_PORT=5555` plus `/context-manager setup` starts Postgres on 5555 while the extension dials 55432, so nothing is ingested, nothing recalled, no curated knowledge and no durable Accounting — and `/context-manager` reports `thread store  not reachable … run context-manager setup`, naming the command just run. Build the default URL from the variable or drop the claim.

**Concept retrieval is not deterministic, against ADR-0003.** The inner `nearest` CTE is `ORDER BY embedding <=> $1 LIMIT candidates` with no tiebreak, over an approximate HNSW index (`src/postgres-store.ts:801-808`). `similarTurns` does the opposite and is safe (`:387,394`), and the outer `ranked` ordering is total — but it can only order the candidate set it was handed. The same prompt can pull a different Concept after an index rebuild, which is the flicker `comparePacks` exists to expose. Add `, identity ASC` to the inner ordering.

## Gaps

**The Doc Store has no authoring path.** The only write to a bundle is `ensureIdentities`, which inserts one `cm_identity` line (`src/doc-store.ts:262-296`); `install.ts:153-154` creates an empty `decisions/` directory. No tool (`src/extension.ts:359-400` registers exactly two), no command (`:500-528` registers three), and no spec requirement provides authoring; both archived proposals rule it out verbatim. The store meant to outlive every Codebase is the one the agent cannot contribute to. Today a human must leave the session, hand-write conformant YAML — a file without `type:` is silently non-conformant and never indexed (`src/concept.ts:85-89`) — and restart, because indexing runs only at `session_start` (`src/extension.ts:171-196`). A `write_documentation` tool emitting `status: draft` and `generated:`, writing atomically as `ensureIdentities` already does and re-indexing that one Concept, closes the loop; `verified:` stays human so the trust tier stays honest. Pair it with an on-demand reindex, or an edit made mid-session is served stale by retrieval while `walk_documentation` reads the new text from disk (`src/doc-store.ts:127-140`).

**Declining the Thread Store silently disables the Graph and Doc Stores.** The no-database branch registers only `turns`, `accounting`, `walk` and `specs` (`src/extension.ts:822-841`); `graph`, `docs`, `bundle`, `recall` and `search` exist only on the Postgres branch (`:856-874`), though nothing in `GraphStore` or `symbolsInPlay` needs Postgres. `CM_DATABASE_URL=""` is the documented way to decline a store (`src/install.ts:78-79`), and `/context-manager` still prints `codebase graph  extraction on` for a store never constructed (`:113-118`). Share one `Dependencies` literal with only the store-backed members conditional.

**Symbol candidates come from the user's prompt text and nothing else.** `structureFor` passes `current.prompt` (`src/extension.ts:705`), and `reconstructTurns` sets `prompt` only for a `user` message (`src/turns.ts:18-22`). Tool results, assistant reasoning, and the tool arguments naming the file under edit contribute no candidates, so on a tool-loop Call — most Calls of an agentic Turn — structure is derived from a sentence written many steps ago. "Fix this" after ten reads yields no structure at all, while the harness knows exactly which files are in play. Separately, a path in the prompt matches nothing: `src/assembler.ts` yields `src`, `assembler`, `ts`, and `assembler` never canonicalises to `assemble` (`src/symbols.ts:33-40,61-65`), though `GraphSymbol.file` is already carried (`src/graph.ts:15`).

**The Thread Store grows without bound and has no timestamp.** There is no `DELETE` against `turns`, `turn_messages` or `call_accounting` outside `pruneConcepts` (`src/postgres-store.ts:751-776`) and the all-or-nothing `truncate()` (`:851-853`), and no `created_at` on `turns` in any migration (`:50-165`) — only `call_accounting.recorded_at`. Every message of every Turn, plus a vector and full JSONB, is retained forever; the only recovery discards Accounting too. Add `turns.ingested_at` now, before more unrecoverable rows accumulate: recency ranking and age-based pruning are both impossible without it, and a later backfill has nothing to draw on.

**Re-ingest is quadratic in Conversation length.** Every sweep reads the whole Journal and passes every Turn to `ingest` (`src/extension.ts:667-669`), which loops Turns and messages with one awaited statement each, unbatched and untransacted (`src/postgres-store.ts:250-289`). Measured on the worst real session here: 25,069 sequential statements across sixteen Turns, 3,371 in the final sweep alone, every `DO UPDATE` a row rewrite. The spec asks that "ingesting again SHALL add only what is new". Track the high-water `turn_index` and write one Turn per transaction with multi-row inserts.

**Recall embeds the wrong text and queries with the wrong text.** `turnText` joins `messageText` output (`src/postgres-store.ts:338-357`), which drops `toolCall` names and arguments entirely (`src/messages.ts:56-67`), and the pinned model's tokenizer silently cuts the result at 512 tokens. A Turn that read three files and concluded something embeds as its prompt plus the head of the first tool result, so the conclusion is unreachable. The query is the bare prompt (`src/extension.ts:650-655`) with no bge query prefix, so `"continue"` produces a vector carrying no topic and recall fires on noise. Embed a bounded, informative per-Turn summary — prompt, assistant text, tool names, tool results truncated per message rather than per Turn — and prefix the query side only.

**`/pack` cannot explain an absence.** `rejected` and `dropped` are counts (`src/assembler.ts:65-75`, `src/inspection.ts:126-128`); no candidate identity or distance is ever recorded (`src/accounting.ts:97-120`), and `inspect` reads only the last two Calls with no addressing (`src/extension.ts:619-640`). The two questions a user actually has — why the Turn where something was decided was not recalled, and what the Budget dropped — are both unanswerable; `3 not relevant enough` names nothing, and a bad pack noticed a few Turns later is gone. Record the top rejected candidates with turn index and distance, add `pack why <text>` rendering a ranked ledger, and allow `pack <turn>[.<call>]`.

**Measurement is recorded and never acted on.** `packTokens` and `floorTokens` are written (`src/accounting.ts:200-206`) and read only by the inspector (`src/inspection.ts:97-100,206-208`); nothing compares them to each other, to the local estimate, or to a window fraction. `ContextSnapshot.compactionEpoch` is declared (`src/messages.ts:25`) and read nowhere in `src/`. The system measures the exact quantity it exists to control. Warn once when packs cross a configured share of the window, and treat a compaction epoch change as the signal to re-derive positions rather than trusting branch arithmetic.

The estimate itself is also narrow: `approximateTokens` sums only `JSON.stringify(message.content)` (`src/assembler.ts:291-294`), ignoring `details`, `toolName` and `toolCallId`, which on real toolResult messages are comparable in size to `content` (`test/fixtures/journal-tool-session.jsonl:15`). Calibrated against the harness's own reported pack sizes it runs 1.35–1.49× low (see Method), systematically and in one direction — and the verbatim-tail line is the number a user would tune `tail` by.

## Risks

- **No timeout on any store call in the `context` handler.** `tailFor` and the `Promise.all` of the three retrievals are awaited on the path the model waits for (`src/extension.ts:239-251`); each is wrapped in `try`/`catch` (`:679,697,715`) but carries no deadline. The only timeout in `src/` is the embedder's 120 s (`src/embedder.ts:66,83-86`), and it is on the recall path. A paused container that still completes the TCP handshake hangs the Turn with no message.
- **The Thread Store's connection pool is never closed, and one long session can exhaust the server.** `contextManager` constructs `PostgresStore.connect(...)` once (`src/extension.ts:906`) and the `close` callback tears down only the embedder (`:932-934`); nothing calls `store.close()`, and `PostgresStore.close` exists (used by tests and `src/install.ts:195`). **Observed live, not inferred:** during the implementation of `token-budgets` the store began refusing every connection with `FATAL: sorry, too many clients already`, and `ss -tnp` attributed 200 established sockets on port 55432 to a single `omp` process — this repo's own session, 16.5 hours old — against `pg_stat_activity` rows all reading `context_manager thread_store … idle`. The store-backed suite cannot run from a session that has already leaked its slots, which is the first symptom a user would see. One line in `close` fixes it; `store-hygiene` owns it, since that ticket already governs Store lifecycle.
- **No timeout or kill path in `runProcess`** (`src/process.ts:18-34`), whose callers are `graphify extract`, `python3 -m venv`, `pip install`, `openspec validate` and `docker compose up -d --wait`. A never-settling promise also means the "extraction failed" report never fires, so the user sees an empty structure part and no reason.
- **A Journal that cannot be found degrades permanently and silently.** `ingestJournal` returns on a miss without reporting (`src/extension.ts:662-670`); `findJournal` globs one fixed session root (`src/journal.ts:88-96`). On a machine whose root differs, the whole Thread Store is a no-op — nothing recalled, tail always the harness's own — while setup checks pass because Postgres is reachable. Surface "turns ingested: 0".
- **Orphaned tool calls are replayed.** Nothing pairs `toolCall` ids with results in `src/turns.ts` or `src/assembler.ts`. A Turn aborted mid-tool ingests with an unanswered call and is later replayed verbatim in the tail, which providers reject outright. One such Turn appears in 219 Journals here — the in-flight one — so the rate is low and the failure is total.
- **Conversation-filtered ANN can starve as the corpus grows.** `turns_embedding_idx` carries no `conversation_id` and nothing sets `hnsw.ef_search` or `hnsw.iterative_scan` (`src/postgres-store.ts:96-97,385-401`). Either pgvector post-filters a corpus-wide candidate set, so recall returns fewer than `limit` — or zero — while `rejected` reads as "nothing was relevant", or the planner seq-scans and every Call computes a distance per Turn. [INFERENCE] on which plan is chosen; both shapes follow from the index definition.
- **Edge truncation is ordered by extraction order.** `balance` alternates inbound and outbound (`src/symbols.ts:159-190`), but each list is filtered in `links` order, and `contains` and `method` are in the programmatic allow-list (`src/graph.ts:44-58`). A hub class can spend all twelve slots restating its own members while its callers land in "and N more". The cap's size is measurement-backed; only its ordering is not.
- **"Assembly is the only memory injection" has no code behind it.** `session_start` asks, remembers and reports (`src/extension.ts:197-221`); assembly proceeds identically whether `memoryOff` is true, false or unknown. Enforcement is a decision, not an oversight — but today the spec's SHALL is advisory, and a user who ignores one stderr line runs a whole session with two injectors and an Accounting that attributes nothing to the contamination.
- **~~[INFERENCE]~~ Prompt-cache defeat — measured, and true by another mechanism.** Volatile per-Call retrieval is placed ahead of the stable tail (`src/assembler.ts:118-167` before `:169`), and a governed Conversation caches **none** of its Pack against 97.2% for an ungoverned one. The cause is not provider-side prefix invalidation: the harness marks a supplied message array for caching only as far as the first message it did not itself send, so an assembled part at index 0 leaves no message breakpoint at all. Moving the volatile parts after what the harness sent is therefore the remedy, and it is a larger change than moving them before the current Turn — the leading messages have to be the harness's own, unaltered. Closed by ADR-0005; the work is `pack-prefix-stability`.

## The queue this became

Every finding above is tracked as an OpenSpec change folder under `openspec/changes/`, which is this repo's issue tracker (`docs/agents/issue-tracker.md`). Ten tickets; `Blocked by:` lines in each `proposal.md` carry the edges, and an edge is cleared when its blocker archives.

| # | Change | Owns | Blocked by |
| --- | --- | --- | --- |
| 1 | `token-budgets` — **shipped**, archived `2026-09-17` | Token Budget per part, Pack ceiling and its reduction order, head-and-tail elision, exclusion reasons in Accounting, whole-message estimate, the report when a Pack nears its ceiling. | — |
| 2 | `recall-fidelity` — **shipped**, archived `2026-09-20` | Tool calls rendered in recollections, bounded per-message embed text, query-side instruction prefix, content hash and per-vector model provenance, orphaned tool calls refused by the tail, and an exact Conversation-scoped recall. | — |
| 3 | `store-hygiene` — **shipped**, archived `2026-09-21` | Codebase set once, incremental batched ingest, `turns.ingested_at` and retention, per-Store deadlines, `runProcess` timeout, the Journal miss, `CM_PG_PORT` in code, the Concept candidate-set tiebreak, and the connection pool that is never closed. | — |
| 4 | `doc-authoring` — **shipped**, archived `2026-09-24` | A write surface for Concepts at machine trust, in-Conversation reindex, section-level attribution, the author's summary in the embedded text, `not:`/`sources:` served with a Concept, unreadable and unlisted Concepts reported. | — |
| 5 | `structure-freshness` — **shipped**, archived `2026-09-21` | Re-extraction after every Turn, per-symbol age disclosed in the Pack, candidates from the whole Turn including file paths, relation-ranked truncation, indexes cached with the parse, and the Graph Store off the Postgres branch. | — |
| 6 | `pack-why` — **shipped**, archived `2026-09-21` | The rejected-candidate ledger, a cause for every absent part, Concept distances and refusals, Call addressing, `pack why`, compaction recording, and estimate-versus-reported. | — |
| 7 | `single-injector-enforcement` — **shipped**, archived `2026-09-24` | The one specified `SHALL` with no code behind it. Every memory backend injects into the **system prompt**, so the content lands in the Floor and the Assembler cannot filter it. The requirement is restated over the Context Window and enforced by detection: a three-valued state decided once per Conversation, reported once, and recorded against every Call. | — |
| 8 | `pack-order-cache` — **shipped**, archived `2026-09-25` | Per-Call cache figures recorded and backfilled, the cached share of a Pack reported against the Floor, a governed baseline collected and checked in, and the `[INFERENCE]` closed by ADR-0005. Opened `pack-prefix-stability` for the remedy. | — |
| 9 | `audit-docs-debt` | The documentation debt below, plus a systematic reconciliation of every `CM_*` variable the README claims against what `src/` reads. `skip_specs`. | — |
| 10 | `assembler-shape` | Structural findings from ticket 1's own code review, behind byte-identical Packs: one `Budget` type, one selection rule serving both passes, Elision in its own module. `skip_specs`, `needs-triage`. | — |

Four planning calls differ from the first draft of this sequence: `turns.ingested_at` belongs to `store-hygiene`, which owns retention, rather than to `recall-fidelity`; the near-the-ceiling report belongs to `token-budgets`, which introduces the ceiling, rather than to `pack-why`; the Risks entry above that treats stripping harness-injected memory as an option is superseded by ticket 7's finding — there is nothing in the message array to strip; and the connection-pool leak recorded in Risks was found while building ticket 1 and is owned by ticket 3.

**What ticket 1 measured, once shipped.** On the audited Conversation with the shipped defaults: 2,080,285 estimated tokens ungoverned, **45,819 governed** — a 97.8% reduction inside a 110,000 ceiling, against the 8.6% the count Budget alone achieved. Its own code review then found two defects, both fixed before archive: the harness's `details` were dropped from a shortened tool result without being counted or named, and `/pack` rendered no exclusion reason for a part with no count Budget — the current Turn, the one the ceiling elides.

**What ticket 3 measured, once shipped.** The worst Journal here — 16 Turns, 3,371 messages — cost **3,387 statements and 0.6 s on every sweep**, changed or not. Resumed ingest costs **49 statements** for the first sweep and **one, writing nothing**, for a second over an unchanged Conversation. The deadlines are measured rather than chosen: the tail's worst read is 47.9 ms and recall's 81.4 ms against this machine's 388-Turn store, so 1,500 ms and 5,000 ms bound hanging rather than working. Its own review then found a scope violation and two spec defects, all fixed before archive: a `CM_PG_PORT` README row that belongs to ticket 9, a problem statement pasted into a requirement body, and a requirement whose "Accounting shows the part absent" clause nothing asserted.

`CM_PG_PORT` is now read by `loadConfig`, so ticket 9's task 1.2 applies: the README sentence is kept and scoped to the default URL, rather than replaced.

**What ticket 6 measured, once shipped.** The figures above can now be re-derived from the inspector rather than from a script: replaying the audited Conversation's last Turn and reading `/pack` alone gives **2,080,291** ungoverned, **1,916,121** under the count Budget alone (7.9%), and **45,819** under the shipped defaults (97.8%) — the same governed figure to the token, the ungoverned to six. The bound on what a Call retains about its refusals is measured too: pooling this machine's 403 real Turns into one Conversation, the Turn a user would ask about was outside the candidate set entirely in 118 of 140 Calls, and where it was inside, its rank reached 12 — so the head is 12, and what bounds explainability is the over-fetch rather than the ledger. Both review axes found the same worst defect independently: `pack why 4` read the bare number as an address and answered with a usage line, which the live evidence had missed because it was gathered through the inspector's function rather than the command.

**What ticket 5 measured, once shipped.** A refresh of this repository costs **0.87–0.95 s** whatever changed — 73 files cached, and the five re-extracted every time are graphify's own outputs, which each run rewrites — so it belongs after a Turn and nowhere near a Call. Candidate text is the other measured bound: over 423 real Turns the widest offers **1,580,818 characters across 1,805 messages** and costs **89 ms** to scan whole, against recall's entire 81 ms budget, so a Turn contributes the first 1,000 characters of each of its 32 most recent messages and costs 1.1 ms. Relation ranking cut membership connections from **188 of 684 kept to 127**, and symbols whose real uses were displaced by their own members from **29 to 14**. A headless run then exposed what `agent_end` alone cannot do: its extraction was still running when the process exited, leaving the graph older than the edit the Turn had just made, so shutdown now waits for it. Live, with no Thread Store at all, a Turn appended a function to `src/shares.ts` and the next Turn's Pack carried that function's own neighbourhood.

**What ticket 7 measured, once shipped.** The planning finding was a documentation read; it is now a measurement. Two live Conversations over one scratch codebase, the same prompt, differing only in `memory.backend`: with `local` and a planted memory summary holding a codeword no model can guess, the model answered the codeword while the `context` event handed over **one message of 184 characters with no trace of it**; with the backend off the same Conversation could not answer at all. The Floor differed by **319 tokens** — `nonMessageTokens` **26,086** against **25,767** — so the injected block is measured on the side of the window the Assembler never supplies. The unconfirmed path turned out to be unreachable on this harness at all: `status()` answered in all four configurations tried, including `hindsight` pointed at a dead port, which reports itself active with "does not expose structured status". Review then found the change's own weakest seam: the state was recorded through an optional argument guarded by a `coalesce`, defending a caller that does not exist — `unconfirmed` already names the unknown, so the argument is required and the guards are gone.

**What ticket 4 measured, once shipped.** Where a Concept's own summary joins the embedded text was decided by measurement, not by argument (`scripts/measure-summary-placement.ts`, three placements over this repository's decisions and the vendored bundle). Attaching it to **every** section moved genuine queries from **0.244–0.438 to 0.229–0.427** while unrelated ones held at **0.597–0.644** — the gap widening from 0.149 to 0.170 — and put the right section of a multi-subject Concept first in **5 probes of 6**, against **3** for the first section alone. The flattening the design predicted is real and harmless: mean distance between one Concept's sections fell from **0.239 to 0.100**, while the margin by which the right section beat its siblings held (0.050 against 0.043) and the worst case improved. Live, a Conversation wrote a decision as a draft Concept and a **separate** Conversation answered from it — 151 tokens of curated part, **part 1 of 3**, with a reviewed Concept beside it still ranked first (0.145 against 0.183). Review then found the change's own worst defect twice over: a test asserting against a path in the shared temp directory that a mutation run had already poisoned, and an undated signature that still counted beneath a machine change — the exact hole the trust rule exists to close.

**What ticket 8 measured, once shipped.** The queue's only `[INFERENCE]` is closed, and not the way it was written. Sixteen Conversations on the same prompts, thirteen governed and three with `--no-extensions`: the median cached share of a Pack is **0.0% governed against 97.2% ungoverned**, **36.1% of everything charged** in a governed Conversation is uncached input, and a Call costs **2.6×** as much at the provider's multipliers while carrying a Pack **half the size**. The pre-registered rule returns inconclusive and says why — it was built to watch provider-side prefix invalidation, and the provider was never offered a breakpoint inside the Pack to invalidate. Four throwaway extensions found the mechanism: passing the harness's array through caches **88%**, rebuilding every message from scratch **91%**, appending one assembled message **87%**, and prepending that same message **0%** with seventeen times the input. The harness marks a supplied array only as far as the first message it did not itself send, and the Assembler puts retrieval there. Review turned the change twice: once for writing the backfill through an INSERT that could invent a Call, and once for an ADR whose causal claim outran its evidence — the second was found by reading the harness's own breakpoint rule, which is what prompted the A/B. The remedy is reachable from this extension, so `pack-prefix-stability` is open with these figures behind it.

Documentation debt, owned by `audit-docs-debt`:

- `CM_PG_PORT` is documented and unread (`README.md:131`). The code fix is `store-hygiene`'s; the wording must agree with whichever way that lands.
- `CM_EMBED_MODEL` is read and undocumented (`src/embedder-worker.ts:17`); a wrong width makes every batch throw into background stderr, which is the failure mode `src/bun-runtime.ts:9-14` set out to eliminate for `CM_BUN`.
- `ensureIdentities` rewrites frontmatter in the user's own bundle files on every session start (`src/doc-store.ts:333`). Correct and specified, but a bundle kept in a git-tracked notes repo goes dirty unannounced. Document it in the terms the Graph Store already gets.
- `README.md:13` understates the cost of an unreachable Thread Store: recall, curated knowledge, cross-conversation search and cross-session Accounting all go with it, since the Doc Store index lives in Postgres too. The same understatement is restated at `README.md:43` and `:63`, while `src/install.ts:88` already states it correctly.

Found while closing that debt, and owned by nothing yet:

- **Concept vectors carry no model provenance.** `recall-fidelity` gave Turns an `embedding_model` per vector, so a same-width model swap excludes the strangers from ranking and re-embeds them. `concept_sections` has no such column: `searchConcepts` orders by distance with no model predicate, and `embedSections` re-embeds a section only when its text hash moves. So after a same-width swap curated knowledge ranks one model's query against another model's vectors until the bundle changes or the index is dropped — the failure mode `recall-fidelity` removed for Turns, still present for Concepts. Cheap to fix on the same pattern: one nullable column, one predicate, and the existing hash-keyed pass.
