# Design: Gate Workload

## Context

What the archived slices built, which this Workload must satisfy:

- **`scripts/workload.ts` `loadWorkload`** validates everything `benchmark-runs` lists. In particular:
  - a prompt-placed Plant's value sits in exactly one prompt;
  - a tool-result Plant's file is under `overlay/`, holds the value, and is named by a prompt before the Plant's first Probe;
  - a superseded Plant's earlier value comes first;
  - no value contains another;
  - a constraint Plant cannot be probed by a prompt that forbids tools;
  - a Revisit's step has a check, and its earlier step names its file.
- **`buildWorkspace`** extracts the commit's tracked files except `bench/` (`git archive`, so every file's mtime is the commit time), copies `overlay/` and `graphify-out/` over them, and runs `git init`. Checks enter only at check time.
- **`scripts/measures.ts`**:
  - A Plant's distance runs from the Turn that stated it to its Probe. Its Position is read from the Probe's first Call.
  - A constraint Plant is right when any tool call of the Probe Turn carries its value in an argument.
  - A superseded Plant's answer that gives the earlier value is Stale.
  - A Revisit's distance runs from the **last** Turn before its step whose tool call named the file to the step's **first** Turn. Its Position is read from the step's first Call.
  - The measures output numbers Turns from 1, and so does this document.
- **pi-chart defaults**: `PICHART_TAIL_TURNS=8`, `PICHART_TAIL_TOKENS=25000`, `PICHART_TAIL_LOW_WATER=0.2`. The tail drops to the low-water mark in one step, so content 8 or more Turns back is out of the tail whatever its size. The Opening carries Turn 1's prompt, never its tool results.
- **Cost reference**: `read-only-40` costs about $3.77 per pi-chart Run and $4.89 per plain-omp Run. Its every Turn reads a large file, which fills the tail to its token Budget.
- **`.gitignore`** has `graphify-out/` with no leading slash, so it also ignores `bench/workloads/*/graphify-out/`.

## Goals / Non-Goals

**Goals:**

- One frozen Workload whose Plants and Revisits each land in their planned distance band, which pi-chart evicts in the middle and far bands, and which costs at most $3.75 per pi-chart Run. (The probe missed this target; see decision 6, step 6.)
- Checks that a correct solution passes and the untouched workspace fails, so a Fail means the agent got the step wrong.

**Non-Goals:**

- The held-out Workload of the Budget sweep (`budget-sweep`).
- Reference figures, A/A calibration and pooled σ (`regression-gate`).
- Changing `bench-tokens`' default Workload, which stays `read-only-40`.
- Any change to `scripts/` or `src/`. If a probe shows the instrument wrong, that is a separate change.

## Decisions

### 1. Name, commit, inputs

- **Name `gate`, version 1.** The name says what it is for. A later revision is `gate` v2, not a new name, so the Gate's reference figures stay keyed by one folder.
- **Commit: `HEAD` when the draft is written**, currently `6eb0d6d`. Every file the steps read (`src/tokens.ts`, `src/turns.ts`, `src/shares.ts`, `src/messages.ts`) exists there. Pinning a commit, not `HEAD`, keeps both sides of a Gate on the same code.
- **`bundle/` is empty** (`.gitkeep`, as in `smoke`). A curated bundle would invite `search_documentation` Pulls that compete with recall for the same facts, and nothing in the Workload needs it.
- **`graphify-out/` holds `graph.json` and `manifest.json` only**, extracted with `~/.pi-chart/graphify/bin/graphify extract <dir> --code-only` over a workspace built by `buildWorkspace`. graphify's `cache/` is left out: it only speeds re-extraction, which a Run never does. `.gitignore` gains `!bench/workloads/*/graphify-out/`.

### 2. The work: one module over six steps

The steps build `src/budget-table.ts`, a pure module that tabulates the token sizes of a Conversation's Turns against a Budget. It uses the repo's own `reconstructTurns`, `approximateTokens` and `shares`. Each step adds exports that its check imports from `./src/budget-table.ts` (and step 5 also from `./src/budget-render.ts`). The rules come from `overlay/notes/*.md`, written with fictional thresholds, labels and weights, so a check passes only if the agent used the notes.

