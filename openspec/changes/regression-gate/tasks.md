## 1. Run machinery shared by the benchmark and the Gate

- [x] 1.1 Move `runOne`, `pool`, `journalsFor`, `headerOf`, `runCheck`, `createDatabase`, `exportAccounting`, `dropDatabase` and `log` from `scripts/bench-tokens.ts` to a new `scripts/runs.ts`. Add `source` (pi-chart root: extension `<source>/src/extension.ts`, `PostgresStore` imported dynamically from `<source>/src/postgres-store.ts`) and `label` (record folder name) to the Run context/arguments. `bench-tokens.ts` passes the repository root and `${arm}-${index}`. Verify: `bun run typecheck` is clean, and `bench-tokens.ts` no longer defines any moved function (grep).
- [x] 1.2 Smoke the move: `bun scripts/bench-tokens.ts --workload smoke --runs 1 --arm pi-chart --out /tmp/gate-smoke-bench`. Verify: it completes, `runs/pi-chart-0/` holds `run.json`, `journal.jsonl` and `accounting.json`, and the report prints as before.

## 2. Statistics (tdd, `test/stats.test.ts`)

- [x] 2.1 Red, then green: `studentCdf(t, df)` (regularised incomplete beta, Lentz) and `studentQuantile(p, df)` (bisection to 1e-10) in `scripts/stats.ts`. Verify: tests pin `t₀.₉₅,₄ = 2.1318`, `t₀.₉₅,₉ = 1.8331` and `t₀.₉₇₅,₉ = 2.2622` to 4 decimals, and check that `studentCdf(-t) = 1 − studentCdf(t)`.
- [x] 2.2 Red, then green: `sampleVariance`, `pooledVariance(batches)` returning `{ variance, df }` (a batch of < 2 adds nothing), and `holm(pValues, alpha)`. Verify: pooled df 17 from batches of 5, 10 and 5; Holm with 0.030 / 0.040 at 0.0467 rejects neither, and with 0.020 / 0.040 rejects both.

## 3. Gate logic (tdd, `test/gate.test.ts`)

- [x] 3.1 Red, then green: `gateLapses(measures)` in `scripts/gate.ts` = Re-fetch left + recall Pulls + failed-Probe Lapses, totals only. Verify: the spec's 13 / 6 / 6 / 2 left Revisits / 1 recall unknown case gives 25, and a `RunMeasures` without `recall` sums the other two.
- [x] 3.2 Red, then green: the pool file format (design §6), `keyOf`, and the key filter, which refuses when the key has no A/A batch. Verify: a batch under another omp version is ignored, and a key with only Gate batches refuses, naming `--aa`.
- [x] 3.3 Red, then green: `decide({ look, pairs, history, key })` with `LOOKS`, `MARGIN`, the cost log ratio and Lapse difference, Holm across the two fail tests, the Cost non-inferiority pass, and the zero-SE rule. Verify: each regression-gate "Each look tests both Measures" scenario holds: fail by Lapses while Cost is non-inferior; pass at look 1 at bound 1.06 and continue otherwise; inconclusive at look 2 at bound 1.14; Holm's marginal case does not fail.
- [x] 3.4 Red, then green: `gatherPairs({ want, cap, spent, width, runPair })`. Verify, with fake `runPair`s:
  - a void pair is replaced and its costs counted;
  - voids reaching $45.20 at 4 complete pairs stop the look, flagged by the cap;
  - no more than `width` pairs are ever in flight;
  - a throwing `runPair` lets in-flight pairs finish, starts no further pair, and rejects.
- [x] 3.5 Red, then green: `changesSource(base, candidate)` with `git diff --quiet <base> <candidate> -- src/`. Verify: `7ef6898` → `3b4304b` is false, and `352b5d1~1` → `352b5d1` is true.

## 4. Gate CLI, record and report

- [x] 4.1 `scripts/gate.ts` main covers:
  - argument parsing: `--base`, `--candidate`, `--aa`, `--commit`, `--report`, `--out`, `--parallel`, `--pool`, `--workload` and `--turn-timeout`;
  - the checks before any spend: `src/` change, A/A batch for the key, `omp --version`;
  - per-side trees via `git archive` plus `bun install --frozen-lockfile`, with a `PostgresStore` API check;
  - pairs run under `Promise.all`, with alternating job order and the model check after each Run;
  - two looks via `gatherPairs` and `decide`;
  - `gate.json`, then the atomic pool append when there is a verdict and at least 2 complete pairs, and tree cleanup in `finally`.

  Verify: `bun run typecheck` is clean, and `bun scripts/gate.ts --base 7ef6898 --candidate 3b4304b` states that no Gate is needed and starts no Run.
- [x] 4.2 The report (design §8), shared by the end of a Gate and `--report <dir>`. Verify: `--report` on 5.1's output prints the same verdict and figures and leaves the pool file byte-identical (checksum before and after).
- [x] 4.3 Create `bench/gate/pool.json` as `{ "batches": [] }`. Verify: `bun scripts/gate.ts --base 352b5d1~1 --candidate 352b5d1` stops before any Run and names `--aa`.

## 5. Smoke and the real A/A batch

- [x] 5.1 Smoke on the `smoke` Workload with `--pool /tmp/gate-smoke-pool.json`: first `--aa`, then a Gate with `--base 352b5d1~1 --candidate 352b5d1`. Verify:
  - both complete;
  - `gate.json` has both commits and every pair;
  - the pool gains an `aa` batch and a `gate` batch;
  - the record folders are `base-<i>` and `candidate-<i>`;
  - a candidate Run's `omp` processes load `<candidate tree>/src/extension.ts` (check `ps` during the run);
  - the recorded model is `REFERENCE_MODEL`. If omp rejects the `--model` form, apply design's fallback and re-run.
- [x] 5.2 With the user's explicit go-ahead for about $44: `bun scripts/gate.ts --aa` on the `gate` Workload against the committed pool. Verify: 5 complete pairs, an `aa` batch in `bench/gate/pool.json`, and the reported cost CV and Lapse SD. If the user declines, leave the pool empty and say so in the archive commit.

## 6. Docs

- [x] 6.1 `docs/agents/workflow.md` §6: add the Gate step (design §9): when it applies, the command, recording the verdict and folder in the archive commit, and what pass, fail and inconclusive lead to, plus `--aa` when the key has no batch. Verify: by reading; the step names `bun scripts/gate.ts --base`.
- [x] 6.2 Add the CLI usage and pool notes to `scripts/gate.ts`'s header comment, and update `scripts/bench-tokens.ts`'s header to point at `scripts/runs.ts`. Verify: `bun run typecheck` and the full `bun test` are clean.
