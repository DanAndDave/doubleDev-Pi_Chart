## 1. Carry a harness compaction as prose

- [x] 1.1 Drop `providerPayload` from `compactionSummary` messages before assembly, and verify at the `context` seam that the Pack carries the summary without it

  `withoutNativeCompaction` in `src/messages.ts`, applied to the `context`
  event's array in `src/extension.ts`. Covered by "reaches the model as its
  summary, never as the provider's own block": dropping the call fails it.
  Smoke: the failing session's compaction entry and kept messages, rebuilt
  as omp builds them and run through the hook, produced a 13-message Pack
  with no `providerPayload` left in it.

- [x] 1.2 Verify a provider payload on any other message survives assembly

  The same test carries a developer message with an `anthropicMessage`
  payload and expects it back unchanged.

## 2. Decline the harness's size-triggered compaction

- [x] 2.1 Remember the trigger from `auto_compaction_start`, clear it on `auto_compaction_end`, and cancel `session_before_compact` for `threshold` and `idle` while the last Call was assembled
- [x] 2.2 Announce the first decline in each Conversation, naming `compaction: {enabled: false}`, and stay silent after that
- [x] 2.3 Verify overflow, incomplete, manual, and post-failure compactions proceed, and that a new session starts governed

  `describe("the harness's own compaction")` in `test/extension.test.ts`:
  threshold and idle are declined with a single report, overflow and
  incomplete proceed, a manual compaction right after a declined one
  proceeds, a failed assembly hands the decision back to the harness until
  the next success, and a session start after a failure declines again.

## 3. Close

- [x] 3.1 Document the compaction setting beside the memory-backend one in the README
- [x] 3.2 Run typecheck and the full suite

  `tsc --noEmit` is clean. `bun test`: 665 pass, 0 fail.