| Step | Turns | Builds |
| --- | --- | --- |
| `buckets` | 1–7 | `bucketOf(tokens)`: names a Turn's size by the thresholds in `notes/buckets.md` |
| `turn-sizes` | 8–13 | `turnSizes(messages)`: one estimated size per reconstructed Turn |
| `histogram` | 14–20 | `histogram(sizes)`: count per bucket, in the order and with the empty buckets `notes/samples.md` specifies |
| `weights` | 21–27 | `weighted(sizes)`: sizes scaled by the per-bucket weights in `notes/weights.md`, rounded as `notes/rounding.md` says |
| `render` | 28–34 | `renderTable(...)` in `src/budget-render.ts`: rows labelled per `notes/legend.md`, numbers per `notes/rounding.md` |
| `summary` | 35–39 | `summaryLine(...)`: the footer `notes/buckets.md` gives, laid out as `notes/format.md` says |
| `recap` | 40 | ungraded; the final tools-forbidden Probe |

Each step ends with a prompt that asks the agent to finish, run its own test file, and stop. Every prompt that is not a Probe ends "Do not modify anything under notes/ and do not spawn subagents." This keeps every Revisit file unedited and keeps every fetch in the main window.

Alternative considered: real changes to existing modules such as `src/assembler.ts`. Rejected because each Turn would read a 1,000-line file, as in `read-only-40`, which already costs $3.77 with no writing. A pure unit check of such a change would also pin incidental internals. A new module over small existing ones is still real code against this repo's types, and the window still fills, because pi-chart's tail evicts by Turn count as well as tokens.

### 3. Plants

| Plant | Kind | Placement | Stated at | Probes (tools) | Distance | Band |
| --- | --- | --- | --- | --- | --- | --- |
| `ticket` | literal | prompt | 3 | 30 | 27 | ≥ 25 |
| `reviewer` | literal | `notes/owners.md`, read at 6 | 6 | 17 | 11 | 8–12 |
| `row-limit` | superseded | `notes/limits.md` (earlier, read at 4), `notes/limits-next.md` (value, read at 7) | 7 | 33 | 26 | ≥ 25 |
| `codename` | superseded | prompt: earlier value at 22, value at 24 | 24 | 27 | 3 | ≤ 5 |
| `test-tag` | constraint | prompt | 11 | 21 | 10 | 8–12 |
| `owner-line` | constraint | `notes/conventions.md`, read at 29 | 29 | 32 | 3 | ≤ 5 |

The final Probe at Turn 40 forbids tools and asks for `ticket`, `reviewer`, `row-limit` and `codename` (distances 37, 34, 33 and 16).

- **No Plant in Turn 1.** The Opening carries Turn 1's prompt for the whole Run, so a Plant there could never be evicted.
- **Plants are project facts the code never uses**: a review ticket, a reviewer, a row limit, a codename. A value that entered the code would come back in later tool results, giving its Score a `result` Source instead of testing the window.
- **Constraints go into actions the Probe Turn must take.**
  - `test-tag` is a house rule for test files, and Turn 21 asks for a test.
  - `owner-line` is a first line every new source file carries, and Turn 32 asks for `src/budget-render.ts`.
- **Values are fictional and distinct** (letter-digit codes and four-digit numbers), so none is guessable and none contains another, as `loadWorkload` requires.

### 4. Revisits

| Revisit | File | Read at (earlier step) | Step, first Turn | Distance | Band |
| --- | --- | --- | --- | --- | --- |
| `samples` | `notes/samples.md` | 12 (`turn-sizes`) | `histogram`, 14 | 2 | ≤ 5 |
| `rounding` | `notes/rounding.md` | 25 (`weights`) | `render`, 28 | 3 | ≤ 5 |
| `weights` | `notes/weights.md` | 10 (`turn-sizes`) | `weights`, 21 | 11 | 8–12 |
| `legend` | `notes/legend.md` | 18 (`histogram`) | `render`, 28 | 10 | 8–12 |
| `layout` | `notes/format.md` | 9 (`turn-sizes`) | `summary`, 35 | 26 | ≥ 25 |
| `thresholds` | `notes/buckets.md` | 1 (`buckets`) | `summary`, 35 | ≥ 28 | ≥ 25 |

- **The Revisit step's first prompt is the one that needs the file and names it.** Distance and Position are measured at the step's first Turn.
- **No prompt between the earlier read and the step names the file.** Distance runs from the last read, so a prompt naming it in between would shorten the Revisit. An unprompted re-read by the agent does the same. That is measured, not prevented, and the README reports the distances the probe actually saw.
- **The step needs a part of the file that nothing before it put into code or prompts.**
  - `buckets.md` holds both the thresholds that step 1 encodes and the footer template that only step 6 uses.
  - `samples.md` is read in step 2 "for later" and used in step 3.
  - The other files follow the same pattern.

  So the step's check passes only if the agent recalled or re-fetched the file.
