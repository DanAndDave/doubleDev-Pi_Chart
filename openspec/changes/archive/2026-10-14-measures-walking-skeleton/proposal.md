# Proposal: Measures walking skeleton

Triage: ready-for-agent
Blocked by: None

## Why

The `context-need-measures` effort settled every decision about the six Measures (`openspec/changes/context-need-measures/map.md`). None of them can be built yet, because `scripts/bench-tokens.ts` has no Workload format, no Graded Tasks, no Run isolation and no Run record a later script could read. Its workload is an inline array of prompts, copied from `HEAD`, run against the user's own Thread Store and bundle, and scored from `omp -p`'s stdout while the Run is still live.

This slice is the walking skeleton for the effort. It covers one end-to-end path: a frozen Workload goes in, isolated Runs happen, each Run leaves a self-contained record, and an offline Measures script reads that record. Every later slice adds a Measure to the script or a field to the Workload. None of them builds a second harness.

## What Changes

- **Workloads become folders.** `bench/workloads/<name>/` holds:
  - `workload.json`: name, version, pinned commit, Plants, and steps, where each step has prompts and optional Probes;
  - `overlay/`;
  - `checks/<step-id>.check.ts`;
  - `bundle/`;
  - optionally `graphify-out/`.
  
  A malformed Workload is rejected before any Run starts.
- **Runs start from the Workload, not from `HEAD`.** The workspace is `git archive <commit>` with `bench/` excluded, then the overlay is copied over it, the frozen `graphify-out/` is added, and dependencies are installed. Both Arms get the same bytes.
- **Each Run is isolated.**
  - A pi-chart Run gets its own Thread Store database, migrated before the first Turn and dropped once its Accounting has been exported.
  - Every Run gets its own copy of the Workload's bundle through `PICHART_DOC_BUNDLE`.
- **Graded Tasks.** After the last prompt of a step that has a check, the check is copied into the workspace and run with `bun test`, then removed. Its outcome (Pass or Fail) is recorded. A Fail does not stop the Run, and nothing is repaired between steps.
- **Every Run leaves a record** in `<out>/runs/<arm>-<index>/`:
  - `run.json`: Arm, Workload name and version, commit, model id, omp version, prompts, check outcomes, and the failed Turn if one failed;
  - copies of the main and subagent Journals;
  - for pi-chart, `accounting.json`.
- **A Measures script**, `scripts/measures.ts <run-dir>`, computes Measures offline from one Run record:
  - Cost per Run, with the existing token breakdown;
  - Pass per step and the first failing step;
  - Cost per Pass;
  - Retention per Plant, scored from the Probe Turn's reply in the Journal.
  
  `bench-tokens` calls the same code once each Run ends and reports from the result.
- **BREAKING (benchmark CLI only).** The changes to `bench-tokens`:
  - The inline 40-Turn default and its codeword and build-number probe move to `bench/workloads/read-only-40/` as version 1. It is pinned to `c6fe516`, the commit the 2026-10-14 benchmark ran, and declares the codeword and build number as Plants. The prompts keep their exact bytes, including the "Do not modify any files" suffix, which becomes part of the prompt text.
  - `--workload <name>` now names a Workload folder; the JSON array of prompts it used to take is gone.
  - `--out` names a directory, and `--report` reads that directory's `bench.json`.
  - Raw files saved before this change can no longer be printed with `--report`. Their write-ups cite the commit that prints them.
- **A `smoke` Workload**, `bench/workloads/smoke/`: two steps over three Turns. The first step is graded and asks for a small edit, the second probes a Plant. It is the cheap end-to-end check of this whole path, and later slices reuse it.

## Capabilities

### New Capabilities

- `benchmark-runs`: the Workload format and its validation, how a Run's workspace is built and isolated, Graded Task checks, and the Run record.
- `measures`: offline Measures over one Run record. This slice adds Cost per Run, Pass per step, Cost per Pass and Retention per Plant; the later slices of `context-need-measures` add theirs here.

### Modified Capabilities

None. Nothing under `src/` changes.

## Impact

- `scripts/bench-tokens.ts`: rewritten around Workload folders, Run isolation, checks and Run records. Its report reads Measures.
- New `scripts/workload.ts` (load and validate a Workload) and `scripts/measures.ts` (CLI plus `measureRun`).
- New `bench/workloads/read-only-40/` and `bench/workloads/smoke/`.
- New tests: `test/workload.test.ts`, `test/measures.test.ts`, with fixture Run records.
- No `package.json` or `tsconfig.json` change: `tsconfig.json` covers only `src/` and `test/`, and the repo's `bun test` skips checks because they are named `*.check.ts`.
- Needs the compose Thread Store (or `PICHART_DATABASE_URL`) for pi-chart Runs, as today.
- Spend:
  - smoke: one 3-Turn Run per Arm, about $0.35;
  - acceptance: one full `read-only-40` Run per Arm, about $8.70 (per-Run costs from `docs/benchmarks/2026-10-14-token-usage-40-turns-mark-0.2.md`).
