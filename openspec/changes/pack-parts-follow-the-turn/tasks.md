## 1. Store invariant first

- [ ] 1.1 In `test/postgres-store.test.ts`, ingest a Turn whose assistant `toolCall.arguments` keys are in non-sorted order (e.g. `{ "path", "i", "offset" }`), read it back with `recentTurns`, and assert `JSON.stringify` of each message equals the original exactly; verify it passes today (it pins the existing string storage) with `bun test test/postgres-store.test.ts`

## 2. New order in the Assembler (tdd at `assemble`)

- [ ] 2.1 Red: in `test/assembler.test.ts`, add tests for the new requirement's scenarios: tail then current Turn then block; block order recall → curated → structure → pins; opening line first in the block and identical across inputs; no assembled content means tail + current Turn and no line; Pins alone still get the line; two assemblies differing only in structure share a deep-equal head through the current Turn; same parts and accounting as before, only the order differs. Verify they fail with `bun test test/assembler.test.ts`
- [ ] 2.2 Green: rewrite `compose` in `src/assembler.ts` as the fixed partition from design.md, adding the opening-line constant; delete `leadingRun`, `sameMessage` and `AssembleInput.supplied`; set `leadingTokens` to the size of tail + current Turn; update the comments on part order and on Pins (lines ~360, ~403, ~442, ~505) and the `Pack.leadingTokens` and `approximateTokens` docs. Verify the 2.1 tests pass
- [ ] 2.3 Red then green: ceiling headroom. A test where assembled parts push the Pack over its ceiling asserts `approximateTokens` (opening line included) ≤ ceiling, and a test with no assembled content asserts ceiling arithmetic is unchanged. Implement the reservation in `assemble` around `reduceToCeiling` and add the line to `approximateTokens` and `beforeCeiling` when carried. Verify with `bun test test/assembler.test.ts`
- [ ] 2.4 Delete the assembler tests that pin the leading run ("the harness's own messages lead…", "a tail that starts later … leads with nothing", "the run never ends between a tool call and its result", "the run hands back the harness's own objects…", "a pack that leads with nothing says so") and fix any remaining test that passed `supplied`; verify `bun test test/assembler.test.ts` is green

## 3. Extension and reporting

- [ ] 3.1 In `src/extension.ts`, stop passing `supplied` to `deps.assemble`; rewrite "a pack leads with the messages the harness sent, then the retrieval" in `test/extension.test.ts` to assert the new order, and add an assertion that the returned current-Turn messages are the very objects from `event.messages` (`toBe`). Verify with `bun test test/extension.test.ts`
- [ ] 3.2 In `src/report.ts`, render `prefix ~N tokens the harness sent, ahead of the assembled parts`; update `test/report.test.ts` to the new wording and check `test/postgres-store.test.ts`'s `leadingTokens` round trip still holds. Verify with `bun test test/report.test.ts test/postgres-store.test.ts`
- [ ] 3.3 Run `bun run typecheck` and the full suite `bun test` once; both green

## 4. Docs

- [ ] 4.1 README.md: change the Pin placement sentence (line ~342) to "after the Turn in progress, last in the Pack" and the `prefix` bullet (line ~365) to the new meaning, citing ADR-0010; verify by reading the two passages

## 5. Measure (acceptance, before archive)

- [ ] 5.1 Add the *prefix held* figure to `scripts/bench-tokens.ts` as design.md defines it (turns 1–7, `cacheRead(n+1) ≥ cacheRead(n) + cacheWrite(n)`); verify with `bun scripts/bench-tokens.ts --report docs/benchmarks/2026-10-13-token-usage.json`, which should print the baseline's figure for both arms
- [ ] 5.2 Run `bun scripts/bench-tokens.ts --runs 3` and write `docs/benchmarks/<date>-token-usage.md` (+ json, svg) beside the 2026-10-13 one. Pass: pi-chart prefix held ≥ 90%, and median cache write over turns 1–7 ≤ 1.25× vanilla in the same run. Report cost per Conversation against $1.86 (2026-10-13) and $1.28 (replay model)
- [ ] 5.3 Quality comparison per design.md: old order from a worktree at the base commit, new order from the change, two Conversations × four prompts per arm (earlier-Turn recall, a tool result immediately before the block, a Pin-governed prompt). Record the prompts, answers and blind judgement in `openspec/changes/pack-parts-follow-the-turn/evidence/quality.md`. Pass: no substantive regression
- [ ] 5.4 Add the measured figures to ADR-0010 under a "What it measures" section; verify the ADR cites the new benchmark document and `evidence/quality.md`
