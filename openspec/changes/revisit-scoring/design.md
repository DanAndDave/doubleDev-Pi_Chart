# Design: Revisit scoring

## Context

What the archived slices built, which this one extends:

- **`scripts/workload.ts`**: `loadWorkload` parses `plants` and `steps`, runs `plantProblems`, then attaches `checks/<step>.check.ts` to its step. Every problem goes into one Error. `turnsOf` numbers prompts as Turns.
- **`scripts/bench-tokens.ts` `runOne`**: copies the template workspace, which already has `overlay/` applied, into `cwd`. It sends each Turn, runs the step's check after the step's last Turn, then copies Journals and Accounting, deletes `cwd`, and writes `run.json`. The workspace is gone before the Measures run.
- **`scripts/measures.ts`**:
  - `refetchesOf` keys results by identical text.
  - `callerOf(turn, result)` finds the assistant message holding the `toolCall` a result answers.
  - `classify(window, earlier)` gives held, left or unknown.
  - `inTail` is the tail test.
  - `stringLeaves` walks tool-call arguments.
  - `recallOf` reads `details.turnIndices` from `recall_earlier_turns` and `details.turns` from `recall_across_conversations`.
  - `scoresOf` finds a Probe Turn's first Call as the first assistant message with `usage`.
  - `branchWindow` sets `summary` only when a compaction precedes the Call, and the tail then starts at its `firstKept`.
- **omp's `read` result** starts with `[path#HASH]` and elides large files, so a ranged read and a whole read of one file differ in text (seen in `/tmp/bench-ro40/runs/pi-chart-0/journal.jsonl`). The call's `arguments.path` is the path as given.
- **`smoke` v1**: three Turns. `add-double` (graded, Turn 0) states `PLUM-17`. `probe` is Turns 1–2, and Turn 2 is a tools-forbidden Probe. It has no `overlay/` and no README.

## Goals / Non-Goals

**Goals:**

- Declare and validate Revisits.
- Record edits to Revisit files while the workspace still exists.
- Score each Revisit from the record alone, report it per Arm, and prove it on `smoke` v2.

**Non-Goals:**

- Authoring the Gate Workload's Revisits and placing them in distance bands (`gate-workload`).
- Adding left Revisits to the Re-fetch band table, or to any combined Lapse count. They can duplicate a Re-fetch.
- Revisits of command output or facts. Only overlay files have a path to match and bytes to compare.
- Subagent fetches. A subagent's read does not enter the main window.
- Revisit bands in the report. Each score carries its distance, and banding waits until the Gate Workload places Revisits in bands.

## Decisions

### 1. Declaration

```ts
export interface Revisit {
	id: string;
	file: string;     // path under overlay/, as prompts name it
	earlier: string;  // step id whose prompts first send the agent to `file`
	step: string;     // step id that needs it again; must be graded
}
Workload.revisits: Revisit[];   // `workload.json` may omit the list: []
```

- `earlier` is declared, unlike a Plant's statement prompt, which is found. It is what lets validation check the authoring, meaning that the earlier step names the file and comes first. Scoring still finds the earlier read in the Journal (decision 4), so a Run in which the agent read the file elsewhere is scored by what happened.
- Field names follow `Plant.earlier`.

### 2. Validation

Implemented in `loadWorkload` as `revisitProblems(dir, revisits, steps)`, called after checks are attached, because "its step has no check" needs them. It follows the spec's list:

- "Names its file" is a plain substring test of the file path against the earlier step's prompt texts, as `plantProblems`' `named` does.
- The file is read from `<dir>/overlay/<file>` with `stat`, and must be a regular file.
- Order compares step positions in `steps`. Equal steps are reported as out of order.

### 3. Edits are recorded after every Turn

`runOne` computes the Revisit files once, as unique `file`s. After each Turn that completes, and before its check runs, each file not yet recorded has its bytes in `cwd/<file>` compared with `<workload.dir>/overlay/<file>`. The first mismatch sets `record.edited[file] = turn`. A missing workspace file counts as a mismatch.

