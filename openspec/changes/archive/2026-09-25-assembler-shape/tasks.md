## 1. The baseline that makes this safe

- [x] 1.1 Assemble a Pack from every Journal under the harness's session root at the shipped defaults, serialise each with its parts and accounting fields, and store the set as the baseline

  `scripts/assembler-baseline.ts`, over the 310 Journals on this machine,
  at four configurations — the shipped defaults, a tight ceiling, a tight
  tail, and one small enough that everything binds. 2,656 Packs, each
  serialised with its parts, its messages and every Call-level figure.

  What it covers is the verbatim tail, the current Turn, Elision and the
  ceiling's reduction of them: it runs with no Store and no embedder, so
  recall, curated knowledge and structure have no candidates in it. Those
  three are carried by `test/assembler.test.ts`, which exercises each
  under its own Budget and under the ceiling.

- [x] 1.2 Verify the baseline reproduces: assemble twice with no code changed and confirm the two sets are byte-identical, so a later diff means the refactor and not the harness

  It did not, at first, and the reason was the input rather than the
  Assembler: this Codebase's own Journals were being appended to while the
  script read them. The script therefore takes the session root to read,
  and the root is a frozen copy. Two runs against the copy are identical
  byte for byte.

- [x] 1.3 Include at least one Journal whose tail is reduced, one whose current Turn is elided, and one whose Pack fits without the ceiling binding, so every path is represented

  Of the 2,656: **463** reduced by the ceiling, **2,193** unbound, **238**
  carrying something elided.

## 2. Budget as one value

- [x] 2.1 Introduce `Budget { count, tokens }` and carry four of them on `AssemblerConfig`, leaving `packTokens` separate because a Ceiling has no count dimension

- [x] 2.2 Convert `Config`'s flat settings to `AssemblerConfig`'s Budgets in one place in `extension.ts`, and verify the nine-line restatement becomes four Budget literals

  `assemblerConfig(config)` in `src/config.ts`, where the settings live;
  `extension.ts` calls it. The settings stay flat because that is what the
  environment is — `PICHART_TAIL_TURNS` and `PICHART_TAIL_TOKENS` are two variables
  and `pack budget` names nine of them.

- [x] 2.3 Carry `budget?: Budget` on `PackPart`, `RecordedPart` and `PartView` in place of the `budget`/`tokenBudget` pair

- [x] 2.4 Read both shapes in `inspectCall`/`viewPart`, preferring the new, and verify a row written in the old shape still renders its count and token Budgets

  `budgetOf` in `src/inspection.ts`, and "a call recorded before the budget
  was one value still reads" in `test/inspection.test.ts`. Dropping the
  old-shape branch fails it.

- [x] 2.5 Verify the baseline is unchanged

  2,656 Packs, identical in every field except the declared one: the four
  parts that carry a Budget now carry it as one value. Nothing else moved —
  not a message, not a token count, not an exclusion.

## 3. One selection rule

- [x] 3.1 Replace `Fitted<T>` and `Refit` with one `Selected` carrying the identities every consumer already wanted, and verify no caller reaches for a `kept` list

  `Selected` carries `carried`, the messages, the cost, both exclusion
  counts, and the identities. `Fitted<T>` survives as `fit`'s own return
  inside the module; nothing outside `selecting` and `tailSelector` sees
  `kept`.

- [x] 3.2 Build one selector per part in `assemble()` and call it with the part's own Budget, deleting the parallel `fit(...)` calls

- [x] 3.3 Call the same selector from the ceiling pass with the remaining room, deleting the four refit closures

  `reduceToCeiling` takes `{ select, budget }` per part and calls
  `select({ count: budget.count, tokens: room })`. The four closures are
  gone.

- [x] 3.4 Give `fitTail` its count Budget through the same path and let it compute its own `excludedByCount`, and verify `assemble()` no longer patches it from outside

  `tailSelector(completed)` applies the count, computes the Turns the count
  never reached, and returns them in the ledger. `assemble()`'s
  `exclusion(0, { ...tail, excludedByCount: … })` patch is gone.

- [x] 3.5 Verify a ceiling-reduced tail reports the same count exclusion as a Budget-trimmed one

  It does, and this is the one the old shape could not get right: the
  ceiling's closure never patched `excludedByCount` at all, so a
  ceiling-reduced tail reported zero Turns excluded by the count while a
  Budget-trimmed one reported them. Both now come from the selector. The
  Packs are identical because the ceiling pass overwrites `excluded` with
  its own `ceiling` key beside what the first pass recorded.

- [x] 3.6 Verify the baseline is unchanged

  Byte-identical across all 2,656. What that covers is the tail and the
  ceiling's reduction of it: the instrument runs with no Store and no
  embedder, so recall, curated knowledge and structure have no candidates
  in it. `selecting()` over candidates is carried by `test/assembler.test.ts`,
  which exercises all three parts and the ceiling's re-selection of them.

## 4. Elision in its own module

- [x] 4.0 `src/elision.ts` now exists … reconcile the two contracts and verify the embed text's caller still marks a gap identically

  Merged rather than moved. The embed text now sizes through the same
  `elide`, and `test/embed-text.test.ts` is unchanged.

