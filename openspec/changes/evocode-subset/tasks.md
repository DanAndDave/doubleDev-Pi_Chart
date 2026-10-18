## 1. Groundwork

- [x] 1.1 Generalise `journalsFor(cwd)` in `scripts/runs.ts` into `journalsIn(root, cwd)`: main Journal chosen by header `cwd` among a session folder's top-level files, subagents one deeper. `runOne` calls it with `SESSION_ROOT`. Verify with the seam cases in design (main by `cwd`, subagents one deeper, another `cwd` ignored), and that the existing `runs` tests pass.
- [x] 1.2 Check where omp writes Journals under a fresh `HOME` (design decision 4: pi-chart reads them only under `homedir()`, so the home moves rather than `--session-dir`). On the host, send two Turns (`HOME=<tmp> ANTHROPIC_OAUTH_TOKEN=… omp -p --no-extensions --model anthropic/claude-opus-5-5`, then the same with `-c`), the second asking for one trivial subagent. Verify that `journalsIn(<tmp>/.omp/agent/sessions, <cwd>)` returns that Conversation's main Journal and its subagent Journal (spend under $1).
- [x] 1.3 Add the optional `harbor` field to `RunRecord` in `scripts/measures.ts`. Verify with `bun run typecheck`.

## 2. Dataset

- [x] 2.1 Write `bench/evocode/subset.json`, holding:
  - the dataset `UnipatAI/EvoCodeBench`, revision `9fcae3e5539d1c0e85e2481fe06bd6af42cc4bc6` and archive `archives/evocodebench_wotraj.tar.zst`;
  - the licence (CC BY-NC 4.0, with its URL) and the paper (arXiv 2605.24110);
  - the candidates, by full task id, in this order: `theme_d10_w8_ml_ai_mlops_security_patch_hardening`, `theme_d10_w12_ml_ai_mlops_explanation_reporting`, `theme_d10_w9_ml_ai_mlops_reproducibility_verification`, `theme_d1_w1_code_build_greenfield_implementation`;
  - no admission results yet.

  Download the archive once, then record its SHA-256 in the file. Verify that the four task folders exist in the extracted archive with 8, 7, 8 and 9 steps.
- [x] 2.2 Implement `fetchTasks(subset, { download, cacheRoot })` in `scripts/evocode.ts`. It hashes the archive before extracting it with `tar --zstd` into `~/.cache/pi-chart/evocode/<revision>/`, through a temp folder that is renamed into place. Verify with the seam cases: a cache hit makes no download; a mismatch names both hashes and leaves no cache folder; a match returns the task folders.

## 3. Agent and Run

- [x] 3.1 Write `scripts/harbor/omp_agent.py`, an `OmpAgent(BaseInstalledAgent)` with `resume=True`:
  - `install()` fails unless `/opt/omp/omp --version` prints the version passed as an agent kwarg;
  - `run()` sends the omp command of design decision 4 for the `arm` kwarg, with the environment built from nothing and the `turns/<n>.started|done` markers of decision 7;
  - it sends nothing when an earlier round started without finishing.

  Verify that `PYTHONPATH=scripts/harbor uvx --from harbor==0.24.0 python -c "import omp_agent"` succeeds.
- [x] 3.2 Harbor oracle smoke, with no model. Run `uvx --from harbor==0.24.0 harbor run -p <cache>/theme_d10_w8_… -a oracle -n 1 --jobs-dir <tmp>`. Verify that the image builds, every round's reward is 1, and the shape of `result.json` and `steps/round-N/` matches what `recordOf` will read.
- [x] 3.3 Implement `recordOf(trialDir, task, spec)` per design decision 8. Build its fixtures from 3.2's trial folder, with Journals from 1.2. Verify with the seam cases:
  - rewards 1, 0, 1 give Pass, Fail, Pass;
  - a missing `.done` for round 3 gives `failedTurn` 2 and outcomes for rounds 1–2 only;
  - the prompts equal the `instruction.md` bytes;
  - the Workload id, empty Plants and empty Revisits are as specified.
- [x] 3.4 Implement the Run in `scripts/evocode.ts`: `--task <id> --arm <arm> [--runs n] [--rounds n] [--out <dir>]`, the preconditions of decision 10, and the steps of decisions 2, 3, 5 and 6. The steps are: database, token, Compose overlay, mounts, `harbor run`, `recordOf`, Accounting export, database drop, `measureRun`, all inside the `attempt` chain.

  Verify with a smoke on `theme_d10_w8_…` with `--rounds 2`, one Run per Arm (a few dollars):
  - `bun scripts/measures.ts` reads each record;
  - each Journal's user messages equal the two `instruction.md` files byte for byte;
  - the pi-chart Run has Accounting, and its database is gone;
  - the user's Thread Store database is unchanged;
  - the record names Harbor 0.24.0, the revision, and no Budget.

## 4. Admission

- [x] 4.1 Implement `admissionOf(record, calls)` per design decision 10. Verify with the seam cases: admitted, `no eviction`, `unknown`, and `failed Turn 4`.
- [x] 4.2 Implement `--admit`. It runs the candidates through `runCapped` with width 2 and cap $60, rewrites `subset.json` after each Run with each candidate's status, rounds, cost and Passes, and prints one line per candidate. Verify, with an injected `runTask`, that $61 after three Runs leaves the fourth `not run`, that the file is written after each Run, and that each precondition is refused with its message.
- [ ] 4.3 Run `bun scripts/evocode.ts --admit` (estimated $40, capped at $60). Commit `subset.json` with the admission results. Keep the output folder's path in the commit message, not the records.

## 5. Close

- [ ] 5.1 README: add EvoCode Runs (`--task`, `--rounds`), admission, the dataset's attribution and licence, and that nothing from it is committed. Verify that the README names the revision and the licence.
- [ ] 5.2 Run `bun run typecheck`, `bunx biome check .` and `bun test` once, and `openspec validate evocode-subset`. Verify that all pass.