- `RunRecord` gains `revisits?: Revisit[]` (from the Workload) and `edited?: Record<string, number>`, with only edited files as keys. Both are optional, so earlier records still parse.
- Alternative rejected: making the files read-only in the workspace. It changes what both Arms see, through permission errors, and `bash` can undo it.
- Alternative rejected: detecting edits from tool calls. `bash` and `sed -i` edits leave no write-tool call.
- It catches an edit only at a Turn boundary, and misses one reverted within the same Turn. In that case the read text was also the overlay text, so the score is still sound.

### 4. Scoring

`revisitsOf(record, turns, completed, windowAt, own)` returns `RevisitScore[]`, in declaration order, for each Revisit whose step's Turns are all below `completed`:

```ts
export type RevisitClass = "held" | "left" | "unknown" | "unfetched" | "edited" | "unread";
export type RevisitPosition = "tail" | "summary" | "evicted" | "unknown" | "unread";
export interface RevisitScore {
	id: string; file: string; step: string;
	turn: number;            // the step's first Turn
	read?: number;           // the earlier read's Turn; absent when unread
	distance?: number;       // turn − read
	fetched?: number;        // the fetch's Turn
	position: RevisitPosition;
	class: RevisitClass;
	pull?: PullTool;
	outcome: Outcome;        // from record.checks, as `steps` already does
}
RunMeasures.revisits: RevisitScore[];   // [] when the record declares none
```

- **Concerns the file**: a `toolResult` that is not `isError`, whose caller (`callerOf`) holds a `toolCall` with the result's `toolCallId` and a `stringLeaves(arguments)` entry containing `file`. The same helper finds the earlier read and the fetch. An absolute path contains the relative one, so `/tmp/…/notes/scale.md` matches.
- **Earlier read**: the last such result in Turns before `turn`, as a `MessageAddress`.
- **Fetch**: the first such result in the step's Turns. Its class is `classify(windowAt(caller address, call), earlier)`, which is the Re-fetch rule unchanged.
- **Position** uses the step's first Call. `scoresOf`'s "first assistant message with `usage`" moves into a shared `firstWindow(turns, turn, windowAt)`, which Plants and Revisits both call.
  - **unknown**: the window is `"unknown"`.
  - **tail**: `inTail`, or **unknown** when the tail is partial.
  - **summary**: `window.summary` is set. `branchWindow` sets it only when the read came before `firstKept`, so nothing more is needed. pi-chart windows never have a summary.
  - **evicted**: otherwise.
  - The summary text is not searched, because there is no single value to search a file for. That is why the spec says "kept only what followed it" rather than "holds it".
- **Pull**: `recallOf`'s parsing of turn indices is split into `recalledTurns(tool, result, own): number[]`, and `recallOf` returns the Turns a recall Pull held beyond its Call's window. The first recall Pull in the step's Turns whose Turns include `read` names the tool, so a `recall_across_conversations` result returning a Turn the window still carried names none.
- **Class order** follows the spec: unread, edited, fetched (held, left or unknown), unfetched.
- **Distance** is measured from the step's first Turn, not the fetch's Turn. A step is usually one prompt, and a fixed origin lets fetched and unfetched scores share bands.

### 5. Aggregate and report

`ArmAggregate` gains `revisits?`, absent when any complete Run's measures lack `revisits` (an older `bench.json`):

```ts
revisits?: {
	each: { id: string; file: string; step: string; classes: Record<RevisitClass, number> }[];
	byClass: Record<RevisitClass, { pass: number; of: number }>;     // of: graded scores only
	byPosition: Record<RevisitPosition, { pass: number; of: number }>;
};
```

`bench-tokens` `report()` gets a Revisits section after Answer sources:

- **Revisit scores**: one row per Revisit and class, as `| Revisit | File | Step | Class | <arm>… |`, only where some Arm counts one.
- **Revisit Passes by class** and **Revisit Passes by position**, as `pass/of` per Arm. These reuse the Retention `breakdown` helper, which moves out of the Probe branch and takes `{ right, of }`, mapped from `{ pass, of }`.
- **A note** that left Revisits are recovered Lapses, reported apart from every other Lapse count, because the same fetch can also be a Re-fetch.
- "No Revisit within the Turns sent." when no Arm has a score. "—" in the cells of an Arm without `revisits`.

CLI: one line per score after the Plant lines, using `revisitLine(score)`. For example: `scale (notes/scale.md, step use-scale): left, fetched at Turn 7, read at Turn 2, 5 Turns back, evicted, Pass`. An unread score gives `…: unread, Fail`.

