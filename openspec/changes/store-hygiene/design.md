## Context

The Thread Store works and is unguarded. Ingest is idempotent per row but not incremental: every sweep reads the whole Journal and drives one awaited statement per message, untransacted (`src/postgres-store.ts:262-301`, `src/extension.ts:732-734`) — 25,069 statements across sixteen Turns on the worst Journal here, 3,371 in the final sweep. That same `DO UPDATE` lets `EXCLUDED` win the Codebase (`:320`) while the caller always passes `process.cwd()` (`src/extension.ts:934`), so resuming from a subdirectory rewrites the provenance `cross-conversation-search` exists to report.

Nothing else is bounded. No Store call on the `context` path carries a deadline (`src/extension.ts:296-308`); `runProcess` has no timeout and no kill (`src/process.ts:17-33`), and a promise nobody settles also suppresses its caller's failure report. An unfindable Journal returns silently (`src/extension.ts:727-735`) from a one-root glob (`src/journal.ts:87-96`). No migration gives `turns` a timestamp (`src/postgres-store.ts:50-175`), nothing deletes outside `pruneConcepts` and `truncate()`, and `CM_PG_PORT` is honoured by `compose.yaml:10` and read by nothing in `src/` (`src/config.ts:71-72,86-108`).

Evidence: `docs/audits/2026-09-16-functionality-audit.md:121,131,133,143,145,157-159`. `token-budgets` has landed, so a Pack has a ceiling and Accounting records why a part carried less; this slice bounds the Stores that fill it. See `proposal.md` and the three delta specs.

The constructed extension dependency closes only the embedder even though `PostgresStore.close()` exists. Repeated extension sessions therefore left idle pools behind until `localhost:55432` exhausted its clients; this is a lifecycle bug, not a token-budget behaviour.

## Goals / Non-Goals

**Goals:**

- Provenance that records where a Turn happened, once.
- A sweep costing the new Turns rather than the Conversation.
- A Turn that can be dated, and a Store that can be bounded.
- A Call bounded by configuration rather than by the slowest Store.
- The same Concepts for the same query across an index rebuild.
- Session shutdown that releases every constructed resource even when final work fails.

**Non-Goals:**

- Choosing a retention length. The mechanism ships; the number is the user's.
- Repairing Turns already relabelled — the true Codebase was never recorded.
- Finding Journals outside the harness's session root. The miss becomes visible; a second root is a separate question.
- Bounding what a Store fetches. Deadlines bound waiting, not result size.

## Decisions

### Codebase is written on insert and never on update

The conflict clause drops `codebase`, so the value arrives only with the row that first carries it. The alternative that looks safer — first-writer-wins via `COALESCE(turns.codebase, EXCLUDED.codebase)` — behaves identically for a Turn that has one and quietly backfills a Turn that does not, from whichever directory happens to be sweeping. A Turn ingested before provenance existed stays absent, which the spec already says it reads as.

`turn_messages` keeps its `DO UPDATE`: a Turn whose final line was unflushed at the last sweep (`src/journal.ts:47-50`) must be corrected, and that is content, not provenance.

### Ingest resumes from a stored high-water turn index

Ingest reads `max(turn_index)` for the Conversation and skips Turns below it, re-writing only the highest, since the last sweep may have caught it mid-flush. A sweep then costs the new Turns plus one.

The alternative is a content hash per Turn compared before writing. That is `recall-fidelity`'s column, it answers a different question — did this Turn's text change, for vector invalidation — and it still reads a hash per Turn. The high-water mark reads one number.

Each Turn is one transaction, its messages one multi-row insert. Per Turn rather than per sweep: an interrupted sweep then leaves whole Turns stored, which is what makes resuming cheap. That turns 3,371 statements into roughly two per new Turn.

### `turns.ingested_at` is nullable and is never backfilled

