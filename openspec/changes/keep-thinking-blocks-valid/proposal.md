# Proposal: A Pack keeps the model's thinking valid

Triage: needs-triage
Blocked by: pack-parts-follow-the-turn

## Why

On Claude Opus 5.5 (also Sonnet 5.5, Haiku 5.5, Fable 5.1), a thinking block stays valid only while `system`, `tools`, and every message sent before it are unchanged on later requests. Anthropic's edit table lists "remove [a text block] you added last time" as invalid. An invalid block is dropped and "the prompt cache restarts at the edit" ([Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#prefix-check)).

pi-chart replaces its assembled block on every Call, and the model's thinking is produced after that block. So every thinking block the model writes is invalid by the next Call. Measured in `pack-parts-follow-the-turn`'s `evidence/thinking-binding.md` (proxy with the `thinking-binding-controls-2026-08-01` header):
- In a pi-chart Conversation, all 11 Calls carrying thinking had every block dropped as `prefix_binding_mismatch`: 53 drops.
- In plain omp, none were dropped.
- This is what holds prefix held at 65% (plain omp: 100%). The model also loses its own earlier reasoning on every Call, and pi-chart's output ran 1.08–1.43× vanilla's across benchmarks.
- It can't be avoided by turning thinking off: `claude-opus-5-5` returns signed thinking blocks even at `--thinking off`.

## What Changes

- The assembled block reaches the provider in a form the next Call can leave in place rather than remove. Anthropic's replacement for "injecting a reminder and deleting it on the next request" is a turn-scoped system message: `role: "system"`, `clear_at: "next_user_message"`, beta `mid-conversation-system-clear-at-2026-08-21`. Once cleared, it costs no input tokens but stays in the array, so later thinking stays valid. omp 18.10.3's binary contains `clear_at: "next_user_message"` handling and that beta name, but whether an extension's `context` hook can produce such a message is unverified.
- Open for grilling:
  - How an extension emits a turn-scoped message through omp, or what omp would need to expose.
  - Whether keeping every Call's block in place fits ADR-0001 (extension, not own loop) and the Pack model, where the Pack replaces history each Call.
  - What happens on models without mid-conversation system messages.
  - How the verbatim tail's eviction interacts with this: dropping old Turns is "keep-tail compaction" in Anthropic's terms, and kept Turns' thinking fails the check too. See `tail-evicts-to-low-water`.
  - Whether to send `prefix_mismatch_behavior: "drop_block"` explicitly in the meantime, so a stricter account default can't turn drops into 400s.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`: "Assembled parts follow the Turn in progress" (added by `pack-parts-follow-the-turn`) gains the rule that assembled content never invalidates the model's earlier thinking; possibly also "Packs carry the prompt and a verbatim tail".

## Impact

- `src/extension.ts` (how the block is handed to omp), `src/assembler.ts` (block shape), possibly an omp feature request.
- Acceptance via `scripts/bench-tokens.ts` (prefix held, turns 1–7) plus a proxied run showing no `prefix_binding_mismatch` in `input_transformations`.
