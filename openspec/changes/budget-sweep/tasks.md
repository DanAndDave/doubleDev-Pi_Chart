## 1. Runs carry their Budgets

- [ ] 1.1 `scripts/runs.ts`: export `BUDGET_VARIABLES` (the nine tunable names). Add `RunSpec.budgets?: Record<string, string>`, set on the child's env after `process.env`. Record `RunRecord.budgets` (`scripts/measures.ts`) as every tunable variable present in that env, omitted when there are none (design decision 2). Verify: `bun run typecheck`. The behaviour is smoked in 5.2.

## 2. The Gate's statistics, shared

- [ ] 2.1 `scripts/gate.ts`: export `measureTest`, `costDiff` and `lapseDiff`. `decide` takes a required `margin`, recorded on `Decision`; `nonInferior`'s doc comment says "at `margin`". `main` passes `MARGIN`. `Batch.kind` gains `"confirm"`, and `Batch` gains an optional `budgets: { base, candidate }` (design decisions 5 and 7). Verify: the existing `decide` tests pass `MARGIN` and stay green. A new red-then-green case shows an upper ratio bound of 1.04 is non-inferior at 1.1 and not at 1.
- [ ] 2.2 `gate.ts main`: refuse a Workload whose name ends in `-holdout` unless `--aa` is given, before the pool check or any build (design decision 9). Verify: smoke in 5.1.

## 3. The sweep's pure core (`scripts/sweep.ts`, TDD at the design's seams)

- [ ] 3.1 Red, then green: `cellsOf(grid, defaults)` and `shellBudgets(env)`. Defaults come from `loadConfig({})` through a variable → `Config` field table, and "read as given" is checked through `loadConfig` (design decision 3). Verify: every `cellsOf` and `shellBudgets` row of the testing-seams table.
- [ ] 3.2 Red, then green: `roundRobin(cells, runs)` and `runCapped({ jobs, width, cap })`. Verify: the rotation, the cap at $120.30, the width bound, and a throwing job letting in-flight jobs finish before rejecting.
- [ ] 3.3 Red, then green: `screen({ cells, runs, history, key })`, covering eligibility, best, ties and winner (design decisions 5 and 6). Verify: every `screen` row of the testing-seams table, including the spec's scenarios: p = 0.03 out; `render` 3/3 vs 1/3 out; 3/3 vs 2/3 in; the default wins a [0.86, 1.03] tie; (40000, 0.2) beats (60000, 0.4).
- [ ] 3.4 Red, then green: `confirm({ …, runPair })` over `gatherPairs` and `decide(margin 1)`, with the outcome and reason mapping (design decision 7). Verify: every `confirm` row of the testing-seams table.

## 4. The sweep command

- [ ] 4.1 `runSweep(argv)` in `scripts/sweep.ts`:
  - the preconditions in design decision 8's order, all before any build;
  - the screen template and screen Runs (pi-chart, `REFERENCE_MODEL`, model check as the Gate does);
  - `sweep.json` after the screen;
  - the held-out template and confirm only when the winner is not the default;
  - the confirm batch appended to the pool;
  - `sweep.json` again after confirm.

  Verify: `bun run typecheck`, then the smoke in 5.1 and 5.2.
- [ ] 4.2 `report(record, measures)` in the shape of design decision 10. At the end of `runSweep`, write `docs/benchmarks/<date>-<slug>.md` and `.json`, refusing to overwrite. In `bench-tokens.ts`:
  - add the `--sweep` dispatch;
  - make `--report <dir>` read `sweep.json` when present;
  - update its header comment, which says a sweep sets cells through the shell.

  Verify: the smoke in 5.2.

## 5. Smoke (spend about $5)

- [ ] 5.1 Refusals, each with its message, with no Run folder and no spend:
  - a grid sweeping three Budgets;
  - `PICHART_DOC_TOKENS=8000` set in the shell;
  - a dirty `src/` (touch a comment, then revert);
  - `--workload gate-holdout`;
  - a temporary pool with no A/A batch for the held-out key, which names the `--aa` command;
  - `gate.ts --workload /tmp/smoke-holdout --base HEAD~1` without `--aa`. `/tmp/smoke-holdout` is a copy of `bench/workloads/smoke` with `name: "smoke-holdout"`.
- [ ] 5.2 End to end, on `--workload smoke --holdout /tmp/smoke-holdout --runs 2 --pool /tmp/sweep-pool.json`:
  - The pool is hand-written per the design's last paragraph.
  - The grid is `PICHART_TAIL_TURNS` over the default and a lower value. If the default still wins, add a second Budget that lowers cost, so confirm runs.

  Verify:
  - `sweep.json` holds cells, Runs, the screen result and the confirm looks;
  - each screen Run's `run.json` names exactly its cell's variables;
  - the temporary pool gained one `confirm` batch;
  - the two `docs/benchmarks/` files exist;
  - `bench-tokens --report <out>` prints the same text and writes nothing.

  Then delete the two `docs/benchmarks/` files and the `/tmp` artifacts. Also check that a plain `bench-tokens --workload smoke --arm pi-chart --runs 1` Run records no `budgets`.

## 6. Held-out Workload `gate-holdout` v1 (design decision 11)

- [ ] 6.1 Draft `bench/workloads/gate-holdout/`:
  - pin `HEAD`;
  - `overlay/notes/` with fictional rules;
  - `workload.json` with 40 prompts over six graded steps and a recap, six Plants and six Revisits in the Gate Workload's bands, and the suffix rules;
  - `checks/<step>.check.ts`, building Concepts through `parseConcept`;
  - `graphify-out/` (`graph.json`, `manifest.json`) and `bundle/.gitkeep`.

  Verify:
  - a throwaway `bun -e` calling `loadWorkload("bench/workloads/gate-holdout")` returns 40 Turns, 6 graded steps, 6 Plants and 6 Revisits with no error;
  - every check fails on an untouched `buildWorkspace` workspace and passes on a throwaway reference solution, which is then deleted;
  - no Plant value equals or contains a `gate` v1 value;
  - `graph.json` has nodes from `src/concept.ts` and none from `bench/`.
- [ ] 6.2 Show the user the draft: the Turn map, every prompt, the notes, the checks, and the Plant and Revisit tables. Apply their changes and re-run the 6.1 verifications. Verify: the user approves before any Run.
- [ ] 6.3 Probe:
  - `bench-tokens --workload gate-holdout --arm pi-chart --runs 1`, twice;
  - `--arm vanilla --runs 1`, once;
  - `measures.ts` over each.

  Verify against the Gate Workload's decision 6 criteria: 40 Turns and all six checks; every Plant and Revisit at its planned Turn and band; the 8–12 and ≥ 25 ones evicted on pi-chart; a mean of at most $4.50 per pi-chart Run. On a miss, revise and probe again, and stop for the user once probe spend reaches $30.
- [ ] 6.4 Freeze: write the README in `gate`'s shape (theme, Turn map, Plant and Revisit tables with measured distances and Positions, probe figures per Arm, authorship caveat, `## Versions`). Verify: every figure matches the 6.3 measures output.

## 7. Close

- [ ] 7.1 Update `CONTEXT.md` only if a term settled here is missing, such as held-out Workload, cell or screen, through `/domain-modeling`. Update `docs/agents/workflow.md` only if the sweep changes a phase. Also update `openspec/changes/context-need-measures/slices.md` line 11 if the delivered slice differs from it. Verify: `bun run typecheck`, the full `bun test` once, and `openspec validate budget-sweep`.
