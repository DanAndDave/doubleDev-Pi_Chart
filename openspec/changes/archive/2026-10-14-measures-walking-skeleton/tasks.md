## 1. Workload format

- [x] 1.1 Red: `test/workload.test.ts` covers `loadWorkload(dir)` on temp folders:
  - a well-formed Workload loads, with the first step graded and the second not;
  - a Probe of an undeclared Plant is rejected, naming the step and the Plant id;
  - an orphan check is rejected, naming it;
  - a missing name, version, commit or steps, duplicate step ids, a step with no prompts, and an unresolvable commit are all reported in one error.
  
  Verify: `bun test test/workload.test.ts` fails because `scripts/workload.ts` does not exist.
- [x] 1.2 Green: `scripts/workload.ts` with the `Workload` type, `loadWorkload` (design decision 1), and `gradedSteps(workload, turns)`, which returns the steps whose last prompt falls within the first `turns` prompts and have a check. Add a `gradedSteps` case where a step is cut short. Verify: `bun test test/workload.test.ts` passes; `bun run typecheck` is clean.
- [x] 1.3 Red, then green: `buildWorkspace(workload, dir)` (design decision 2). The test builds a temp Workload pinned to `c6fe516` twice, with an overlay that replaces `src/tokens.ts` and adds one new file. Expected:
  - the two trees are identical;
  - the overlay wins;
  - there is no `bench/` and no `*.check.ts`.
  
  `installDependencies(dir)` is separate and not unit-tested. Verify: `bun test test/workload.test.ts` passes.

## 2. Measures

- [x] 2.1 Build fixture record folders under `test/fixtures/runs/`, each holding `run.json` and `journal.jsonl`, plus `subagents/0.jsonl` where needed. There are three:
  - **complete:** 3 Turns, main Calls costing $1.00 in total, a subagent costing $0.25, checks Pass, Fail, Fail, and one Probe of two Plants whose reply contains only the first value;
  - **failed-early:** `failedTurn: 1`, its Probe never reached;
  - **ungraded:** no checks.
  
  Write them by hand, in the shape of a real Journal: `session` header, `model_change`, then `message` entries with `usage` and `contextSnapshot`. Verify: `readJournal` from `src/journal.ts` reads each with the expected Turn count (a throwaway check).
- [x] 2.2 Red: `test/measures.test.ts` asserts, for `measureRun(dir)` on those fixtures:
  - a cost of $1.25, with the subagent Calls at turn −1;
  - 1 Pass, with `firstFail` = the second step;
  - Plants scored right for the first and wrong for the second;
  - no Plant scores for failed-early;
  - two calls on the same folder deep-equal.
  
  For `aggregate`, it asserts:
  - Cost per Pass of $8.00 / 6 over Runs of $3.00 / 4 Passes and $5.00 / 2;
  - "no Pass" when a graded Workload's Runs have no Pass;
  - "n/a" for the ungraded Workload;
  - incomplete Runs are excluded and counted;
  - Retention as a share of complete Runs.
  
  Verify: the tests fail because `scripts/measures.ts` does not exist.
- [x] 2.3 Green: `scripts/measures.ts` with `measureRun`, `aggregate` and the `RunMeasures` type (design decision 6). Move `callsIn`, `Totals`, `totals`, `prefixHeld`, `median` and the rates out of `bench-tokens.ts` into it. Assign main-Journal Calls to Turns through `readJournal`. Add the CLI, `bun scripts/measures.ts <run-dir> [--json]`. Verify: `bun test test/measures.test.ts` passes; `bun scripts/measures.ts test/fixtures/runs/complete` prints cost $1.25, 1 Pass and the two Plant scores.

## 3. Runs

- [x] 3.1 Rewrite `runOne` in `scripts/bench-tokens.ts` (design decisions 2–5):
  - build the workspace, then install dependencies;
  - give each Run a bundle copy, and a pi-chart Run its own migrated database;
  - send prompts verbatim, run `gradedSteps`' checks between Turns, and stop at a failed Turn;
  - in `finally`, copy the Journals and export the Accounting, drop the database, remove the workspace, and write `run.json`.
  
  Read `omp --version` once per benchmark. Remove `copyCodebase`, `PROBE`, `CODEWORD`, `BUILD_NUMBER`, `NO_EDITS`, `DEFAULT_WORKLOAD`, the stdout scoring and the `scored` parameter. Verify: `bun build --target=bun scripts/bench-tokens.ts --outdir /tmp/bt-check` succeeds, and `grep -n 'PROBE\|NO_EDITS\|copyCodebase' scripts/bench-tokens.ts` finds nothing.