### 6. `smoke` v2

- `overlay/notes/scale.md` reads `# Scale\n\nfactor: 7\noffset: 413\n`.
- Turn 0, step `add-scale` (graded): "Remember this codeword for later: PLUM-17. Then read notes/scale.md and create src/smoke.ts exporting a function `scale(n: number): number` that returns n times the factor it gives. Do not modify any other file and do not spawn subagents."
- Turns 1–2, step `probe`: unchanged.
- Turn 3, step `add-shift` (graded): "Add to src/smoke.ts an exported function `shift(n: number): number` that returns n plus the offset notes/scale.md gives. Keep `scale` as it is. Do not modify any other file and do not spawn subagents."
- Checks: `add-scale.check.ts` asserts `scale(4)` is 28, and `add-shift.check.ts` asserts `shift(1)` is 414. `add-double.check.ts` is removed.
- Revisit: `{ "id": "offset", "file": "notes/scale.md", "earlier": "add-scale", "step": "add-shift" }`.
- Version 2. The codeword Probe moves from Turn 2 of 3 to Turn 2 of 4, and its distance is unchanged.
- `add-shift` names the file, so the agent will usually fetch it while held on both Arms. Smoke proves the plumbing, not eviction.

## Risks / Trade-offs

- **[Risk] A tool call names the file in passing**, for example `grep -l x notes/` or a write to a sibling file whose content mentions the path. → The match is against argument strings, and `notes/` alone does not contain `notes/scale.md`. A write whose content quotes the path would count. Gate Workload authors keep Revisit paths out of the files the agent writes.
- **[Risk] The agent reads the file by a path that does not contain the declared one**, such as `./notes//scale.md` or `cd notes && cat scale.md`. → The score is then unfetched while the agent did go back. This is rare for read tools, which take the path as given. The CLI line shows `fetched` so that spot checks catch it.
- **[Trade-off] An edit is excluded even when it came after the fetch**, because the rule is "edited at or before the step's last Turn". → This is conservative: an excluded score cannot be wrong, and the class says why.
- **[Risk] `smoke` v2 costs about one Turn more per Run.** → It stays far below a Gate Run. The codeword Probe's figures are unchanged in meaning, but v1 and v2 reports are not compared.

## Migration Plan

- Old records recompute unchanged: no `revisits`, so `revisits: []`.
- An older `bench.json` prints "—" in the Revisit tables.
- `smoke` v1 records stay readable. v2 changes the prompts, so its version is bumped.
- Rollback is a revert. Nothing outside `scripts/`, `bench/workloads/smoke/` and the tests changes.

## Testing seams

| Requirement / scenario | Seam |
| --- | --- |
| A Workload is a versioned folder: a Revisit loads; every Revisit rejection | `loadWorkload(dir)` on temp Workload folders (`test/workload.test.ts`, existing pattern); plus `loadWorkload` on `bench/workloads/smoke` v2 |
| Every Run leaves a self-contained record: Revisits and edit Turns | The edit check is a small exported function, `editedFiles(workspace, overlay, files)`, in `scripts/workload.ts`, tested on temp folders: an unchanged file, a changed file and a deleted file. Wiring is proved by one `bench-tokens --workload smoke --runs 1` |
| Revisits scored: left with a ranged read, held, unfetched with search and error results, recall Pull, edited, unread, unknown window, most recent earlier read | `measureRun(dir)` on a new fixture `test/fixtures/runs/pi-chart-revisits` (`test/measures.test.ts`) |
| Revisits scored: held before a compaction, unfetched in summary, left after the cut | `measureRun` on a new fixture `test/fixtures/runs/vanilla-revisits` |
| A step the Run never finished; a record without Revisits | `measureRun` on `failed-early` with a Revisit added to its `run.json` whose step was not reached; `complete` as is |
| Revisits reported by class and position | `aggregate()` on constructed `RunMeasures` (existing pattern); report layout on a throwaway `bench.json` built from both fixtures (not kept) |
| End to end | `bun scripts/bench-tokens.ts --workload smoke --runs 1`: each `run.json` holds the Revisit and no `edited`; each Run prints an `offset` line; the report prints the Revisit tables |
