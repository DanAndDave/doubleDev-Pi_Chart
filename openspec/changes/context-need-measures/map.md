# Map: measuring what context was needed

Wayfinder map. Tickets are `questions/NN-<slug>.md`, each with `Type:`, `Status:` and `Blocked by:` lines. A ticket is on the frontier when it is `open`, unclaimed, and every ticket it is blocked by is `closed`. Claim one by setting `Status: claimed` before any work.

## Destination

Every decision needed to build pi-chart's context-need measures is settled, so `to-tickets` can slice the build into OpenSpec changes. The measures must do three jobs: act as a regression gate on pi-chart changes, give an objective for tuning Budgets, and support a comparison with plain omp that holds up to scrutiny. They must also be computed the same way for both arms.

## Notes

- Scope, per the user: all six measures (the "full gambit"):
  1. tail utilisation
  2. ablation of window parts
  3. re-fetch rate
  4. recall pulls
  5. planted-fact retention
  6. task outcome, with cost per solved task.
- Vocabulary is `CONTEXT.md` (`### Measuring`): Measure, Utilisation/Used, Ablation/Needed, Lapse, Re-fetch, Pull, Plant/Probe/Retention, Graded Task/Pass/Cost per Pass, Arm/Workload/Run. Use those words in tickets and specs.
- Grilling tickets: call `grilling` and `domain-modeling`. Research tickets: `research`. Findings go in the ticket file under `## Resolution`, not `docs/research/` (`docs/agents/issue-tracker.md`).
- The existing instrument is `scripts/bench-tokens.ts`: an arm pair of `omp -p` per Turn, plus a 40-Turn default workload with a codeword and build-number probe. Reuse it rather than starting a second harness.
- Cost reference: 40 Turns, 3 runs per arm comes to about $26 and 804 s at parallel 6. Per Conversation that is $3.77 for pi-chart and $4.89 for plain omp (`docs/benchmarks/2026-10-14-token-usage-40-turns-mark-0.2.md`).
- Since ADR-0015 there is no Briefing. Recall, docs and structure are tools the model pulls, so a Pull is directly observable in the Journal. Ticket 15 lists which tools are Pulls.

## Decisions so far

<!-- one line per closed ticket: [title](questions/NN-slug.md): gist -->

- [Name the measures](questions/01-name-the-measures.md):
  - The family is a **Measure**. It sits beside Accounting rather than inside it.
  - **Used** (from Utilisation) and **Needed** (from Ablation) are separate verdicts.
  - A **Lapse** is needed content that was absent, seen through a recall Pull of an evicted Turn, a Re-fetch of a result that had left the window, or a failed Probe. A Re-fetch made while the result is still held is not a Lapse.
  - A **Re-fetch** is defined by an identical result, not an identical call.
  - Task outcome is named **Graded Task**, **Pass** and **Cost per Pass**.
- [Long-horizon coding benchmarks](questions/11-long-horizon-coding-benchmarks.md):
  - Most suites (SWE-bench family, Terminal-Bench, Commit0) are one prompt per task, so they can only serve as a no-harm check.
  - The closest fits keep one workspace across fixed per-step prompts with tests at each step: EvoCode-Bench, SlopCodeBench and Harbor's multi-step format.
  - Chaining unrelated tasks into one Conversation risks rewarding forgetting.
- [Context attribution methods](questions/12-context-attribution-methods.md):
  - Published methods need log-probabilities or weights, which `claude-opus-5-5` doesn't expose. The options are regenerating with a resend noise floor, an open-weights proxy, or a judge.
  - Leave-one-out gives a lower bound on need, because it scores redundant Turns near zero.
  - Nothing published defines a "changed" tool call. The nearest ready-made rule is BFCL's syntax-tree matcher.
