## 1. Measure before choosing

- [x] 1.1 Record how long each Store call on the `context` path takes against this machine's store, worst case over the audited Conversations, and record the figures for the tail and for each of the three retrievals — against a scratch Store holding all 388 Turns of this machine's Journals, ten runs each on the worst Conversation (16 Turns, 3,371 messages): **`recentTurns(8)` p50 47.1 ms, worst 47.9 ms**; **`similarTurns(12)` p50 72.6 ms, worst 81.4 ms**, of which ~60 ms is embedding the query; **`searchConcepts(4)` p50 9.1 ms**, though this machine's bundle holds no Concepts so that figure is a floor rather than a worst case; **`graph()` under 1 ms**, because it reads a parsed file and this Codebase has no `graphify-out/` — its real cost is the extraction behind it, measured in 1.3. A fresh embedder worker answers its first query in **350 ms** with the model cached on disk, so a cold session's first recall does not need a deadline of its own
- [x] 1.2 Choose each per-Store deadline from those figures, and record the headroom left over the measured worst case and why the tail's differs from the retrievals' — **1,500 ms for the tail, 5,000 ms each for recall, Concepts and structure**, as `design.md` proposed and the measurement now supports. The tail is one indexed read: 47.9 ms worst, so 1,500 ms is 31× headroom and anything slower is a Store in trouble rather than a Store working. The three retrievals each do something unbounded by an index — embed a query, or read a file a subprocess wrote — and their worst case includes a 350 ms model load, so 5,000 ms is 62× the measured worst and still leaves the Call bounded at 6,500 ms against no bound at all today
- [x] 1.3 Record how long each command behind `runProcess` takes on a cold machine — `graphify extract`, `python3 -m venv`, `pip install`, `openspec validate`, `docker compose up -d --wait` — and choose each caller's deadline from that — measured here: **`graphify extract --code-only` 2.0 s** over this Codebase's 69 code files, **`openspec validate --all` 0.39 s**, **`python3 -m venv` 2.1 s**, **`pip install` 0.7 s** for one cached wheel. `docker compose up -d --wait` could not be measured: `docker info` fails on this machine and `sudo -n` fails with it, which is why the store-backed work runs against a throwaway PostgreSQL instead. Deadlines are `design.md`'s, and they are chosen against the shape of the command rather than this Codebase's size: **60 s** for extraction (69 files in 2 s, and a large Codebase is the case worth surviving), **30 s** for `openspec validate`, **300 s** for the interpreter and package installs, which download on a cold machine, and **120 s** for Compose, which pulls an image
- [x] 1.4 Count the statements a sweep of the worst Journal costs today, and record the budget a second sweep over an unchanged Conversation must not exceed, against the recorded 3,371 — counted with a `sql` tag wrapping the Store's: the worst Journal (16 Turns, 3,371 messages) costs **3,387 statements and 0.6 s per sweep today, every sweep, whether or not anything changed**. The budget for a second sweep over an unchanged Conversation is **one statement** — the read that finds the stored head — and nothing written. Measured after the change: first sweep 49 statements in 276 ms, second sweep **1 statement in 2 ms**, a sweep after one more Turn 4 statements

## 2. Provenance written once

- [x] 2.1 Stop the ingest conflict clause from writing a Turn's Codebase, and verify a Turn ingested from one Codebase and re-ingested from a subdirectory of it still reads with the first
- [x] 2.2 Verify a Turn stored for the first time by a later ingest records the Codebase that ingest ran from
- [x] 2.3 Verify a Turn stored with no Codebase reads with it absent rather than failing, and is not backfilled by a later ingest
- [x] 2.4 Verify `recall_across_conversations` reports the Codebase a Turn was first stored with after a re-ingest from elsewhere — held through `searchAll`, which is what `recall_across_conversations` reports from: after a re-ingest from `src/`, the Turns still come back with `/home/user/dev/pi-chart`

## 3. Incremental ingest

