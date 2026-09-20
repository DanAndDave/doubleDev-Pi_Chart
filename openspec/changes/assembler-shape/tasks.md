## 1. The baseline that makes this safe

- [ ] 1.1 Assemble a Pack from every Journal under the harness's session root at the shipped defaults, serialise each with its parts and accounting fields, and store the set as the baseline
- [ ] 1.2 Verify the baseline reproduces: assemble twice with no code changed and confirm the two sets are byte-identical, so a later diff means the refactor and not the harness
- [ ] 1.3 Include at least one Journal whose tail is reduced, one whose current Turn is elided, and one whose Pack fits without the ceiling binding, so every path is represented

## 2. Budget as one value

- [ ] 2.1 Introduce `Budget { count, tokens }` and carry four of them on `AssemblerConfig`, leaving `packTokens` separate because a Ceiling has no count dimension
- [ ] 2.2 Convert `Config`'s flat settings to `AssemblerConfig`'s Budgets in one place in `extension.ts`, and verify the nine-line restatement becomes four Budget literals
- [ ] 2.3 Carry `budget?: Budget` on `PackPart`, `RecordedPart` and `PartView` in place of the `budget`/`tokenBudget` pair
- [ ] 2.4 Read both shapes in `inspectCall`/`viewPart`, preferring the new, and verify a row written in the old shape still renders its count and token Budgets
- [ ] 2.5 Verify the baseline is unchanged

## 3. One selection rule

- [ ] 3.1 Replace `Fitted<T>` and `Refit` with one `Selected` carrying the identities every consumer already wanted, and verify no caller reaches for a `kept` list
- [ ] 3.2 Build one selector per part in `assemble()` and call it with the part's own Budget, deleting the parallel `fit(...)` calls
- [ ] 3.3 Call the same selector from the ceiling pass with the remaining room, deleting the four refit closures
- [ ] 3.4 Give `fitTail` its count Budget through the same path and let it compute its own `excludedByCount`, and verify `assemble()` no longer patches it from outside
- [ ] 3.5 Verify a ceiling-reduced tail reports the same count exclusion as a Budget-trimmed one
- [ ] 3.6 Verify the baseline is unchanged

## 4. Elision in its own module

- [ ] 4.0 `src/elision.ts` now exists: `recall-fidelity` created it to share the marker between the Assembler and the embed text, exporting `ELISION`, `ELIDED_WHOLE` and `elide(text, half, removed, withoutDetails): string`. This group is therefore a rename and a merge, not a move — reconcile the two contracts and verify the embed text's caller still marks a gap identically
- [ ] 4.1 Move the rest of the elision family into it, exporting `elide(message, allowance)` and `elideTurn(messages, allowance)` and keeping `shortenText`, `shortenPayloads`, `payloadCost` and both floors private, without breaking the text-level `elide` the embed text calls
- [ ] 4.2 Verify `src/assembler.ts` no longer imports `ContentBlock` or `ToolCallBlock`
- [ ] 4.3 Move the shortening tests to `test/elision.test.ts` with their assertions untouched, and verify none needed editing to pass
- [ ] 4.4 Verify the baseline is unchanged, embed text included — `embedFingerprint` is derived from the composed text, so a marker that shifts by one character re-embeds the whole corpus

## 5. Verification

- [ ] 5.1 Confirm the final baseline comparison is byte-identical across every captured Journal, and delete the baseline script — its value expires with the change
- [ ] 5.2 Confirm no test file changed except the moved shortening tests and the added old-shape Accounting test
- [ ] 5.3 Run the default, store-backed and live suites and the type checker, and confirm `openspec validate assembler-shape` passes
- [ ] 5.4 Confirm `src/assembler.ts` is shorter by roughly the elision family and that its remaining contents are selection and ceiling reduction only
