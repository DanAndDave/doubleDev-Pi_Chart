## Context

See `proposal.md` for why. Code state this design starts from:

- `scripts/measures.ts` `measureRun` already gives each main Call a `window` (`Call.window`): Opening Turn, Pin ids, summary id, tail Turns with `from`, current Turn. It reads `compactions` and `pinTexts(entries)` from the branch.
- `scripts/ablation.ts` already holds the (tool, target) table (`targetOf`, device calls resolved, line selectors dropped) and the unit lister (`unitsOf`, `turnUnits`). It also has `unitContent`, which renders a unit's text as the model saw it. That text is what `bench/ablation/calibration.json` stores for each judged unit.
- `ablation.ts` imports `answerOf` and `PULL_TOOLS` from `measures.ts` at runtime. If `measures.ts` imported `unitsOf` from `ablation.ts`, the two modules would import each other.
- Run records hold no system-prompt text: neither the Journal nor Accounting has it. The Opening and Pins can be rebuilt from the record: the Opening is a Turn's prompt and the Pins come from `pinTexts`. The user chose to apply ticket 19's exclusion to the current Turn, the Opening and the Pins only, and to report the gap.
- `scripts/gate.ts` re-measures every Run from its record folder when it reports, so its Utilisation row works on old Gate folders. `scripts/bench-tokens.ts --report` prints the Measures stored in `bench.json`, so an old `bench.json` has no Utilisation.

## Goals / Non-Goals

**Goals:**
- One definition of a unit and of a target, shared by Ablation and Utilisation.
- Utilisation on every main Call of every record, old ones included, at no model cost and in about the time `measureRun` already takes.
- *s* and *k* passed as parameters, so that `utilisation-calibration` can run the rule over its grid without editing code.

**Non-Goals:**
- Calibration, κ, the PPI row: `utilisation-calibration`.
- Recording the system prompt.
- Re-measuring old `bench.json` folders in `bench-tokens --report`.

## Decisions

### 1. Units and targets move to `scripts/units.ts`

The following move out of `ablation.ts` unchanged: `ToolCallLike`, `Target`, `targetOf` with `deviceCall` and its regexes, `Action`/`actionOf`, `UnitKind`, `Unit`, `unitsOf`/`turnUnits`, and `unitContent`, which becomes exported. `PULL_TOOLS` and `PullTool` move out of `measures.ts`, because `turnUnits` needs them at runtime. `units.ts` imports `Window` from `measures.ts` as a type only, so there is no runtime cycle. The import graph becomes:
- `measures` → `utilisation` → `units`;
- `measures` → `units`;
- `ablation` → `units` and `measures`.

Every importer moves to the new path: `ablate.ts`, `replay-ext.ts`, `gate.ts`, `bench-tokens.ts` and the tests. The old modules re-export nothing.

Alternatives:
- `measures.ts` imports from `ablation.ts`. Rejected: Bun resolves this cycle only because every use happens inside a function, and one top-level use would break it.
- A second target table in the Measures. Rejected: the proposal requires one definition.

`matches`, `probeMatches` and `controlUnit` stay in `ablation.ts`, since only Ablation uses them.

### 2. The Used rule lives in `scripts/utilisation.ts`, pure

`utilisationOf(turns, calls, compactions, pins, cwd, rule = DEFAULT_RULE)` takes each main Call's address and window and returns:
- for each Call, its figures, or `"empty"` or `"unknown"`;
- the Run's sums.

`measureRun` calls it once, puts each Call's figures on `Call.utilisation`, and puts the sums on `RunMeasures.utilisation`. `DEFAULT_RULE = { s: 8, k: 2 }` and `RARE = 0.05` are exported.

```ts
type JudgedKind = "tool-call" | "pull" | "prose" | "summary";
interface Tally { used: number; judged: number }                 // estimated tokens
interface CallUtilisation extends Tally { byKind: Partial<Record<JudgedKind, Tally>> }
interface RunUtilisation extends Tally {
	byKind: Record<JudgedKind, Tally>;
	calls: { measured: number; empty: number; unknown: number };
}
// Call.utilisation?: CallUtilisation | "empty" | "unknown"     (absent on subagent Calls)
// RunMeasures.utilisation?: RunUtilisation                       (absent in an older bench.json)
```

Tokens are the `Unit.tokens` estimates `unitsOf` already gives (`approximateTokens`). These are the same figures Ablation samples by.

### 3. A unit's text is `unitContent`

The text a unit contributes is what `unitContent` renders:
- for a tool-call group or Pull result, the call rendered by `renderToolCall`, then its result;
- for prose, the prompt and the assistant's text;
- for the summary, its text.

The calibration set stores the same text, so `utilisation-calibration` judges exactly what Utilisation judged.

