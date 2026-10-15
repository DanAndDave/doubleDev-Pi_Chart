# Design: Pulls and recall Lapses

## Context

`scripts/measures.ts` already has what this slice builds on (from `window-held-and-refetch`):

- `measureRun(dir)` reads `run.json`, the main Journal through `readBranch`, and `accounting.json`.
- `windowAt(at, call)` gives each main Call's `Window`: the tail's `turns`, the Opening, the Pins and `current`. It returns `"unknown"` when the Call has no Accounting.
- `callerOf(turn, result)` finds the assistant message holding a tool result's tool call, by id. Re-fetches use it to pick the deciding Call.
- `BANDS` and `Banded` give five distance bands. `RunMeasures.refetch` holds Re-fetches per class, and `compactions` is absent on pi-chart.
- `bench-tokens` `report()` prints "n/a" for an Arm whose pick returns `undefined` for every complete Run, and prints the banded Re-fetch table.

What the record says, observed:

- Journal `toolResult` messages keep `toolName` and the tool's `details` whole. `readBranch` pushes the parsed message as is, and `HarnessMessage` has an index signature. On `/tmp/bench-ro40/runs/pi-chart-0`, `read` and `grep` results carry their `details`.
- `recall_earlier_turns` details are `{ results, turnIndices }`, most similar first (`src/extension.ts` `recallEarlier`). It returns only Turns with an index below the tail start recorded for the Conversation's latest Call, which is the Call that made the tool call.
- `recall_across_conversations` details are `{ results, conversations }`, with conversation ids only (`searchCorpus`). `searchAll` ranges over every Conversation, the current one included (`src/postgres-store.ts`). In a bench Run the Thread Store is the Run's own, so every result there is the Run's own Conversation.
- The Thread Store's conversation id is the Journal's session id. The one key of `pi-chart-0`'s `accounting.json` equals its `run.json` `sessionId`.
- Neither `read-only-40` Run made a Pull: pi-chart-0's tool results are 76 `read` and 22 `grep`.
- Nothing reads `details.conversations`.

## Goals / Non-Goals

**Goals:**

- Count Pulls and their returned tokens, and classify each as a recall Pull, a recall Pull unknown, or neither, from the record alone, on the window already computed per Call.

**Non-Goals:**

- Pulls made inside subagents. A subagent is its own Conversation with no window here, as with Re-fetches.
- A combined Lapse count across routes. The Probe route (slice 4) is still to come, and the spec keeps the routes apart.
- Whether a Pull's result was used (Utilisation, Ablation).
- Removing `details.conversations`. It becomes redundant but costs nothing, and dropping it would be a change of its own.

## Decisions

### 1. Turn identities in the cross-conversation details

`searchCorpus` adds `turns: { conversationId: string; turnIndex: number }[]`, in result order, next to `results` and `conversations`.

- Alternative rejected: parsing `conversation <id>, turn <n>` out of the rendered text (`src/report.ts`). Ticket 15 rejected it because rewording the text would break it.
- Alternative rejected: reshaping `conversations` into objects. Records that already exist would then hold one key with two shapes.

### 2. Pulls are found by tool name in the main Journal

```ts
export const PULL_TOOLS = [
	"recall_earlier_turns", "recall_across_conversations",
	"search_documentation", "walk_documentation", "codebase_structure",
] as const;
type PullTool = (typeof PULL_TOOLS)[number];

RunMeasures.pulls?: Record<PullTool, { calls: number; tokens: number }>; // pi-chart only
RunMeasures.writes?: number;            // write_documentation calls, pi-chart only
```

- Every `toolResult` with a Pull `toolName` counts one call, failed or not. A failed call still cost a Call and a tool turn, and the spec counts calls.
- `tokens` adds `approximateTokens([message])` (`src/tokens.ts`) over that tool's results. It is the estimator Accounting uses for parts, applied to the message as the Journal holds it. It counts what was sent, `details` included, and leaves out what the harness keeps and does not send.
- Every tool is present with zeros when it was never called.
- Alternative rejected: counting `toolCall` blocks in assistant messages. A call without a result brought nothing in, and the result is what carries the tool name, the details and the tokens.

### 3. Recall classification

Each Pull result gets a deciding Call through `callerOf`, and from it a window through `windowAt`, as for Re-fetches. A Turn is **carried** when it is in `window.tail.turns` or equals `window.current`. The Opening's Turn is not carried, since the Opening holds only that Turn's prompt and the Pull returned the whole Turn. A partial tail still carries its Turns, shortened.

| Tool | Result | Class | Distance to |
| --- | --- | --- | --- |
| `recall_earlier_turns` | `turnIndices` non-empty | recall | nearest of `turnIndices` |
| `recall_across_conversations` | own Turns, window known, some not carried | recall | nearest own Turn not carried |
| `recall_across_conversations` | own Turns, window `"unknown"` or no caller | unknown | nearest own Turn |
| `recall_across_conversations` | `results > 0`, no `turns` recorded | unknown | none: counts in the total, in no band |
| `recall_across_conversations` | no own Turn, or every own Turn carried | none | none |
| `search_documentation`, `walk_documentation`, `codebase_structure` | any | none | none |

