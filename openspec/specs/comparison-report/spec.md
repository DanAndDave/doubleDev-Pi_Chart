# comparison-report Specification

## Purpose
Comparing pi-chart with plain omp in paired Runs on more than one model and Workload, and reporting the paired differences with two-sided 95% intervals, Ablation beside them and fixed caveats, so the comparison describes what pi-chart costs and retains against plain omp without passing a verdict.

## Requirements

### Requirement: The comparison runs three batches of paired Runs

The comparison SHALL run three batches. Each pair in a batch SHALL be one plain-omp Run and one pi-chart Run of the same Workload or task, on the same model, with both Runs started together. The start order SHALL alternate from one pair to the next.
- **reference**: the Gate Workload on `anthropic/claude-opus-5-5`, until 10 pairs are complete.
- **second model**: the Gate Workload on `anthropic/claude-sonnet-5-5`, until 10 pairs are complete.
- **EvoCode**: every task `bench/evocode/subset.json` marks admitted, on `anthropic/claude-opus-5-5`, with 2 pairs per task.

Every Run SHALL run at the harness's default thinking level. In a Gate Workload batch, a void pair (one where either Run did not complete) SHALL be replaced by a new pair. In the EvoCode batch, a void pair SHALL NOT be replaced. In every batch, a void pair SHALL count toward spend and SHALL be excluded from every paired figure.

Every pi-chart Run SHALL load pi-chart as committed at the `HEAD` the batch started from. The comparison SHALL refuse to start a batch while the working tree has uncommitted changes under `src/`. Each batch SHALL be started on its own, and SHALL write its pairs, its spend, whether its cap stopped it, and why it stopped, if it did, beside its Runs' record folders.

#### Scenario: A void Gate Workload pair is replaced

- **WHEN** the plain-omp Run of the reference batch's third pair fails at Turn 12
- **THEN** that pair SHALL count as void, its cost SHALL count toward the batch's spend, and the batch SHALL run another pair until 10 pairs are complete or the cap is reached

#### Scenario: A void EvoCode pair is not replaced

- **WHEN** one pi-chart Run of an EvoCode task fails a round's Turn
- **THEN** that task SHALL have one complete pair in the report, and no further pair SHALL be run for it

#### Scenario: Uncommitted source stops a batch before it spends

- **WHEN** a batch is started while `src/assembler.ts` has uncommitted edits
- **THEN** the comparison SHALL refuse, naming the uncommitted source, and SHALL start no Run

### Requirement: A batch stops on a Run it cannot count

A batch SHALL stop on either of these:
- a Run whose record names a model other than the batch's, or which completed without a recorded model;
- a Run that could not be run at all, as opposed to one that failed a Turn.

Pairs already running SHALL finish, no new pair SHALL start, the stopped pair's finished Runs SHALL count toward spend, and the batch's record SHALL say why it stopped.

A stopped EvoCode batch MAY be resumed. A resumed batch SHALL refuse unless omp's version, the admitted tasks and `src/` are what the batch ran on. It SHALL run only the pairs its record lacks, the stopping pair included, and keep its void pairs as they are. Its cap SHALL count what it spent before the stop. The stopping pair's Run folders SHALL be kept apart from the batch's Runs, and the record and the report SHALL name every stop resumed past. A batch stopped by its cap, or one that finished, SHALL NOT be resumed.

#### Scenario: A Run on the wrong model stops the second-model batch

- **WHEN** a Run of the second-model batch records `anthropic/claude-opus-5-5`
- **THEN** the batch SHALL stop, start no further pair, and record that Run's label and model as the reason

#### Scenario: A stopped EvoCode batch resumes on its own omp

- **WHEN** the EvoCode batch stopped with 5 of its 8 pairs recorded, one of them void, after spending $56.72, and it is resumed on the omp version it ran on
- **THEN** only the 3 missing pairs SHALL run, the void pair SHALL stay void, the cap SHALL leave $68.28 to spend, and the report SHALL name the stop

#### Scenario: A resume on another omp is refused

