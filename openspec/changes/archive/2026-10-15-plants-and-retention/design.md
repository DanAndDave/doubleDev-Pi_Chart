# Design: Plants and Retention

## Context

What the archived slices built, which this one extends:

- **`scripts/workload.ts`**: `Plant` is `{ id, value }` and `Prompt` is `{ text, probes }`. `loadWorkload` collects every problem into one Error. `bench-tokens` copies `workload.plants` and each prompt's `{ step, text, probes }` into `run.json`.
- **`scripts/measures.ts`**:
  - `measureRun` scores each Probe by `messageText(final reply).includes(value)` into `RunMeasures.plants: { id, turn, right }[]`.
  - `aggregate()` gives `retention: { id, right, of }[]` per Plant id. A Run counts as right only when every Probe of that id was right.
  - `windowAt(at, call)` gives each main Call's `Window`: Opening Turn, Pin ids, summary id, tail Turns with `from` and `partial`, and the current Turn, or `"unknown"`.
  - `callerOf`, `classify`'s tail test, `PULL_TOOLS` and `band()` already exist.
- **`src/journal.ts`**: `readBranch` gives each `Compaction` an id, `before` and `firstKept`. The entry's `summary` text is in the Journal, as in `vanilla-compacted`'s `k1`, but it is not read.
- **Pins**: Pins are `pi-chart.pin` custom entries, `add { id, text }` or `snapshot { pins }` (`src/pins.ts`). A Window holds Pin ids only.
- **`messageText`** returns text blocks only. Tool-call arguments are separate `toolCall` blocks (`isToolCall`).
- **Observed on `/tmp/bench-ro40`**:
  - pi-chart-0's Probe at Turn 39 was sent with Opening 0 and tail 31–38, and answered the codeword right and the build number (Turn 2) wrong, with no tool call.
  - vanilla-0 answered both right, with no compaction.
  - The Probe's prompt says "Do not use any tools."

## Goals / Non-Goals

**Goals:**

- Declare and validate the Plant matrix in the Workload.
- From the record alone, give each score:
  - the Plant's Turn, its distance and its position;
  - its source and its class;
  - its place in the failed-Probe Lapse bands.
- Report Retention by Probe, band and position, and the source × result table.

**Non-Goals:**

- Authoring the Gate Workload's Plants. Slice 6 places them in the bands and gives each kind a Probe.
- Judged scoring, and "a decision with its reason", which needs a judge (question 07).
- Oracle or no-fact control Runs. Values are fictional, so a right answer with no source is flagged as a leak, not controlled for (question 07).
- Combining the three Lapse routes into one count.
- Constraints that a token cannot express, such as "use tabs".
- Probes in subagents. A subagent's tool calls do not count toward a constraint.

## Decisions

### 1. Declaration: Plant fields, defaults, and no statement markers

```ts
export type PlantKind = "literal" | "superseded" | "constraint";
export interface Plant {
	id: string;
	kind: PlantKind;          // workload.json may omit it: "literal"
	value: string;
	earlier?: string;         // superseded only: the value it replaces
	file?: string;            // placed in a tool result: path under overlay/ holding `value`
	earlierFile?: string;     // superseded and `file`: path under overlay/ holding `earlier`
}
export interface Prompt { text: string; probes: string[]; tools?: false }
```

- **A missing kind is `literal`.** `read-only-40`, `smoke` and every existing `run.json` keep their meaning without a version bump or a record migration. `measureRun` applies the same default to a recorded Plant without `kind`.
- **Where a Plant is stated is found, not declared.** A prompt-placed Plant is stated by the one prompt holding its value. A file-placed Plant is stated by the first prompt naming its file.
  - Alternative rejected: a `plants: [...]` field on stating prompts, mirroring `probes`. It would duplicate what the value search already finds and add a mismatch for validation to report.
- **`tools: false`** is declared only on prompts that forbid tools; it means nothing on a prompt that probes nothing.
  - Nothing sent changes: the prompt's text must still say so ("Do not use any tools"), as both existing Probes do. Passing `--no-tools` to omp was rejected because it disables built-in tools only, which leaves pi-chart's recall tools in place, and it would change the Arms' system prompts on that Turn.
- **Field names** follow the spec's words: "earlier value" becomes `earlier`.

### 2. Validation

The spec's list of rejections, implemented in `loadWorkload` beside the existing checks, each naming the Plant and, where one applies, the step:

- "Contains" is a plain substring test, in either direction, over every pair drawn from the values and earlier values. Scoring is a substring test, so two overlapping values could not be told apart.
- "Names the file" is the prompt text containing the declared path as given.
- A file is read from `<dir>/overlay/<file>`. A missing file and a file without the value are reported separately.
- A Plant's statement prompt and each Probe are compared by Turn index (`turnsOf` order).

### 3. The Plant's Turn is found in the Journal

