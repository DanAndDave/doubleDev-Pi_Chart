# Proposal: Pulls and recall Lapses

Triage: needs-triage
Blocked by: window-held-and-refetch

## Why

pi-chart's Context Pack is smaller than plain omp's window because the agent pulls content back on demand. Without counting those Pulls, a cheaper Run could simply be one that pulls more. A recall Pull of an evicted Turn is also the second way a Lapse shows up, and the only one plain omp has no analogue for.

Decisions: `context-need-measures/questions/15`, `03`.

## What Changes

- **Pull counts per Run.** Count, by tool, with tokens returned, for the five Pull tools: `recall_earlier_turns`, `recall_across_conversations`, `search_documentation`, `walk_documentation`, `codebase_structure`.
- **`write_documentation` counted apart.** It adds nothing to the window, so it is not a Pull.
- All Pull rows are pi-chart-only and read "n/a" for plain omp.
- **Recall Pulls by result.** A recall Pull is any Pull whose result holds a Turn of the same Conversation that the Call's Context Window did not carry. `recall_earlier_turns` always qualifies; `recall_across_conversations` qualifies when it returns such a Turn. The window is the per-Call window `window-held-and-refetch` built. Where that window is unknown, a `recall_across_conversations` result holding the Run's own Turns is a recall Pull unknown, reported apart, like a Re-fetch unknown.
- **Second Lapse route.** Each recall Pull is a recovered Lapse, counted per Run in the same five distance bands as Re-fetches. These counts sit beside the Re-fetch Lapses and are never added to them. The report says the Arms recover Lapses by different routes.
- Doc, walk and structure Pulls never count toward Lapse, since they bring content the Conversation never held.
- **`recall_across_conversations` records result Turn identities.** It adds each result's conversation id and Turn index to its tool result details, so the Measures script does not have to parse the rendered text. This is the effort's only change to the extension.

Not in scope: whether the Call used what it pulled. Utilisation judges a Pull result only once it sits in an earlier Turn of the tail; a result in the Call's own Turn is never judged (question 19). Ablation's Pull-result unit gives a Needed verdict instead.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `measures`: Pull counts, `write_documentation` count, recall Pulls, and the second Lapse route.
- `cross-conversation-search`: "Results say where they came from" gains the Turn identity of each result in the tool result details.

## Impact

- `src/extension.ts`: `recall_across_conversations` details carry `(conversation id, Turn index)` per result, in result order.
- `scripts/measures.ts`: Pull counts, the `write_documentation` count, and recall Pulls with their bands. The classifier reuses the deciding-Call lookup and per-Call window that Re-fetches already use.
- `scripts/bench-tokens.ts`: a Pulls table and recall columns in the band table, all "n/a" on plain omp.
- `README.md`: the Measures paragraph names the new figures.
- Tests: the extension's cross-conversation tool test, plus a pi-chart fixture record folder whose Pulls cover each tool and each class.
