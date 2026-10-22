## Context

`warnIfNearCeiling` (`src/extension.ts`) runs on every `context` Call. It calls `announce`, which writes the line through `reportSafely` and also calls `ui.notify(message, "warning")`. An overrun is announced on every Call; the approach once per Conversation, gated by `warnedNearCeiling`. `notify` is what puts the line in the conversation.

Two existing pieces shape the approach:

- **The footer is already in use.** `showPins` writes `pi-chart.pins` through `setStatus`. It is re-run from `session_start`, `context` (success and failure), `session_switch` and `session_branch`, and the handlers keep `ui` current from each `ctx`. The gauge follows the same pattern under its own key.
- **The words already exist.** `src/report.ts` has `REASONS`, `absenceOf` and the rule that hides a `pinned` part carrying nothing. They operate on `PartView` (`src/inspection.ts`), which is built from a `RecordedPart` (`recordPart` in `src/accounting.ts`), which is built from a `PackPart`. The live `Pack` therefore reaches a `PartView` without the store.

omp's `setWidget(key, lines | factory | undefined, { placement })` renders a string array as one text line per entry (up to 10, then a truncation notice), above the editor by default. Interactive mode and RPC both accept string arrays; headless and print supply neither `setStatus` nor `setWidget`. `HarnessUI` declares only `notify`, `setStatus` and `editor`.

## Goals / Non-Goals

**Goals:**

- One source for the figures and words the footer, the widget and `/pack` show for a Call.
- Nothing on the request path waits on a UI call or the store.

**Non-Goals:**

- An interactive overlay (`ctx.ui.custom`) to explore excluded Turns. `/pack why` already answers that, and an overlay only works in the interactive TUI.
- Theme colours. The lines are plain strings so RPC clients get the same text; colour can come later through a component factory without changing the specs.
- Changing other `announce` callers.

## Decisions

### The gauge reads the live Pack, not Accounting

The gauge and the widget are built from the `Pack` that `deps.assemble` just returned, inside the `context` handler. They are never read back from `deps.accounting`.

Alternative: render from `readAccounting`, as `/pack` does. Rejected for three reasons. Accounting writes are fire-and-forget (`inBackground`), so a read-back on the same Call races the write. It would add a store round trip to every Call. And with no Thread Store the gauge would go blank, at exactly the time an operator is least able to inspect anything else.

`/pack` keeps reading Accounting. The words match because both paths end in the same `PartView` and the same `REASONS`.

### One view, two renderers

- `src/inspection.ts` exports `viewPack(pack: Pack, warnShare: number): PackView`. It holds `approximateTokens`, `ceiling`, `beforeCeiling`, `mark` and `parts: PartView[]`. Each part is `viewPart(recordPart(part))`, so the conversion `/pack` uses is the one used here. `mark` is computed once, in the spec's precedence order: `over` if `approximateTokens > ceiling`; else `reduced` if `beforeCeiling > approximateTokens`; else `near` if `approximateTokens > ceiling * warnShare`; else none. With `ceiling <= 0` the mark is always none. `warnIfNearCeiling` moves from `>=` to `>` with it, so the gauge, the log line and the spec's "more than a configured share" agree on the boundary.
- `src/inspection.ts` also exports `PackState`, `PackView | "unassembled" | undefined`. `src/report.ts` exports `renderGauge(state)` and `renderPackWidget(state)`, both taking a `PackState`. They describe a part through one `saidOf(part)` that `renderCall` also uses, so a part placed in the system prompt reads `in the system prompt` in both; it reuses `REASONS` through `carriedOf` / `reasonsOf` and `absenceOf`. The pinned-part skip rule is factored into one predicate all three call.
- Token figures use `tokenFigure` from `src/elision.ts` (exact below 1,000, `~Nk` from 1,000), exported for this. The footer is width-truncated and shared with other statuses; `~805k/300k` survives truncation where `~804839 of 300000` would not.

Alternative: a separate formatter in `extension.ts`. Rejected: a second phrasing of "4 for the pack ceiling" is exactly the drift `REASONS` exists to stop.

### Formats

Footer, key `pi-chart.pack`, with an 8-cell bar filled to `min(share, 1)` in eighth blocks:

```
pack ▕███▎    ▏ 41% ~123k/300k
pack ▕███████▊▏ 98% ~294k/300k · near ceiling
pack ▕███████▉▏ 99% ~298k/300k · reduced from ~410k
pack ▕████████▏ 268% ~805k/300k · over ceiling
pack: not assembled
pack ~123k
```

The last line is the no-ceiling form. With no state the status is cleared (`setStatus(key, undefined)`).

Widget, key `pi-chart.pack`, `placement: "belowEditor"`. A header, then a line per listed part, in `pack.parts` order (pinned, opening, verbatim-tail, current-turn, matching `/pack`). Bars are 20 cells against `max(ceiling, approximateTokens)`, so over-ceiling bars still fit:

```
pack ~805k of 300k (268%) · over ceiling
pinned         ▏                     ~4k  in the system prompt (2 of 5)
opening        ▏                     ~9k  in the system prompt (1 of 1)
verbatim-tail  █████▏              ~151k  (1 of 8, 4 for the pack ceiling, 412 messages dropped)
current-turn   ███████████████▎    ~612k  (content shortened)
```

