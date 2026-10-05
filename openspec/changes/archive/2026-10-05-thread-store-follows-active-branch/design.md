## Context

The harness keeps one Journal per Conversation. Entries carry `id` and `parentId`; the active branch is the parent chain from the current leaf. `/tree` and `/branch` (alias `/rewind`) both call `navigateTree`, which moves the leaf inside the same file and emits `session_tree` with `oldLeafId` and `newLeafId`; `getBranch(fromId?)` answers the path to any entry. A rewind appends nothing unless a branch summary is requested, so the file's last entry can still be the old leaf after the event.

`readJournal` reads entries in file order. The Thread Store resumes from its highest stored Turn and skips everything below it. The tail is the highest `tailTurns` stored Turns.

## Goals / Non-Goals

**Goals:**

- Ingest reads only the active branch.
- After a rewind the store drops the Turns the branch no longer holds, before the next Call reads the tail.

**Non-Goals:**

- Keeping abandoned Turns for recall. Decided against: the store mirrors the active branch.
- Accounting: Calls made on an abandoned branch happened, and their rows stay.
- `/fork` and `AgentSession.branch()`: they create a new session id, which is a new Conversation and is ingested fresh.

## Decisions

1. **The leaf comes from the harness.** `readJournal(path, leafId?)` walks the parent chain from `leafId`, else from the last tree entry. A tree entry has an `id` and a `parentId` (`null` at the root); the session header carries an id but no parent and is not one. After `navigateTree` with no summary, the file's last entry is still the old leaf, so the rewind passes `getBranch().at(-1)?.id` explicitly, and skips the re-ingest when the branch is empty. Sweeps pass the leaf too. A Journal with no tree entries is read in file order.
2. **Rewinding deletes from where the branches part.** The store holds the branch the harness left, not the Journal's, so the rewind point is counted against that branch: walk `getBranch(oldLeafId)` and `getBranch()` while their ids agree, count the `k` prompts on that shared prefix, and `TurnSink.rewind(conversationId, fromTurn)` deletes Turns `>= max(k-1, 0)` with their messages and vectors. Turns `0..k-2` lie wholly on both branches; Turn `k-1` may differ after its prompt, and discarding it when it does not costs only its re-ingest. With no `oldLeafId`, `k` is 0 and the whole branch is re-ingested. Counting only the new branch (`p-1` for `p` prompts) is wrong when the new branch is the longer one: the store resumes from its head and skips below it, so the left branch's Turns below `p-1` would stay.
3. **Event-driven, not detected during ingest.** Detecting divergence inside ingest needs a per-Turn entry id (a migration) or a scan that grows with the Conversation. `session_tree` already names the rewind.
4. **Ordered with sweeps.** The rewind waits for any running sweep of the Conversation, so a sweep that read the Journal before the rewind cannot write abandoned Turns after it, and registers itself in `sweeping`, so a sweep starting meanwhile waits for it in turn. It then deletes and ingests (database work only) before returning, so the next Call reads a corrected store. The re-ingested Turn is embedded by the next sweep, at the end of the next Turn, as any new Turn is.

## Risks / Trade-offs

- A rewind made while pi-chart was not loaded, or while the store was unreachable, is not detected later: the store resumes from its highest Turn as before. Discarding the store and re-ingesting (ADR-0002) repairs it.
- If the wait on a running sweep plus the rewind exceeds the harness's handler timeout, the harness logs a timeout; the work still completes.

## Testing seams

- `readJournal` against a temp Journal with a rewind in it: active-branch Turns only, explicit leaf respected, a leaf inside a Turn ends it, unknown leaf falls back to the last tree entry, file-order fallback for a Journal with no tree.
- `TurnSink.rewind` in `test/turn-source-contract.ts`, so `MemoryTurnSource` and `PostgresStore` (PGlite) meet the same contract: Turns from the index on are gone, earlier ones untouched, and a following ingest refills the positions.
- `register` with one `MemoryTurnSource` as `ingest` and `turns`, a temp Journal, and a fake `sessionManager` answering `getBranch(fromId?)` over the Journal's tree: emit `session_tree` with `oldLeafId`, then `context`; the Pack carries the active branch and not the abandoned Turn, and a rewind inside a Turn stores only its kept part.
- `register` with a `PostgresStore` (PGlite) as `ingest` and `turns`: leave a long branch for a shorter one, then return to the long one; the store holds exactly the long branch. A memory store rewrites every Turn on ingest and would hide the resume-from-head skip this guards.
