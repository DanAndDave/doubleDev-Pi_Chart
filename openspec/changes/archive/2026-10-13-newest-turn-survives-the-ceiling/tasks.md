## 1. The newest tail Turn fits its Budget

- [x] 1.1 Write the incident regression test at the `assemble()` seam: one completed Turn of 200 assistant-call/result groups plus a final reply, tail token Budget 5,000, and a current Turn. Assert the tail fits the Budget and carries the final reply and the newest group. Verify it fails on the current code.
- [x] 1.2 Add a test helper that builds a Turn from groups, each an assistant tool call with a `name` plus its matching `toolResult`, with an optional final reply. Verify the existing assembler tests still pass with it in place.
- [x] 1.3 Implement `shrinkTurn(messages, allowance)` in `src/elision.ts`: split the Turn into prompt, groups matched by `toolCallId` and final reply; binary-search for the fewest oldest groups to drop, eliding payloads at each probe; return `droppedMessages`. Verify the tests for "the oldest actions go first", "no call is carried without its result", "every group may go" and "a turn that fits by eliding drops nothing" pass.
- [x] 1.4 Add the marker on the prompt text, for both string and block `content`: the message count, tools in order of first use (`unknown` for an unnamed call), and estimated tokens (exact below 1,000, `~Nk` from 1,000 up). Verify with a test against the spec's `read ×140, bash ×52, edit ×13` example.
- [x] 1.5 Implement the steps below the smallest form: elide the final reply, then the prompt, then re-append the marker. Verify a test where the prompt and reply alone exceed the room shows the reply elided first and the marker still present.
- [x] 1.6 Wire `fitTail` to `shrinkTurn` and move the check that a tail token Budget of 0 disables the tail to where the configured Budget is applied in `assemble`. Verify 1.1 passes and the "a budget of nothing disables its part" behaviour still holds for a configured zero.
- [x] 1.7 Rewrite "an irreducible tail turn is carried and its budget reported as exceeded" so the irreducible content is a prompt and final reply that together exceed the Budget, not orphan results. Verify it passes and still asserts the Budget is reported exceeded.
- [x] 1.8 Thread `droppedMessages?: number` through `PackPart`, `Fitted`/`Selected`, `RecordedPart` and `PartView`, set only when above zero. Verify with `bun run typecheck`.
- [x] 1.9 Add `${n} messages dropped` to `REASONS` in `src/report.ts`, directly before `content shortened`. Verify a `test/report.test.ts` case shows "412 messages dropped" separately from "content shortened", and that a part without the field shows no such line.
- [x] 1.10 Add a determinism test: assemble the same oversized Turn twice and verify the two Packs are identical.

## 2. The ceiling never empties the tail

- [x] 2.1 Write a test at the `assemble()` seam: a long newest tail Turn and `packTokens` below that Turn plus the current Turn. Assert the tail is carried shrunk with the marker, `absent` is undefined, and the Pack fits. Verify it fails before 2.2.
- [x] 2.2 In `reduceToCeiling`, accept the verbatim tail's re-selection whenever it carried a Turn, even over the room, and copy `droppedMessages` from it. Verify 2.1 passes and the existing ceiling tests, including the reduction-order sweep, still pass.
- [x] 2.3 Write a test where the tail's smallest form exceeds the room the current Turn leaves. Assert the tail is still carried at its smallest form, the current Turn is elided around it, and the Pack exceeds its ceiling. Verify it passes.
- [x] 2.4 Update the overrun announcement in `src/extension.ts` to name the current Turn and the newest tail Turn as the parts never dropped. Verify `test/extension.test.ts` still matches "exceeds its ceiling".

## 3. Close

- [x] 3.1 Run `bun run typecheck` and the full suite once, and verify both are green.
- [x] 3.2 Smoke test against the incident: assemble turn 10, call 0 of Conversation `01a13590-9c9e-746d-955c-1144d294cccc` from the Thread Store with default config. Verify `/pack` shows the verbatim tail carrying turn 9 with "N messages dropped" and a size within the tail Budget.
