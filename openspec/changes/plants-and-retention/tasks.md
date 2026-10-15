## 1. Plant declaration and validation

- [x] 1.1 Red: in `test/workload.test.ts`, using temp Workload folders as the existing tests do, add:
  - a Plant `{ id, value }` loads as `kind: "literal"`;
  - a Workload with a prompt-placed literal, a prompt-placed superseded Plant (earlier value in Turn 1, value in Turn 3), and a constraint in `overlay/notes/rule.md` named by an earlier prompt, each probed later, loads with every field intact, and a Probe's `tools: false` is kept;
  - one malformed Workload that breaks every new rule in the spec's list. Its single Error names each: unknown kind; superseded without `earlier`, or with `earlier` equal to `value`; `earlier` on a literal; overlapping values `7341`/`73412`; a value in two prompts; a value in no prompt; an earlier value after the statement; a file-placed value in a prompt; a missing overlay file; a file lacking its value; a file never named before the first Probe; an earlier file named after the value's file; a Probe at or before the statement; a `tools: false` Probe of a constraint.

  Verify: `bun test test/workload.test.ts` fails on the new cases only.
- [x] 1.2 Green: the `Plant`, `PlantKind` and `Prompt` types and the `loadWorkload` checks in `scripts/workload.ts` (design decisions 1 and 2). Verify: `bun test test/workload.test.ts` passes; `bun run typecheck` is clean.
- [x] 1.3 Add `"tools": false` to the Probe of `bench/workloads/read-only-40/workload.json` and `bench/workloads/smoke/workload.json`, leaving every text and the version unchanged. Each README's Versions section notes the amended declaration (`smoke` has no README, so only `read-only-40`'s does). Verify: a throwaway `loadWorkload` on each prints the Probe with `tools: false` and every Plant as `literal`.
- [x] 1.4 `scripts/bench-tokens.ts` writes each prompt's `tools` flag into `run.json` `prompts`; `plants` already comes from the loaded Workload, so it carries `kind`. `RunRecord.plants` accepts a recorded Plant without `kind`. Verify: `bun run typecheck` is clean (the real record is checked in 6.2).

## 2. Journal: summaries and Pin texts

- [x] 2.1 Red, then green: `readBranch` gives each `Compaction` its `summary` text (design decision 5). In `test/journal.test.ts`, `vanilla-compacted`'s `k1` has `summary: "## Goal\nThe Run so far."`. Verify: `bun test test/journal.test.ts` fails, then passes.
- [x] 2.2 Red, then green: `pinTexts(entries)` in `src/pins.ts` maps Pin ids to texts from `add` and `snapshot` events and ignores other entries. In `test/pins.test.ts`, an `add` of id 1 and a `snapshot` holding id 2 give both texts. Verify: `bun test test/pins.test.ts` fails, then passes.

## 3. Fixtures

- [x] 3.1 Build `test/fixtures/runs/pi-chart-plants/`, shaped like `pi-chart-pulls`, with `sessionId: "s-own"`, 12 Turns (0–11), and `accounting.json` keyed `s-own` with Opening 0 on every Call. A `pi-chart.pin` `add` entry gives Pin 1 the text `Release name PIN-23`.
  - **Plants:**
    - `codeword` `PLUM-17`, Turn 0 prompt;
    - `port`, superseded, earlier `PORT-3304` in Turn 1's prompt, value `PORT-8817` in Turn 3's;
    - `pinned` `PIN-23`, Turn 1 prompt;
    - `build` `7341`, Turn 2 prompt;
    - `secret` `SECRET-55`, file `notes/secret.md`, in a `read` result at Turn 4;
    - `owner`, constraint `owner: QUILL-9`, Turn 5 prompt;
    - `leaky` `MOSS-61`, Turn 6 prompt;
    - `ghost` `GHOST-80`, file `notes/ghost.md`, never read.
  - **Probes:**
    - Turn 7 probes `build`, has no Accounting, and its reply is wrong.
    - Turn 8 probes `owner`, with tail `[5, 6, 7]` marked partial. A `write` call's `content` holds `owner: QUILL-9`.
    - Turn 9, `tools: false`, probes `secret`, with tail `[6, 7, 8]`. It reads `notes/secret.md` again and replies `SECRET-55`.
    - Turn 10 probes `port`, with tail `[7, 8, 9]`. A `recall_earlier_turns` result (`turnIndices: [3]`) holds `PORT-8817`, and the reply says it.
    - Turn 11, `tools: false`, probes `codeword`, `build`, `port`, `leaky`, `ghost`, `secret` and `pinned`, with tail `[8, 9, 10]` and pins `[1]`. It makes no tool call, and its reply is `PLUM-17, 1234, PORT-3304, MOSS-61, UNKNOWN, SECRET-55, PIN-23`.

  Verify: a throwaway `readBranch` check gives 12 Turns, and every tool result's `toolCallId` matches a tool call in its Turn.