- [x] 3.1 Read the stored high-water Turn index for a Conversation before writing, and skip Turns below it while re-writing the highest — the head read returns the highest Turn's index, its `text_hash` and how many messages it holds, so the highest is *reconsidered* rather than rewritten: an unchanged Conversation writes nothing at all, which is what the delta spec's "no stored Turn or message SHALL be written again" asks for. Both checks are needed — the embed text is bounded, so a message appended beyond it moves the count and not the hash
- [x] 3.2 Write each Turn in one transaction with its messages as a single multi-row insert, and verify the statement count for a second sweep over an unchanged Conversation is within task 1.4's budget — measured on the worst Journal: 49 statements for the first sweep of 16 Turns, **1 statement and no writes for the second**, against 3,387 every sweep before
- [x] 3.3 Verify a Conversation that grew by one Turn costs only that Turn plus the re-written highest, and that the new Turn is retrievable — and the highest is only re-written when it actually differs, so a grown Conversation costs one Turn, not two
- [x] 3.4 Verify a Turn whose final message was unflushed at the previous sweep is stored complete after the next, and its messages read in order
- [x] 3.5 Verify an ingest interrupted between Turns leaves the Turns already written intact and the next ingest completes the rest

## 4. When a turn arrived

- [x] 4.1 Add the forward migration giving `turns` a nullable ingest time defaulted on insert, with no backfill, and verify it applies to the existing database leaving existing rows null — migration 14. Added without a default and given one afterwards, deliberately: `ADD COLUMN ... DEFAULT now()` fills every existing row, which would date the whole Store one migration old and let retention retire all of it at once
- [x] 4.2 Verify a newly ingested Turn reads with its arrival time, and re-ingesting the Conversation leaves that time unchanged
- [x] 4.3 Verify a Turn with no arrival time reads with it absent rather than derived, and nothing on the read path fails on it — `FoundTurn.ingestedAt` is absent rather than derived, and nothing on the read path fails on it

## 5. Retention

- [x] 5.1 Add the retention age to configuration, unset by default, and verify an unusable value is refused with a reason rather than silently disabling or enabling retention — `PICHART_RETAIN_DAYS`, unset by default. An unusable value is refused *and said aloud* through `Config.problems`, reported at session start: treating it as unset would leave someone believing their Store is bounded, and treating it as a number would delete history on a typo
- [x] 5.2 Remove Turns older than the configured age with their messages, and verify Turns within the age remain retrievable in the tail and by recall
- [x] 5.3 Verify nothing is removed when no retention age is configured, however old the Turns
- [x] 5.4 Verify a Turn with no arrival time is left in place by retention
- [x] 5.5 Verify Accounting for a removed Turn's Calls is still readable, and report how many Turns retention removed — Accounting is untouched by the delete, and the count is reported once at shutdown
- [x] 5.6 Run retention at session shutdown beside ingest, and verify no Call on the `context` path waits for it — `session_shutdown` runs ingest and then retention, both inside the `try` whose `finally` releases resources; no `context` handler reaches either

## 6. Deadlines on the context path

- [x] 6.1 Add a per-Store deadline to configuration with task 1.2's defaults, and verify each Store's deadline is settable independently — `PICHART_TAIL_DEADLINE_MS`, `PICHART_RECALL_DEADLINE_MS`, `PICHART_DOC_DEADLINE_MS`, `PICHART_GRAPH_DEADLINE_MS`, each independent, defaulting to task 1.2's figures
- [x] 6.2 Bound the tail and the three retrievals by their deadlines, and verify a Store that never answers costs its part while the Turn proceeds — the four per-Store helpers each race their own call; the wait is injected (`deps.after`) so no test spends the time
- [x] 6.3 Verify a missed deadline is reported as a missed deadline, distinguishably from a Store that refused the connection, and that Accounting shows the part absent — "did not answer within 5000ms" against "Recall unavailable", and the part is simply absent from the Pack, which is what Accounting records
- [x] 6.4 Verify one Store missing its deadline leaves the parts served by the others carried
- [x] 6.5 Verify a tail deadline missed falls back to the harness's own history and records the fallback as an unreachable store does — the tail falls back to the harness's history and records `harness-fallback`, exactly as an unreachable Store does
- [x] 6.6 Verify a Call whose every Store fails to answer still supplies a Pack, and waits no longer than the largest configured deadline — every Store silent still yields a Pack, and the longest wait is the largest deadline configured

## 7. Bounding a child process