- [Error bars for small-n agent evals](questions/13-error-bars-small-n-agent-evals.md):
  - Use a paired t test on the per-pair log-ratio for cost, and Wilson intervals with exact McNemar for pass rates.
  - At cost CV ≈ 10% and 3 pairs, only about ×1.4–1.6 is detectable. ×1.10 needs about 15 pairs.
  - The levers are a pooled variance, a pass / fail / inconclusive margin, and two looks (at 5 then 10 pairs).
- [Memory benchmark fact planting](questions/14-memory-benchmark-fact-planting.md):
  - No benchmark measures distance in Turns. Ground Truth First found eviction, not distance, drives loss.
  - The norm is near-miss distractors, direct probes, and a separating control (fact-only, no-fact, or retrieval-hit labels).
  - pi-chart's pull log supports splitting results into pulled / not pulled × right / wrong.
- [Where the measures are computed](questions/02-where-the-measures-are-computed.md):
  - Offline only, by a separate script over one finished Run that `bench-tokens` calls. The extension records nothing new.
  - What a Call's window held: Accounting's Turn identities for pi-chart, the Journal's active branch for plain omp. Everything after that is shared code.
- [Model pinning](questions/09-model-pinning.md):
  - Reference is `claude-opus-5-5` at default thinking; every Run records its model id. A model or omp change resets saved reference figures; a price change only recomputes cost.
  - A second model is required only for the comparison report's headline claim.
- [Gate statistics and cost](questions/08-gate-statistics-and-cost.md):
  - Fresh paired Runs of the previous commit, alternated in time. pi-chart against pi-chart only.
  - Gated: Cost per Run (×1.10 non-inferiority) and Lapses per Run, Holm-corrected. Everything else is reported only.
  - Pass / fail / inconclusive, looks at 5 and 10 pairs, pooled σ seeded by a one-time A/A batch, cap ≈ $75 per Gate. Needed share "not measured" unless `--ablate`.
  - Run by hand before `/opsx-archive` for changes touching `src/`.
- [Task suite source](questions/06-task-suite-source.md):
  - Own multi-Turn Workloads drive the Gate and Budget tuning; a probed EvoCode-Bench subset backs the comparison report. No chaining of unrelated tasks.
  - A Graded Task is one Workload step plus a hidden `bun test` check; no repair between steps. About 6 per Run.
  - Pinned workspace commit plus overlay; pi-chart under test via `-e`. One Gate Workload, ~40 Turns, ≤ $3.75 per pi-chart Run.
  - `bench/workloads/<name>/`, agent-drafted, user-reviewed, frozen; an edit is a new version and resets reference figures.
- [Planted-fact matrix](questions/07-planted-fact-matrix.md):
  - Plants ride the Gate Workload. Distance bands ≤ 5, 8–12, ≥ 25 Turns, each Probe tagged Opening / Pin / tail / evicted.
  - Literal, superseded (old value as distractor), and silent constraint; half in prompts, half in tool results.
  - Direct Probes with tools; one tools-forbidden Probe at the end. Deterministic scoring.
  - Attribution offline: source × right/wrong; right with no source is a leak.
- [Measuring both arms alike](questions/03-measuring-both-arms-alike.md):
  - One list of window parts (system prompt, Opening, Pin, summary, tail, current Turn); a part an Arm lacks is empty. Utilisation is a share of the Context Window, measured on tail plus summary.
  - One-Arm Measures (Pulls, compactions, Opening/Pin attribution) report "n/a" on the other side and feed no headline. Lapse stays comparable.
  - Units: Cost per Run and per Pass; Lapses, Re-fetches, Pulls per Run by band; Utilisation per Call token-weighted; Retention per Probe; Needed per ablated Call. Nothing per Turn.
  - Plain omp needs no Thread Store: Journal plus Accounting only.
- [Revisiting workload](questions/10-revisiting-workload.md):
  - Revisits ride the Gate Workload: ~6 steps re-needing a read-only overlay file, in the Plant distance bands. Edited files excluded.
  - Each revisit scored offline: re-fetched while held (redundancy), re-fetched after leaving (recovered Lapse), or not re-fetched. Correctness from the step's check; source tagged tail / summary / evicted.