At most five lines, well under omp's 10-line cap. `"unassembled"` renders `pack: not assembled — the harness's history went out`, and `undefined` renders `pack: no call assembled yet in this conversation`.

The header total is `pack.approximateTokens`, which includes the eviction notice. The part lines don't, so they can sum to a few tokens less. That matches `/pack`, which also doesn't list the notice as a part.

### Extension state and wiring

- `lastPack: PackView | "unassembled" | undefined` and `packShown = false` sit beside `held` / `governing`.
- `showPack(target)` sets the status from `renderGauge(lastPack)`, and the widget from `renderPackWidget(lastPack)` when `packShown` is true.
- `context` success: `lastPack = viewPack(pack, deps.config.packWarnShare)`, then `showPack(ui)`, next to `showPins(ui)`. Failure: `lastPack = "unassembled"`, then `showPack(ui)`.
- `session_start`: `packShown = false`, `lastPack = undefined`, `showPack(ui)`.
- `session_switch` and `session_branch`: `lastPack = undefined`, then `showPack(ui)`. An open widget then says no Call is assembled yet.
- `warnIfNearCeiling` keeps its conditions, its log text and the `warnedNearCeiling` gate, but calls `reportSafely` instead of `announce`. The gauge's near mark is per Call, separate from the once-per-Conversation log gate.
- Each UI call is wrapped like `reportSafely`. A throwing `setStatus` or `setWidget` is swallowed, so the UI cannot fail assembly. That is the spec's "SHALL NOT ... fail the Turn".

### `/pack show` and `/pack hide`

Two verbs in `inspect`, checked before the Accounting read, as `budget` is, so they work with no Thread Store. They need the command's UI, so `inspect` receives `commandCtx.ui`.

- `show`: if the UI has no `setWidget`, answer `This harness cannot show the pack beside the editor; /pack reads it.` Otherwise set `packShown = true`, call `showPack(commandCtx.ui)`, and answer `Showing the pack below the editor; /pack hide closes it.`
- `hide`: set `packShown = false`, call `setWidget(key, undefined)`, and answer `Pack widget closed.`

`show` and `hide` cannot clash with Call addresses, which are digits only (`parseAddress`). The `/pack` command description gains both verbs.

Alternative: a separate `/pack-view` command. Rejected: `pack` and `pins` are one command with verbs, by the project's own convention (`src/extension.ts` comment on `pins`).

### `HarnessUI`

Add `setWidget?: (key: string, lines: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }) => void`. Only the string-array form is declared, because only that form works over RPC.

## Risks / Trade-offs

- [An overrun no longer interrupts the transcript, so an operator who never looks at the footer misses it] → The gauge stays at `over ceiling` for every overrunning Call, the log still records each one, and `/pack` and `/pack summary` are unchanged. The user chose this trade explicitly over a one-time notice.
- [Footer truncation hides the mark when many statuses compete] → The mark comes after the figures and the line is short. omp sorts statuses by key, and `pi-chart.pack` sorts before `pi-chart.pins`, so the gauge goes first of pi-chart's two.
- [A status and widget update per Call costs a repaint per tool result] → omp already repaints on every tool result. These are two string writes with no I/O.
- [Over RPC the widget arrives as plain lines and the block glyphs may render oddly in some clients] → The figures and words carry the information on their own, and the bar is decoration.
- [The gauge describes the Call just assembled, before the provider answers] → That is the Pack that went out. Accounting reconciles reported sizes later, and `/pack` shows them.

## Migration Plan

None: no stored data changes. Rollback is reverting the commit. Because `src/` changes, the Gate runs before archive (`docs/agents/workflow.md`, phase 6). Nothing that reaches the model changes, so a pass is the expected verdict.

## Testing seams

| Requirement | Seam |
| --- | --- |
| The last call's pack is shown on the status line: mark precedence, share, bar bounds, no-ceiling form, the unassembled form | `renderGauge` / `viewPack` in `test/report.test.ts`, over `Pack` fixtures. Bar fill is checked at 0, at a fraction, and over 100%. |
| The last call's pack is shown on the status line: follows each call, unassembled replaces, switch and branch clear, no status line | `harness()` in `test/extension.test.ts`. Reads `statuses` for key `pi-chart.pack` after `context` calls, a throwing `assemble`, `session_switch` and `session_branch`; a UI without `setStatus` still completes the Turn and `/pack` reports the Call. |
| The last call's parts can be shown beside the editor: line contents and reason words | `renderPackWidget` in `test/report.test.ts`. A tail reduced by the ceiling shows `4 for the pack ceiling`, asserted equal to the phrase `renderCall` produces for the same part. Pins and Opening read `in the system prompt`, as `/pack` prints them. |
| The last call's parts can be shown beside the editor: off by default, closed at session start, show, refresh down to unassembled, hide, no call yet, no widget support | `harness()` in `test/extension.test.ts`, with the fake UI's new `widgets` log, driving `commands.pack.handler("show" / "hide")` around `context` calls. |
| A pack approaching its ceiling is reported (modified) | The existing `describe("a pack approaching its ceiling")` tests keep their `reported` assertions. They add that `notified` holds no ceiling line and that the gauge carries `near ceiling` on each crossing Call. |
| An overrun is reported on every call, outside the conversation | Same `describe`: two overrunning Calls give two `reported` lines, no `notified` line, and a gauge reading `over ceiling`. The throwing-reporter test gains an overrunning Call (`packTokens: 200`) whose Pack is still returned unchanged. |

The interactive footer and widget are checked by hand at the end (task 4.3). The tests exercise the strings, not omp's rendering.