- **WHEN** a stopped EvoCode batch that ran on omp 18.12.1 is resumed while `omp --version` prints 18.12.2
- **THEN** the comparison SHALL refuse, naming both versions, and SHALL start no Run

### Requirement: Spend is capped per batch

A pair SHALL start only while the batch's spend, the summed Cost per Run of every finished Run, is below the batch's cap: $80 for reference, $45 for the second model and $125 for EvoCode. Pairs already running when the cap is reached SHALL finish. When the cap stops a batch before it reaches its pairs, the batch record and the report SHALL say so.

#### Scenario: The cap leaves pairs unrun

- **WHEN** the EvoCode batch has spent $126 with two pairs not yet started
- **THEN** neither SHALL start, and the report SHALL state that the cap stopped the batch and give the number of pairs it ran

### Requirement: Headline Measures are paired differences with 95% intervals

For each batch, the report SHALL give each headline Measure over the batch's complete pairs. It SHALL show each Arm's figure, pi-chart's figure against plain omp's, and a two-sided 95% interval. The headline Measures SHALL be:
- **Cost per Run**: the per-pair difference SHALL be the log of pi-chart's Cost per Run over plain omp's. It SHALL be reported as a ratio, with each Arm's figure the geometric mean.
- **Cost per Pass**: a Run's Cost per Run divided by its Passes, as a ratio in the same way. A pair in which either Run has no Pass SHALL be left out, and the number left out SHALL be shown.
- **Lapses per Run**: Re-fetch Lapses plus recall Pulls plus failed-Probe Lapses. The per-pair difference SHALL be pi-chart's count minus plain omp's.
- **Retention by distance band**: one row per Re-fetch distance band. A Run's figure in a band SHALL be the share of its scored Probes of planted Plants at that distance that were right. The per-pair difference SHALL be pi-chart's share minus plain omp's. A pair in which either Run has no such Probe in the band SHALL be left out of that band. A batch whose Workload states no Plants SHALL read "n/a: no Plants".

The interval SHALL be the mean difference plus or minus the Student t quantile at 0.975 times its standard error. The difference SHALL be pooled within tasks: the mean SHALL be the mean of each task's mean difference, and the variance SHALL be pooled over the tasks with degrees of freedom equal to the sum over tasks of complete pairs minus one. A Gate Workload batch is one task. A row whose pooled degrees of freedom are zero SHALL show its difference with no interval. A row with no pair SHALL show no figure. No sequential look, margin, verdict or multiplicity correction SHALL apply.

#### Scenario: Cost per Run is a geometric ratio with its interval

- **WHEN** the reference batch has 10 complete pairs
- **THEN** the report SHALL give each Arm's geometric-mean Cost per Run, the ratio of pi-chart to plain omp as exp of the mean log difference, and the interval's bounds as exp of the mean ± t₀.₉₇₅,₉ × SE

#### Scenario: A pair with no Pass is left out of Cost per Pass

- **WHEN** one complete pair's plain-omp Run passes no graded step
- **THEN** Cost per Pass SHALL be computed over the other pairs, and the report SHALL show that one pair was left out

#### Scenario: EvoCode pairs are pooled within tasks

- **WHEN** each of 4 EvoCode tasks has 2 complete pairs
- **THEN** each headline difference SHALL be the mean of the 4 task means, with 4 degrees of freedom

#### Scenario: A task with one complete pair adds its mean but no degrees of freedom

- **WHEN** one EvoCode task has 1 complete pair and the other 3 have 2 each
- **THEN** that task's difference SHALL count in the mean, and the degrees of freedom SHALL be 3

#### Scenario: A band no pair reaches shows no figure

- **WHEN** no complete pair has a scored Probe in the 25-or-more band
- **THEN** that band's row SHALL show no figure, rather than zero

### Requirement: Pass counts are given per step

For each batch, the report SHALL give, per graded step and per Arm, the number of complete Runs that passed the step out of the complete Runs that graded it, with no interval and no difference. It SHALL also give each Arm's count of Runs per first failing step.

#### Scenario: A step's Passes per Arm

- **WHEN** a Gate Workload step was passed by 9 of 10 complete plain-omp Runs and 10 of 10 pi-chart Runs
- **THEN** that step's row SHALL read 9/10 and 10/10