Set on insert, `DEFAULT now()`, nullable, with no `UPDATE` in the migration. An existing row has nothing to derive an arrival time from: `call_accounting.recorded_at` covers only Turns that assembled a Pack, and the Journal's timestamps say when a Turn happened, not when it was stored. Stamping every row `now()` would make the Store look one migration old and defeat the retention the column exists for. Hence now rather than later: every Turn ingested before the column is permanently undatable, so that population is smallest today.

### Retention ships off, deletes Turns, and leaves Accounting

A configured age (`CM_RETAIN_DAYS`, unset) removes Turns older than it and their messages by cascade. A null `ingested_at` is exempt — an undatable Turn cannot be judged old. `call_accounting` is untouched, so "what did this Call send" outlives the Turn; Accounting is a few numbers per Call against a Turn's full JSONB and vector, and the size problem is not in Accounting.

Off by default because retention length is policy about someone else's history, and blocking on it would leave the Store both unbounded and undatable. The sweep runs at `session_shutdown` beside ingest, never on the `context` path.

### Deadlines live in the `context` handler's per-Store helpers

`tailFor`, `recallFor`, `conceptsFor` and `structureFor` (`src/extension.ts:404,706,741,761`) each own one Store and each already catch and report. Each gains a deadline around its await and, on expiry, reports and returns the empty value it already returns when its Store refuses. `assemble()` cannot hold it — it is pure and is handed results, not promises — and deadlines inside each Store would implement the same race four times.

Numbers, which task 1 confirms against this machine's store: **1,500 ms** for the tail, one indexed read ordered by Turn; **5,000 ms** each for recall, Concepts and structure, which embed a query or shell out. The three run in parallel (`:247-251`), so a Call waits at worst 6,500 ms against an unbounded wait today. The embedder's 120 s (`src/embedder.ts:66`) stops being reachable from the request path and stays on the off-path backfill.

### `runProcess` takes a deadline, kills the child, and returns what it got

A fourth positional `timeoutMs?` on `runProcess` and `RunCommand`. On expiry the child gets `SIGTERM`, then `SIGKILL` after a grace period, and the call returns `{ ok: false, output }` carrying the partial output and naming the timeout — `src/embedder.ts:66,83-86` exactly: a bounded wait that fails loudly instead of a promise nobody settles.

Positional rather than an options object because `RunCommand` has three implementations and several test fakes (`src/graph-store.ts:60`, `src/install.ts:57`, `src/spec-store.ts:67`), and a fake ignoring a fourth argument keeps compiling. Partial output rather than none because "graphify printed this much and stopped" is the diagnosis. The deadline is the caller's, since the commands differ by two orders of magnitude: `graphify extract` 60 s, `openspec validate` 30 s, `docker compose up -d --wait` 120 s, `python3 -m venv` and `pip install` 300 s.

### The default connection URL derives its port from the environment

`DEFAULT_DATABASE_URL` becomes a function of the environment, substituting `CM_PG_PORT` and defaulting to 55432. **BREAKING** for a setup that set it and relied on it being ignored. Deleting `CM_PG_PORT` from the documentation instead loses: `compose.yaml:10` honours it, so the two halves of setup would still disagree about which port exists. The README wording is `audit-docs-debt`'s and follows this.

### The Concept candidate set is totally ordered

`, identity ASC` in the inner `nearest` CTE (`src/postgres-store.ts:819-826`), the tiebreak `similarTurns` already carries (`:399,406`). The outer ordering is total but can only order the candidates it was handed, and HNSW is approximate: the same prompt can pull a different Concept after a rebuild, the flicker ADR-0003 forbids. By identity rather than `concept_id`, so the tiebreak survives a `git mv` — what identity was assigned for.

### A journal miss is a report and a count

`ingest` returns how many Turns it stored; `ingestJournal` reports a `findJournal` miss, naming the Conversation and the root searched; the sweep reports the count. Today a miss is indistinguishable from an empty Conversation, and on a machine whose session root differs it is the whole Store.

