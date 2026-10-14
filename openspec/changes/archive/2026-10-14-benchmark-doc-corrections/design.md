## Context

See proposal.md (Why). The current state the approach has to fit:

- `docs/benchmarks/2026-10-13-token-usage.md` describes one run on one day (commit `4dbe254`). Its tables, charts and `2026-10-13-token-usage.json` are correct; only the Findings section (six bullets) is wrong or unsettled.
- ADR-0010 and `README.md` cite the document for its figures and already state the corrected turn 1–6 mechanism. Three later benchmarks (`-parts-follow-turn`, `-tail-evicts`, `-briefings-kept`) cite it as their "Before".
- `scripts/bench-tokens.ts` reads only the provider's `usage` from the Journal. The per-part figures live in the Thread Store's `call_accounting` table (`parts` jsonb, `leading_tokens`), reachable through `~/.pi-chart/database.url`.
- The JSON records each run's `cwd`; `turns.codebase` equals it, which maps each run to its `conversation_id`. pi-chart runs: index 0 `/tmp/pichart-bench-fMQcHA`, 1 `/tmp/pichart-bench-ksa1Oo`, 2 `/tmp/pichart-bench-41BItz` (the `UNKNOWN` run).
- `parts` is stored as either a jsonb array or a jsonb string holding one; queries have to unwrap both.

## Goals / Non-Goals

**Goals:**
- A reader who arrives from ADR-0010 or the README reads the corrected mechanism first.
- Every new figure in the document can be reproduced by one query file.

**Non-Goals:**
- Changing any table, chart or figure the run produced.
- Re-running the benchmark.
- Correcting the later benchmark documents.
- Reporting part churn or recall exclusions from `bench-tokens.ts`.

## Decisions

### 1. Edit Findings in place, with a dated note

The Findings section is rewritten, not appended to. Its first line reads: corrected on 2026-10-14 from the run's Thread Store accounting (`openspec/changes/archive/<date>-benchmark-doc-corrections/audit.sql`); the turn 1–6 and turn 8+ mechanisms and the memory-check miss changed; the earlier wording is in git history.

Alternatives: an appended `## Correction` section leaves the wrong explanation as the first thing read; struck-through text keeps it visible in the rendered document. Both serve history, which git already keeps.

### 2. Figures come from `audit.sql` in the change folder

One file with three selects, each scoped to the three pi-chart Codebases:

1. **Part churn:** for each Turn and assembled part (by `source`), compare each Call's part (minus volatile fields, as the grilling query did: the whole element hashed) with the previous Call's in the same Turn; count pairs and changed pairs, split into turns 1–6 and 7–12. Expected: structure 21/26 and 9/38; recalled, curated and pinned 0.
2. **Leading run:** `leading_tokens` per run and Turn. Expected: non-zero on turns 2–7, 0 on every Call of turns 8–12.
3. **Recall at turn 12:** for each run, the `recalled` part of turn index 11's first Call, with turn index 0's carried or excluded entry and its distance and threshold. Expected: run 2 excluded at 0.5449 against 0.52; runs 0 and 1 carried it.

Run as `psql "$(cat ~/.pi-chart/database.url)" -AF' | ' -f audit.sql`, matching `structure-match-precision`'s audit. The file is archived with the change, so the document links to the archive path.

Alternative: extend `bench-tokens.ts` to read the Store. That would make every bench run depend on the database for a finding that is needed once.

### 3. One forward pointer, no results

Under Findings, one line lists the three later benchmarks as where these findings were acted on. Their results are not restated, so the document doesn't need updating when they change.

## Risks / Trade-offs

- [The archive path in the document is wrong until the change is archived] → The archive date is known at apply time (the day `/opsx-archive` runs); write the path with that date and check the link resolves after archiving.
- [Retention deletes the bench Conversations' rows, so `audit.sql` stops reproducing] → The document states the figures; the query records how they were read. The run's date and Codebases are in the JSON.

## Testing seams

None. No behaviour changes. Verification is `audit.sql` reproducing the figures in design §2 and the document stating them.
