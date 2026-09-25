## 1. Confirm where the backend injects, before rewriting anything

- [x] 1.1 Run one live Conversation with `memory.backend` set to the local backend and this extension active, and record whether the memory block arrives in the message array the `context` event hands over or in the Floor the harness reports
- [x] 1.2 Record the Floor size for that Conversation against a Conversation with the backend off, and confirm the difference accounts for the injected block rather than the Pack growing
- [x] 1.3 If the block turns out to reach the message array on any backend, stop and revise `design.md`: the stripping option returns and this plan's central decision is wrong

> Two live Conversations over the same scratch project and the same prompt — "What is the deployment codeword? Answer in one word, and say where you learned it" — differing only in `memory.backend`. The project's memory root held one planted summary naming `PEREGRINE-7741`, a codeword no model can guess.
>
> **1.1** With `backend: local` the model answered `PEREGRINE-7741`, while the `context` event handed over **one message of 184 characters with no trace of it**. With `backend: off` the same Conversation could not answer at all. The content reached the model and did not reach the message array: it is in the Floor.
>
> **1.2** `nonMessageTokens` was **26,086** with the backend active against **25,767** with it off — a **319-token** difference on the Floor side of the window, while the Pack path was identical in both runs. The block is measured where the Assembler cannot reach.
>
> **1.3** Not triggered. `local` and `hindsight` were both exercised; neither put anything in the message array.

## 2. The state the check produces

- [x] 2.1 Keep the backend state as three values — off, active, unconfirmed — and verify a harness that answers `off`, one that answers with an active backend, and one that does not answer each yield their own value
- [x] 2.2 Verify a `status` call that throws is treated as unconfirmed rather than as off
- [x] 2.3 Verify the state is determined once per Conversation and does not change between Calls

> `backendState` in `src/harness.ts` maps the harness's answer into the three states, and the extension asks once at `session_start`. Three silences are one state: no `memory`, no `status`, and a `status` that throws (`test/extension.test.ts`, "a harness that never answers is unconfirmed, not off"). Three Calls of one Conversation record `active`, `active`, `active`.

## 3. Reporting

- [x] 3.1 Report once per Conversation when the backend is active, naming the backend and the setting that disables it, and verify the report fires exactly once across several Calls
- [x] 3.2 Report once when the backend cannot be confirmed, in terms that do not read as verified-off, and verify the wording distinguishes the two cases
- [x] 3.3 Verify a confirmed-off backend produces no report at all
- [x] 3.4 Verify an active backend does not withhold the Context Pack: assemble, supply, and complete the Turn, and verify the Pack equals what it would have been

> The active report names the backend and `memory: {backend: off}`; the unconfirmed one says the invariant could not be confirmed and that the Calls are recorded as unconfirmed rather than clean. An off backend reports nothing at all (`cm.reported` empty). A Conversation with an active backend returns the same Pack messages as one with it off.

## 4. Recording the state

- [x] 4.1 Add the forward migration for the per-Call backend state and verify it applies to the existing database
- [x] 4.2 Record the state with the Accounting already written for each Call, off the request path, and verify no additional round trip is made on the path the model waits for
- [x] 4.3 Verify the state is readable per Call afterwards, and that unconfirmed reads back as unconfirmed rather than as off
- [x] 4.4 Verify a Conversation whose backend was active for some Calls and off for others identifies exactly the exposed Calls
- [x] 4.5 Verify Accounting rows written before this column existed still read, with the state absent rather than failing

> Migration 16 adds `memory_backend TEXT`, nullable and never backfilled. The suites only ever prove a fresh migrate, so the upgrade was run by hand: against a database already at 15 and already holding rows, the column appeared, the pre-existing row still read back, and its state read absent. The state rides the `recordPack` and `recordUnassembled` writes started `inBackground` — the same single statement, no second round trip; "does not wait for accounting before handing back the pack" still holds. It is a required argument on both writes, because every Call has a state: a Conversation that could not interrogate the harness is `unconfirmed`, and absence means only that a row predates the column.

