## Context

See proposal.md for why. Harness facts the design rests on, checked against omp 18.8.6:

- `pi.appendEntry(customType, data)` writes a `custom` entry (`{type:"custom", customType, data}`) at the current leaf. `buildSessionContext` never turns it into a model message, and pi-chart's own Journal readers (`readJournal`, `addressOf`, `measurementsOf`) skip non-`message` entries already.
- `ctx.sessionManager.getEntries()` returns every non-header entry of the current file in insertion order; `getBranch()` returns only the root→leaf path.
- Whole-session `/fork` (`SessionManager.fork()`) copies every entry to the new file and emits `session_switch` with `reason: "fork"`. `AgentSession.branch()`, `fork(entryId)` and `/btw` promotion call `createBranchedSession(leaf)` (or `newSession({parentSession})` for a root prompt), which copies only the root→leaf path, then emit `session_branch` with `reason` `"branch"`, `"fork"` or `"btw"`. `/new` and resume emit `session_switch` with `reason` `"new"` / `"resume"`.
- `ctx.ui.setStatus(key, text)` sets a footer status; `undefined` clears it. `ctx.ui.editor(title, prefill?)` resolves to the submitted text, or `undefined` when cancelled or when there is no UI. Both are no-ops/defaults under `--no-ui`.
- Command handlers get the full `ExtensionContext` (`sessionManager`, `ui`, `hasUI`), not only `ui`.

## Goals / Non-Goals

**Goals:**

- One source of truth for a Conversation's Pins: its Journal.
- The Assembler stays pure (ADR-0003): Pins arrive as input, like recalled Turns.

**Non-Goals:**

- An agent-facing tool for Pins. Pins are the user's words only.
- Editing a Pin in place. Unpin and pin again.
- A widget rendering Pin text above the editor. `/pins` prints it; the status says it exists.
- Persisting `/pack budget pins…` across sessions. Same rule as every Budget: environment for defaults, command for the session.

## Decisions

1. **Event log with snapshots, replayed over the whole file.** Entry type `pi-chart.pin`, `data` one of:
   - `{ op: "add", id, text }`
   - `{ op: "remove", ids }` (`/pins rm all` lists every held id)
   - `{ op: "snapshot", pins: [{id, text}], nextId }`

   `replayPins(entries)` folds `getEntries()` in insertion order: a snapshot replaces state, `add` appends, `remove` deletes. `nextId` is one past the highest id any `add` or snapshot has seen, so ids never repeat. Malformed `data` is skipped, not thrown on: a hand-edited Journal must not break assembly. Whole-file rather than `getBranch()`, so a Pin added after the entry `/tree` returns to still holds (ADR-0009). Alternative: one snapshot entry per change and read the latest. Rejected: it's equally simple to replay, and the add/remove log keeps the Journal readable as a history of what the user pinned.

2. **Inheritance writes a snapshot only when the new file disagrees.** pi-chart keeps the last replayed state in memory, `held`. On `session_branch`, any reason: replay the new file. If that differs from `held`, append a snapshot of `held`. A whole-session fork copies the entries, so it replays equal and nothing is written. On `session_switch` with `"new"` or `"resume"`: replay only, with no carry, so unrelated Conversations start clean. A `"fork"` switch replays and writes nothing. Alternative: carrying on every switch. Rejected because a resume of an unrelated Conversation would inherit.

3. **Replay per Call, not cached across Calls.** `context` replays `getEntries()` before assembling. That is a linear scan of a list already in memory and needs no extra I/O, and it means the Pack can't carry a Pin the user just removed through some path pi-chart missed. `held` is updated from that replay too.

4. **Pins are assembler input; the part is irreducible.** `AssembleInput.pins: Pin[]` and `AssemblerConfig.pins: Budget`. `assemble` pushes a `pinned` part after `verbatim-tail` and before `current-turn`, so `compose` puts the Pins after the rest of the tail and right before the Turn in progress. The leading run is unaffected, because Pins never come out of the tail. The part is left out of `REDUCTION_ORDER` and out of the `reduceToCeiling` selectors, so the ceiling can't touch it, and its tokens count in `others` when the current Turn is elided. Each Pin renders as one user-role message `[pinned by the user: #<id>, <i> of <n>]\n<text>`, marked `cmPinned: true` like `cmCurated`. Part fields: `pinIds`, `carried = pins.length`, `candidates = pins.length`, `budget = config.pins`, `unranked: true`, `absent: "none"` when there are no Pins. A part over its token Budget gets the existing "over its N-token budget, irreducible" line in `report.ts` without new code.

