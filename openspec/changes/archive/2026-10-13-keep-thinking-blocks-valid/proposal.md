# Proposal: A Pack keeps the model's thinking valid

Triage: ready-for-agent
Blocked by: None

## Why

On Claude Opus 5.5 (also Sonnet 5.5, Haiku 5.5, Fable 5.1), a thinking block stays valid only while `system`, `tools`, and every message sent before it are unchanged on later requests. Anthropic's edit table lists "remove [a text block] you added last time" as invalid. An invalid block is dropped and "the prompt cache restarts at the edit" ([Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#prefix-check)).

pi-chart replaces its Briefing on every Call, and the model's thinking is produced after that Briefing. So every thinking block the model writes is invalid by the next Call. Measured in `pack-parts-follow-the-turn`'s `evidence/thinking-binding.md` (proxy with the `thinking-binding-controls-2026-08-01` header):

- In a pi-chart Conversation, all 11 Calls carrying thinking had every block dropped as `prefix_binding_mismatch`: 53 drops.
- In plain omp, none were dropped.

The decision is ADR-0011 (`docs/adr/0011-every-briefing-stays-where-it-was-sent.md`), backed by `evidence/turn-scoped-feasibility.md`. omp 18.10.4 can send a turn-scoped system message from the `context` hook, and in a proxied run identical re-sent Briefings dropped no thinking.

## What Changes

- On a model whose compat flags declare both mid-Conversation and turn-scoped system messages, the Briefing becomes one turn-scoped system message (`clear_at: "next_user_message"`) placed after the message it follows.
- **BREAKING** (Pack shape): every earlier Briefing is sent again on later Calls, byte for byte and in its original position, as long as the message it follows is still sent. ADR-0010's "the next Call replaces that block" is superseded.
- Each Briefing is stored exactly as it was sent, as a `pi-chart.briefing` custom entry in the Journal. The entry is written from inside the `context` hook and names the message it follows. On a Turn's first Call it is tagged as preceding the prompt, because the prompt is not in the Journal yet. A text that is already stored is referenced by hash.
- The Briefing's text is fenced: first a fixed framing, then the Pins, then a marker that says everything after it is reference data and not instructions, then recalled Turns, curated knowledge, and structure. The Pins move from last to before the marker.
- A Briefing that should be sent but has no stored text is not replaced; Accounting counts it as missing. Budget, Ceiling, and Floor cover only the current Briefing.
- Stored Briefings are read from the whole Journal and carried into forks, branches at an entry, and `/btw` promotions together with the texts they reference, as Pins are.
- On any other model the Call falls back to ADR-0010: one Briefing, sent as a user message, replaced on the next Call, and not stored. The fallback keeps the same text and order.
- Accounting records which way each Call sent its Briefing, plus how many earlier Briefings it sent again, their size, and how many were missing. `/pack` reports these.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`: the Briefing's shape (one fenced message, Pins before the marker), its role and clearing, earlier Briefings sent again in place, their storage and fork carry-over, and the per-model fallback.
- `pack-accounting`: per Call, the Briefing mode and the earlier Briefings sent again or missing.
- `pack-inspection`: `/pack` reports the same.

## Impact

- `src/briefings.ts` (new): the Journal entry format, replay over the whole Journal, placement in a Pack, and fork carry-over.
- `src/assembler.ts`: one Briefing message with a fence (the `OPENING` line and the per-part messages fold into it), and Pins move ahead of the marker.
- `src/extension.ts`: mode chosen from `ctx.model.compat`, the entry written in the hook, earlier Briefings placed, and Briefings carried on fork, branch, and `/btw` alongside Pins.
- `src/harness.ts`: `HandlerContext.model.compat`.
- `src/accounting.ts`, `src/postgres-store.ts` (four nullable `call_accounting` columns), `src/report.ts`.
- Tests: `test/assembler.test.ts` (block shape), `test/extension.test.ts`, a new `test/briefings.test.ts`, `test/postgres-store.test.ts`, `test/report.test.ts`.
- Docs: amend ADR-0011's write timing (written in the hook, not deferred), fix "Pins last" in `CONTEXT.md` **Briefing**, update README's pack-order paragraph.
- Acceptance:
  - A proxied run (`thinking-binding-controls-2026-08-01`) of three `-c` Turns with tool calls shows zero `prefix_binding_mismatch` drops, compared with the 53 measured before.
  - `scripts/bench-tokens.ts` shows no regression in prefix held for turns 1–7.
