## 1. Draft

- [ ] 1.1 Pin the commit and write `bench/workloads/gate/overlay/notes/`:
  - the Revisit files `buckets.md`, `samples.md`, `weights.md`, `rounding.md`, `legend.md`, `format.md`;
  - the Plant files `owners.md` (`reviewer`), `limits.md` and `limits-next.md` (`row-limit`), and `conventions.md` (`owner-line`).

  Rules and values are fictional (design decisions 2–4). Each Revisit file holds a part that only its Revisit step needs. No two Plant values overlap.

  Verify: by inspection against decision 4. `git rev-parse <commit>` resolves.
- [ ] 1.2 Write `workload.json`: `name: "gate"`, `version: 1`, the commit, the six Plants, the six Revisits, and seven steps (`buckets`, `turn-sizes`, `histogram`, `weights`, `render`, `summary`, `recap`), 40 prompts in the Turn map of decisions 2–4.
  - Every non-Probe prompt ends "Do not modify anything under notes/ and do not spawn subagents."
  - Each step's last prompt names the one test file to run.
  - No prompt between a Revisit's earlier read and its step names its file.

  Verify: a throwaway `bun -e` calling `loadWorkload("bench/workloads/gate")` from `scripts/workload.ts` returns 40 Turns, 6 graded steps, 6 Plants and 6 Revisits with no error. Never import `scripts/bench-tokens.ts`.
- [ ] 1.3 Write `checks/<step>.check.ts` for the six graded steps, importing from `./src/budget-table.ts` (and `./src/budget-render.ts` for `render`) and asserting values that follow from the notes.

  Verify: in a workspace built by `buildWorkspace`:
  - all six checks fail on the untouched tree;
  - a throwaway reference solution written there passes all six with `bun test <check>`.

  Delete the reference afterwards (design decision 5).
- [ ] 1.4 Extract `graphify-out/` with `~/.pi-chart/graphify/bin/graphify extract <dir> --code-only` over a workspace built by `buildWorkspace`. Keep `graph.json` and `manifest.json` in `bench/workloads/gate/graphify-out/`. Add `bench/workloads/gate/bundle/.gitkeep`. Add `!bench/workloads/*/graphify-out/` to `.gitignore`.

  Verify: `git status --short bench/workloads/gate` lists both graph files. `graph.json` has nodes from `src/tokens.ts` and none from `bench/`. Its `built_at_commit` comes from the workspace's fresh `git init`, so it is not checked against the pin.

## 2. Review

- [ ] 2.1 Show the user the draft: the Turn map, every prompt, the notes, the checks, and the Plant and Revisit tables. Apply their changes and re-run the 1.2 and 1.3 verifications. Verify: the user approves the draft before any Run is started.

## 3. Probe

- [ ] 3.1 Probe pi-chart alone: `bun scripts/bench-tokens.ts --workload gate --arm pi-chart --runs 1 --out /tmp/gate-probe-<n>`, then `bun scripts/measures.ts /tmp/gate-probe-<n>/runs/pi-chart-0`. Verify against design decision 6:
  - 40 Turns complete and six checks run;
  - every Plant and Revisit at its planned Turn and band;
  - the 8–12 and ≥ 25 Plants and Revisits are evicted (Revisits may be `summary`);
  - Cost per Run ≤ $3.75 with $0.25 headroom, or the mean of two Runs ≤ $3.75.

  On a miss, revise (cut Turns without Plants, Revisits or Probes; shorten reads), redo 1.2–1.3, and probe again. Stop for the user once probe spend reaches $30.
- [ ] 3.2 Probe plain omp: `--arm vanilla --runs 1`. Verify: 40 Turns complete and every check runs. Record its cost and Passes.

## 4. Freeze

- [ ] 4.1 Write `bench/workloads/gate/README.md` in the shape of `read-only-40`'s:
  - the theme and Turn map;
  - the Plant and Revisit tables with the distances and Positions the probe measured;
  - each Arm's probe cost and Passes;
  - the authorship caveat;
  - `## Versions` with v1.

  Verify: every figure in it matches the 3.1 and 3.2 measures output.
- [ ] 4.2 Update `openspec/changes/context-need-measures/slices.md` only if the delivered Workload differs from slice 6's line. Commit the Workload, `.gitignore` and the change. Verify: `bun test` and `bun run typecheck` stay green, and `openspec validate gate-workload` passes.
