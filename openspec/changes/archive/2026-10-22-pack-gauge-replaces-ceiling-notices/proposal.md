# Proposal: A pack gauge replaces the ceiling notices

Triage: needs-triage
Blocked by: None

## Why

When a Context Pack goes out over its Ceiling, pi-chart posts a warning in the conversation on every Call: *"Context Pack exceeds its ceiling: ~804839 of 300000 tokens. The current turn could not be reduced further and is never dropped, so the pack went out over budget."* A long tool-using Turn makes a Call for every tool result, so one Turn can post dozens of identical lines. They bury the transcript while saying nothing the operator can act on mid-Turn. The approach notice has the same problem, posted once per Conversation.

The condition does need to stay visible: an overrun means a Call went out larger than the operator allowed (`newest-turn-survives-the-ceiling`). But it is a *state* that lasts while the Turn runs, not an event, and omp has surfaces for state: a footer status, which pi-chart already uses for Pins, and a widget beside the editor. Showing the pack there also answers the question the warning raises (what filled it?) without a `/pack` round trip.

## What Changes

- **A footer gauge on every Call.** Under the key `pi-chart.pack`, the footer shows the last Call's Pack size against the Ceiling, with a short bar and a share. It also shows one state mark: over the Ceiling, reduced to fit (with the size before reduction), or near the Ceiling (past `packWarnShare`). A Call that went out unassembled says so. The gauge clears when the session switches or branches, until the next Call is assembled.
- **A parts widget, off by default.** `/pack show` opens a widget below the editor. It has one line for the pack and one per part: source, a bar against the Ceiling, estimated size, `in the system prompt` for the Pins and the Opening, and the same reasons `/pack` gives (`4 for the pack ceiling`, `content shortened`, ...). It refreshes on every Call until `/pack hide`. The toggle is in memory, like `/pack budget`.
- **No ceiling notices in the conversation.** The overrun and approach conditions are no longer raised through `notify`. The log keeps both lines exactly as today: every overrun, and the approach once per Conversation. The gauge carries the state. Other notices that go through `announce` (setup, config problems, graph) are unchanged.
- Unchanged: how a Pack is assembled or reduced, what Accounting records, and `/pack` output.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pack-accounting`: "A pack approaching its ceiling is reported" says where the report goes: the log once per Conversation, and the footer while the condition holds, never the conversation. A new requirement covers the same for overruns.
- `pack-inspection`: new requirements for the footer gauge and for the `/pack show` / `/pack hide` parts widget.

## Impact

- `src/extension.ts`: `warnIfNearCeiling` stops using `announce`; a gauge is set on each `context` Call, on assembly failure, and cleared on `session_switch` / `session_branch`; `inspect` gains `show` and `hide`; the `/pack` description names them.
- `src/harness.ts`: `HarnessUI` declares `setWidget`.
- `src/report.ts`: renderers for the gauge line and the widget lines, reusing `REASONS`. `src/inspection.ts` exposes a view of a live `PackPart` so both surfaces use the same words.
- `test/extension.test.ts`: the fake UI records widgets; the ceiling tests check the log, the footer, and the absence of a notice. `test/report.test.ts` covers the renderers.
- `README.md`: "Inspect a pack" documents the gauge and `/pack show` / `/pack hide`.
- No migration, no new dependency, no change to what reaches the model, so the prompt cache is unaffected.
- Harness support: the footer and the widget work in the interactive TUI and over RPC (string-array widgets). Headless and print runs have neither, so there the log is the only record, which it already is today.
