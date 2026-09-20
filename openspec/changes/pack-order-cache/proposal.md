# Proposal: Pack Order and the Prompt Cache

Triage: ready-for-agent

## Why

Ordinary Conversations here run 91–93% `cacheRead` against total input: a Context Pack's body is cached today, and it is most of what a Call costs. The Assembler puts volatile per-Call retrieval at the front of every pack — recalled, then curated, then structure (`src/assembler.ts:202-267`) — ahead of the verbatim tail (`:278`) and the current Turn (`:300-308`). Caching is prefix-based and the recalled set changes every Call by construction, so **[INFERENCE]** any change to those leading parts plausibly invalidates the cached prefix for the whole body beneath. The audit marks this an inference; it was not reproduced.

It cannot be asserted because nothing measures it. Each Call's Journal entry carries `usage.cacheRead`, `cacheWrite` and `input`; `src/messages.ts:36` types `usage` as little more than `totalTokens`, and no code in `src/` reads it. `measurementsOf` already walks those same messages for `contextSnapshot` (`src/extension.ts:899-911`), and Accounting keeps only pack and Floor figures (`src/accounting.ts:235-241`). The system never records the cost it exists to control.

ADR-0001 rejected the stateless-per-Turn option partly over prompt-cache writes (`docs/adr/0001-omp-extension-not-own-loop.md:7`), so this wants an answer, not an action. This change is the measurement only, and it is `ready-for-agent` on that scope: `design.md` fixes the derived rate, the governed-Call population, the three confounds and the decision rule in advance, so an agent can run it without asking anything. The reorder itself is a human's call — trading a semantic argument for a cost one — and ships as a separate change, or not at all, with every outcome including a negative one recorded as an ADR.

## What Changes

- Record per-Call cache figures where measurements are already gathered from the branch, persisted in Accounting beside `packTokens` and `floorTokens`.
- Report hit rate per Call, so an inspected Conversation shows where inside a Turn the cache is written rather than read.
- Baseline the inference: hit rate against Call position in a Turn, against whether the leading parts changed between Calls, and against tail-slide frequency.
- Then, only if the numbers support it, move the volatile parts to sit immediately before the current Turn, so the body misses when the tail slides rather than on every Call.
- If they do not, record the negative result as an ADR and leave the order alone.

Two complications are in scope. The tail slides when a Turn drops out of it, and `token-budgets` makes the tail's contents depend on size as well as count — possibly making the prefix less stable, not more; measure that rather than assume it away. And the order is not arbitrary: it encodes the claim that retrieval is background for the exchange that follows (`src/assembler.ts:202-203,229-230,249-250`).

**Not in scope:** the token Budget and pack ceiling themselves (`token-budgets`); the rejected-candidate ledger and `pack <turn>.<call>` addressing (`pack-why`); anything about what is retrieved (`recall-fidelity`, `doc-authoring`).

## Capabilities

### Modified Capabilities

- No spec delta, so the measurement slice declares `skip_specs`: it records a diagnostic figure the Journal already holds and changes no promise made to a user. No requirement states a composition order — `openspec/specs/context-assembly/spec.md:27,102,160,189` name the parts and their Budgets, never their sequence — so that requirement is worth writing only once a result stands behind it.

## Impact

- **Schema:** three nullable integers on `call_accounting`, derived from the Journal and rebuildable by re-ingest.
- **Configuration:** none; nothing to tune until there is a result.
- **Assembly:** unchanged in the measurement slice; recording runs on the background path measurements already use (`src/extension.ts:830-833`), so it cannot delay a Call.
- **Migration:** earlier Calls carry no cache figures; re-ingest backfills them where the Journal survives.
- **Performance:** the whole point, but the sign is unknown until measured. `token-budgets` has shipped, so the tail this measures is the one that now exists: bounded by size as well as count, which is the confound `design.md` says the baseline must control for.
- **Unblocks:** a decision — a reordering with evidence behind it, or an ADR that closes the question.
