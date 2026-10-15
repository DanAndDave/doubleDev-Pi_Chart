## 1. Compactions on the branch

- [x] 1.1 Red: `test/journal.test.ts` covers `readBranch(path)` on new fixture Journals:
  - a branch with one compaction whose `firstKeptEntryId` names the third message of Turn 6 gives `{ before, firstKept: { turn: 6, message: 2 } }`, where `before` is the next message's address;
  - a `firstKeptEntryId` naming a `model_change` resolves to the next message;
  - a `firstKeptEntryId` not on the active branch gives no `firstKept`;
  - a compaction on an abandoned branch is not returned;
  - `readBranch(p).turns` deep-equals `readJournal(p)` on the existing fixture.

  Verify: `bun test test/journal.test.ts` fails because `readBranch` does not exist.
- [x] 1.2 Green: `readBranch`, `Compaction` and `MessageAddress` in `src/journal.ts` (design decision 1); `readJournal` delegates to it. Verify: `bun test test/journal.test.ts` passes; `bun run typecheck` is clean; a throwaway script prints `firstKept` resolved for every compaction in `~/.omp/agent/sessions/-dev-context-manager/2026-09-16T04-20-35-175Z_01a0a871-f2e7-7415-9ead-d457e3850f13.jsonl`.

## 2. Windows per Call

- [x] 2.1 Build fixture record folders under `test/fixtures/runs/`, hand-written in the shape of a real Journal (`session`, `model_change`, `message` entries with tree ids, `usage`, `contextSnapshot`):
  - **pi-chart-evicted:** `arm: "pi-chart"`, 6 Turns, with an `accounting.json` whose tail at Turn 5 carries only Turn 4. The Run reads file A at Turn 1 and again at Turn 5 (a Lapse, distance 4). It reads B at Turn 3 and again at Turn 4 (held, distance 1). Turn 4 also reads B a second time (a same-Turn repeat). The same error result comes at Turns 2 and 5, and the same empty result at Turns 2 and 3. One Call of Turn 5 has no Accounting row, and it re-reads C from Turn 0 (unknown).
  - **vanilla-compacted:** `arm: "vanilla"`, 10 Turns. A compaction after Turn 7 keeps from the fourth message of Turn 6. Results from Turn 3 come again at Turn 9 (left, distance 6). Turn 6's fourth message comes again at Turn 9 (held: the cut itself), and so does its third (left: before the cut in the same Turn). File D is read at Turn 2, edited at Turn 3 and read again at Turn 4 with new content (no Re-fetch). A Turn-1 result recurs at Turn 5, before the compaction (held, distance 4).

  Verify: `readBranch` reads each with the expected Turn and compaction counts (a throwaway check).
- [x] 2.2 Red: `test/measures.test.ts` asserts `calls[].window` on those fixtures:
  - pi-chart Turn 5 has tail `[4]`, Opening 0 and no summary;
  - the Call without Accounting is `"unknown"`;
  - vanilla Turn 9 has the compaction as summary and a tail `from` `{ turn: 6, message: 2 }`;
  - vanilla Turn 5 has tail Turns 0–4 and no summary;
  - subagent Calls have no window.

  Add one unit case for an `unassembled` Call using the whole-branch rule. Verify: the tests fail.
- [x] 2.3 Green: the `Window` type and per-Arm filling in `scripts/measures.ts` (design decision 2), with the Arm taken from `run.json`. Verify: `bun test test/measures.test.ts` passes.

## 3. Re-fetches, Lapses and bands

- [x] 3.1 Red: assert `refetches` and `refetch` on the fixtures. The expected classes and distances are those listed in 2.1: no Re-fetch for the edited file, the same-Turn repeat, or the error and empty results. Bands sum to totals, and zero counts are present rather than absent. Also assert that `compactions` is 1 on vanilla-compacted, 0 on a plain-omp fixture with no compaction (the existing `complete` fixture relabelled `vanilla` in a temp copy), and absent on pi-chart. Verify: the tests fail.
- [x] 3.2 Green: Re-fetch detection, deciding-Call lookup, classification, `BANDS`, `refetch` and `compactions` (design decisions 3 and 4). Verify: `bun test test/measures.test.ts` passes; `bun run typecheck` is clean.

## 4. Report

- [x] 4.1 CLI: `bun scripts/measures.ts <run-dir>` prints Re-fetches held, Lapses and Re-fetches unknown, each with its total and bands, then compactions per Run or "n/a" (design decision 5). Verify: on `test/fixtures/runs/pi-chart-evicted` it prints 1 held, 1 Lapse, 1 unknown and compactions n/a.
- [x] 4.2 `scripts/bench-tokens.ts` `report()`:
  - a compactions row in the per-Conversation table, with "n/a" cells and an "n/a" ratio for an Arm with no figure;
  - the banded Re-fetch table.

  Verify: `bun scripts/bench-tokens.ts --report <dir>` on a throwaway `bench.json` assembled from the two fixture records prints compactions `1` for vanilla and `n/a` for pi-chart with an `n/a` ratio, and the band table. Delete the throwaway file afterwards.

## 5. Acceptance

- [x] 5.1 Run `bun scripts/measures.ts /tmp/bench-ro40/runs/pi-chart-0`. Expect 3 Lapses, all in 8–12, with 0 held and 0 unknown; `--json` should list them as Turn 4 → 13 (twice) and Turn 5 → 14. Then run it on `…/vanilla-0`. Expect 0 Re-fetches in every class and compactions 0. If `/tmp/bench-ro40` is gone, run `bun scripts/bench-tokens.ts --runs 1` (about $8.70) and check that pi-chart reports at least one Lapse whose earlier Turn was missing from the tail that Accounting recorded for the deciding Call.
- [x] 5.2 Run the full suite with `bun test`, then `bun run typecheck`.
