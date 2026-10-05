## 1. Journal follows the active branch

- [x] 1.1 `readJournal(path, leafId?)` walks the parent chain from `leafId`, else from the last entry with an `id`, and builds Turns in path order; a Journal without ids is read in file order
- [x] 1.2 Tests in `test/journal.test.ts`: abandoned Turn excluded; explicit leaf mid-file honoured; unknown leaf falls back to the last entry

## 2. Stores discard from a Turn

- [x] 2.1 `TurnSink.rewind(conversationId, fromTurn)` in `src/thread-store.ts`, implemented by `MemoryTurnSource`
- [x] 2.2 `PostgresStore.rewind` deletes Turns at or above `fromTurn` with their messages in one transaction; returns the count
- [x] 2.3 Contract test in `test/turn-source-contract.ts`: after a rewind and re-ingest, `recentTurns` returns the new branch's Turns at the reused positions

## 3. Extension reacts to `session_tree`

- [x] 3.1 `BranchEntry.id` and the `session_tree` event in `src/harness.ts`
- [x] 3.2 Leaf id threaded through `store` → `runSweep` → `ingestJournal` → `readJournal`
- [x] 3.3 `session_tree` handler: after any running sweep, rewind from the first Turn the leaf moved into, then re-ingest along the new leaf; failures reported, navigation never blocked
- [x] 3.4 Extension test: rewind then Call; the Pack carries the active branch and not the abandoned Turn
- [x] 3.5 Rewind point counted where the branch left (`getBranch(oldLeafId)`) and the branch taken part, not from the new leaf's Turn; PGlite-backed extension test returning to a longer branch

## 4. Docs

- [x] 4.1 Amend ADR-0002's append-only consequence
- [x] 4.2 Full suite and typecheck
