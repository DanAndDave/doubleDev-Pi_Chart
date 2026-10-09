## 1. Harness surface and configuration

- [x] 1.1 Declare in `src/harness.ts`: `ExtensionAPI.appendEntry`; `sessionManager.getEntries`; `ui.setStatus` and `ui.editor` on `HandlerContext` and `CommandContext`; `sessionManager` and `hasUI` on `CommandContext`; `session_switch` and `session_branch` events with `reason` and `previousSessionFile`; `customType`/`data` on `BranchEntry`. Verify with `bunx tsc --noEmit`
- [x] 1.2 Add `pinCount`/`pinTokens` to `Config` (`PICHART_PINS`, `PICHART_PINS_TOKENS`, both added to `SETTINGS`, defaults 8 and 2,000), `pins` to `AssemblerConfig` via `assemblerConfig`, and `pins`/`pins-tokens` to `BUDGET_FIELDS` and the `setBudget` error text and `/pack` usage. Verify with a `setBudget` case for `pins-tokens` beside the existing ones in `test/inspection.test.ts`

## 2. Pin model

- [x] 2.1 Create `src/pins.ts` with `Pin`, `replayPins(entries)` (add/remove/snapshot fold, `nextId`, malformed data skipped), `renderPin(pin, index, total)` (`[pinned by the user: #id, i of n]` + text, `cmPinned: true`), `pinTokens`, and `admit(held, text, budget)` returning the accepted size or a refusal naming the Budget, the spend and the excess. Verify with `test/pins.test.ts` written red-first: ids not reused after remove, snapshot replaces, refusal at count+1 and at tokens+1, acceptance exactly at the Budget

## 3. Assembly

- [x] 3.1 Add `"pinned"` to `PackSource` and `pinIds` to `PackPart`. `assemble` takes `input.pins` and pushes the `pinned` part between `verbatim-tail` and `current-turn`. It stays out of `REDUCTION_ORDER`. Add `pins` to `Pack.budgets`. Verify with `test/assembler.test.ts`: order, the ceiling reduces every other part and never a Pin, current-Turn elision accounts for Pins, over-Budget Pins are all carried and reported, and no Pins gives messages equal to the pre-change Pack

## 4. Accounting and inspection

- [x] 4.1 Carry `pinIds` through `RecordedPart`/`recordPart`, `PartView`/`viewPart`, the `comparePacks` items (`pinned:#id`) and `renderCall`/`renderDiff` (`pins #1, #3`). Verify in `test/inspection.test.ts`: the pinned part lists ids, the diff shows entering/leaving by id, and an old record without `pinIds` reads with no pinned part

## 5. Extension wiring

- [x] 5.1 Extend the `harness()` seam in `test/extension.test.ts` with a fake `sessionManager` (`getEntries` backed by the array `appendEntry` writes to) and a `ui` that records `setStatus` and answers `editor`. Write the cases from design.md § Testing seams red first
- [x] 5.2 In `src/extension.ts`: replay Pins in `context` and pass them to `assemble`. Register `/pins` with `add` and `rm` verbs (design decision 7). Handle `session_switch` and `session_branch` (decision 2) and refresh the status in every handler named in decision 6, including ` — not sent` when assembly fails. Verify that 5.1 passes
- [x] 5.3 Run the full suite (`bun test`) and `bunx tsc --noEmit`; both pass

## 6. Docs and smoke

- [x] 6.1 Update `README.md`: add `PICHART_PINS`/`PICHART_PINS_TOKENS` to the settings table, add a `/pins`, `/pins add`, `/pins rm` section, and add `pins`/`pins-tokens` to the `/pack budget` list. Verify by reading the rendered section
- [x] 6.2 Smoke in a real `omp` session with pi-chart loaded: `/pins add` text, a prompt, then confirm `/pack` lists `pinned #1` and the footer shows `pinned: 1`. Then `/fork` → `/pins` lists #1, `/pins rm 1` in the fork leaves the parent's Pin on resume, and `/new` → `/pins` reports none
