## 1. Replay in `scripts/` (free; the walking skeleton)

- [x] 1.1 `scripts/runs.ts`:
  - `RunSpec.commit?: string`, recorded in `run.json` as `piChart`;
  - export `createDatabase` and `dropDatabase`;
  - move the Gate's tree builder (`git archive` plus `bun install --frozen-lockfile`, with the store check) from `gate.ts` into `runs.ts` as `buildTree(sha)`.

  The Gate passes each side's sha. `bench-tokens.ts` passes `HEAD` only when `git diff --quiet HEAD -- src/` holds.

  Verify: `bun run typecheck` and `bun test test/gate.test.ts` are clean. `gate.ts --base 77a4cbb` still reports that no Gate is needed.
- [x] 1.2 `scripts/replay.ts` and `scripts/replay-ext.ts`, stub mode only, reworked from `context-need-measures/evidence/`.
  - The replay recreates the record's inputs (design §10) and refuses on each condition in the spec's replay requirement.
  - It pins the session id and date, counts every Call, and writes `call-NNN.json`.
  - It moves its own Journals out of the session root and drops its database.
  - `replay.ts check <run-dir> [--commit]` prints count − `usage` per Call and the band it implies.

  Verify:
  - `bun scripts/replay.ts check /tmp/gate-aa-real/runs/base-0 --commit fd96df4`, and the same for `candidate-3`, put every Call in one offset band. Record the band in `OFFSET_BAND`; if it is not 43–46, note that in the design.
  - `ls ~/.omp/agent/sessions/*hISzG3*` shows only the original Journal.
  - No database named `replay_*` remains.
  - If no request reaches the wrapped fetch, stop: design Risk 1.
- [x] 1.3 Throwaway, not committed: hold one stubbed request inside the wrapped fetch for 10 minutes before answering. Verify: omp neither retries nor aborts that Call, and the Turn completes. If omp aborts, stop: design Risk 2. Remove the hold.

## 2. Ablation rules (tdd, `test/ablation.test.ts`, `test/stats.test.ts`)

- [x] 2.1 Red, then green: `wilson(k, n)` in `scripts/stats.ts`. Verify: 6/20 gives [0.1455, 0.5190] to 4 decimals, 0/10 has a lower bound of 0, and 10/10 has an upper bound of 1.
- [x] 2.2 Red, then green: `targetOf(toolCall)` and `matches(original, resend)` in `scripts/ablation.ts`.
  - A device call resolves the way `invokedTool` does.
  - Export `answerOf` from `measures.ts` unchanged, and add `probeMatches(plants, originalVerdicts, resend)`.

  Verify: each row of the spec's target table, a line selector ignored, `bash` whitespace collapsed, reply matching reply, and the UNKNOWN Probe resend not matching.
- [x] 2.3 Red, then green: `unitsOf(turns, address, window, compactions, pins)` over a synthetic record folder. Verify:
  - no unit comes from the current Turn;
  - a Turn-0 Call has no Opening unit;
  - Pull results are split from tool-call groups, a device call included;
  - a plain-omp Call after compaction has a summary unit;
  - tokens are estimated.
- [x] 2.4 Red, then green: `locate`, `cut` and `sham` over Anthropic body fixtures, plus `duplicated`. Verify every case in the design's seam row: tool group, prose, Pin span, Opening, summary, emptied and thinking-only messages dropped, identical breakpoints at most 4, duplicated, and unlocated.
- [x] 2.5 Red, then green: `countCheck(sham, cut, alone)`, `stability(matches)` and `verdict(matches)`. Verify: the tolerance edges at max(20, 5%); 3/4 stable and 2/4 unstable; Needed ≤ 1, unclear at 2, not Needed ≥ 3.
- [x] 2.6 Red, then green: `sample(callUnits, n, seed, exclude)`. Verify: the same seed gives the same draws; no Call is drawn twice across redraws; unit choice over 1,000 seeds lands within 5 points of the token shares.
- [x] 2.7 Red, then green: `ratesOf(journal)` and `priceOf(usage, rates)`. Verify: the rates from a synthetic Journal match its `cost / tokens` per kind, and a resend's price equals the hand sum.
- [x] 2.8 Red, then green: `summarise(records)` per Arm. It gives:
  - Needed share with Wilson over non-duplicated units, and duplicated units apart;
  - the unclear share;
  - the unstable share of Calls drawn;
  - counts per fate;
  - spend;
  - the positive control's trusted flag, at least 80%;
  - the null false-Needed rate.

  Verify: 7/10 is not trusted and 8/10 is trusted.