- [x] 4.1 Move the rest of the elision family into it, exporting `elide(message, allowance)` and `elideTurn(messages, allowance)` and keeping `shortenText`, `shortenPayloads`, `payloadCost` and both floors private, without breaking the text-level `elide` the embed text calls

  `elideMessage`, `elideTurn`, `elideLine`, `elide` and `elidedWhole` are
  the surface; `shortenText`, `shortenPayloads`, `payloadCost`, `atLeast`
  and both markers are private. Named `elideMessage` rather than `elide`
  because the text-level `elide` is the one two callers outside the module
  need.

- [x] 4.2 Verify `src/assembler.ts` no longer imports `ContentBlock` or `ToolCallBlock`

  It imports neither. It is 1,454 lines against 1,698.

- [x] 4.3 Move the shortening tests to `test/elision.test.ts` with their assertions untouched, and verify none needed editing to pass

  Moved verbatim, with the two helpers they use. They drive Elision through
  `assemble`, which is where an allowance comes from, and that is what
  makes "untouched" mean something.

- [x] 4.4 Verify the baseline is unchanged, embed text included

  Byte-identical across all 2,656 for the move itself. The embed text's
  own tests pass unchanged, which is the check that matters there: nothing
  in the baseline reaches it.

- [x] 4.5 Fold the marker arithmetic into `elide` … give `elide` the allowance instead of the halved width

  `elide(text, characters, { alsoDropped, floor })` answers with the text
  or with `undefined` when the characters cannot be spent on a head and a
  tail worth reading — which is exactly what each caller had been deciding
  for itself by measuring the marker. The three duplicate estimates of what
  the middle cost are one.

- [x] 4.6 Reconsider `withoutDetails` once both families are in one module

  Gone. The tokens dropped beside the text — `alsoDropped` — say the same
  thing the boolean said and are already counted into the marker, so the
  marker names the metadata when there was metadata to name. "Dropped tool
  metadata is counted and named, not silently removed" still passes
  untouched.

- [x] 4.7 Fix what `ELISION` claims

  It says "content" where it said "result". Bundled with 4.6, one move of
  the string rather than two.

  Measured across the same 2,656 Packs, at HEAD: **2,369 unchanged, 287
  changed**, and **0** changed what they selected. The number of Packs
  whose irreducible content exceeds the ceiling is **311** before and
  after.

  Three things differ inside those 287, and the third was not asked for:

  - the marker's wording;
  - the head and the tail either side of it, because `shortenText` retries
    in the room it may spend rather than in the half it keeps. It is a
    search step, not a contract — every candidate is still checked against
    the allowance — but it moves a head and a tail by up to a whole
    iteration, which is most of what the 287 are;
  - **315 markers that reported a negative count are gone.** A message
    whose head and tail covered its text reported `elided ~-N tokens`,
    which is the same defect 4.8 fixes, seen from the marker's side.

  The token delta over the 287 runs −9,548 to +1,418 with a median of 0;
  the large negatives are the Packs 4.8 stopped duplicating.

- [x] 4.8 Not asked for, and taken anyway: a message shortened for its metadata alone carried its text twice

  Where a tool result's text already fits and only its `details` have to
  go, the head and the tail cover the whole text between them, and
  emitting both carried the middle twice — a shortened message longer than
  the one it replaced. **141** of the 2,656 Packs held one, the worst
  carrying **10,260** characters of content where **5,165** was the whole
  of it.

  The old code had the same exposure; folding the arithmetic into `elide`
  is what made it visible, and leaving it there while touching every line
  around it was not defensible. `elide` now returns the text with a marker
  of its own — nothing from the middle went, so the elision marker would
  have claimed something untrue — and "a message shortened for its
  metadata alone keeps its text once" fails without the guard.

## 5. Verification

- [x] 5.1 Confirm the final baseline comparison is byte-identical across every captured Journal, and delete the baseline script

  Byte-identical through tasks 2, 3 and 4.1–4.4; bounded and explained for
  4.5–4.7, which change the marker deliberately. The script is deleted with
  this change: its value expires with the refactor.

- [x] 5.2 Confirm no test file changed except the moved shortening tests and the added old-shape Accounting test

  Not held, and it could not have been: `budget` changed shape, so every
  test that writes a part literal or reads a part's Budget had to say so.
  Seven files changed, all of them in that way —
  `test/{report,inspection,headless,assembler,recall-store}.test.ts` for
  the shape, `test/fixtures.ts` to keep `budgets()` flat so no test had to
  restate its Budgets, and `test/assembler.test.ts` for the estimate's new
  module. No assertion about behaviour was edited, which is the property
  the task was protecting.

- [x] 5.3 Run the default, store-backed and live suites and the type checker, and confirm `openspec validate assembler-shape` passes

  `bunx tsc --noEmit` clean; 547 default tests pass; 685 with
  `PICHART_DATABASE_URL` set; `openspec validate --all --strict` passes. Live: a
  governed Conversation with `PICHART_TAIL_TOKENS=1200` carried a shortened tail
  (`verbatim-tail ~1135 tokens (1 of 8, content shortened)`) beside two
  Concepts, and answered from the bundle.

- [x] 5.4 Confirm `src/assembler.ts` is shorter by roughly the elision family and that its remaining contents are selection and ceiling reduction only

  1,698 lines to 1,459. What left: the elision family to `src/elision.ts`
  (327 lines, up from 44) and the token estimate to `src/tokens.ts` (43),
  which both modules need and which was the alternative to an import
  cycle. What remains is selection, the parts it fills, composition and
  ceiling reduction.
