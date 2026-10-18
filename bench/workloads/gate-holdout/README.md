# gate-holdout

The held-out Workload of the Budget sweep: 40 Turns over pi-chart's own source at `bca71dc`, in six graded steps and one ungraded recap. A sweep tunes Budgets on `gate` and confirms its winner here, so this Workload shares `gate`'s shape, suffix rules and distance bands, but none of its notes, code or answers. Together the steps build `src/concept-card.ts` and `src/concept-card-render.ts`: a small pure module that renders a one-screen card for a doc-store Concept, on top of `parseConcept` (`src/concept.ts`) and `splitConcept` (`src/sections.ts`), files the Gate Workload never reads. The rules come from `overlay/notes/*.md`, which use fictional badges, numbering, truncation, tag weights, layout and footer marks, so a check passes only if the agent followed the notes.

Every prompt that is not a Probe ends with: "Read a file under notes/ only when this prompt names it. Do not modify anything under notes/ and do not spawn subagents." A tools-allowed question Probe ends with: "Do not modify any files and do not spawn subagents." The two work prompts that carry a constraint Probe (Turns 20 and 31) end with neither.

Each graded step has a check in `checks/<step>.check.ts`, a pure `bun test` file with no store, no Postgres and no network: it builds Concepts from Markdown strings through `parseConcept`. Each step's last prompt names the one test file to run. The bundle is empty. `graphify-out/` was extracted with `--code-only` over a workspace built from this folder.

A held-out Workload is recognised by its `-holdout` name: the Gate refuses it outside `--aa`. That is a guard against accidents, not against intent; tuning anything on this Workload defeats its purpose.

## Turn map

| Turn | Step | Prompt | Probes |
| --- | --- | --- | --- |
| 1 | badges | Read `notes/badges.md`, create `statusBadge` and `trustBadge` | |
| 2 | | States `change-request`; read `src/concept.ts`, explain | |
| 3 | | TypeError on a non-conformant Concept | |
| 4 | | Read `notes/crawl.md` (`crawl-quota`, earlier value); JSDoc | |
| 5 | | Read `notes/stewards.md` (`signoff`); `badgesOf` | |
| 6 | | Read `notes/crawl-next.md` (`crawl-quota`, value); create `src/concept-card.test.ts`, run it | |
| 7 | sections | Read `src/sections.ts`; explain | |
| 8 | | Read `notes/footer.md` for later | |
| 9 | | `cardSections` over `splitConcept` | |
| 10 | | Read `notes/tags.md` for later; JSDoc | |
| 11 | | States `fixture-set`; question on `splitConcept` without `cm_identity` | |
| 12 | | Read `notes/numbering.md` for later; tests for `cardSections` | |
| 13 | | TypeError on a non-conformant Concept | |
| 14 | | Finish, run the test file | |
| 15 | numbering | `numberedHeadings` per `notes/numbering.md` | |
| 16 | | | `signoff` |
| 17 | | Read `notes/layout.md` for later; tests | |
| 18 | | Read `src/sections.ts` again; question | |
| 19 | | Finish, run the test file | |
| 20 | tags | `rankedTags` per `notes/tags.md`, tests in a new `src/concept-tags.test.ts` | `fixture-set` |
| 21 | | States `milestone` (earlier value); read `src/concept.ts` again, question | |
| 22 | | States `milestone` (value); leave out blank tags | |
| 23 | | Remove dead code | |
| 24 | | Read `notes/preview.md`, `tagPreview` per its tag-preview rule | |
| 25 | | | `milestone` |
| 26–27 | | Tests for `tagPreview`; finish, run `src/concept-tags.test.ts` | |
| 28 | render | `bodyPreview` per `notes/preview.md`, `headerLine` per `notes/layout.md` | |
| 29 | | Read `notes/headers.md` (`ledger-line`); tests | |
| 30 | | | `change-request` |
| 31 | | Create `src/concept-card-render.ts` with `renderCard` | `ledger-line` |
| 32 | | | `crawl-quota` |
| 33 | | Finish, run the test file | |
| 34 | footer | `cardFooter` per `notes/footer.md` and `notes/badges.md` | |
| 35–39 | | TypeError; read both modules for duplication; `cardLines`; tests; finish, run the test file | |
| 40 | recap | Answer from memory, tools forbidden | `change-request`, `signoff`, `crawl-quota`, `milestone` |

## Plants

Distances and Positions are as `scripts/measures.ts` reported them for the clean pi-chart probe and the plain-omp probe of v1. The kinds and placements sit in the same bands as `gate`'s: per band, one prompt-placed and one file-placed Plant, two per band.

