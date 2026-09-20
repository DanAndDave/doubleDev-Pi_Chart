# Proposal: Thread Store Durability and Provenance

Triage: ready-for-agent

## Why

Resume a Conversation from a subdirectory and every Turn it ever held is re-attributed there. `ingest` lets `EXCLUDED` win the Codebase (`src/postgres-store.ts:321`), the caller always passes `process.cwd()` (`src/extension.ts:974`), and every sweep re-ingests the whole Journal (`:772-774`). `recall_across_conversations` then reports a provenance that never happened — the one thing `cross-conversation-search` promises.

That sweep also makes ingest quadratic: a whole-Journal re-read driving one awaited statement per message, unbatched and untransacted (`src/postgres-store.ts:303-357`). Measured on the worst Journal here, 25,069 statements across sixteen Turns, 3,371 in the final sweep — against a spec asking that "ingesting again SHALL add only what is new" (`openspec/specs/thread-store/spec.md:32`).

Nothing else is bounded either. No Store call in the `context` handler has a deadline (`src/extension.ts:305-317`), so a Store that accepts a connection and never answers hangs the Turn; `runProcess` has no timeout or kill path (`src/process.ts:17-33`), and never settling also suppresses its failure report. An unfindable Journal returns silently (`src/extension.ts:767-775`) from a one-root glob (`src/journal.ts:87-96`), making the Thread Store a no-op while setup checks pass. Nothing is deleted outside `pruneConcepts` (`src/postgres-store.ts:875-900`) and all-or-nothing `truncate()` (`:975-977`), and no migration gives `turns` a timestamp (`:51-215`).

## What Changes

- Codebase is written on insert only; re-ingest never relabels a Turn, and a Turn stored without one still reads with it absent.
- Ingest resumes from the high-water `turn_index`, one Turn per transaction with multi-row inserts, so a sweep costs only what is new.
- `turns.ingested_at`, set on insert. It cannot be backfilled — an existing row has nothing to derive an age from — so Turns ingested before it stay undatable forever.
- An age-based retention sweep over `turns` and `turn_messages`, leaving Accounting intact; off unless configured, since retention length is the user's policy.
- Every Store call on the `context` path gets a deadline; missing it is treated as an unavailable Store — reported, pack assembled without it.
- `runProcess` gains a timeout that kills the process tree and reports it, so `graphify extract` and `docker compose up -d --wait` cannot hang.
- An unfindable Journal is reported, and ingest states how many Turns it stored, so zero is visible.
- The Thread Store's connection pool is closed when the extension shuts down. `contextManager` never closes it (`src/extension.ts:950,977-979`) while `PostgresStore.close` exists and is used elsewhere (`src/install.ts:195`), so a session leaks its pool for as long as it lives. **Observed, not inferred:** a 16.5-hour session of this repo held 200 established sockets on port 55432 and the store refused every new connection with `FATAL: sorry, too many clients already`, which blocked `token-budgets`' own store-backed task. Ownership sits here because this ticket already governs when a Store is reached for and when it is given up.
- **BREAKING** `loadConfig` builds the default database URL from `CM_PG_PORT` when `CM_DATABASE_URL` is unset (`src/config.ts:80-81,95-117`); today `compose.yaml:10` honours it while the extension dials 55432.
- `searchConcepts`' inner `nearest` CTE gains `, identity ASC` (`src/postgres-store.ts:925-932`) — the tiebreak `similarTurns` already has (`:496,406`).

**Not in scope:** what a Turn is embedded as and the vector-validity columns (`recall-fidelity`); token ceilings (`token-budgets`); Graph Store wiring and freshness (`structure-freshness`); the README's `CM_PG_PORT` wording (`audit-docs-debt`).

## Capabilities

### Modified Capabilities

- `thread-store`: ingest becomes incremental rather than merely repeatable; a Turn's Codebase becomes immutable once recorded; Turns carry an ingest time and may be retired by age; an unfindable Journal is reported, not silent.
- `doc-store`: Concept retrieval SHALL return the same candidates for the same query. The requirement belongs here, not in `context-assembly`, whose determinism guarantee is already store-agnostic (`openspec/specs/context-assembly/spec.md:53`): the store that orders its own approximate-index candidates must promise that order.
- `context-assembly`: a Store that misses its deadline SHALL be treated as unavailable, bounding a Call by configuration rather than by the slowest Store.

## Impact

- **Schema:** `turns.ingested_at`, nullable so existing rows migrate without an invented time. Retention adds the first `DELETE` against `turns` and `turn_messages`.
- **Configuration:** `CM_PG_PORT` becomes live, breaking a setup that set it and relied on it being ignored; a per-Store deadline; a retention age, unset.
- **Performance:** sweep cost drops to the new Turns; a deadline trades a stalled Turn for a missing part.
- **Migration:** Turns already relabelled cannot be repaired — the true Codebase was never recorded. Fixing the write stops the loss without undoing it.
- **Completes:** the `thread-store` incremental-ingest and Codebase-provenance scenarios, today satisfied in letter only. **Unblocks:** recency ranking and age-based pruning.
