## 1. Measure before choosing

- [ ] 1.1 Record how long each Store call on the `context` path takes against this machine's store, worst case over the audited Conversations, and record the figures for the tail and for each of the three retrievals
- [ ] 1.2 Choose each per-Store deadline from those figures, and record the headroom left over the measured worst case and why the tail's differs from the retrievals'
- [ ] 1.3 Record how long each command behind `runProcess` takes on a cold machine — `graphify extract`, `python3 -m venv`, `pip install`, `openspec validate`, `docker compose up -d --wait` — and choose each caller's deadline from that
- [ ] 1.4 Count the statements a sweep of the worst Journal costs today, and record the budget a second sweep over an unchanged Conversation must not exceed, against the recorded 3,371

## 2. Provenance written once

- [ ] 2.1 Stop the ingest conflict clause from writing a Turn's Codebase, and verify a Turn ingested from one Codebase and re-ingested from a subdirectory of it still reads with the first
- [ ] 2.2 Verify a Turn stored for the first time by a later ingest records the Codebase that ingest ran from
- [ ] 2.3 Verify a Turn stored with no Codebase reads with it absent rather than failing, and is not backfilled by a later ingest
- [ ] 2.4 Verify `recall_across_conversations` reports the Codebase a Turn was first stored with after a re-ingest from elsewhere

## 3. Incremental ingest

- [ ] 3.1 Read the stored high-water Turn index for a Conversation before writing, and skip Turns below it while re-writing the highest
- [ ] 3.2 Write each Turn in one transaction with its messages as a single multi-row insert, and verify the statement count for a second sweep over an unchanged Conversation is within task 1.4's budget
- [ ] 3.3 Verify a Conversation that grew by one Turn costs only that Turn plus the re-written highest, and that the new Turn is retrievable
- [ ] 3.4 Verify a Turn whose final message was unflushed at the previous sweep is stored complete after the next, and its messages read in order
- [ ] 3.5 Verify an ingest interrupted between Turns leaves the Turns already written intact and the next ingest completes the rest

## 4. When a turn arrived

- [ ] 4.1 Add the forward migration giving `turns` a nullable ingest time defaulted on insert, with no backfill, and verify it applies to the existing database leaving existing rows null
- [ ] 4.2 Verify a newly ingested Turn reads with its arrival time, and re-ingesting the Conversation leaves that time unchanged
- [ ] 4.3 Verify a Turn with no arrival time reads with it absent rather than derived, and nothing on the read path fails on it

## 5. Retention

- [ ] 5.1 Add the retention age to configuration, unset by default, and verify an unusable value is refused with a reason rather than silently disabling or enabling retention
- [ ] 5.2 Remove Turns older than the configured age with their messages, and verify Turns within the age remain retrievable in the tail and by recall
- [ ] 5.3 Verify nothing is removed when no retention age is configured, however old the Turns
- [ ] 5.4 Verify a Turn with no arrival time is left in place by retention
- [ ] 5.5 Verify Accounting for a removed Turn's Calls is still readable, and report how many Turns retention removed
- [ ] 5.6 Run retention at session shutdown beside ingest, and verify no Call on the `context` path waits for it

## 6. Deadlines on the context path

- [ ] 6.1 Add a per-Store deadline to configuration with task 1.2's defaults, and verify each Store's deadline is settable independently
- [ ] 6.2 Bound the tail and the three retrievals by their deadlines, and verify a Store that never answers costs its part while the Turn proceeds
- [ ] 6.3 Verify a missed deadline is reported as a missed deadline, distinguishably from a Store that refused the connection, and that Accounting shows the part absent
- [ ] 6.4 Verify one Store missing its deadline leaves the parts served by the others carried
- [ ] 6.5 Verify a tail deadline missed falls back to the harness's own history and records the fallback as an unreachable store does
- [ ] 6.6 Verify a Call whose every Store fails to answer still supplies a Pack, and waits no longer than the largest configured deadline

## 7. Bounding a child process

- [ ] 7.1 Give `runProcess` and `RunCommand` a caller-supplied deadline, and verify a command finishing inside it behaves exactly as today
- [ ] 7.2 Kill the child on expiry — terminate, then kill after a grace period — and verify a child that outlives its deadline leaves no process running
- [ ] 7.3 Return the output produced before the kill with the timeout named, and verify the caller reports the failure rather than never settling
- [ ] 7.4 Pass task 1.3's deadlines at every call site — `graphify extract`, the interpreter and package installs, `openspec validate`, `docker compose up -d --wait` — and verify a hanging extraction costs the structure part and reports it

## 8. The journal miss, the port, and the tiebreak

- [ ] 8.1 Return the number of Turns stored from ingest and report it from the sweep, and verify a Journal yielding none is distinguishable from one never read
- [ ] 8.2 Report a Journal that cannot be found, naming the Conversation and the root searched, and verify the Turn still proceeds on the harness's own history
- [ ] 8.3 Build the default database URL from `CM_PG_PORT` when `CM_DATABASE_URL` is unset, and verify the port set for Compose is the port the extension dials, with 55432 when neither is set
- [ ] 8.4 Add the identity tiebreak to the Concept candidate set, and verify a query against a corpus larger than the candidate set selects the same Concepts in the same order across repeated retrieval and across an index rebuild

## 9. Resource lifecycle

- [ ] 9.1 Wire `PostgresStore.close()` into constructed dependency cleanup, and verify Store and embedder cleanup are both attempted when either fails
- [ ] 9.2 Run dependency cleanup in a `finally` path after final ingest and retention, and verify a failed final sweep cannot skip cleanup
- [ ] 9.3 Repeatedly start and shut down extension dependencies against the Store, and verify database connection use returns to baseline rather than accumulating

## 10. Verification

- [ ] 10.1 Ingest one of this machine's real Journals twice and confirm the second sweep writes only the highest Turn rather than every message, reporting the statement count against the recorded 3,371
- [ ] 10.2 Resume that Conversation from a subdirectory and confirm its historical Turns still report the original Codebase through `recall_across_conversations`
- [ ] 10.3 Run with a configured retention age against a scratch Store, confirm old dated Turns and their messages leave, undatable Turns and Accounting remain, then run with retention unset and confirm nothing leaves
- [ ] 10.4 Run the default, store-backed, model, graphify, OpenSpec and live suites and the type checker, and confirm `openspec validate store-hygiene` passes