Alternative: the result text alone. Rejected, because it would leave a call's own arguments unjudged. Re-reading a file named in an earlier read is the path signal the ticket intends.

### 4. Judged kinds include Pull results

`unitsOf` gives `pull` for an earlier Pull call in the tail. A Pull result is tail tokens, and leaving it out would understate pi-chart's tail. It is reported as its own kind ("Pull result"), which reads "n/a" on plain omp. The kinds kept are `tool-call`, `pull`, `prose` and `summary`. `opening` and `pin` are dropped, and `unitsOf` never lists `turn`.

### 5. The next action, as text and as a target

The first tool call of the Call's assistant message:
- its **target** is `targetOf(call)`, with device calls resolved;
- its **text** is every string and number leaf of its arguments, with a device call's parsed content as its arguments, one leaf per line.

Without a tool call, the text is the message's `text` blocks joined. Thinking blocks are never read. Argument keys are left out of the text: `path`, `i` and `content` are the tool's vocabulary, not the agent's choice.

### 6. Lexical units

- **Tokens:** `/[\p{L}\p{N}_]+/gu`, case-sensitive. Punctuation separates tokens and is not one, so `foo.bar(x)` is three tokens. The decision ruled out BPE tokens: the record holds no tokenizer, and the rule must run offline.
- **Items:**
  - a code-shaped identifier: a token starting with a letter or underscore that holds `_`, a digit, or a capital after its first character (`QUILL_9`, `measureRun`, `PORT`);
  - a number: an all-digit token;
  - a string literal: the contents of `"…"`, `` `…` `` or `'…'` on one line, where a single quote counts only when no letter or digit touches it on the outside, so `don't` opens nothing. Each string leaf of a tool-call action is also a literal of the action, so that the action's raw argument `src/a.ts` meets the unit's rendered `"src/a.ts"`.

  The alternative was every word token. It was rejected because prose vocabulary would dominate: a word in one or two prose units is "rare" by the 5% rule.
- **Path:** each path of the target is normalised: the leading `./` and `<cwd>/` are stripped, and an empty path or `.` is skipped. The paths come from:
  - `read` and `write`: the target;
  - `edit`: the target split on newlines;
  - `grep` and `glob`: the second element of the JSON pair, split on `;`, each part's line selector dropped. A glob's pattern is not a path, and neither is a `grep` or `glob` path holding a wildcard (`*?[]{}`); a `read`, `write` or `edit` path with brackets is still a path.

  It fires on an occurrence in the unit's text that no `[\w.-]` touches on either side, except that a full stop may follow it when no name character follows the full stop, so a sentence may end with a path while `a.ts.bak` stays a longer name. A `/` may precede it, so an absolute path in a result matches its relative form.

### 7. One index per Run

Each distinct judged unit of the Run has an identity: `tool-call`/`pull` by Turn and call id, prose by Turn, summary by compaction id. Its text is rendered once. Two inverted indexes over those texts are built once per Run:
- *s*-gram → units, joined with `\u0000`;
- item → units, whose size is the item's document frequency.

An item is rare when its frequency is below `RARE` × the number of distinct units.

Per Call, the work is:
- the action's *s*-grams, looked up in the first index;
- its items, less the exclusions, kept only when rare, looked up in the second index and counted per unit against *k*;
- an `indexOf` scan per target path over the Call's units.

The cost of a Call is then proportional to its action rather than to (action × units). A large `write` against 200 tail units would otherwise be about 10⁵ lookups per Call.

Identical text gives identical *s*-grams and items, and the same path occurrences. So two units with the same text are Used together, as the spec requires, with no special case.

### 8. Exclusions

Per Call, the excluded items are those found in:
- the Call's own Turn up to the Call: the prompt, the assistant text, the rendered tool calls and the tool results;
- the Opening's prompt, when `window.opening` is set;
- each carried Pin's text.

This is the user's decision (see Context). The report states the gap.

### 9. Defaults *s* = 8, *k* = 2

These are the middle cell of ticket 19's grid, held until calibration.
- **s = 8.** A line of ordinary code is about 6–10 tokens. At 8, a shared import line or a short stock phrase such as `import { x } from "y"` (6 tokens) does not fire, but a copied line of code or prose does. 6 fires on boilerplate; 12 misses short copied values.
- **k = 2.** One shared rare number or name is often a coincidence, such as a line number or a port. Two rarely are. k = 1 credits any coincidence; k = 3 misses a unit read for one constant and its file.

### 10. Reports