- [x] 3.2 CLI and report (design decision 7):
  - `--workload <name|path>` and an `--out` directory, with `bench.json` written there holding the options, the omp version and each Run's `run.json` with its `measureRun` result;
  - `--report <dir>`;
  - `report()` reads `aggregate`, prints the existing token and window tables, adds Graded Tasks, Cost per Pass and Retention per Plant, and names the Workload name and version, the model and the omp version.
  
  Rewrite the header comment. Verify: `bun scripts/bench-tokens.ts --report <a fixture bench dir built from test/fixtures/runs>` prints every table without error.

## 4. Workloads

- [x] 4.1 `bench/workloads/read-only-40/` v1 (design decision 8):
  - `workload.json` pinned to the full sha of `c6fe516`. Steps `read` (today's 39 prompts with `NO_EDITS` appended, byte for byte) and `probe` (today's probe text, probing `codeword` and `build`). Plants `codeword` = `TANGERINE-42` and `build` = `7341`.
  - An empty `bundle/`, kept with a `.gitkeep`.
  - A `README.md` holding the rationale moved from the old header comment.
  
  Verify: a throwaway script shows every prompt equal to the old `DEFAULT_WORKLOAD` entry plus `NO_EDITS` (taken from `git show HEAD:scripts/bench-tokens.ts`), and `loadWorkload` accepts the folder.
- [x] 4.2 `bench/workloads/smoke/` v1 (design decision 8):
  - the graded `add-double` step with `checks/add-double.check.ts`;
  - a `probe` step with a read-only prompt and a tools-forbidden Probe of `codeword` = `PLUM-17`;
  - an empty `bundle/`.
  
  Verify: `loadWorkload` accepts it. In a workspace built from it, where `src/smoke.ts` was written by hand, `bun test ./add-double.check.ts` passes, and it fails without that file.

## 5. End to end

- [x] 5.1 Smoke on both Arms: `bun scripts/bench-tokens.ts --workload smoke --runs 1 --out /tmp/bench-smoke`. Verify:
  - both `run.json` files record a Pass for `add-double`, plus the model id and the omp version;
  - every prompt equals its Turn's user message in the copied Journal;
  - the pi-chart record has an `accounting.json` covering all 3 Turns;
  - `psql` lists no `bench_%` database;
  - `bench/workloads/smoke/bundle/` is unchanged;
  - `bun scripts/measures.ts /tmp/bench-smoke/runs/pi-chart-0` prints the same Measures as `bench.json`.
  
  Spend: about $0.35.
- [x] 5.2 Failing-check path: copy `smoke` to `/tmp/smoke-fail`, with the check expecting `double(4) === 9`, then run `--workload /tmp/smoke-fail --arm pi-chart --runs 1`. Verify:
  - the record holds a Fail for `add-double`;
  - all 3 Turns ran;
  - no tool call in the Journal names a `.check.ts`;
  - the report shows Cost per Pass as "no Pass".
  
  Spend: about $0.17.
- [x] 5.3 Acceptance: `bun scripts/bench-tokens.ts --runs 1 --parallel 2 --out /tmp/bench-ro40`. Verify:
  - both Runs complete;
  - the report names `read-only-40` v1, Cost per Pass "n/a", and Retention for `codeword` and `build` per Arm;
  - pi-chart's cost is within ±15% of $3.77 and plain omp's within ±15% of $4.89, the 2026-10-14 figures (plausibility only, see design Risks).
  
  Spend: about $8.70.

## 6. Close

- [x] 6.1 Docs:
  - `README.md` and any doc that shows a `bench-tokens` command get the new flags (`grep -rn 'bench-tokens' README.md docs/ --include=*.md`, skipping dated write-ups under `docs/benchmarks/`, which stay as history);
  - `docs/agents/workflow.md` needs no change in this slice.
  
  Verify: every flag in those live commands exists in `bench-tokens`' argument handling, and no live doc still passes a JSON file to `--workload` or `--report`.
- [x] 6.2 Run `bun run typecheck`, the full `bun test` and `openspec validate measures-walking-skeleton --strict`. Verify: all clean, and no `*.check.ts` appears in `bun test`'s file list.
