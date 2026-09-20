# Proposal: Explaining an Absence

Triage: ready-for-agent

## Why

The two questions a user actually has about a Context Pack are both unanswerable. *Why was the Turn where we decided that not recalled?* — `/pack` answers `3 not relevant enough` (`src/report.ts:108-122`), naming none of the three. *What did the Budget drop?* — `dropped` is `candidates − carried` (`src/inspection.ts:158-159`), an integer with nothing behind it. No candidate that was not carried is recorded anywhere (`src/accounting.ts:120-150`), so none can be named.

Nor can an absence be located in time. `inspect` reads `calls[calls.length - 1]` and `calls[calls.length - 2]` with no addressing (`src/extension.ts:729-735`), so a bad Pack noticed three Turns later is out of reach — although the rows persist and `readAccounting` returns every Call of the Conversation in order (`src/postgres-store.ts:645-652`).

This ticket is what makes the rest of the queue measurable. Every figure in `docs/audits/2026-09-16-functionality-audit.md` had to be derived by reading Journals with a throwaway script, because the inspector could not answer them — including the 8.6% reduction that justifies `token-budgets`, exactly the question a user should be able to ask of their own Conversation.

## What Changes

- Accounting retains the top rejected candidates of each Call: Turn index or Concept identity, distance, and the threshold that refused it. Identity and distance only — never the refused text, which stays in the Journal and the bundle.
- The same for content a Budget excluded, including the "dropped for size" reason `token-budgets` introduces: which recollection, which Concept, which neighbourhood.
- `pack why <text>` renders a ranked ledger of near misses: `turn 12  distance 0.61  > 0.50 threshold`.
- `pack <turn>[.<call>]` reopens any recorded Call; `pack diff` accepts two addresses.
- Every part reports irrelevance. The *rendering* half shipped with `token-budgets`, whose `REASONS` table prints every reason for every part (`src/report.ts:20-75`); what remains is the retrieval half. `searchConcepts` returns hits already filtered by distance and status with no count of what it refused (`src/postgres-store.ts:925-971`); it returns that count and the near misses, so `curated` has something to report. A `CM_DOC_MAX_DISTANCE` set too tight still shows no `curated` line at all — indistinguishable from an empty bundle, a failed index, or a Doc Store never wired, and it is the one knob the README asks users to tune.
- `packTokens` is reconciled per Call against the local estimate and the Floor (`src/accounting.ts:235-241`), so the estimator's bias is visible where it is used.
- A `compactionEpoch` change is noticed. It is declared (`src/messages.ts:25`) and read nowhere, yet `addressOf` numbers Turns by counting prompts in the harness branch (`src/extension.ts:862-886`) — so a compaction that rewrites that branch renumbers the addresses this ticket's addressing depends on.

**Not in scope:** the token Budget, the pack ceiling, the window-fraction warning, and the whole-message estimate, all `token-budgets`; and any change to what is retrieved or how it ranks, which is `recall-fidelity` and `doc-authoring`.

## Capabilities

### Modified Capabilities

- `pack-accounting`: a new obligation to record what a Call did *not* carry — rejected and dropped candidates by identity, with the distance and the threshold or Budget that excluded them, bounded to a small ranked head per Call. Refused content is deliberately not retained, and candidates below that head survive only as a count.
- `pack-inspection`: the report distinguishes irrelevance from trimming for every part rather than recall alone, any recorded Call is addressable, and an absence is explainable by name and distance.

## Impact

- **Schema:** the detail rides in the existing `parts` JSONB and one Call-level field; `decode` already tolerates rows lacking it (`src/postgres-store.ts:658-663`), so no migration and no backfill. Calls already recorded stay unexplainable, which they are.
- **Configuration:** how many rejected candidates to keep per Call. Small — this is diagnosis, not an index.
- **Assembly:** retrieval must hand the Assembler its near misses instead of a count, so `Recollections` and `ConceptHit` carry distance. `assemble` stays pure.
- **Performance:** a few hundred bytes more JSONB per Call; `pack why` reads the Accounting the inspector already reads.
- **Compaction:** the response is grounded in one observed compaction (epoch 0→1 at 822,279 reported tokens). The implementing agent confirms against that Journal whether the branch keeps its pre-compaction prompts; until it is read, whether addressing shifts or breaks is [INFERENCE], and a break is its own change.
- **Unblocks:** judging `recall-fidelity`, `doc-authoring` and `structure-freshness` from inside a Conversation instead of from a script.
