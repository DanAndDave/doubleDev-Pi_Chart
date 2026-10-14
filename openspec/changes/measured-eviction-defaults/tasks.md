## 1. Sweep and decide (before any `src/` change)

- [x] 1.1 Record the commit hash. On that commit, run all 9 cells of design.md decisions 1–2, one at a time:
  `PICHART_TAIL_TOKENS=<t> PICHART_TAIL_TURNS=<n> PICHART_TAIL_LOW_WATER=<w> bun scripts/bench-tokens.ts --arm pi-chart --runs 3 --parallel 3 --out docs/benchmarks/<date>-eviction-defaults-<t>-<w>.json`
  - `<t>/<n>` takes each of 25000/8, 40000/13 and 60000/19;
  - `<w>` takes each of 0.2, 0.4 and 0.6.
  Rerun a cell that has a failed run.
  Verify: 9 files exist. `--report` on each prints `complete runs: vanilla 0, pi-chart 3` and the probe lines.
- [x] 1.2 Apply design.md decision 4 exactly as written. Record the eligible cells, the minimum, the tied set and the chosen cell. Verify: the choice follows from the 9 `--report` outputs with no judgment call.
- [x] 1.3 Reconcile the plan with the outcome:
  - mark 0.4: nothing to change;
  - another mark: update the delta's default and the "The default mark" scenario (mark × 25,000) with `/opsx-update`;
  - 25000/8 at 0.6, the current defaults: remove the delta, set `skip_specs: true`, drop tasks 2.2–2.3 and 3.1–3.3, and keep the write-up.
  Verify: `openspec validate measured-eviction-defaults --strict` is clean.
- [x] 1.4 Write up `docs/benchmarks/<date>-eviction-defaults.md`, plus an SVG, in the 2026-10-14 format. It covers:
  - one row per cell: cost, uncached input, cache read, cache write, output, peak window, `read` calls per Conversation (from each run's Journal), codeword and build number;
  - the rule as applied, and the chosen cell;
  - the method, with the commit, commands and raw files;
  - the Turn-size inference from design.md Context, stated as an inference.
  Verify: `--report` on each cell's file reproduces its row.

## 2. Tests and defaults

- [x] 2.1 In `test/assembler.test.ts`, make the eviction tests that rely on the fixture's default mark pass `tailLowWater: 0.6` explicitly. These are the tests around the "default mark of 15,000" comment and the count-mark test. Reword their comments to name the mark. Verify: `bun test test/assembler.test.ts` passes, unchanged in outcome.
- [x] 2.2 Red, these cases fail against the current constants:
  - `test/assembler.test.ts`: "The default mark", through `assemblerConfig(loadConfig({PICHART_TAIL_TOKENS: "25000"}))`. A Turn carries the tail past 25,000 and the tail ends at or under the chosen mark × 25,000. Use Turn sizes whose result differs between 0.6 and the chosen mark;
  - `test/extension.test.ts`: the low-water default block expects the chosen mark, including the out-of-range fallbacks. Rename "defaults to the middle of the measured range" to describe the measured choice.
  Verify: both fail.
- [x] 2.3 Green: in `src/config.ts`, set `DEFAULT_TAIL_TOKENS`, `DEFAULT_TAIL_TURNS` and `DEFAULT_TAIL_LOW_WATER` to the chosen cell. Rewrite the comment on the mark, and add one on the two Budgets, citing the write-up instead of the 2026-10-13 benchmark. Verify: `bun test test/assembler.test.ts test/extension.test.ts` passes.

## 3. Docs

- [x] 3.1 `README.md` settings table: the defaults for `PICHART_TAIL_TURNS`, `PICHART_TAIL_TOKENS` and `PICHART_TAIL_LOW_WATER`. Recompute "leaves at most N tokens and M Turns of the defaults", and replace the 2026-10-13 sentence with the new write-up and the workload it measured. Verify: each number in those rows matches `src/config.ts`.
- [x] 3.2 `docs/adr/0013-…`: add a dated amendment paragraph under the existing "Partly superseded" note. It gives the new defaults and links the write-up. The body is left as history. Verify: the note names all three values.
- [x] 3.3 `scripts/bench-tokens.ts` header comment: name the new default tail, and say when turn 3 leaves it under the new defaults, read from the chosen cell's window table. Verify: `bun run typecheck` is clean.

## 4. Close

- [x] 4.1 Run `bun run typecheck`, the full `bun test` and `openspec validate measured-eviction-defaults --strict`. Verify: all clean.
- [x] 4.2 Smoke in a real omp session with pi-chart and no `PICHART_TAIL_*` set. Verify: `/pack` shows the tail's Budget as the new token and count defaults. After the tail first fills, the next `/pack` shows a tail at or under the chosen mark of both Budgets.
