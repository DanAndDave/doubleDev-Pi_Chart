## Context

`approximateTokens` is `characters / 4` over `JSON.stringify` of each message, minus a 7-key denylist (`contextSnapshot`, `usage`, `timestamp`, `api`, `provider`, `model`, `stopReason`). Everything else counts: the Ceiling, every Budget, shortening, the gauge, `/pack` and Accounting.

`token-budgets` (2026-09-17) calibrated it on content-only Journals from before omp recorded thinking signatures or response metadata, and set the headroom factor to 1.5 from a p90 of 1.447. omp has since added fields the estimate charges for and no provider receives.

Where the game-factory Conversation's estimate went, over all its stored messages:

| Field | Estimated tokens |
| --- | ---: |
| assistant `content` (of which thinking signatures 10.8M, thinking text 3.2M) | 16.8M |
| toolResult `details` | 15.9M |
| toolResult `content` | 12.6M |
| assistant `inputTransformations` | 2.8M |
| assistant `requestControls` | 1.2M |

What omp 18.12.6 sends (read from the shipped bundle):

- Anthropic `tool_result`: `tool_use_id`, `content`, `is_error`.
- OpenAI Responses `function_call_output`: `call_id`, `output` from content.
- Google `functionResponse`: `name`, the content text.
- Anthropic `thinking`: `thinking` plus `signature`.
- Anthropic `tool_use`: `id`, `name`, `input` (the arguments).

No provider receives `details`, any response metadata, or the tool call's `intent`.

## Goals / Non-Goals

**Goals:**

- The estimate counts what a provider is sent and charges as input, so the Ceiling stops binding on bytes that never travel.
- Shortening stops spending effort and marker text on `details`.
- The Ceiling's documented derivation matches a fresh measurement.

**Non-Goals:**

- A real tokenizer or a new divisor. Every Budget is in estimated tokens; changing `/4` would move all of them at once.
- Stopping the API from dropping earlier thinking (`prefix_binding_mismatch`).
- Bounding a single long Turn's real growth.
- Rewriting `call_accounting` rows already stored.

## Decisions

### Extend the denylist; don't switch to an allowlist

The message shape belongs to the harness and changes without us (`src/messages.ts`). If omp adds a field, a denylist over-counts it and an allowlist drops it. An over-count shows up in `/pack`'s reconciliation and fails safe against the Ceiling. An under-count fails silently. An allowlist would also have to know every role's text-carrying field, for example a `bashExecution`'s `output` or a summary's `summary`, and it would read 0 for roles it had never seen. So both denylists grow:

- **Message fields:**
  - `details`
  - `inputTransformations`, `requestControls`, `responseId`, `duration`, `ttft`, `completedAt`, `credentialId`, `errorMessage`, `errorId`, `errorStatus`, `retryRecovery`
  - `attribution`, `synthetic`, `userInitiated`, `prunedAt`, `useless`
  - `piChartShortened`
- **Block fields:** `thinkingSignature`, and a tool call's `intent`, which is a copy of its arguments' `i`.

Considered: an allowlist of `role`, `content`, `toolCallId`, `toolName`, `isError`. Rejected for the under-count above.

### Signatures are not counted; thinking text is

Signatures are sent but not charged as input. Measured on the 5 gate-v1 vanilla Journals (Opus 5.5, omp 18.11, linear, so the harness sends the whole history):

1. Take the growth of the reported prompt between consecutive Calls. That growth is the tokens of the messages added in between.
2. Calls with no thinking in between gave a factor of 1.50 between reported growth and the estimate without thinking (median, 218 Calls).
3. Apply that factor to the 172 Calls that did add thinking. It leaves 39,002 tokens unexplained.
4. Against that residual, the thinking text estimates 12,920 tokens and the signatures 76,397.

If signatures were charged at any rate near their size, the residual would be at least 95,000. The residual is about 2.2× the thinking text's estimate, so the text is charged.