- "Own Turns" are the `turns` whose `conversationId` equals `run.json` `sessionId`. A record without `sessionId` cannot name its own Conversation, so any recorded Turn makes the Pull unknown.
- `recall_earlier_turns` is not checked against the window. Its own filter compares against the tail start of the very Call that made it, and the proposal says it always qualifies. A window check would only add an unknown class for Calls without Accounting, where the tool already knew.
- **Distance is to the nearest uncarried Turn.** This matches Re-fetches, which measure to the most recent earlier copy. Alternative rejected: the first-ranked Turn, which depends on the search's ordering rather than on the window. Alternative rejected: one Lapse per returned Turn. A Lapse is a Call's need, and the search's `limit` would decide how many Lapses one need became.

```ts
export type RecallClass = "recall" | "unknown";
export interface RecallPull { turn: number; call: number; tool: PullTool; distance?: number; class: RecallClass }
RunMeasures.recalls?: RecallPull[];                                 // pi-chart only, in order
RunMeasures.recall?: Record<RecallClass, Banded>;                   // pi-chart only
```

`banded` in `measureRun` becomes a small function over distances. A Pull with no distance adds to `total` and to no band, which is the one case where bands do not sum to the total. That gap is covered by a scenario.

### 4. "n/a" is decided by the Arm

The pi-chart-only fields are set when `record.arm === "pi-chart"` and absent otherwise. The report's picks for them return `undefined` when `run.arm !== "pi-chart"`, which prints "n/a". They return NaN, which prints "—", for a pi-chart run whose `bench.json` predates the fields.

- Alternative rejected: taking a field's absence to mean "n/a", as the compactions row does with its `refetch` guard. On pi-chart an older `bench.json` would then read "n/a" instead of "—" and claim the Measure does not exist.

### 5. Report and CLI

- CLI: after the Re-fetch lines, on pi-chart:
  - one `Pulls, <tool>: <calls> (~<tokens> tokens)` line per tool;
  - `write_documentation calls: <n>`;
  - `Recall Pulls (Lapses): <total> (<bands>)` and `Recall Pulls unknown: …`.

  On plain omp a single `Pulls: n/a` line stands for all of them.
- `bench-tokens` `report()`:
  - A **Pulls per Run** table, median over complete Runs. It has one row per Pull tool and one for `write_documentation`, and per-Arm columns for calls and tokens returned. Plain omp's cells read "n/a" and there is no ratio column.
  - The band table gains `recall` and `recall unknown` columns per Arm, "n/a" on plain omp.
  - When both Arms are present, a line under the band table names the routes: plain omp recovers Lapses through Re-fetches only, pi-chart through Re-fetches and recall Pulls.

## Risks / Trade-offs

- **[Risk] No Workload yet makes Pulls.** `read-only-40` shows none, so the real-Run check only shows zeros. → The fixture covers every class. The Gate Workload probe (slice 6) is where real Pull counts first appear.
- **[Risk] Tokens returned are estimated, not billed.** → They use Accounting's estimator, so they compare with part sizes, and Cost already carries the billed price.
- **[Risk] `recall_earlier_turns` is trusted, not checked.** If its tail-start bound were wrong, Measures would report its Pulls as recall anyway. → The bound is the Accounting tail of the same Call. `--json` lists every recall Pull with its Turn and distance, so it can be checked by hand against `accounting.json`.
- **[Risk] A cross-conversation result is the Run's own only by session id.** → Observed equal on the real record. Without a `sessionId`, results with Turns become unknown rather than guessed.

## Migration Plan

- Older Journals have no `turns` in cross-conversation details. Those Pulls with results become recall Pulls unknown with no distance, which is honest about what the record lacks.
- Older `bench.json` files lack the new fields: pi-chart cells read "—" and plain omp reads "n/a". `bun scripts/measures.ts <run-dir>` on a kept record recomputes them.
- Rollback is a revert. The extension change only adds a details key.

## Testing seams

| Requirement / scenario | Seam |
| --- | --- |
| The record says which Turns a search returned | `recall_across_conversations.execute` on the extension with a fake `CorpusSearch` (`test/extension.test.ts`, the existing details test), asserting `details.turns` in order |
| Pulls per Run: per-tool calls and tokens, failed calls counted, zero for uncalled tools, `write_documentation` apart, absent on plain omp | `measureRun(dir)` on a new fixture `test/fixtures/runs/pi-chart-pulls`, asserting `pulls` and `writes`, and on `vanilla-compacted`, asserting they are absent (`test/measures.test.ts`) |
| Recall Pulls: every row of the decision 3 table | `measureRun(dir)` on `pi-chart-pulls`, asserting `recalls` |
| Recall Lapses by band, zeros present, no-distance unknown in total only | `measureRun(dir)` on `pi-chart-pulls` and on `pi-chart-evicted` (no Pulls), asserting `recall` |
| "n/a" on plain omp, "—" on an older pi-chart record, routes line | `bun scripts/bench-tokens.ts --report` on a throwaway `bench.json` built from the fixtures (not kept) |
| End to end on a real Run | `bun scripts/measures.ts /tmp/bench-ro40/runs/pi-chart-0` prints zero Pulls, zero recall Pulls and the Re-fetch figures unchanged (3 Lapses); `…/vanilla-0` prints `Pulls: n/a` |