`plantedAt(turns, value, before)` gives the first Turn below `before` with a message whose text contains `value`, along with that message's address. Only the user prompt (message 0) and `toolResult` messages count.

- Validation keeps the value out of every other prompt, so for a prompt-placed Plant this is its statement Turn. For a file-placed Plant it is the Turn whose tool result first brought the value in, wherever the agent happened to read it.
- Assistant messages do not count. An echo is the agent repeating something already in the Conversation, not the Plant entering it.
- Old records work unchanged, because nothing here is read from the declaration.

### 4. Scoring by kind

- **literal**: `messageText(final reply).includes(value)`, as today.
- **superseded**: the reply includes `value` and not `earlier`. A reply that includes `earlier` is `stale`, whether or not it also includes `value`. Naming both is hedging between the near-miss and the answer, and the Probe asks for one value.
- **constraint**: the first main-agent `toolCall` block of the Probe Turn that has a string leaf in its `arguments` containing `value`. String leaves are searched recursively, not `JSON.stringify` output, so escaping cannot hide a match.
- **breach**: the prompt is `tools: false` and any assistant message of the Turn has a `toolCall` block.
- The scored message is the final reply, or that first tool call for a right constraint. Sources are looked for in messages before it (decision 6).

### 5. Position from the Probe's first Call

The window is `windowAt` at the Probe Turn's first assistant message that has `usage`, with its Call index. Precedence, first match wins:

| Position | Test |
| --- | --- |
| unplanted | `plantedAt` found nothing |
| unknown | window `"unknown"` |
| Opening | `window.opening === plantTurn` and the Plant entered at message 0 |
| Pin | a Pin id in `window.pins` whose text contains `value` |
| tail / unknown | the entry address is in the tail (the `classify` tail test: Turn in `tail.turns`, at or after `tail.from`); `unknown` if `tail.partial` |
| summary | `window.summary` names a compaction whose summary text contains `value` |
| evicted | otherwise |

- `Compaction` gains `summary?: string` in `readBranch`: read from the entry, absent when the entry has none.
- Pin texts come from the main Journal's `pi-chart.pin` entries, `add` and `snapshot` alike, keyed by id. `src/pins.ts` exports a `pinTexts(entries)` built on its existing event parsing. `readBranch` also returns `entries`, every entry of the file in the order written, from the same parse, and the Measures pass those. A rewound branch could reuse an id with other text, but bench Runs never rewind, so the latest text per id is taken without walking the branch.
- Alternative rejected: Opening/Pin/tail/evicted only, as question 07 lists them. On plain omp after a compaction, the summary is the only part that can still hold an old Plant, and calling that "evicted" would make a summary hit look like a leak.

### 6. Source: window first, then the Probe Turn's own results

Search order, first hit wins. `holds(message, value)` checks text blocks and `toolCall` argument string leaves, since a tail carries both.

1. If the window is `"unknown"`, the source is `unknown`.
2. **Opening**: `turns[window.opening].prompt`.
3. **Pin**: carried Pin texts.
4. **tail**: every message of each Turn in `tail.turns`, from `tail.from` in its Turn. A hit while `tail.partial` gives `unknown`.
5. **summary**: carried summary text.
6. **Pull**: a Probe-Turn `toolResult` with a `PULL_TOOLS` `toolName`, before the scored message, holding the value. The score records which tool.
7. **tool result**: any other Probe-Turn `toolResult` before the scored message holding the value.
8. **none**.

- The window parts come first because the Call had them before it acted. A Pull that returns what the tail already held is the agent's redundancy, not where the answer came from.
- The decision's "a Re-fetch of the file holding it" became "tool result". A Re-fetch requires a result identical to an earlier one, and a `grep` that finds the value in the file is not one. The source is still a fetch, so the Lapse is recovered, and the score shows it.
- Classes follow the spec's table. `unplanted` wins over `unknown`, so every unknown has a distance.

```ts
export type Position = "opening" | "pin" | "tail" | "summary" | "evicted" | "unplanted" | "unknown";
export type Source = "opening" | "pin" | "tail" | "summary" | "pull" | "result" | "none" | "unknown";
export type ScoreClass = "leak" | "despite" | "lapse" | "unknown" | "unplanted";
export interface Score {
	id: string; turn: number; kind: PlantKind; right: boolean;
	planted?: number; distance?: number; position: Position;
	source: Source; pull?: PullTool; class?: ScoreClass;   // absent: right with a source
	stale?: true; breach?: true; tools?: false;
}
RunMeasures.plants: Score[];                              // replaces { id, turn, right }[]
RunMeasures.probe: { lapse: Banded; unknown: Banded };    // both Arms, zeros present
```

### 7. Aggregate and report

`ArmAggregate.retention` becomes per Probe: `{ id, turn, kind, tools?, right, of }`, over complete Runs. It is no longer per Plant id with every Probe required right. `ArmAggregate` gains:

- `byBand: { right, of }[]`, indexed like `BANDS`;
- `byPosition: Record<Position, { right, of }>`;
- `sources: Record<Source, { right, wrong }>`;
- `counts: { leak, despite, stale, breach }`.

A score without a distance counts under `unplanted` in `byPosition` and in no band.

`bench-tokens` `report()`:

- **Retention per Probe**: Plant, kind, Probe Turn, tools, then `right/of` per Arm.
- **Retention by distance band** and **Retention by position**: `right/of` per Arm, with a row only where some Arm has a score.
- **Answer sources**: per Arm right and wrong columns, followed by a line giving leaks, wrong despite a source, stale and breaches per Arm.
- **Band table**: gains `failed Probe` and `failed Probe unknown` columns per Arm. On plain omp they are figures, not "n/a".
- **Routes line**: adds that failed Probes are Lapses neither Arm recovered.
- An older `bench.json` whose scores lack `position` prints "—" in the new tables.

CLI: each score prints on its own line, for example `build: wrong at Turn 40, literal, 37 Turns back, evicted, source none (Lapse)`. Then come `Failed-Probe Lapses: …` and `Failed Probes unknown: …` banded lines, next to the Re-fetch Lapses.

### 8. Existing Workloads

`read-only-40` and `smoke` add `"tools": false` to their Probe. The texts are unchanged, so the version stays 1, and each README's Versions note records the amended declaration. Their Plants stay literal and prompt-placed by default.

## Risks / Trade-offs

- **[Risk] A shortened Opening is still read as holding the Plant.** The Window has no Opening-shortened flag, and Elision keeps a prompt's head and end. → Workload openings are far under the Opening Budget. `accounting.json` shows `shortened` on the opening part if a Gate Workload ever reaches it, and the flag can then join the partial-tail rule.
- **[Risk] `tools: false` is honoured only by the model.** → A breach is flagged on the score and counted in the report, and the source then shows what the tool brought.
- **[Risk] Constraints are limited to tokens in tool arguments.** → The Gate Workload phrases each constraint as a fictional token the agent must write, for example a header line, which question 07's "deterministic rule" allows.
- **[Risk] Plain omp's tail is the whole branch before any compaction**, so most of its Plants sit in the tail. → That is plain omp's window as specified. Positions on the two Arms differ for that reason, and the report shows Retention by position for that reason.
- **[Trade-off] Source order prefers the window over a Pull that also held the value.** A Pull made "just to check" is then not credited. → The Pull is still counted under Pulls and recall Pulls, so only the attribution prefers the window.

## Migration Plan

- Old records recompute with `bun scripts/measures.ts <run-dir>`. Plants default to literal, Probes carry no tools flag, and the Plant's Turn, position and source come from the Journal and Accounting already kept.
  - The `read-only-40` records from before this change show their Probe as allowing tools.
- An older `bench.json` prints "—" in the new tables.
- Rollback is a revert. The only change outside the scripts is an optional field on `Compaction` and a new export in `src/pins.ts`.

## Open Questions

- Whether `omp -p` runs `/pin`, so that a Workload can place a Plant in a Pin. Slice 6 decides how its Plants are placed. Measures report the Pin position either way.

## Testing seams

| Requirement / scenario | Seam |
| --- | --- |
| A Workload is a versioned folder: defaults, every kind and placement, each new rejection | `loadWorkload(dir)` on temp Workload folders (`test/workload.test.ts`, existing pattern); plus `loadWorkload` on `bench/workloads/read-only-40` and `smoke` |
| Every Run leaves a self-contained record: Plants and tools flag kept | One `bun scripts/bench-tokens.ts --workload smoke --runs 1` on both Arms; `run.json` holds `kind: "literal"` and the Probe's `tools: false` |
| Retention per Plant: kinds, stale, constraint, breach | `measureRun(dir)` on a new fixture `test/fixtures/runs/pi-chart-plants` (`test/measures.test.ts`) |
| Where a Plant sat: Opening, tail, evicted, unplanted, unknown, partial | `measureRun` on `pi-chart-plants` |
| Where a Plant sat: summary | `measureRun` on a new fixture `test/fixtures/runs/vanilla-plants` |
| Each answer has a source: every source, class and the tail repeat | `measureRun` on both fixtures |
| Failed Probes per Run by distance band, zeros present | `measureRun` on both fixtures, and on `pi-chart-evicted`, which has no Probe |
| Retention reported by Probe, distance and position | `aggregate()` on constructed `RunMeasures` (`test/measures.test.ts`, existing pattern); report layout on a throwaway `bench.json` built from both fixtures (not kept) |
| End to end on a real Run | `bun scripts/measures.ts /tmp/bench-ro40/runs/pi-chart-0`: codeword Opening, source Opening, right; build evicted, source none, failed-Probe Lapse at 37 (≥25). `…/vanilla-0`: both tail, right, zero failed Probes |