## 3. Send mode and the Ablation CLI

- [x] 3.1 `replay-ext.ts` plan and result protocol (design §2–§3). At a planned Call, the extension runs: faithful gate, locate, the three counts and the count check, 4 shams, the stability gate, then 4 cuts or 4 second shams. It checks the cap before each send, prices sends with `priceOf`, and writes each fate. With `--dry-run`, it stops after the count check. Verify: `bun run typecheck` is clean, then 3.2.
- [x] 3.2 `scripts/ablate.ts`:
  - argument parsing (design §11), using `flagsOf`;
  - refusal when `ablation.json` exists;
  - the plan from `measureRun` plus `unitsOf` plus `sample`, then replay passes with redraws;
  - `ablation.json`, `--report`, `--controls`, `--null` and `--parallel`.

  Verify: `bun scripts/ablate.ts /tmp/gate-aa-real/runs/base-1 --commit fd96df4 --units 30 --dry-run` gives counts for 30 units with no send. The miscounted share is printed. The 20-token / 5% tolerance holds for the non-early units, or else it is retuned on that evidence and recorded in the design.
- [x] 3.3 Paid smoke, about $3: `bun scripts/ablate.ts /tmp/gate-aa-real/runs/base-1 --commit fd96df4 --units 3 --null 1 --controls --cap 3`. Verify:
  - `ablation.json` holds every draw, with resends, matches, verdicts and spend at or under $3 plus one batch;
  - `--report` re-prints it with no send;
  - a second run refuses;
  - the session root and the database list are clean.

## 4. Gate `--ablate`

- [x] 4.1 In `scripts/gate.ts`, `--ablate` runs after the pool write and before tree cleanup: 10 units per side spread over complete Runs, with a $10 cap per side. It writes each Run's `ablation.json` and `gate.json`'s `ablation` summaries. The report row reads Needed share with its interval, judged units and Ablation spend per side, or "not measured". Verify: `bun scripts/gate.ts --report` on a copy of `/tmp/gate-aa-real` with two fabricated `ablation.json` files prints Needed share per side and makes no send. Without them, the row reads "not measured".
- [x] 4.2 Smoke, about $5: `--aa` then a Gate with `--ablate` on `--workload smoke --pool /tmp/ablate-gate-pool.json`, `--base 352b5d1~1 --candidate 352b5d1`. Verify:
  - the verdict is reached before Ablation;
  - Ablation spend is reported apart;
  - each record under `runs/` names its side's commit as `piChart`.

## 5. Calibration set

- [x] 5.1 Red, then green: the calibration writer. It adds a set under the key only when the control holds, refuses a second set for the key, and never reads another key's set. Create `bench/ablation/calibration.json` as `{ "sets": [] }`. Verify: the writer tests pass.
- [x] 5.2 With the user's explicit go-ahead for about $67, plus about $25 for five plain-omp Gate Workload Runs (and about $22 for pi-chart Runs if `/tmp/gate-aa-real` is gone):
  - run `bench-tokens --workload gate --arm vanilla --runs 5`;
  - then run `ablate.ts --calibrate` over those and five A/A records.

  Verify: 50 judged units per Arm, 20 null units, the positive control's share, and the set committed under its key. If the control fails or the user declines, leave the file empty and say so in the archive commit.

## 6. Docs

- [x] 6.1 Usage headers in `scripts/replay.ts` and `scripts/ablate.ts`, with the `--ablate` flag added to `scripts/gate.ts`'s header. One line in `docs/agents/workflow.md` §6: `--ablate` is optional and costs up to $20. Verify: `bun run typecheck` and the full `bun test` are clean.
