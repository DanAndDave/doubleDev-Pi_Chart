# Proposal: The estimate counts what the provider receives

Triage: ready-for-agent
Blocked by: None

## Why

The size estimate (`approximateTokens`, `src/tokens.ts`) serializes every message field outside a short denylist, so it charges for bytes no provider is ever sent. On the game-factory Conversation (`01a0d935-…`) the pack gauge read ~791k–1.34M tokens while the harness reported Packs of 127k–264k. At no point did a real window exceed 377k.

Turn 577, re-estimated by field (637 messages):

| Counted | Estimated tokens |
| --- | ---: |
| As shipped | 1,203,645 |
| Without omp's response metadata (`inputTransformations`, `requestControls`, `responseId`, `duration`, `ttft`, `completedAt`) | 806,087 |
| Also without tool-result `details` | 605,957 |
| Also without thinking signatures | 353,246 |

omp 18.12 records `inputTransformations` on each assistant message: a list of every earlier thinking block the API dropped. That list grows by one entry per Call, so its cost grows quadratically within a Turn. Every provider conversion in omp 18.12.6 builds a tool result from `content`, `toolCallId` and `isError` alone, so `details` are never sent. Thinking signatures are sent but, measured below, not charged as input.

The over-count does more than misreport. Every Call of those Turns ran over the 300,000 Ceiling on the estimate alone, so `reduceToCeiling` shortened the current Turn's tool results from call 43 onward when the real Pack was a third of the Ceiling. Each shortening rewrote the prefix, which reset the prompt cache (`cache_read` 0 at call 577.252).

## What Changes

- **The estimate skips what is never sent or charged.** It drops tool-result `details`, omp's response metadata (`inputTransformations`, `requestControls`, `responseId`, `duration`, `ttft`, `completedAt`, `credentialId`, `errorMessage`, `errorId`, `errorStatus`, `retryRecovery`), the harness's bookkeeping (`attribution`, `synthetic`, `userInitiated`, `prunedAt`, `useless`), pi-chart's own `piChartShortened` marker, and thinking signatures. It also drops the `intent` copy omp keeps on a tool call beside its arguments. Thinking text stays counted, because a provider that keeps the block charges for it. The estimate is still `characters / 4` over what remains, deterministic and independent of key order.
- **Shortening no longer handles `details` specially.** A tool result was stripped of its `details` and its marker said "and its tool metadata" because the estimate charged for them. Once they cost nothing, the stripping, the `alsoDropped` accounting and the metadata-only marker serve no purpose, so they go. A shortened tool result keeps its `details` untouched.
- **The Ceiling's derivation is re-measured.** The estimate now under-counts the reported window at every quantile (median 1.57×, p90 1.84× over 624 Calls of the gate-v1 vanilla Journals). The headroom factor goes from 1.5 to 1.85. `DEFAULT_PACK_TOKENS` stays 300,000, which now presumes a reported window of ~583,000. The 200,000-token guidance becomes ~93,000.
- Unchanged: what is sent to the model, every Budget's value, the shortening order, and Accounting's schema.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pack-accounting`: "The recorded pack size is comparable to the reported window" says the estimate counts what the provider is sent and charges for. It no longer requires counting every field of every message. Its "whole message" scenario gains scenarios for unsent fields and signatures.

## Impact

- `src/tokens.ts`: unsent message fields and unsent block fields; the doc comment's calibration.
- `src/elision.ts`: `shortenText` loses `withoutDetails` / `droppedDetails`; `elide` loses `alsoDropped`; `ELISION`, `METADATA_ONLY` and `atLeast` lose the metadata variant.
- `src/config.ts`: the `tailTokens` and `DEFAULT_PACK_TOKENS` comments carry the new factor and presumed window.
- `README.md`: the `PICHART_PACK_TOKENS` row.
- `test/assembler.test.ts` ("the token estimate"), `test/elision.test.ts` (the two `details` tests).
- Packs that crossed the Ceiling on the old estimate alone now go out whole. The prefix shortening rewrote stays stable, so the prompt cache holds. Figures already stored in `call_accounting` keep the old estimate. No migration.
- Out of scope: the API dropping earlier thinking as `prefix_binding_mismatch` (`openspec/changes/archive/2026-10-13-pack-parts-follow-the-turn/evidence/thinking-binding.md`), and the current Turn's real growth within one long prompt.