5. **The Budget binds at `/pins add`, measured as the Pack will measure it.** A Pin's size is `approximateTokens` of its rendered message, header included, so `/pins` totals and the Pack's part size agree. `/pins add` refuses when `held.length + 1 > pins.count` or when `sum + size > pins.tokens`, naming the Budget, what is spent, and the excess. Defaults: `DEFAULT_PIN_COUNT = 8` and `DEFAULT_PIN_TOKENS = 2_000`, from `PICHART_PINS` and `PICHART_PINS_TOKENS`. Under the 300,000 default ceiling, 2,000 tokens of standing instruction is noise. Above roughly that size, the text is a document and belongs in the Doc Store. Budget names `pins` and `pins-tokens` join `BUDGET_FIELDS`, following `docs` / `docs-tokens`.

6. **Status key `pi-chart.pins`.** Text `pinned: <n> (~<tokens> tok)`, with ` — not sent` appended while the last `context` handler failed (`governing === false`). Cleared with `undefined` when there are no Pins. It is refreshed in `session_start`, `session_switch`, `session_branch`, `session_tree`, `/pins add`, `/pins rm`, and at the end of each `context` handler, so a recovered Call clears "not sent". The `ui` captured per handler is used, as everywhere else in `extension.ts`.

7. **Commands: one, `/pins`, with verbs.** omp 18.8.6 has a built-in `/pin` (pin a session at the top of the resume list), and a built-in wins over an extension command of the same name, so `/pin` would never reach pi-chart. `/pins` is free, and verbs under it follow `/pack`'s shape. The verb is the first word; the rest after `add` is kept verbatim, line breaks included. An unknown verb changes nothing and names the verbs.
   - `/pins add [text]`: with no text, opens `ui.editor("Pin text")`. Empty or whitespace input is refused with a hint to use `/pins add <text>`. Over-Budget input is refused. Otherwise it appends `add` and reports the id, the size, and the total against the Budget.
   - `/pins rm <id|#id|all>`: an unknown id is refused, listing the held ids.
   - `/pins`: prints each Pin as `#id  ~N tokens`, then its text, then the total against both Budgets. When there are none, it says `no pins in this conversation`.

   Output goes through `ui.notify`, or `deps.show` when there is no UI, the same channel as `/pack`.

8. **Accounting carries ids, never text.** `RecordedPart.pinIds?: number[]` and `PartView.pinIds`, with diff items keyed `pinned:#<id>`. `Pack.budgets` gains `pins`. Older rows lack the field and read as no `pinned` part (ADR-0002: no migration, JSONB).

## Risks / Trade-offs

- [`/pins add` while a Turn is streaming appends a custom entry between a tool call and its result in the tree] → Custom entries are ignored by `buildSessionContext` and by every pi-chart Journal reader, and the result still chains through `parentId`. A test with an entry between a call and its result covers `readJournal`.
- [A Pin removed in a parent after a fork stays in the child] → Intended: after the fork the two Conversations hold their Pins independently (spec "A fork's pins are its own").
- [The harness renames `appendEntry`, `getEntries` or the event reasons] → They are declared once in `src/harness.ts`. A missing `getEntries` degrades to no Pins plus one warning, and assembly does not fail.
- [The status line is invisible under `--no-ui` or in RPC without UI] → `/pins` is the fallback, and the spec states it.

## Testing seams

- `src/pins.ts`, pure, tested in `test/pins.test.ts`: `replayPins` (add/remove/snapshot ordering, ids never reused after remove, malformed data skipped), `admit` (count and token refusals with the excess, and acceptance exactly at the Budget), `renderPin`.
- `assemble` in `test/assembler.test.ts`: Pins come after the tail and before the current Turn. The ceiling reduces every other part and never a Pin, and the current Turn is elided around Pins. Over-Budget Pins are all carried with the Budget reported. No Pins gives messages identical to the pre-change Pack.
- `register` through the `harness()` seam in `test/extension.test.ts`, extended with a fake `sessionManager` whose `getEntries()` returns an array `pi.appendEntry` pushes to, and a `ui` recording `setStatus` and answering `editor`. Cases: `/pins add` → `context` Pack carries the Pin. `/pins rm` → not carried. `session_branch` onto a path-only copy → a snapshot is appended and ids are kept. `session_switch` `"new"` → no Pins and status cleared. Failed assembly → ` — not sent`.
- `inspectCall` / `comparePacks` / `renderCall` in `test/inspection.test.ts`: the `pinned` part lists ids, and diffs report entering/leaving by id. An old record with no `pinIds` gives no pinned part.
- Smoke in a real `omp` session, not a test: `/pins add`, a prompt, `/pack` shows `pinned`, the footer shows the status, `/fork` then `/pins` lists the Pin, and `/new` then `/pins` lists none.