The thinking text is counted even though a Pack whose prefix pi-chart changed has its earlier thinking dropped by the API: on Turn 577 that was all 84,000 estimated tokens of it. Whether a block is dropped depends on the provider's binding check, which pi-chart cannot see when it estimates, and over-counting is the safe direction.

### Shortening leaves `details` alone

`shortenText` deleted `details`, kept them out of the allowance, counted them into the marker (`alsoDropped`) and had a separate marker for a result shortened only for its metadata. All of that existed because the estimate charged for `details` (`token-budgets`, "The harness's `details` are dropped, so they are not charged for"). Once they cost 0:

- `droppedDetails` is always 0.
- A result whose text fits is never touched.
- The metadata branches are dead.

They are removed rather than left inert. The shortened message keeps its `details`: they never reach the model, and the harness may still use them.

### Headroom 1.85, Ceiling stays 300,000

Whole-window calibration on the same 624 vanilla Calls: reported window minus `nonMessageTokens`, over the estimate of every message before the Call.

| Estimate | p10 | median | p90 | under-counts |
| --- | ---: | ---: | ---: | ---: |
| Shipped | 0.555 | 0.613 | 0.865 | 5% |
| Without metadata | 0.618 | 0.696 | 0.990 | 9% |
| Also without `details` | 1.063 | 1.110 | 1.345 | 100% |
| Also without signatures (this change) | 1.528 | 1.566 | 1.835 | 100% |

The shipped estimate over-counts even here. Without `details` but with signatures it lands near the old 1.15× / 1.447×, but only because uncharged signature bytes cancel the tokenizer's real under-count.

The headroom factor is the p90 rounded up: 1.85. A 300,000 Ceiling then presumes `300,000 × 1.85 + 28,000 ≈ 583,000` reported tokens, which still fits a 1M-token window. So the default holds, and the 200,000-token guidance becomes `(200,000 − 28,000) / 1.85 ≈ 93,000`.

Projected on game-factory with the new estimate:

| Turn | Old estimate | New estimate | Crosses the current Turn's 259,000 allowance at |
| --- | ---: | ---: | --- |
| 576 | 1.92M | 371k | call 242 of 476 (was call 56) |
| 577 | 1.20M | 353k | call 115 of 281 (was call 43) |

Those are real crossings: about 400,000 measured tokens.

### No per-call copy of every message

`approximateTokens` runs in shrinking loops. Messages are still shallow-copied without unsent keys. A content array is rebuilt only when one of its blocks carries an unsent block key, and only those blocks are copied; the rest go by reference.

## Risks / Trade-offs

- **The estimate now under-counts everywhere.** It was over-counting on modern Journals, so the gauge reads lower than the reported window rather than 3–6× higher. `/pack`'s reconciliation shows the bias, and the factor in the docs covers its p90. A 200,000-token operator who followed the old guidance (110,000) keeps a ceiling that presumes about 231,000. That is over their window, and the README tells them so.
- **Calibration set.** It is 624 Calls from one workload and one model on omp 18.11. Journals from game-factory cannot calibrate, because they carry assembled Packs whose thinking was dropped. A wider set needs vanilla runs, the same constraint `token-budgets` had.
- **omp adds another field.** The estimate over-counts it until the denylist learns it. That fails safe, and it shows as an estimate above the reported size in `/pack`.
- **Existing Accounting rows** keep old estimates, so a Conversation summary spanning the change mixes both. They are not rewritten.

## Testing seams

- `approximateTokens` (`src/tokens.ts`), through `describe("the token estimate")` in `test/assembler.test.ts`, covers all three new scenarios:
  - "What is recorded but never sent is not counted": details, then response metadata.
  - "A thinking block counts its text and not its signature".
  - "The estimate covers the whole message": the existing case, re-based from `details` onto `toolCallId` / `toolName` / `isError`.
- The `details` cutover is tested through `assemble` in `test/elision.test.ts`, the seam the two `details` tests already use. A tool result whose text fits its allowance and whose `details` are huge is carried unshortened, with its `details`. A tool result that is shortened keeps its `details`, and its marker reads `content]` with no metadata clause.
