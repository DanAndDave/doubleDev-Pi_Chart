# Design: Window held and Re-fetch

## Context

`scripts/measures.ts` (from `measures-walking-skeleton`) reads one Run record folder: `run.json`, `journal.jsonl`, `subagents/*.jsonl` and, for pi-chart, `accounting.json` (`{ [conversationId]: TurnAccounting[] }`). It assigns main-Journal Calls to Turns through `readJournal` (`src/journal.ts`), which also numbers every message by the Call that produced it, using the same index Accounting uses (`JournalTurn.calls`).

What the record already says, observed on `/tmp/bench-ro40/runs/` (`read-only-40` v1, one Run per Arm):

- pi-chart Accounting gives each Call a `verbatim-tail` part with `turnIndices`, plus `opening` and `pinned` parts with placement, ids and `absent` causes (`src/accounting.ts` `RecordedPart`). At Turn 13 the tail carried `[11, 12]` and recorded 6 Turns evicted.
- Comparing tool-result text across Turns finds 3 cross-Turn identical results on pi-chart (Turn 4 → 13 twice, Turn 5 → 14) and none on plain omp. The tail did not carry Turns 4 and 5 at those Calls, so all three are Lapses.
- Neither Run compacted. A real compaction entry, from `~/.omp/agent/sessions/-dev-context-manager/…01a0a871….jsonl`, has `type: "compaction"`, `id`, `parentId`, `firstKeptEntryId`, `summary`. Its `firstKeptEntryId` names an assistant message 99 entries before the compaction, so the cut falls part-way through a Turn.
- `readJournal` keeps only `message` entries and drops their ids, so it cannot place a compaction or its cut.

## Goals / Non-Goals

**Goals:**

- A per-Call window that later slices reuse: Pulls ask what a recall Pull's Turns were relative to it, Plants ask where a Plant sat, Utilisation weighs its tail and summary.
- Re-fetch held / left / unknown, Lapses per Run by band, and the "n/a" convention, from the record alone.

**Non-Goals:**

- Part sizes. Utilisation needs them and adds them; this slice needs only identities.
- Recall Pulls as recovery, and Lapses through Pulls or Probes (slices 3 and 4).
- Subagent windows. A subagent is its own Conversation with its own Journal, and its Calls stay at Turn −1.
- Revisits declared by a Workload (slice 5).

## Decisions

### 1. Compactions come from the Journal reader, not a second parser

`src/journal.ts` gains `readBranch(path, leafId?): Promise<{ turns: JournalTurn[]; compactions: Compaction[] }>`. It does the same walk over `activeBranch(parse(text))` that `readJournal` does today, and `readJournal` becomes `(await readBranch(…)).turns`. Ingest and the extension keep calling `readJournal` unchanged.

```ts
/** A message by position: its Turn, and its index in that Turn's messages. */
interface MessageAddress { turn: number; message: number }

interface Compaction {
	id: string;
	/** The first message written after the compaction on the branch. */
	before: MessageAddress;
	/** The first message the compaction kept; absent when its entry is not on the branch. */
	firstKept?: MessageAddress;
}
```

- `before` is the address the next message will get when the compaction entry is reached. `firstKept` resolves `firstKeptEntryId` against entry ids seen so far on the branch. An id naming a non-message entry, such as a `model_change`, resolves to the next message after it.
- Alternative rejected: a parser in `scripts/` that re-reads the file with ids. It would duplicate `activeBranch`, and two readers of the same Journal could disagree about which branch is active.
- Alternative rejected: adding compactions to `JournalTurn`. Ingest has no use for them, and the type is the shape the Thread Store stores.

### 2. One window type, filled per Arm

```ts
type Window =
	| "unknown"
	| {
			opening?: number;        // Turn 0, where the Opening was carried
			pins: number[];          // Pin ids
			summary?: string;        // compaction id
			tail: { turns: number[]; from?: MessageAddress; partial?: true };
			current: number;         // the Call's own Turn
	  };
```

Each main `Call` row gets `window`. The system prompt part has no identity, so it is not in the type, and the Floor still covers its size. The Arm is read from `run.json`'s `arm`:

- **pi-chart:** find the `CallAccounting` with the same `turnIndex` and `callIndex` in the single Conversation of `accounting.json`.
  - The tail is the `verbatim-tail` part's `turnIndices`, with `partial` when that part has `shortened` or `droppedMessages`.
  - The Opening is set when the `opening` part has no `absent`; pins are `pinned.pinIds`.
  - No row, no `accounting.json`, or a tail part without `turnIndices` gives `"unknown"`.
  - `unassembled: true` uses the plain-omp rule below on the pi-chart Journal; pi-chart suppresses compaction, so that is the whole branch.
- **plain omp:** the applicable compaction is the latest one whose `before` is at or before the address of the assistant message that ends the Call.
  - With none, the tail is Turns 0 to `current − 1`.
  - With one, `summary` is its id and the tail starts at `firstKept`: `turns` lists the Turns from `firstKept.turn` to `current − 1`, and `from` is `firstKept` when it is not the first message of its Turn.
  - A compaction with no `firstKept` gives `"unknown"`.
- Alternative rejected: deciding the Arm from whether `accounting.json` exists. A pi-chart Run whose export failed would then be measured as plain omp and look like it never evicted.

### 3. Re-fetch detection