- **`measures.ts`:** prints `Utilisation (uncalibrated): 31% of 48,210 judged tokens` on one line. A second line gives each kind and the Call counts (measured, empty, unknown). The caveats follow.
- **`bench-tokens.ts`:** a "Utilisation per Run (uncalibrated)" table with one row in total and one per kind, as medians over complete Runs, through the existing `figure` helper:
  - a kind the Arm cannot hold returns `undefined` and reads "n/a";
  - a Run with no judged tokens of a kind gives NaN and reads "—";
  - a `bench.json` without `utilisation` gives NaN.

  The table has no pi-chart / vanilla ratio column, since a ratio of shares invites reading one as more Needed. Under the table print a line saying Utilisation is lexical and uncalibrated, so Used is not Needed, then both caveats.
- **`gate.ts`:** the row becomes `Utilisation (uncalibrated)`, with each side's median of per-Run shares and one caveat line under the table.

## Testing seams

| Requirement | Seam | Test |
| --- | --- | --- |
| The units Utilisation judges | `utilisationOf` on in-code Journals (`test/utilisation.test.ts`) | Units of the Call's own Turn are never judged, including its earlier results. Opening and Pin units are dropped. A Pull result is judged as `pull`. A plain-omp summary is judged as `summary`. |
| The next action of a Call | `utilisationOf` | A value only in thinking makes nothing Used. The first tool call wins over the reply text and over later calls. A reply with neither a tool call nor text has an empty next action: the Call is measured, with nothing Used. A device call's content counts as the action. |
| A unit is Used when a lexical signal fires | `utilisationOf` | One case per signal, each with the others kept silent: an absolute path against a relative mention; `a.ts` not matching `a.tsx`; `.` never firing; an 8-token span fires and a 7-token span does not; two rare items fire. The rare cases are built programmatically over 60 units: one item excluded by the current Turn leaves one, which does not fire; an item in 10 of 60 units does not count; an item in the carried Opening or a Pin does not count. Identical text in two units makes both Used. Each signal also passes a `{ s, k }` other than the default. |
| Utilisation per Call and per Run | `measureRun` on `test/fixtures/runs/` | `pi-chart-evicted`: Turn-0 Calls are `empty`, Calls with no Accounting are `unknown`, and the Run's sums equal the sums of its measured Calls. `vanilla-compacted`: a post-compaction Call judges a `summary`. A kind with no judged tokens has no share. The token-weighted example (10%, 30% → 25%) runs through `utilisationOf`. |
| Utilisation is reported raw and uncalibrated; Every Gate leaves a record and a report | smoke | `bun scripts/measures.ts` on `/tmp/ablate-gate2/runs/base-0` and a `/tmp/calib-vanilla` Run. `bun scripts/gate.ts --report /tmp/ablate-gate2` prints both sides with the label. `bench-tokens --report /tmp/calib-vanilla` prints "—" for the old `bench.json`. The same report on a throwaway copy whose Measures were recomputed prints figures, "n/a" for Pull result on vanilla, and both caveats. |

## Risks / Trade-offs

- **[Lexical over-credit]** Shared boilerplate, a common path or a stock phrase can make a unit Used that the action did not need. → Mitigated by the "uncalibrated" label, by never reporting Utilisation as Needed, and by *s* and *k* being parameters; `utilisation-calibration` picks the cell against Needed.
- **[Unrecorded system prompt]** An item that the action took from omp's base prompt, the workspace's agent instructions or the tool roster can credit a tail unit holding the same item. → Both Arms share those texts, and on the Gate Workload pi-chart adds only the Opening and Pins, which are excluded. The report states the gap.
- **[Small Runs]** With 20 judged units or fewer, no item appears in fewer than 5% of them, so rare identifiers never fires. The smoke Workloads are this small, and the Gate Workload is not. → Accepted, since this is the decided rule. The spec's scenario uses 60 units.
- **[Estimated tokens]** The shares are of `approximateTokens` estimates, not of provider counts. A tail Accounting marks `partial` is judged as if whole. → The same estimates drive Ablation's sampling. A partial tail is rare on pi-chart (`tail-evicts-to-low-water`).
- **[Calibration inputs]** `utilisation-calibration` will need each calibration unit's next-action text, its Turn's exclusions and its Run's item frequencies. `calibration.json` stores only the unit's text and target, so the calibration Runs' record folders are needed. They live under `/tmp/` (`/tmp/calib-vanilla` and the A/A folders). → Not this change's scope; the folders should be copied somewhere durable before `utilisation-calibration`.
- **[Move churn]** Moving `PULL_TOOLS` and the unit code touches six importers. → A mechanical move: typecheck plus the existing `ablation` and `measures` tests prove it.

## Migration Plan

None. Utilisation is computed from existing records, and nothing new is recorded. An older `bench.json` prints "—" until its Runs are re-measured. The Gate re-measures on every report, so old Gate folders show Utilisation at once.
