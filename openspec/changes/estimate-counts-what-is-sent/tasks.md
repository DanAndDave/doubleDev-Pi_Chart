## 1. The estimate

- [x] 1.1 In `describe("the token estimate")` of `test/assembler.test.ts`, re-base "counts what is sent with a message, not its content alone" from `details` onto `toolCallId`, `toolName` and `isError`. Add cases for two `pack-accounting` scenarios. "What is recorded but never sent is not counted": a tool result with and without a large `details`, and an assistant message with and without `inputTransformations`, `requestControls`, `responseId`, `duration`, `ttft`, `completedAt` and `credentialId`, each pair estimating equal. "A thinking block counts its text and not its signature": an assistant message with the same thinking text, signed and unsigned, estimating equal and above the same message without the block. Also cover a tool call whose `intent` alone differs. Verify red.
- [x] 1.2 In `src/tokens.ts`, extend `UNSENT` with the message fields in the design's denylist and add a block-field denylist (`thinkingSignature`, `intent`). Rebuild a content array only when a block carries an unsent key, and copy only those blocks. Rewrite the doc comment's calibration with the design's figures (median 1.57×, p90 1.84×, 624 vanilla Calls) and why signatures and `details` are excluded. Verify green.

## 2. Shortening without `details`

- [x] 2.1 In `test/elision.test.ts`, replace "dropped tool metadata is counted and named, not silently removed" and "a message shortened for its metadata alone keeps its text once" with two cases through `assemble`. In the first, a tool result whose text fits its allowance and whose `details` hold 40,000 characters is carried unchanged, `details` included. In the second, a tool result whose text overruns is shortened, keeps its `details`, and its marker ends `content]` with no "tool metadata". Verify red.
- [x] 2.2 In `src/elision.ts`, remove `withoutDetails`, `droppedDetails` and the `alsoDropped` option, the `METADATA_ONLY` marker and the metadata variant of `ELISION`, and `atLeast`'s parameter. Update the comments that justified them. Verify green, and verify no caller still passes `alsoDropped`.

## 3. The Ceiling's derivation

- [x] 3.1 Update the `tailTokens` comment and the `DEFAULT_PACK_TOKENS` comment in `src/config.ts`: headroom 1.85, a presumed window of `300,000 × 1.85 + 28,000 ≈ 583,000`, and `≈ 93,000` for a 200,000-token window. Drop "beyond any real Turn measured here", because game-factory Turns 576–577 reach 353,000–371,000 under the new estimate.
- [x] 3.2 Update the `PICHART_PACK_TOKENS` row of `README.md` to the same figures.

## 4. Close

- [x] 4.1 Run `bun run typecheck` and the full `bun test` once, and verify both are green.
- [x] 4.2 Smoke: re-estimate game-factory Turn 577 from the Thread Store with the shipped `approximateTokens` (a throwaway `bun -e` script, deleted afterwards). Verify it reads about 353,000, against 1,203,645 before. Then start `omp` with this extension in a scratch directory, make a few tool calls, and verify the footer gauge's size sits below the reported window `/pack` shows for that Call.
