## 1. Confirm where the backend injects, before rewriting anything

- [ ] 1.1 Run one live Conversation with `memory.backend` set to the local backend and this extension active, and record whether the memory block arrives in the message array the `context` event hands over or in the Floor the harness reports
- [ ] 1.2 Record the Floor size for that Conversation against a Conversation with the backend off, and confirm the difference accounts for the injected block rather than the Pack growing
- [ ] 1.3 If the block turns out to reach the message array on any backend, stop and revise `design.md`: the stripping option returns and this plan's central decision is wrong

## 2. The state the check produces

- [ ] 2.1 Keep the backend state as three values — off, active, unconfirmed — and verify a harness that answers `off`, one that answers with an active backend, and one that does not answer each yield their own value
- [ ] 2.2 Verify a `status` call that throws is treated as unconfirmed rather than as off
- [ ] 2.3 Verify the state is determined once per Conversation and does not change between Calls

## 3. Reporting

- [ ] 3.1 Report once per Conversation when the backend is active, naming the backend and the setting that disables it, and verify the report fires exactly once across several Calls
- [ ] 3.2 Report once when the backend cannot be confirmed, in terms that do not read as verified-off, and verify the wording distinguishes the two cases
- [ ] 3.3 Verify a confirmed-off backend produces no report at all
- [ ] 3.4 Verify an active backend does not withhold the Context Pack: assemble, supply, and complete the Turn, and verify the Pack equals what it would have been

## 4. Recording the state

- [ ] 4.1 Add the forward migration for the per-Call backend state and verify it applies to the existing database
- [ ] 4.2 Record the state with the Accounting already written for each Call, off the request path, and verify no additional round trip is made on the path the model waits for
- [ ] 4.3 Verify the state is readable per Call afterwards, and that unconfirmed reads back as unconfirmed rather than as off
- [ ] 4.4 Verify a Conversation whose backend was active for some Calls and off for others identifies exactly the exposed Calls
- [ ] 4.5 Verify Accounting rows written before this column existed still read, with the state absent rather than failing

## 5. The pack's own guarantee

- [ ] 5.1 Verify a Context Pack's messages contain only what the Assembler's parts contributed, so the Pack-level assertion is checked rather than assumed

## 6. The spec edit

- [ ] 6.1 Record in `docs/adr/` that the invariant is enforced by detection and disclosure because the injection lands in the Floor, citing the live confirmation from task 1 rather than the documentation alone
- [ ] 6.2 Verify `/context-manager` still reports the same condition on demand and its wording agrees with the session-start report

## 7. Verification

- [ ] 7.1 Run a live Conversation with the backend active and confirm the report appears, the Turn completes, and the Calls are marked exposed in the Accounting afterwards
- [ ] 7.2 Run a live Conversation against a harness that does not report a backend and confirm the unconfirmed path, end to end
- [ ] 7.3 Run the default and store-backed suites and the type checker, and confirm `openspec validate single-injector-enforcement` passes