- [x] 7.1 Give `runProcess` and `RunCommand` a caller-supplied deadline, and verify a command finishing inside it behaves exactly as today
- [x] 7.2 Kill the child on expiry — terminate, then kill after a grace period — and verify a child that outlives its deadline leaves no process running — held against a real child that `exec`s `sleep`, so the process the deadline kills is the process that was sleeping, and the test asks the process table rather than a clock
- [x] 7.3 Return the output produced before the kill with the timeout named, and verify the caller reports the failure rather than never settling
- [x] 7.4 Pass task 1.3's deadlines at every call site — `graphify extract`, the interpreter and package installs, `openspec validate`, `docker compose up -d --wait` — and verify a hanging extraction costs the structure part and reports it — `graphify extract` 60 s, `--version` 10 s, `python3 -m venv` and `pip install` 300 s, `openspec validate` 30 s, `docker compose up -d --wait` 120 s. Held by a test per Store against the injected `RunCommand`: every program the Graph Store, the Spec Store and setup run carries a deadline, red when one call site drops it

## 8. The journal miss, the port, and the tiebreak

- [x] 8.1 Return the number of Turns stored from ingest and report it from the sweep, and verify a Journal yielding none is distinguishable from one never read — a Journal that was read and held nothing reports that it holds no turns; one that could not be found reports the miss; a Journal with Turns reports how many were stored
- [x] 8.2 Report a Journal that cannot be found, naming the Conversation and the root searched, and verify the Turn still proceeds on the harness's own history
- [x] 8.3 Build the default database URL from `PICHART_PG_PORT` when `PICHART_DATABASE_URL` is unset, and verify the port set for Compose is the port the extension dials, with 55432 when neither is set — code only: the README's `PICHART_PG_PORT` sentence is `audit-docs-debt`'s, and its task 1.1 reads this resolution before rewording it. The variable is now read, so its wording is the "kept and scoped to the default URL" branch
- [x] 8.4 Add the identity tiebreak to the Concept candidate set, and verify a query against a corpus larger than the candidate set selects the same Concepts in the same order across repeated retrieval and across an index rebuild — `, identity ASC, section_index ASC` in the inner `nearest` CTE. Held against 60 Concepts saying the same thing, a candidate window cutting through the ties, and a `REINDEX` between retrievals; red without the tiebreak

## 9. Resource lifecycle

- [x] 9.1 Wire `PostgresStore.close()` into constructed dependency cleanup, and verify Store and embedder cleanup are both attempted when either fails
- [x] 9.2 Run dependency cleanup in a `finally` path after final ingest and retention, and verify a failed final sweep cannot skip cleanup
- [x] 9.3 Repeatedly start and shut down extension dependencies against the Store, and verify database connection use returns to baseline rather than accumulating — five start/shutdown cycles against the real Store, comparing connections after the first with connections after the fifth, so a backend the server has not reaped yet is noise that does not grow

## 10. Verification

- [x] 10.1 Ingest one of this machine's real Journals twice and confirm the second sweep writes only the highest Turn rather than every message, reporting the statement count against the recorded 3,371 — first sweep 49 statements for 16 Turns, **second sweep 1 statement and nothing written**, against the recorded 3,371
- [x] 10.2 Resume that Conversation from a subdirectory and confirm its historical Turns still report the original Codebase through `recall_across_conversations` — re-ingested from `src/`, every historical Turn still reports `/home/user/dev/pi-chart` through `searchAll`
- [x] 10.3 Run with a configured retention age against a scratch Store, confirm old dated Turns and their messages leave, undatable Turns and Accounting remain, then run with retention unset and confirm nothing leaves — eight Turns backdated 90 days: retention at 30 removed 8 with every message (no orphans), left the 8 within the age, left the undatable Turn in place, and the Accounting recorded for a removed Turn still reads back. With retention unset nothing was removed
- [x] 10.4 Run the default, store-backed, model, graphify, OpenSpec and live suites and the type checker, and confirm `openspec validate store-hygiene` passes — default 404 pass, store-backed 506 pass, model suite (`PICHART_EMBED=1`) 35 pass, `PICHART_GRAPHIFY=1` 4 pass, `PICHART_OPENSPEC=1` 7 pass, `PICHART_LIVE=1` 4 pass / 1 skip, `tsc` clean, `openspec validate store-hygiene` passes