#### Scenario: A step a Run did not grade is not in its count

- **WHEN** an EvoCode round was graded in 3 of an Arm's 4 complete Runs of the task, and passed in 2
- **THEN** that round's row SHALL read 2/3 for that Arm

### Requirement: One-Arm Measures read n/a

Measures that one Arm cannot have SHALL be reported for the Arm that has them, and SHALL read "n/a" for the other, with no difference or interval. These are Pulls per tool, recall Pulls by band and Compactions per Run. None SHALL feed a headline Measure.

#### Scenario: Compactions are plain omp's alone

- **WHEN** the reference batch is reported
- **THEN** the Compactions per Run row SHALL give plain omp's mean and read "n/a" for pi-chart

### Requirement: Ablation and Utilisation sit beside the headline

After the reference batch, the comparison SHALL ablate both Runs of each of the 2 lowest-indexed complete pairs, 20 units per Run, with at most $10 spent per Run. For each Arm, the report SHALL give the Needed share with its Wilson 95% interval, the unclear and unstable shares, and what Ablation spent. Beside the Needed share it SHALL give each Arm's Utilisation share and its label. It SHALL give each Arm's PPI-corrected Needed share only when the calibration for the batch's Workload version, model and omp version has κ ≥ 0.4. Otherwise it SHALL state why that row is missing. The other batches SHALL NOT be ablated.

#### Scenario: An uncalibrated key has no PPI row

- **WHEN** the committed calibration for the Gate Workload on the reference model has κ = 0.167
- **THEN** the report SHALL give each Arm's Needed share and Utilisation, and SHALL state that the PPI row is uncalibrated for that key

#### Scenario: A failed replay leaves the other Runs' Ablation

- **WHEN** one of the four ablated Runs cannot be replayed
- **THEN** that Run SHALL have no Ablation record, what it spent SHALL count, and the Arm's Needed share SHALL be computed from its other Run

### Requirement: The report states six fixed caveats

The report SHALL carry a caveats section stating:
1. The Gate Workload was written knowing how pi-chart works, and the EvoCode subset is the outside check.
2. The Workloads were chosen to make pi-chart evict, so they show long sessions rather than typical short ones.
3. The Arms recover Lapses by different routes, so zero Pulls on plain omp is not zero Lapses.
4. Plain omp runs at its default compaction settings, untuned.
5. Each Run is isolated, which removes any benefit pi-chart draws from earlier Conversations.
6. Each batch's exact model id and thinking level, as the Runs' records and Journals give them; its omp version; its number of complete and void pairs; and the interval method.

#### Scenario: The thinking level comes from the Runs

- **WHEN** no Run of a batch was given a thinking level and every Run's Journal records `high`
- **THEN** caveat 6 SHALL give that batch's thinking level as `high`, the harness default

#### Scenario: Mixed thinking levels are named

- **WHEN** the Runs of one batch record more than one thinking level
- **THEN** caveat 6 SHALL list each level with its number of Runs

### Requirement: The report is written beside its JSON and can be rebuilt

The report SHALL be written to `docs/benchmarks/<date>-plain-omp-comparison.md`, with `<date>-plain-omp-comparison.json` beside it. The JSON SHALL hold, per batch: its model, Workload or tasks, omp version, pi-chart commit, cap, spend, pairs, and each Run's label, Arm, index, task, model, thinking level, completion, cost, Passes per step, Lapses and Retention scores. It SHALL also hold the headline rows and the Ablation summary. Neither file SHALL hold any prompt text or Journal content. The report SHALL be rebuilt from the batches' output folder with no model Call. A batch not yet run SHALL be reported as not run, and the other batches SHALL still be reported.

#### Scenario: No task text reaches the repository

- **WHEN** the report is written after the EvoCode batch
- **THEN** neither file SHALL contain any EvoCode round's instruction text

#### Scenario: A missing batch is reported as not run

- **WHEN** the report is built after the reference and EvoCode batches but before the second-model batch
- **THEN** the second-model batch's section SHALL say it was not run, and the other two SHALL be reported in full