- [Pulls beyond recall](questions/15-pulls-beyond-recall.md):
  - A Pull is any of five tools that bring content in from outside the Turn; `write_documentation` is counted separately.
  - A recall Pull is classified by result: it holds a same-Conversation Turn the window did not carry. Only these count toward Lapse.
  - `recall_across_conversations` adds result Turn identities to its details: the one exception to "the extension records nothing new".
- [Run isolation](questions/16-run-isolation.md):
  - Each Run gets its own Thread Store database (dropped after measuring) and its own copy of the bundle.
  - The Workload freezes `bundle/` and `graphify-out/`; changing either is a new Workload version.
- [Comparison report shape](questions/17-comparison-report-shape.md):
  - Headlines: Cost per Run, Cost per Pass, Lapses per Run, Retention by band, each a paired difference with a 95% interval.
  - 10 pairs on the Gate Workload, the EvoCode subset, and 10 pairs on a second model. Fixed n, cap ≈ $250, plus ≈ $49 for Ablation.
  - Six fixed caveats, including Workload authorship, chosen-to-evict, different Lapse routes, untuned compaction, and isolation.
- [Budget sweep design](questions/18-budget-sweep-design.md):
  - Any Budget, at most two per sweep, ≤ 9 cells; the default is always a cell.
  - Objective = the Gate's: eligible if Lapses no worse and no Pass-rate collapse; lowest geometric-mean cost; ties by 95% interval on pooled σ; default wins ties.
  - Screen on the Gate Workload (≤ 9 × 3 Runs, round-robin), confirm on a held-out Workload under the Gate procedure; a default changes only if cheaper there. Cap ≈ $175.
- [Can a Call be replayed](questions/04-can-a-call-be-replayed.md):
  - Yes, byte for byte, with the original session id and date pinned and pi-chart's Thread Store migrated before the first Turn. A stub answers each Call from the Journal at no model cost.
  - The `fetch` wrapper in `evidence/replay-ext.ts` is where Ablation removes a unit. Token savings are compared against the endpoint's count of the unchanged rebuild, not `usage` (43–46 token offset).
- [Ablation design](questions/05-ablation-design.md):
  - One token-weighted unit per sampled Call (earlier tool-call group, earlier Turn's prose, summary, Opening, Pin, Pull result), cut after assembly, not refilled. Duplicated units reported apart.
  - Next action matched on (tool, target), no judge. Sham at the same position, k = 4: stable if sham ≥ 3/4, Needed if ablated ≤ 1/4, 2/4 unclear. Wilson interval.
  - ≈ $0.29 / $0.93 per unit; $10 per Run cap. Comparison report 40 units per Arm; calibration set 50 per Arm + 20 null once per Workload version; Gate only with `--ablate`.
  - Plant-Turn positive control ≥ 80% Needed; null false rate ≈ 5%. `scripts/ablate.ts`, offline, reusing the replay wrapper.
- [Judging Utilisation](questions/19-judging-utilisation.md):
  - Judged units: earlier tool-call groups, earlier Turns' prose, the summary; same next action as Ablation. Same-Turn tool results are unmeasured (caveat).
  - Used if any lexical signal fires: target path in the unit, ≥ *s*-token copied span, or ≥ *k* shared rare identifiers. No judge, no embeddings.
  - *s* × *k* from a 9-cell grid by best κ against Needed on the calibration set, one rule for both Arms, frozen per Workload version; κ < 0.4 marks Utilisation "uncalibrated".
  - Utilisation reported raw by unit kind; a separate "PPI" Needed-share row corrects with calibration-set residuals when κ ≥ 0.4.

## Not yet specified

- Nothing. Every ticket is closed; the map is ready for `to-tickets`.

## Out of scope

- Changing any Budget, Ceiling or Assembler behaviour. This effort produces the instrument and the objective; tuning is done by later changes that use them.
- Measuring the Floor. The Assembler cannot reach it (`CONTEXT.md`).
