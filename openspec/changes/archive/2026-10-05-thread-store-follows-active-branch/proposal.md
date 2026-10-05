# Proposal: The Thread Store Follows the Conversation's Active Branch

Triage: ready-for-agent
Blocked by: None

## Why

`/tree` and `/branch` (alias `/rewind`) move the harness's leaf back to an earlier entry in the same Journal and continue from there. pi-chart ignores the move, so a rewind breaks its Context Pack:

- `readJournal` reads the Journal in file order and ignores `parentId`. Turns from the abandoned branch and Turns from the active branch both land in one sequence, numbered as if they were one history.
- The Thread Store resumes from its highest stored Turn (ADR-0002 assumed an append-only Journal). Turns the rewind abandoned stay stored, and the active branch's Turns at those indices are never written.
- `tailFor` serves the store's highest Turns as the verbatim tail. The Call after a rewind gets the abandoned branch's Turns, which the harness's own context no longer holds. A throwaway repro confirms this: a Pack assembled after `/tree` contained the abandoned answer.

## What Changes

- A Journal is read along one branch: the parent chain from a leaf back to the root, in that order. The leaf is the one the harness reports. When it reports none, the last tree entry is the leaf. A Journal without tree entries is still read in file order.
- The Thread Store gains a rewind operation that discards a Conversation's Turns from a given index onward, along with their messages and vectors. Abandoned content is discarded, not kept for recall.
- On `session_tree`, which both `/tree` and `/branch` emit, the extension rewinds the store to the first Turn the branch it left and the branch it moved to do not share, and re-ingests the active branch from there before the next Call. Embedding follows in the background, as after any sweep.
- Every sweep reads the Journal along the harness's active branch.

## Capabilities

### New Capabilities

### Modified Capabilities

- `thread-store`: the store mirrors the Conversation's active branch. Ingest follows the branch, and a rewind discards the abandoned Turns.

## Impact

- `src/journal.ts` (`readJournal` takes a leaf), `src/thread-store.ts` (`TurnSink.rewind`, `MemoryTurnSource`), `src/postgres-store.ts` (`rewind`), `src/harness.ts` (`BranchEntry.id`, `session_tree`), `src/extension.ts` (the `session_tree` handler, and the leaf passed through sweeps).
- ADR-0002: its consequence that the Journal is append-only is amended. The Journal is append-only per file, but the record the store derives from is the active branch.
- No migration. Accounting rows for Calls made on an abandoned branch stay: those Calls happened.