## 5. The pack's own guarantee

- [x] 5.1 Verify a Context Pack's messages contain only what the Assembler's parts contributed, so the Pack-level assertion is checked rather than assumed

> "parts account for every message in the pack, in order" now assembles with every part populated — recall, curated, structure, tail and current Turn — and asserts the Pack's messages are exactly the parts' messages concatenated. Smuggling one message into the Pack past the parts fails it.

## 6. The spec edit

- [x] 6.1 Record in `docs/adr/` that the invariant is enforced by detection and disclosure because the injection lands in the Floor, citing the live confirmation from task 1 rather than the documentation alone
- [x] 6.2 Verify `/pi-chart` still reports the same condition on demand and its wording agrees with the session-start report

> `docs/adr/0004-single-injector-enforced-by-disclosure.md`, carrying the measured figures from task 1. The check and the report now say the same thing in the same words, asserted end to end through the registered command.

## 7. Verification

- [x] 7.1 Run a live Conversation with the backend active and confirm the report appears, the Turn completes, and the Calls are marked exposed in the Accounting afterwards
- [x] 7.2 Run a live Conversation against a harness that does not report a backend and confirm the unconfirmed path, end to end
- [x] 7.3 Run the default and store-backed suites and the type checker, and confirm `openspec validate single-injector-enforcement` passes

> **7.1** `memory.backend: local`, a real model, a real Thread Store: the report named `local` and the setting, the Turn answered `ready`, and the Conversation's Call reads `memory_backend = active` in `call_accounting`.
>
> **7.2** omp never stays silent — `status()` answered in all four configurations tried, including `hindsight` pointed at a dead port, which reports itself active with "does not expose structured status". So the unconfirmed path was exercised live by withholding `ctx.memory` the way a harness without the capability would: the report appeared, the Turn answered `steady`, and the Call reads `memory_backend = unconfirmed`. Both runs were repeated against the reviewed code.
>
> **7.3** 494 default tests pass; 614 with `PICHART_DATABASE_URL` against a scratch Postgres 18.6 with pgvector; `tsc` clean; `openspec validate single-injector-enforcement --strict` passes. Sixteen mutations were applied to the new mechanisms — silence read as off, a backend named without an `active` flag read as off, a throwing `status` read as off, the state dropped at each of its six hops, the report repeated per Call, an active backend rounded to healthy in the check, the Call view and the Conversation summary hiding it, and a message smuggled into a Pack past its parts — and every one failed a test.

## 8. Review

Two axes, both against `3e16158`.

**Standards.** Three P2 findings, all acted on. The state was recorded through an *optional* trailing parameter guarded by `if (memoryBackend)` and a SQL `coalesce`, defending a caller that does not exist — production always knows the state, because "unknown" already has a name (`unconfirmed`). It is now required on both writes, the guards are gone, and the test that pinned the re-record rule is replaced by one that covers `recordUnassembled` through the real store, which nothing had exercised. `MemoryBackendState` and the classifier were in `harness.ts`, making four pure modules import from the harness adapter and contradicting that file's own header; the type now sits beside `TailSource` in `accounting.ts` — it is record vocabulary — and the classifier is a private function in the adapter, where "the harness's answer in our vocabulary" belongs.

Four P3s acted on: the active report claimed Calls are "recorded as exposed" when the value is `active`, which broke the same-words rule the change itself states; the unconfirmed test's comment claimed three silences and exercised two; a backend named without an `active` flag was accepted by no test, so an implementation checking only the flag would have passed; and the agreement test asserted one surface while its name claimed two.

**Spec.** Two findings acted on. The delta required the report to be "unmissable", which is an adverb no code implements and no test can distinguish — it now says the report is made when the backend is anything other than off, and that the per-Call record is what makes the condition outlive it. And the README claimed `/pack` lists a Conversation's exposed Calls when `renderCall` shows one Call at a time; `pack summary` now names them, which is the surface the scenario's own question asks for.

Every delta scenario has a test behind it, confirmed one at a time by the spec axis.
