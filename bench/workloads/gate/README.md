# gate

The Gate Workload: 40 Turns over pi-chart's own source at `6eb0d6d`, in six graded steps and one ungraded recap. Together the steps build `src/budget-table.ts` and `src/budget-render.ts`: a small pure module that tabulates the token sizes of a Conversation's Turns against a Budget, on top of `reconstructTurns` and `approximateTokens`. The rules come from `overlay/notes/*.md`, which use fictional thresholds, weights, labels and layouts, so a check passes only if the agent followed the notes.

Every prompt that is not a Probe ends with: "Read a file under notes/ only when this prompt names it. Do not modify anything under notes/ and do not spawn subagents." A Probe that allows tools ends with: "Do not modify any files and do not spawn subagents." The first part of the work-prompt suffix keeps the agent from reading notes files ahead of plan, which would put Plant values in its window early and shorten Revisit distances. The first probe Run, made without that part, did both.

Each graded step has a check in `checks/<step>.check.ts`, a pure `bun test` file with no Postgres and no network. Each step's last prompt names the one test file to run. The bundle is empty. `graphify-out/` was extracted with `--code-only` over a workspace built from this folder.

## Turn map

| Turn | Step | Prompt | Probes |
| --- | --- | --- | --- |
| 1 | buckets | Read `notes/buckets.md`, create `bucketOf` and `Bucket` | |
| 2 | | Read `src/tokens.ts`, `src/messages.ts`; explain | |
| 3 | | States `ticket`; add `BUCKETS` | |
| 4 | | Read `notes/limits.md` (`row-limit`, earlier value); RangeError on a bad size | |
| 5 | | Read `src/turns.ts`; explain | |
| 6 | | Read `notes/owners.md` (`reviewer`); JSDoc | |
| 7 | | Read `notes/limits-next.md` (`row-limit`, value); create `src/budget-table.test.ts` | |
| 8 | turn-sizes | `turnSizes` | |
| 9 | | Read `notes/format.md` for later | |
| 10 | | Read `notes/weights.md` for later; JSDoc | |
| 11 | | States `test-tag`; read `src/shares.ts` | |
| 12 | | Read `notes/samples.md`; tests for `turnSizes` | |
| 13 | | Finish, run the test file | |
| 14 | histogram | `histogram` per `notes/samples.md` | |
| 15–16 | | Tests; read `src/shares.ts` again | |
| 17 | | | `reviewer` |
| 18 | | Read `notes/legend.md` for later; RangeError | |
| 19–20 | | `totalOf`; finish, run the test file | |
| 21 | weights | `weighted` per `notes/weights.md`, tests in a new `src/budget-weights.test.ts` | `test-tag` |
| 22 | | States `codename` (earlier value); read `src/messages.ts` | |
| 23 | | Reject negative sizes | |
| 24 | | States `codename` (value); remove dead code | |
| 25 | | Read `notes/rounding.md`, apply its weighted-size rule | |
| 26 | | | `codename` |
| 27 | | Finish, run `src/budget-weights.test.ts` | |
| 28 | render | `formatCount` per `notes/rounding.md`, `labelOf` per `notes/legend.md` | |
| 29 | | Read `notes/conventions.md` (`owner-line`); tests | |
| 30 | | | `ticket` |
| 31 | | `bucketTotals` | |
| 32 | | Create `src/budget-render.ts` with `renderTable` | `owner-line` |
| 33 | | | `row-limit` |
| 34 | | Finish, run the test file | |
| 35 | summary | `summaryLine` per `notes/format.md` and `notes/buckets.md` | |
| 36–39 | | RangeError; read both modules for duplication; tests; finish, run the test file | |
| 40 | recap | Answer from memory, tools forbidden | `ticket`, `reviewer`, `row-limit`, `codename` |

## Plants

Distances and Positions are as `scripts/measures.ts` reported them for the three probe Runs of v1: pi-chart Runs 2 and 3, and the plain-omp Run.