- [x] 3.2 Build `test/fixtures/runs/vanilla-plants/`, shaped like `vanilla-compacted`, with 10 Turns (0–9) and one compaction before Turn 8. The compaction keeps from Turn 6 message 0, and its summary holds `7341`.
  - **Plants**, all literal: `build` `7341` (Turn 2 prompt), `color` `TEAL-12` (Turn 3 prompt), `mark` `MARK-77` (Turn 7 prompt).
  - **Probe**: Turn 9, `tools: false`, probes all three, and its reply is `7341, UNKNOWN, MARK-77`.

  Verify: a throwaway `readBranch` check gives the compaction with its `firstKept` at Turn 6 and its summary.

## 4. Scores, positions, sources and failed Probes

- [x] 4.1 Red: `test/measures.test.ts` asserts `plants` (`Score[]`, design decision 6) in order on `pi-chart-plants`:
  - 7 `build`: wrong, planted 2, distance 5, position unknown, source unknown, class unknown.
  - 8 `owner`: right, constraint, distance 3, position unknown, source unknown.
  - 9 `secret`: right, planted 4, distance 5, evicted, source result, breach, `tools: false`.
  - 10 `port`: right, superseded, planted 3, distance 7, evicted, source pull with `pull: "recall_earlier_turns"`.
  - Turn 11:
    - `codeword`: right, distance 11, opening, source opening.
    - `build`: wrong, distance 9, evicted, none, class lapse.
    - `port`: wrong, stale, distance 8, evicted, source tail, class despite.
    - `leaky`: right, distance 5, evicted, none, class leak.
    - `ghost`: wrong, unplanted, no distance, class unplanted.
    - `secret`: right, distance 7, evicted, source tail.
    - `pinned`: right, distance 10, pin, source pin.
  - `probe` is `{ lapse: { total: 1, bands: [0, 0, 1, 0, 0] }, unknown: { total: 1, bands: [1, 0, 0, 0, 0] } }`.

  On `vanilla-plants`:
  - `build`: right, distance 7, position summary, source summary.
  - `color`: wrong, distance 6, evicted, none, lapse.
  - `mark`: right, distance 2, tail, source tail.
  - `probe.lapse` is `{ total: 1, bands: [0, 1, 0, 0, 0] }`.

  The existing `plants` assertions on `complete` and `failed-early` move to the `Score` shape, and `pi-chart-evicted` has `probe` zeros present. Verify: the new assertions fail.
- [x] 4.2 Green: `plantedAt`, scoring by kind, position, source, classes and `probe` banding in `scripts/measures.ts` (design decisions 3–6). Reuse `windowAt`, the `classify` tail test, `PULL_TOOLS` and `band`. Verify: `bun test test/measures.test.ts` passes; `bun run typecheck` is clean.

## 5. Aggregate and report

- [x] 5.1 Red, then green: `aggregate()` gives per-Probe `retention`, `byBand`, `byPosition`, `sources` and `counts` (design decision 7). In `test/measures.test.ts`, on constructed Runs:
  - three complete Runs whose `build` score sits in the tail and is right once, and is evicted and wrong twice, give `byPosition.tail` 1/1 and `byPosition.evicted` 0/2;
  - a leak counts 1 in `counts.leak`;
  - an incomplete Run is excluded;
  - an unplanted score counts in `byPosition.unplanted` and in no band.

  The existing `retention` test moves to the per-Probe shape. Verify: `bun test test/measures.test.ts` fails, then passes.
- [x] 5.2 CLI: `bun scripts/measures.ts <run-dir>` prints one line per score, plus `Failed-Probe Lapses` and `Failed Probes unknown` banded lines (design decision 7). Verify: on `pi-chart-plants` it prints `build: wrong at Turn 12, literal, 9 Turns back, evicted, source none (Lapse)` and failed-Probe Lapses 1 in 8–12; on `vanilla-plants` it prints `build … summary, source summary`.
- [x] 5.3 `scripts/bench-tokens.ts` `report()` gains:
  - the Retention per Probe, by band and by position tables;
  - the Answer sources table and the counts line;
  - the failed-Probe columns in the band table;
  - the updated routes line.

  Verify with a throwaway `bench.json`, deleted afterwards, built from `pi-chart-plants` and `vanilla-plants`. `bun scripts/bench-tokens.ts --report <dir>` should print plain omp's failed-Probe cells as figures, not "n/a", and give pi-chart one leak. With `position` stripped from the scores, the new tables should print "—".
- [x] 5.4 `README.md`: the Measures paragraph describes Retention by kind, position and source, leaks, and failed Probes as the third Lapse route on both Arms. Verify: the paragraph reads true against the 5.2 output.

## 6. Acceptance

- [x] 6.1 `bun test` and `bun run typecheck` pass.
  - `bun scripts/measures.ts /tmp/bench-ro40/runs/pi-chart-0` prints:
    - codeword right, position Opening, source Opening;
    - build wrong, 37 Turns back, evicted, source none (Lapse);
    - failed-Probe Lapses 1 in ≥25;
    - the Re-fetch Lapses unchanged (3 in 8–12).
  - `…/vanilla-0` prints both Plants right from the tail and zero failed Probes.
- [x] 6.2 `bun scripts/bench-tokens.ts --workload smoke --runs 1` completes on both Arms. Each `run.json` holds the codeword Plant as `kind: "literal"` and the Probe's `tools: false`, and the report prints the new Retention tables.