- Walk the main Journal's `toolResult` messages in order, keyed by `messageText(message)`. Skip a result whose text is empty or that has `isError`.
- Keep a map from text to the address of its most recent occurrence. A result is a Re-fetch when its key is in the map and the stored address is in an earlier Turn. The map is updated after every result, so a re-read after an edit has a new key and is not a Re-fetch.
- The tool name is not part of the key: the definition is the result, not the call, so a file read by `read` and then printed by `bash` is the same content fetched twice.
- **The deciding Call:** the tool call's id is matched to the assistant message that holds it, and that message's index in `JournalTurn.calls` gives the Call. Its window decides the class:

  | Window | Earlier result's Turn *u* | Class |
  | --- | --- | --- |
  | `"unknown"` | any | unknown |
  | known | *u* in `tail.turns`, or `opening === u`, with `from` at or before the result when *u* = `from.turn` | held, or unknown if `tail.partial` |
  | known | otherwise | left |

  `opening` counts only for Turn 0's prompt. A tool result is never the prompt, so in practice the Opening never holds one; the clause is there so the rule does not depend on that.
- Each Re-fetch is recorded on `RunMeasures.refetches` as `{ turn, call, earlierTurn, distance, tool, class }`. With `--json` that lists every one by Turn, which is how a reader audits a surprising count.

### 4. Bands and counts

```ts
const BANDS = [[1, 5], [6, 7], [8, 12], [13, 24], [25, Infinity]] as const;
interface Banded { total: number; bands: number[] }   // bands[i] counts BANDS[i]
RunMeasures.refetch: { held: Banded; left: Banded; unknown: Banded }
RunMeasures.compactions?: number   // absent on pi-chart: one-Arm
```

- Lapses are `refetch.left`. Slices 3 and 4 add Lapse routes, and they will add their own counts beside this one rather than renaming it.
- `aggregate` adds nothing: the report takes medians of these per-Run counts over complete Runs, like every other per-Conversation row.
- The two between-bands are reported, not dropped. Dropping them would make the band columns no longer add up to the Run's total, and a reader would have to guess where the rest went. The three planned bands keep their bounds, so Retention by band (slice 4) lines up with them.

### 5. "n/a" in the report

- `bench-tokens` report rows gain an optional per-Arm `pick` that may return `undefined`. A row whose value is `undefined` for every complete Run of an Arm prints "n/a" for that Arm and "n/a" in the ratio column.
- Compactions per Run goes in the per-Conversation table.
- A new table, "Re-fetches per Run by distance band, median over complete Runs", has one row per band plus a total, and held / Lapse / unknown columns per Arm.
- The CLI prints one line per class with its total and bands, then the compactions count or "n/a".

## Risks / Trade-offs

- **Identical text is not always a fetch.** Two identical write acknowledgements in different Turns would count as a Re-fetch. → `read-only-40` has only `read`, `grep` and `bash` results. The `--json` list names the tool of every Re-fetch, so the Gate Workload probe (slice 6) will show whether acknowledgements occur. If they do, they are excluded then, with a scenario.
- **A partial tail hides some Lapses as unknown.** → It is reported, not folded in. In `read-only-40` no tail part was shortened or dropped messages, so the count is 0 there.
- **[INFERENCE] The plain-omp Journal may not record every way the harness trims history.** If omp drops or prunes old tool output without writing an entry, held is overstated on plain omp. → Only compaction entries have been observed. The `context-need-measures` map records harness behaviour as found, and a second mechanism would be a later change to the plain-omp rule.
- **The most recent earlier copy decides.** If a result was received at Turns 3 and 10 and again at 30, distance is 20, not 27. → That is the copy a window would hold, so it is the one whose presence matters.

## Migration Plan

- Old `bench.json` files lack the new fields. `--report` on them prints the new rows as "—", the way a missing figure already prints. Re-measuring a kept record folder with `bun scripts/measures.ts <run-dir>` gives the new figures.
- Rollback is a revert. Nothing stored changes shape.

## Testing seams

| Requirement / scenario | Seam |
| --- | --- |
| Compactions placed on the branch, cut part-way through a Turn, cut entry off the branch | `readBranch(path)` on fixture Journals (`test/journal.test.ts`), plus a throwaway run on the real compacted Journal named in Context |
| Window parts per Call: pi-chart tail and Opening, plain omp before and after a compaction, missing Accounting, unassembled | `measureRun(dir)` on fixture record folders under `test/fixtures/runs/`, asserting `calls[].window` (`test/measures.test.ts`) |
| Re-fetch held / left / unknown, distance, re-read after an edit, same-Turn repeat, error and empty results | `measureRun(dir)` on the same fixtures, asserting `refetches` |
| Bands sum to total; zero counts present | `measureRun(dir)` on the fixtures, asserting `refetch` |
| Compactions per Run, "n/a" on pi-chart, 0 on a plain-omp Run that never compacted | `measureRun(dir)` for the count; the report's n/a and ratio cells are checked by `bun scripts/bench-tokens.ts --report` on a throwaway `bench.json` built from the fixtures |
| End to end on a real Run | `bun scripts/measures.ts /tmp/bench-ro40/runs/pi-chart-0`: 3 Lapses, all in 8–12, 0 held, 0 unknown; `…/vanilla-0`: 0 Re-fetches, compactions 0 |