| Plant | Kind | Stated at | Probe | Distance | Band | pi-chart | plain omp |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `signoff` | literal, `notes/stewards.md` | 5 | 16 | 11 | 8–12 | evicted, right (pull) | tail, right |
| `fixture-set` | constraint, prompt | 11 | 20 | 9 | 8–12 | evicted, wrong | tail, right |
| `milestone` | superseded, prompt (earlier value at 21) | 22 | 25 | 3 | ≤ 5 | evicted, right (pull) | tail, right |
| `change-request` | literal, prompt | 2 | 30 | 28 | ≥ 25 | evicted, right (pull) | tail, right |
| `ledger-line` | constraint, `notes/headers.md` | 29 | 31 | 2 | ≤ 5 | evicted, wrong | tail, right |
| `crawl-quota` | superseded, `notes/crawl-next.md` (earlier value in `notes/crawl.md`, read at 4) | 6 | 32 | 26 | ≥ 25 | evicted, right (pull) | tail, right |
| `change-request` |  | 2 | 40 | 38 |  | evicted, wrong | tail, right |
| `signoff` |  | 5 | 40 | 35 |  | evicted, wrong | tail, right |
| `crawl-quota` |  | 6 | 40 | 34 |  | evicted, wrong | tail, right |
| `milestone` |  | 22 | 40 | 18 |  | evicted, wrong | tail, right |

`ledger-line` and `milestone` sit in the ≤ 5 band, yet pi-chart evicted them, as it did `owner-line` on `gate`; only the 8–12 and ≥ 25 bands carry an eviction criterion. The Turn 40 recap forbids tools, so on pi-chart it answers from the window alone.

## Revisits

A Revisit marked "recall" also had a recall Pull return the Turn of its earlier read during the step.

| Revisit | File | Read at | Step, first Turn | Distance | Band | pi-chart | plain omp |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `numbering` | `notes/numbering.md` | 12 (`sections`) | `numbering`, 15 | 3 | ≤ 5 | evicted, left, recall | tail, held |
| `preview` | `notes/preview.md` | 24 (`tags`) | `render`, 28 | 4 | ≤ 5 | evicted, left | tail, held |
| `tags` | `notes/tags.md` | 10 (`sections`) | `tags`, 20 | 10 | 8–12 | evicted, left, recall | tail, held |
| `layout` | `notes/layout.md` | 17 (`numbering`) | `render`, 28 | 11 | 8–12 | evicted, left, recall | tail, held |
| `footer` | `notes/footer.md` | 8 (`sections`) | `footer`, 34 | 26 | ≥ 25 | evicted, left | tail, held |
| `badges` | `notes/badges.md` | 1 (`badges`) | `footer`, 34 | 33 | ≥ 25 | evicted, left | tail, held |

On pi-chart every Revisit's earlier read was evicted and fetched again (left), and every step passed; plain omp held all six reads in its window.

## Probe figures

| Run | Cost per Run | Calls | Passes | Lapses | Failed-Probe Lapses |
| --- | --- | --- | --- | --- | --- |
| pi-chart | $6.8027 | 168 | 6 of 6 | 11 | 6 |
| plain omp | $9.7787 | 140 | 6 of 6 | 0 | 0 |

The pi-chart figure was planned at ≤ $4.50 per Run so that 20 confirm Runs fit the Gate's $90 cap. The clean Run cost $6.80, most of it cache writes after nine `recall_earlier_turns` Pulls returning about 94k tokens, most of them in Turns 25–33. That figure was accepted, and the sweep's confirm got its own caps, $70 and $140 (`CONFIRM_CAPS` in `scripts/sweep.ts`), rather than reshape this Workload around pi-chart's recall cost.

Two earlier pi-chart probes are void: the agent ran pi-chart's own `bun test`, whose store tests truncated the Run's Thread Store, so those Runs lost their Accounting and stored Turns mid-Run. `scripts/run-url-set.ts` and `run-url-unset.ts` now keep a Run's database out of the agent's shell; the clean Run above ran after that fix.


## Authorship

An agent drafted this Workload for the user's review. The work is a new module invented for the benchmark, not production work on pi-chart. The Plants and Revisits are placed to land in their distance bands, not where a real session would put them. Figures from this Workload measure retention and cost under that placement, and say nothing about how often real sessions need a fact back.

## Versions

- **v1:** the draft as reviewed, unchanged by the probe.
