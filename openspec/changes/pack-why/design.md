## Context

This ticket is what makes the rest of the queue measurable. Every figure in `docs/audits/2026-09-16-functionality-audit.md` was derived by reading Journals with a throwaway script, because the inspector could answer none of them: the 526,302-token Turn, the 974,861-token eight-Turn tail, the 1.35–1.49× estimator bias, and the 8.6% reduction that justifies `token-budgets`. Those are questions about a Conversation's own Accounting, asked from outside it, because from inside it `/pack` answers `3 not relevant enough` (`src/report.ts:108-112`) and `dropped` is `candidates − carried` (`src/inspection.ts:151-152`).

`token-budgets` has since put names behind part of that. `recordPart` retains four distinct exclusion reasons — `irrelevant`, `count`, `size`, `ceiling` — plus `withoutCeiling`, `shortened` and `tokenBudget` (`src/accounting.ts:115-146`), and `renderCall` renders every one of them for every part, including a part with no count Budget (`src/report.ts:20-75`). So the *reasons* are already recorded and already read.

What is still missing is identity. Every reason is a count: which Turn was refused, at what distance, against which threshold, is nowhere — `recordPart` has no field for it, so no reader can have one. Nor is anything addressable: `inspect` reads `calls[calls.length - 1]` and `[- 2]` (`src/extension.ts:689-695`) while `readAccounting` already returns every Call in order (`src/postgres-store.ts:548-555`). And the retrieval side still refuses silently — `searchConcepts` returns hits already filtered with no count of what it excluded, so `curated` has nothing to report even now that the renderer would print it.

This slice adds the identities, the addressing, and the retrieval-side counts. See `proposal.md` and the two delta specs.

## Goals / Non-Goals

**Goals:**

- An absence explained by identity and distance, not by an integer.
- Any recorded Call reachable, so a bad Pack noticed three Turns later is still diagnosable.
- Irrelevance reported for every part, so a threshold set too tight is distinguishable from an empty corpus, a failed index and a Store never wired.
- The estimator's bias visible where the estimate is used.

**Non-Goals:**

- What is retrieved or how it ranks — `recall-fidelity`, `doc-authoring`, `structure-freshness`.
- Any Budget, ceiling, elision or window-fraction warning — `token-budgets`.
- Re-deriving Turn positions after a compaction; see below.
- Retaining enough to replay a Pack. Accounting explains, the Journal replays.

## Decisions

### The ledger keeps a bounded ranked head per part, not every candidate

Each part records its nearest excluded candidates, distance ascending, the remainder surviving as a count per reason. Task 1 measures the bound before it is set: over the audit's Journals, at what rank does the Turn a user would actually ask about appear? The proposed default is 5 per part, which the over-fetch each Store already performs (`src/extension.ts:715-720,746-750,770-773`) makes cheap — a Call's whole candidate set is around twenty items.

Retaining all of them loses twice: that detail rides in the `parts` JSONB read whole on every `/pack`, and diagnostic value falls monotonically with distance. Retaining only counts is the present failure.

### The ledger holds identity and distance, never content

Deliberately not retained: the text of any candidate not carried, any embedding, and any candidate beyond the ranked head. ADR-0002 makes the Journal the record and the Thread Store a derived index, and the bundle plays that role for Concepts; Accounting that copied refused content would be a second, partial, unrebuildable record of both. A Turn refused at 0.61 is readable in full by its position, which is what the ledger supplies.

### The ledger is written where Accounting already is

`recordPack` runs through `inBackground`, off the request path (`src/extension.ts:333-336`), and the detail rides in the existing `parts` JSONB plus one Call-level field, which `decode` already tolerates absent (`src/postgres-store.ts:561-566`). No migration, no backfill, no latency where the model waits. A separate table would buy a migration and a join for a few hundred bytes. Calls already recorded stay unexplainable, and the delta says so: reporting "nothing excluded" for them is the same lie in a new place.

### A call is addressed absolutely, and a missing address is refused

An address is a Turn and optionally a Call within it; bare means the latest Call, as today. A Turn alone resolves to its last recorded Call, the one whose Pack carried the whole tool loop. Comparison takes two addresses. An address never recorded is refused, naming what is recorded: clamping to the nearest Call answers about a different Call than the one asked about, the failure this ticket exists to remove. Relative addressing is not added — a second scheme doubles the ways an answer can be about the wrong Call.