- Revisit files and Plant files are disjoint. A Revisit's file is never a Plant's.

### 5. Checks

`checks/<step>.check.ts` imports the step's exports from the workspace and asserts outputs that follow from the notes, as `smoke`'s checks do. Before any Run:

- A throwaway reference solution, written in a workspace built by `buildWorkspace`, passes all six checks.
- The untouched workspace fails all six.

The reference solution is not kept: the folder layout `benchmark-runs` fixes has no place for it, and a v2 rewrites its checks anyway.

A step's check tests only that step's exports, plus earlier ones it calls through. A break in step 2 can then fail step 3, which is the "no repair between steps" rule.

### 6. Probe and freeze

1. The user reviews the draft before any Run.
2. Then one pi-chart Run, alone (`--arm pi-chart --runs 1`). Its measures output must show:
   - all 40 Turns complete and all six checks run;
   - every Plant and Revisit read at its planned Turn and in its planned band;
   - the four Plants and four Revisits of the 8–12 and ≥ 25 bands Positioned `evicted` (Revisits may also be `summary`);
   - Cost per Run ≤ $3.75.
3. If that holds, one plain-omp Run must complete all 40 Turns and run every check.
4. A failed criterion revises the draft and repeats the probe. The levers, in order:
   - cut Turns that carry no Plant, Revisit or Probe, keeping every distance;
   - shorten reads.
5. Probe spend stops at $30 for a decision from the user.
6. **Outcome.** Probe 1 met the cost target but missed the Positions: the agent read `notes/owners.md` and `notes/conventions.md` at Turn 1, and most of `notes/` again at Turns 31–32. The fix was a suffix on every non-Probe prompt: "Read a file under notes/ only when this prompt names it." With it, Probes 2 and 3 put every Plant and Revisit at its planned Turn and evicted all eight in the 8–12 and ≥ 25 bands. They cost $3.83 and $4.91 (mean $4.37). The spread comes from agent behaviour, not the draft: `recall_earlier_turns` results of about 20k tokens each, and the tail's cache rewrite after each Eviction. The levers above save cents per Turn, so they could not close the gap reliably. The user accepted the measured mean as the per-Run figure instead of revising further.

Pass rates are recorded, not gated. A step every Arm fails, or every Arm passes trivially, is reported to the user at freeze rather than tuned in a loop.

Freezing commits the Workload with a README, as in `read-only-40`. The README gives the Turn map, the Plant and Revisit tables with the distances the probe measured, the probe figures per Arm, and a `## Versions` section.

## Risks / Trade-offs

- [A single probe Run under $3.75 can still average over it] → freeze only with at least $0.25 headroom, or run a second pi-chart Run and judge the mean.
- [The agent re-reads a Revisit file unprompted, shortening its distance] → measured per Run, not prevented. If the probe shows a Revisit out of band, move the read or reword the step, then probe again.
- [The agent runs the whole repo suite, which needs Postgres and costs time] → each step's prompts name the one test file to run.
- [The near band (≤ 5) may still be evicted when the tail drops to low water just before the Probe] → that is a real Position, recorded by the Measures. Only the 8–12 and ≥ 25 bands carry an eviction criterion.
- [`graph.json` freshness is judged by mtimes, and a copied workspace has new ones] → `git archive` gives source files the commit time, older than the frozen graph, so the graph reads as fresh until the agent edits. The probe checks that `codebase_structure`, if called, does not mark the untouched files stale.
- [The theme is a new module, not production work] → stated in the README and later in the comparison report's Workload-authorship caveat.

## Migration Plan

Additive. Nothing reads `bench/workloads/gate/` until `regression-gate`. Rollback deletes the folder and the `.gitignore` line.

## Testing seams

No code changes, so no permanent tests. Each requirement is verified through an existing seam:

- **Well-formed Workload**: `loadWorkload` from `scripts/workload.ts`, called by a throwaway `bun -e` before any Run; `bench-tokens` calls it again and rejects before any Run starts. Never import `scripts/bench-tokens.ts`: it has no `import.meta.main` guard and starts a benchmark on import.
- **Checks decide Pass and Fail correctly**: each check run with `bun test` in a workspace built by `buildWorkspace`, once with the reference solution and once untouched.
- **Bands, eviction and cost**: `bun scripts/measures.ts <out>/runs/pi-chart-0` over the probe Run, read against the tables in decisions 3 and 4.