### Session shutdown owns every constructed resource

The dependency factory constructs the Store and embedder, so its close owns both. Session shutdown already awaits `deps.close`; the factory must close every constructed resource rather than only the embedder.

Final ingest or retention and resource cleanup need `try`/`finally` or equivalent control flow so failure in the sweep cannot skip cleanup. Cleanup attempts every resource close; repeated sessions must return database connection use to baseline.

## Risks / Trade-offs

- **The high-water mark hides an edited historical Turn** → only the highest Turn is re-written. Journals are append-only (ADR-0002) but for the unflushed final line, which is that Turn; a full re-ingest stays available by discarding the Store.
- **A deadline turns a slow Store into a missing part** → the trade the audit asks for: a part named absent beats a Turn that never returns.
- **Killing a child can leave a half-written index** → `graphify extract` writes its output at the end, so a kill leaves the previous index; re-extraction is `structure-freshness`'.
- **Retention deletes history someone wanted** → off unless configured, undatable Turns exempt, Accounting kept, and the Journal is still the record (ADR-0002): retention discards an index, never history.
- **`CM_PG_PORT` becoming live breaks a working setup** → only one that set it, which today means one dialling 55432 while its container listened elsewhere. A setup that set it and worked was not using it.
- **Shutdown can now surface a cleanup failure** → attempt every close, preserve the primary sweep failure when one exists, and report cleanup failures rather than skipping remaining resources.

## Testing seams

| Requirement | Seam |
| --- | --- |
| The Journal is ingested into the store — Codebase set once | Store boundary (`CM_DATABASE_URL`): ingest, ingest again from a subdirectory, read the Codebase back. |
| The Journal is ingested into the store — resume adds only what is new, and an unflushed final Turn is corrected | Store boundary with a counting `sql` tag passed to the constructor (`src/postgres-store.ts:226-229`): statements per second ingest against Turns added; then a truncated Turn re-ingested whole. |
| Every turn records when it was ingested | Store boundary: read the arrival time, re-ingest and assert it unchanged, a row with none reads absent. |
| Retention bounds the store only when it is configured | Store boundary: backdated arrival times, retention on and off, Accounting read back after. |
| A journal that cannot be found is reported | Extension boundary (`test/extension.test.ts`), stub reporter and a finder that finds nothing. |
| Concept retrieval selects from a totally ordered candidate set | Store boundary against real pgvector: a corpus larger than the candidate set, retrieve, rebuild the index, retrieve again. |
| A store that misses its deadline is treated as unavailable | Extension boundary: an injected Store that never settles, a stub reporter, and a fake clock advancing the deadline so no test waits. |
| A store that misses its deadline — a program that hangs is stopped | `runProcess` boundary against a short-lived real child that outlives its deadline, plus the injected `RunCommand` for the Graph and Spec Stores. |
| Store resources are released when a session ends | Extension dependency boundary with injected closers: shutdown closes Store and embedder, still closes after final sweep failure, and repeated start/shutdown returns connection use to baseline. |

The store boundary is the target seam: provenance, incremental cost, arrival time, retention, candidate ordering, and connection lifetime are all statements about what real SQL did. The default suite stays container-free, model-free and network-free — the deadline rows use an injected Store and clock, the Journal-miss row a stub finder and reporter, the lifecycle row injected closers, the process row a child that sleeps. The store rows need `CM_DATABASE_URL`; candidate ordering also needs `CM_EMBED=1`. Verification adds `CM_GRAPHIFY=1`, `CM_OPENSPEC=1` — both Stores' `RunCommand` signature changes — and `CM_LIVE=1`.

## Open Questions

None. Three numbers are task 1's measurement: the per-Store deadlines, the per-command process deadlines, and the statements a second sweep may spend. A default retention length is deliberately not chosen — it becomes answerable once a Store has run with `ingested_at` long enough to show how fast it grows.
