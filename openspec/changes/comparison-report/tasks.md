## 1. Groundwork

- [ ] 1.1 Red, then green: `pairedWithinTasks(groups)` in `scripts/stats.ts`, per design decision 5, tested in `test/stats.test.ts` with the seam cases:
  - one task `[0.1, 0.2, 0.3]` gives mean 0.2, df 2, bounds 0.2 ± t₀.₉₇₅,₂·0.1/√3;
  - two tasks `[[0, 0.2], [1, 1.2]]` give mean 0.6, df 2, se √0.02/2;
  - a one-pair task counts in the mean with no df;
  - all one-pair tasks give no bounds;
  - no groups gives `pairs: 0`.
- [ ] 1.2 Red, then green: `offModel(record, measures, model)` in `scripts/gate.ts`, with `pairRunner` passing `ctx.options.model` and the sweep's call passing `REFERENCE_MODEL`. Test in `test/gate.test.ts`: a `anthropic/claude-sonnet-5-5` record passes under that model and fails under `REFERENCE_MODEL`. Verify that the existing gate and sweep tests pass.
- [ ] 1.3 Red, then green: `headerOf(file)` in `scripts/runs.ts` also returns `thinking`, the first `thinking_level_change`'s `thinkingLevel`. Test it over a fixture Journal holding one such entry, and over one holding none.
- [ ] 1.4 Export `ppiByArm` from `scripts/ablate.ts`, unchanged. Verify with `bun run typecheck`.

## 2. Summaries and headline

- [ ] 2.1 Red, then green: `RunSummary` and `summaryOf(record, measures, thinking)` in `scripts/compare.ts` (design decision 6). Test in `test/compare.test.ts`: over a record whose `prompts` hold a sentinel string, the serialised summary does not contain it, and `lapses` equals `gateLapses(measures)`.
- [ ] 2.2 Red, then green: `headline(pairs)` over hand-built summaries. Cases:
  - the Cost per Run ratio is exp of the mean log difference, and its bounds are exp of `pairedWithinTasks`'s bounds;
  - a pair with 0 Passes on one side is left out of Cost per Pass and counted;
  - a Retention band with scores on one side only is left out;
  - a band no pair reaches shows no figure, not zero;
  - unplanted scores never count;
  - a batch with no Plants gives a single "n/a: no Plants" row;
  - EvoCode-style pairs are grouped by task;
  - the one-Arm rows read "n/a" for Compactions on pi-chart and for Pulls on plain omp;
  - Pass counts per step and first failing steps count complete Runs only.

## 3. Batches

- [ ] 3.1 Implement the CLI frame in `scripts/compare.ts` (design decision 1):
  - `--out` required, and `--batch`, `--ablate` and `--report` exclusive;
  - a batch refused when its `batch.json` exists;
  - the clean-`src/` check of decision 2, refusing with the paths;
  - `batch.json` written when the batch ends, stopped or not.
- [ ] 3.2 Implement the Gate Workload batches (decision 3): `buildTree(HEAD)`, `buildContext` with the batch's model, `pairRunner` with `base` as plain omp and `candidate` as pi-chart, and `gatherPairs({ want: 10 or --pairs, cap: 80 or 45, width: --parallel ?? 2 })`. A `PairStop` sets `stopped` and counts its spend.
- [ ] 3.3 Red, then green: `evocodeBatch({ tasks, perTask, runPair, cap, width })` (decision 4), with an injected `runPair`. Cases:
  - jobs are replica-major;
  - a void pair is not rerun;
  - a cap reached after 5 pairs leaves 3 unstarted, with `capped` true;
  - a pair whose Run throws stops the batch, and its finished Run's cost is in `spent`.

  Then wire it to `runTask` with the admitted tasks from `subset.json`, `fetchTasks`, `evocode.ts`'s preconditions and `model: REFERENCE_MODEL`.
- [ ] 3.4 Implement `--ablate` (decision 8): the 2 lowest-indexed complete reference pairs, both Runs each, `ablateRun` one at a time with `{ units: 20, nulls: 0, controls: false, cap: 10 }`. An `AblationStop` is logged, its spend counted, and the next Run ablated.

## 4. Report

- [ ] 4.1 Implement `--report` (decision 9):
  - recompute every Run with `measureRun(dir, readCalibration())`;
  - write the Markdown (title, bold headline paragraph, bullet list, per-batch sections, Ablation with Utilisation and the PPI line or its reason, the six caveats with thinking levels per decision 7) and the JSON to `docs/benchmarks/<date>-plain-omp-comparison.{md,json}`;
  - write a "not run" section for a missing batch;
  - name a batch run on another Workload or at another n as such.
- [ ] 4.2 Smoke, a few dollars:
  - `bun scripts/compare.ts --out <tmp> --batch reference --workload smoke --pairs 1`; a second identical call is refused;
  - with an uncommitted edit under `src/`, `--batch second` is refused naming the file, and spends nothing;
  - `--report --date smoke` writes both files: the second-model and EvoCode batches read "not run", the reference section names the smoke Workload and n = 1, and `grep` finds no Workload prompt text in the JSON.

  Delete the smoke report files afterwards.

## 5. The comparison

- [ ] 5.1 Run `--batch reference` into `<out>`, a folder outside the repository that is kept until the report is committed (about $70, cap $80).
- [ ] 5.2 Run `--ablate` (about $26, at most $40).
- [ ] 5.3 Run `--batch second` (about $35, cap $45).
- [ ] 5.4 Run `--batch evocode` (about $110, cap $125). It needs Docker, Harbor and the host's Postgres, per `evocode.ts`'s preconditions.
- [ ] 5.5 Run `--report`, read the report against the spec's scenarios, and commit `docs/benchmarks/<date>-plain-omp-comparison.{md,json}`.
- [ ] 5.6 Add the report and the command to `README.md`'s benchmarks section, and the reproduce line to the report. Run `bun run typecheck` and `bun test` once.