| Plant | Kind | Stated at | Probe | Distance | pi-chart Run 2 | pi-chart Run 3 | plain omp |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `reviewer` | literal, `notes/owners.md` | 6 | 17 | 11 | evicted, right (result) | evicted, right (result) | tail, right |
| `test-tag` | constraint, prompt | 11 | 21 | 10 | evicted, wrong | evicted, right (tail) | tail, right |
| `codename` | superseded, prompt | 24 | 26 | 2 | tail, right | tail, right | tail, right |
| `ticket` | literal, prompt | 3 | 30 | 27 | evicted, right (result) | evicted, right (result) | tail, right |
| `owner-line` | constraint, `notes/conventions.md` | 29 | 32 | 3 | evicted, wrong | evicted, wrong | tail, right |
| `row-limit` | superseded, `notes/limits-next.md` | 7 | 33 | 26 | evicted, right (result) | evicted, right (result) | tail, right |
| `ticket` | | 3 | 40 | 37 | evicted, wrong | evicted, wrong | tail, right |
| `reviewer` | | 6 | 40 | 34 | evicted, wrong | evicted, wrong | tail, right |
| `row-limit` | | 7 | 40 | 33 | evicted, wrong | evicted, wrong | tail, right |
| `codename` | | 24 | 40 | 16 | evicted, wrong | evicted, wrong | tail, right |

`owner-line` sits in the ≤ 5 band, yet pi-chart evicted it on both Runs. The design anticipated this: only the 8–12 and ≥ 25 bands carry an eviction criterion.

## Revisits

| Revisit | File | Read at | Step, first Turn | Distance | pi-chart Run 2 | pi-chart Run 3 | plain omp |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `samples` | `notes/samples.md` | 12 | `histogram`, 14 | 2 | tail, unfetched | evicted, left | tail, unfetched |
| `rounding` | `notes/rounding.md` | 25 | `render`, 28 | 3 | tail, left | tail, held | tail, unfetched |
| `weights` | `notes/weights.md` | 10 | `weights`, 21 | 11 | evicted, left | evicted, left | tail, unfetched |
| `legend` | `notes/legend.md` | 18 | `render`, 28 | 10 | evicted, left | evicted, left | tail, unfetched |
| `layout` | `notes/format.md` | 9 | `summary`, 35 | 26 | evicted, left | evicted, left | tail, unfetched |
| `thresholds` | `notes/buckets.md` | 1 | `summary`, 35 | 34 | evicted, left | evicted, left | tail, unfetched |

Every Revisit step passed on every Run.

## Probe figures

| Run | Cost per Run | Calls | Passes | Lapses | Failed-Probe Lapses |
| --- | --- | --- | --- | --- | --- |
| pi-chart, Run 2 | $3.8320 | 146 | 6 of 6 | 13 | 6 |
| pi-chart, Run 3 | $4.9107 | 151 | 6 of 6 | 13 | 5 |
| plain omp | $2.4845 | 129 | 6 of 6 | 0 | 0 |

The pi-chart figure was planned at ≤ $3.75 per Run so that 20 Runs fit a $75 Gate. The two Runs of v1 average $4.37, and that figure was accepted: 20 Runs cost about $87. The difference between the two Runs comes from agent behaviour, not the prompts. Each `recall_earlier_turns` result was about 20k tokens, and after each Eviction the tail's cache is rewritten. Run 3 wrote 392k tokens of cache, against Run 2's 269k.

The first probe Run used the earlier suffix, without the notes clause. It is not a v1 figure: the agent read `notes/owners.md` and `notes/conventions.md` at Turn 1, which put `reviewer` 16 Turns back and `owner-line` 31 back. It also re-read `notes/buckets.md` and `notes/format.md` at Turns 31–32, which moved two ≥ 25 Revisits to the near band.

## Authorship

An agent drafted this Workload and the user reviewed it. The work is a new module invented for the benchmark, not production work on pi-chart. The Plants and Revisits are placed to land in their distance bands, not where a real session would put them. Figures from this Workload measure retention and cost under that placement, and say nothing about how often real sessions need a fact back.

## Versions

- **v1:** the draft as reviewed, plus the notes clause in the work-prompt suffix after the first probe. The `codename` Probe is at Turn 26 rather than 27, because Turn 27 closes the `weights` step. The `test-tag` rule covers new test files only, and the first new one is created at Turn 21.