### Retrieval hands over its near misses, mirroring `Recollections`

`Recollections` already carries `{ turns, rejected }` (`src/thread-store.ts:52-57`). `searchConcepts` returns hits already filtered by distance and status, discarding the distance it computed (`src/postgres-store.ts:819-865`), so the curated part has no refusal count to report at all. It takes the same shape — hits, a refusal count, ranked near misses — with `ConceptHit` carrying its distance. The refusals come free: `nearest` already holds every candidate's distance before `best` filters at `distance <= maxDistance` (`:820-834`), so heading that set is one branch over the same rows. A second query would double the ANN cost where the model waits.

Structure has no distance — `neighbourhoods` returns what the graph held for the symbols in play — so its exclusions are Budget-only and it reports *no relevance threshold* rather than zero refusals. A part that cannot refuse must not read like one that refused nothing.

### Compaction is detected from the reported epoch, recorded, and not acted on further

`ContextSnapshot.compactionEpoch` arrives per Call (`src/messages.ts:22-26`) and `reconcile` already walks every snapshot in the branch (`src/extension.ts:783-794`), so detection is a comparison against the last epoch seen — no new source of truth. The one observed compaction is epoch 0→1 at 822,279 reported tokens.

The extension records it, reports it once, and stops. `addressOf` numbers Turns by counting `role === "user"` entries in the branch (`src/extension.ts:822-848`), so a compaction rewriting that branch renumbers the addresses this ticket depends on — but whether it does is `[INFERENCE]`, and task 7 reads that Journal. If the branch keeps its pre-compaction prompts, the record is a caveat; if not, re-deriving positions is its own change, because renumbering Accounting against an unread assumption would corrupt the only ordered record there is.

### The inspector renders estimate, reported and their ratio side by side

`token-budgets` retains both figures per Call. The inspector prints both and their ratio, per Call and averaged across a Conversation. Rendering only the reported figure — the accurate one — hides the drift of the number the Pack ceiling is applied to. The audit's 1.35–1.49× is the pre-`token-budgets` bias; afterwards the ratio should sit near 1, and this is where that is checked.

## Risks / Trade-offs

- **A bound of 5 may miss the candidate a user asks about** → task 1 sets it from measured rank, it is configurable, and the count beyond it makes the truncation visible.
- **More JSONB per Call on a store that already grows without bound** → a few hundred bytes against whole message bodies already retained; retention is `store-hygiene`'s.
- **Distance on `ConceptHit` invites ranking on it elsewhere** → it is reported, never re-weighted, the line ADR-0003's tie-break argument draws.

## Testing seams

| Requirement | Seam |
| --- | --- |
| Accounting records what a call did not carry | `recordPart`/`recordPack` boundary over synthetic exclusions; store-backed read-back for the bound. |
| Every retrieving part records what it refused | `assemble()` boundary; store boundary for the curated near misses `searchConcepts` must now return. |
| A harness compaction is recorded against the call it affected | Journal fixture carrying an epoch flip, through the boundary that already walks snapshots. |
| A part reports how much of its budget it spent | Pure `inspection.ts`/`report.ts` boundary, including the unwired, failed, empty and tight-threshold cases. |
| Any recorded call of a conversation can be examined | Pure `inspection.ts` boundary; store boundary for a Call read back from a real Conversation. |
| An absence can be explained by name | Pure `inspection.ts`/`report.ts` boundary over a recorded ledger. |
| A harness compaction is visible in the record | Pure `inspection.ts`/`report.ts` boundary, plus that same fixture end to end. |
| The estimate is reconciled against the reported window | Pure `inspection.ts`/`report.ts` boundary over a Call carrying both figures, and the unmeasured case. |

The target seam is the pure `inspection.ts`/`report.ts` boundary over recorded Accounting: it sees every view this slice adds and needs no container, model, network or harness. Only the ledger read-back, the retained bound, the curated near misses and addressing over a real Conversation need the store-backed suite (`CM_DATABASE_URL`); compaction detection needs only a Journal fixture. The model and tool-gated suites are untouched; task 9 needs `CM_LIVE=1`.

## Open Questions

None. Two things resolve during implementation:

- The retained bound, which task 1 measures before task 2 sets a default.
- Whether a compaction shifts Turn addressing, which task 7 reads from the observed Journal. A break is its own change; this slice records the fact regardless.
