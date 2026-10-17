## Context

See `proposal.md` for the motivation, and the `ablation` spec for the behaviour.

**What exists:**
- Question 04 proved a replay exact, on omp 18.10.4. Running omp again with a stub that answers from the Journal rebuilt 134 Calls byte for byte, or within the counting endpoint's 43–46 token offset from `usage`, once the session id, the date and the Thread Store's migration timing were pinned.
- The throwaway scripts are `context-need-measures/evidence/replay.ts` and `replay-ext.ts`.
- Since then the Run machinery has moved:
  - `scripts/runs.ts` starts every Run from a workspace template (`buildWorkspace` plus `installDependencies`), a per-Run bundle copy, and a per-Run database migrated by the given pi-chart tree's `PostgresStore`;
  - Runs record into `<out>/runs/<label>/`;
  - omp is now 18.11.0. Its binary still reads `PI_PROXY_ANTHROPIC` and still fires `before_provider_request` (checked with `strings`). Whether its Anthropic Calls still pass through `globalThis.fetch` when the proxy is set has not been run yet.
- `measureRun` already gives every main Call its window, on both Arms (`Call.window`: Opening, Pins, summary, tail Turns). `answerOf` scores a Probe reply.
- `scripts/stats.ts` holds the Gate's statistics.

**What is unavailable:**
- `run.json` does not say which pi-chart tree a Run loaded.
- No plain-omp Run of the Gate Workload exists. The 10 pi-chart Runs of the A/A batch sit in `/tmp/gate-aa-real/runs/`, all at `fd96df4`.

## Goals / Non-Goals

**Goals:**
- One replay path that both the free check and Ablation use.
- Credentials never leave the omp process.
- Every verdict re-derivable from the ablation record without a model Call.
- Spend bounded per Run before any send.

**Non-Goals:**
- Utilisation and the Used verdict. The calibration set only stores what `utilisation-calibration` needs to compute Used later.
- The comparison report's 40 units per Arm (`comparison-report`).
- Subagent Calls: a Run with subagent Journals is refused.
- Shapley or group removal: one-at-a-time is the accepted lower bound.
- Any model other than the reference model.

## Decisions

### 1. Four modules, split by where they run

| Module | Runs in | Holds |
| --- | --- | --- |
| `scripts/ablation.ts` | anywhere; pure | unit listing, locating and cutting in an Anthropic request body, sham breakpoints, duplicated flag, tool targets and match, verdicts, seeded sampling, Needed-share summary |
| `scripts/replay-ext.ts` | inside omp (`-e`) | the fetch wrapper: stub replies, date and session pins, counts, the faithful gate, and, at planned Calls, count check, sends and stability decision |
| `scripts/replay.ts` | the driver process | recreates a record's inputs, runs the Turns, collects per-Call result files, cleans up; CLI `check` |
| `scripts/ablate.ts` | the driver process | plan → replay pass → redraw → record → report; `--controls`, `--null`, `--calibrate`, `--report` |

`ablation.ts` is pure so the rules are tested without omp or a model, and so the extension and the driver share one definition of match and cut. The evidence scripts stay where they are, as question 04's record. Their code is reworked into the two replay modules, not imported.

### 2. Sends happen in the extension, inside the wrapped fetch

At a planned Call, the extension has the finished body and omp's auth headers. In this order, it:
1. counts the unchanged body;
2. checks the faithful band;
3. locates the unit;
4. counts the sham, the cut body and the unit alone;
5. sends 4 shams (one, then three in parallel, so the first writes the cache);
6. decides stability;
7. sends 4 cut resends (or 4 second shams for a null unit);
8. writes the result file;
9. only then answers omp with the Journal's reply, so the replay stays on script.

*Alternatives considered:*
- A separate sender process. It would need the OAuth token handed over or read from omp's store, and the rule is that credentials are never written or passed on.
- Answering omp first and sending asynchronously. omp `-p` may exit before the sends finish.

*Risk:* omp's transport may time out a request held open for minutes. Task 1.3 measured it on omp 18.11.0. By default, three things break a hold:
- the cache warmer sends a request of its own at 270 s, which shifts every later Call's ordinal;
- the stream watchdog aborts the request at 300 s;
- the SDK aborts it at 600 s. With the first-event watchdog at 0, omp passes no timeout, and the SDK falls back to its own 600 s.

The replay therefore runs omp with `providers.cacheWarming: "off"` (a `--config` overlay) and with `PI_STREAM_FIRST_EVENT_TIMEOUT_MS` and `PI_STREAM_IDLE_TIMEOUT_MS` at 6 h. omp passes the first-event value on as the SDK timeout. With these settings, a 13-minute hold completed with no retry and no abort, and every later Call stayed in the band. None of the settings touches a request body.

### 3. Driver and extension talk through files

- **Plan.** The driver writes a plan file named by `REPLAY_PLAN`. Per global main-Call ordinal (the stub's k), it holds:
  - the unit descriptor;
  - the condition (`ablate`, `null` or `control`);
  - the original next action;
  - for a Probe Call, the probed Plants and the original's per-Plant verdicts.

  It also holds the price rates, the remaining cap and the faithful band.
- **Results.** The extension writes `call-NNN.json` for every Call: the unchanged count, and the `usage` total it is compared with. A planned Call also gets:
  - its fate;
  - the counts;
  - each resend's content blocks, `usage` and match;
  - its spend.
- **Driver's part.** The driver derives verdicts with the same pure functions, so the record and the report never depend on the extension's own judgement. The extension judges only stability, because stability decides whether cut resends are paid for.

### 4. Units are listed from the record, located in the body

**Listing.** `unitsOf(turns, address, window, compactions, pins)` lists a Call's units from `readBranch`'s Turns and the window `measureRun` already gives. The listing covers:
- tool-call groups and Pull results of window Turns before the current one (Pull tools from `PULL_TOOLS`, device calls resolved as `invokedTool` does);
- the prose of those Turns;
- the summary;
- the Opening, unless it is the current Turn;
- each Pin.

Tokens are estimated with `approximateTokens` for sampling only. The counted size comes from the endpoint.

**Locating** in the Anthropic body:

| Kind | How it is found |
| --- | --- |
| tool-call group, Pull result | the `tool_use` block with the Journal's call id, and the `tool_result` with that `tool_use_id` |
| prose | the user message whose text is that Turn's prompt; the assistant `text` blocks of the messages that follow it, up to the next prompt |
| Opening | the system block holding `OPENING_FRAMING` |
| Pin | the span of the system text from `[pinned by the user: #<id>,` to the next Pin marker or the block's end |
| summary | the user message holding the Journal's compaction summary text |

A unit not found is *unlocated*.

**Cutting** keeps the body valid:
- blocks are removed;
- an assistant message left with only thinking blocks, or a message left empty, is dropped whole;
- a `system` message (omp's mid-conversation reminder) that the cut leaves after anything but a user message is dropped too, and from the sham as well. The API refuses it in that position: the first calibration attempt hit this on a plain-omp positive control at vanilla-0 Call 92.
- the Messages API joins consecutive same-role messages, so no merge is needed;
- the current Turn is never touched.

**Duplicated** means the unit's whole text, as a string, also occurs in the body outside the unit.

### 5. The sham is the cut without the removal

Both bodies get the same cache breakpoints:
- the existing ones;
- one on the last block before the unit's position;
- when that would exceed the API's 4, the earliest existing breakpoint is dropped from both.

Both bodies also lose the same thinking:
- for a unit in the messages, every thinking block after the unit's position, and the thinking of any message the cut leaves with nothing else;
- for a unit in the system prompt, every thinking block in the messages.

The server drops signed thinking after any change to the request's prefix, so the cut loses it whatever we send. The sham loses it too, so the two differ by the unit alone. Both cases were measured on base-1. With the strip and the unit counted in its own messages, 25 message cuts freed exactly the unit (0 tokens over). An Opening cut at Call 44 freed 1,106 tokens beyond the unit, the size of the 8 thinking blocks after it.

The breakpoints change cost, not output. The lost thinking may change output, so the sham carries it as well. The sham is what isolates the cut's effect from the transformation's.

### 6. Count check and faithful band are constants measured first

**Faithful band:** `OFFSET_BAND = [43, 46]` from question 04. Task 1.2 re-measures it on omp 18.11.0 over the A/A records, and widens or moves it only on that evidence.

**Count tolerance:** |(sham − cut) − unit alone| ≤ max(20 tokens, 5% of the unit alone).
- For a tool-call group or Pull result, the unit alone is counted where it sits: a request of a placeholder user message plus the unit's own call and result messages as the body holds them, siblings kept and thinking left out, minus the same request with the unit cut from them and emptied messages dropped. A call beside another in its message costs about 41 tokens more than the same call alone in a message; on base-1 this rule matched sham − cut exactly for every tool-call unit.
- For any other unit, it is the count of a request holding the unit's blocks in their own messages, roles kept (text blocks for prose, Opening, Pin and summary), minus the count of the same messages with "." in each block. The framing of the messages cancels; the framing of the blocks, which the cut removes, is counted.
- Task 1.4 checks the tolerance on 30 free counts before any send.

### 7. Sampling and redraw by whole replay passes

**Seed.** A seeded PRNG (mulberry32) drives sampling:
- a uniform draw of eligible Calls without replacement;
- one unit per Call, chosen in proportion to its estimated tokens.

Each Run given draws from its own seed, derived from `--seed` and the Run's place in the argument list, and its record holds that seed. Runs of one Workload hold similar Call counts, so a shared seed would draw the same Call ordinals in each.

**Redraw.** A replay pass only meets Calls in order, so a redraw cannot go back.
- After a pass, each Call that ended unstable, unfaithful, unlocated or miscounted is replaced by a fresh draw from the Calls not yet drawn, and another pass runs.
- Passes are free apart from sends.
- A pass stops after the Turn of its last planned Call.

*Alternative considered:* filling the quota with later Calls in the same pass. That biases the sample toward early Calls, which breaks the estimator.

### 8. Pricing from the Run's own Journal

Per-token rates for input, cache read, cache write and output are the Run's summed `usage.cost` per kind over its summed tokens per kind. This gives the rates the provider actually charged the Run, including the one-hour cache-write rate omp uses, with no price table to drift. A resend is priced from its own `usage` at those rates.

The cap is checked before every send, so the overshoot is at most one in-flight batch of 3 sends.

### 9. Probe matching reuses `answerOf`

`answerOf` is exported from `measures.ts` unchanged. A resend on a Probe Call is scored per probed Plant, as the Turn's reply. It matches when every verdict equals the original's. Plant declarations come from `run.json`.

**Positive control units:**

| Plant's Position | Unit cut |
| --- | --- |
| verbatim tail | its planted Turn's whole message range |
| Opening | the Opening |
| Pin | the Pin whose text holds the value |
| summary | the summary |

### 10. Replay inputs, and the pi-chart commit

**Pi-chart commit.** `RunSpec` gains `commit?: string`, recorded in `run.json` as `piChart`.
- The Gate passes each side's sha.
- `bench-tokens` passes `HEAD` only when `git diff --quiet HEAD -- src/` holds.
- `ablate.ts --commit <rev>` supplies it for older records, such as the A/A batch.

**Tree.** The tree is built as the Gate builds its sides (`git archive` plus `bun install --frozen-lockfile`); that builder moves from `gate.ts` to `runs.ts` so both use it. `createDatabase` and `dropDatabase` are exported from `runs.ts`.

**omp.** omp is whatever is on `PATH`; the replay refuses unless `omp --version` equals `run.json`'s `omp`.

**Sessions.** The replay's own Journals land in the session directory beside the original's. They are moved into the replay's output folder afterwards, so the session root holds only what the original Run wrote.

**Thinking level.** `run.json` records the `--thinking` level a Run passed omp, and the replay passes the same one.

**Harness complaints.** A replay Turn fails only when omp exits non-zero, as the original Run's Turn did. omp also prints `Extension error` lines, which the replay reports and goes on past. On candidate-0, pi-chart's `session_shutdown` handler ran past omp's 2 s limit at Turn 32: the replay's Turn still ended normally, and all 156 of its Calls were rebuilt in the band. So the faithful band, not the harness's complaints, decides whether a Call counts.

**Workspace.** pi-chart starts graph extraction detached, so it can outlive omp and write `graphify-out/` into the recorded path after the workspace is removed. The next replay of that Run would then find the path in use. Both a Run (`runOne`) and a replay end every process still working in the workspace before they remove it.

### 11. Records and CLI

**Record.** `<run-dir>/ablation.json`, beside `run.json`. It holds:
- `seed`, `cap`, `band`, `commit`, `omp`;
- `draws[]`: Call ordinal, Turn, condition, fate, unit (kind, estimated and counted tokens, duplicated, location), original action, `resends[]` with condition, action and match, verdict, spend;
- `spend`.

**CLI.** `--dry-run` runs every free step, from the replay through the count check, then prints the fates and counts. It makes no send and writes no `ablation.json`. It is how the band and the tolerance get checked, and how a record is vetted before any spend.

```
bun scripts/replay.ts check <run-dir> [--commit <rev>]
bun scripts/ablate.ts <run-dir>... [--units 20] [--null 0] [--controls] [--cap 10] [--seed <n>] [--commit <rev>] [--parallel <n>] [--dry-run]
bun scripts/ablate.ts --calibrate <run-dir>... [--commit <rev>]
bun scripts/ablate.ts --report <run-dir>...
```

**Concurrency.** Runs are ablated one after another by default. Different Runs can replay concurrently because their recorded paths differ, so `--parallel` reuses `pool` from `runs.ts`.

**Calibration** spreads 50 units per Arm evenly over the given Runs of that Arm, plus 10 null units per Arm and the positive control on every eligible Probe Call. It writes `bench/ablation/calibration.json` (`{ "sets": [] }` to start) under the key, only when the control holds.

A calibration that stops part-way, for example on a network failure in `bun install`, can be rerun with the same Runs. Each record it wrote is marked `calibration`, and the rerun reuses those rather than paying for them again. Any other existing record still makes it refuse.

**Stops.** A count or send that keeps failing stops the Run's Ablation before its record is written. The error names what every pass of that Run had spent and the folder holding the stopped pass's results, and the Gate counts that spend against the side's cap. No partial record is written, so the Run can be ablated again.

### 12. Gate `--ablate`

After the pool write and before the trees are removed, each side runs `ablate` over its complete Runs with 10 units spread across them and a $10 cap. Each Run gets `ablation.json`; `gate.json` holds nothing of Ablation. The report and `--report` compute Needed share from the Runs' `ablation.json`, so a re-print makes no model Call.

## Testing seams

| Requirement | Seam | Test |
| --- | --- | --- |
| The units of a Call | `unitsOf` | `test/ablation.test.ts`, on a synthetic record folder written as `test/measures.test.ts` writes its own: no unit from the current Turn; a Turn-0 Call has no Opening unit; Pull results split from tool-call groups, a device call included; a plain-omp Call after compaction has a summary unit. |
| A unit is cut from the finished request | `locate`, `cut`, `sham` over Anthropic body fixtures | A cut tool group removes both blocks and drops the emptied message. A prose cut leaves the Turn's tool groups. A Pin cut removes only its span. Sham and cut carry identical breakpoints, a body at 4 breakpoints stays at 4, and a string-content message never carries one. Sham and cut lose the thinking after the unit and in the messages the cut empties; thinking before it stays, and a system unit loses all thinking in the messages. A repeated tool result is flagged duplicated. An absent call id is unlocated. |
| The count confirms the cut | `alone`, `countCheck(sham, cut, alone)` | A tool call is counted in its own messages, siblings kept and thinking left out, against them without it; a call alone in its messages takes them with it. Any other unit is its blocks in their own messages against the same messages holding "."; a system span is one user message. The check holds inside max(20, 5%) and fails outside it. |
| Calls and units are sampled | `sample(units, n, seed)` | The same seed gives the same draws. Draws are without replacement. A 1,000-draw frequency check shows unit choice proportional to tokens within 5 points. |
| The next action is compared on tool and target | `targetOf`, `matches` | Each row of the spec's table, including the line selector ignored, whitespace collapsed, a device call resolved, and reply against reply. A Probe resend is scored by `answerOf`. |
| Noise decides the verdict | `stability(matches)`, `verdict(matches)` | 3/4 stable, 2/4 unstable; Needed ≤ 1, unclear 2, not Needed ≥ 3. |
| Needed share is reported with its interval | `wilson(k, n)` in `stats.ts`; `summarise(records)` | 6/20 gives [0.1455, 0.5190]; duplicated units summarised apart; fates counted. |
| Controls test the instrument | `summarise` | 7/10 is not trusted, 8/10 is trusted; the null false-Needed rate. |
| Spend is capped per Run | `priceOf(usage, rates)`, `ratesOf(journal)` | Rates from a synthetic Journal; capped units counted. |
| Only a faithful Call is ablated; A Run is replayed through omp's own code path | smoke | `bun scripts/replay.ts check` on two A/A records with `--commit fd96df4`: every Call inside the band, and no Call billed. |
| Every Ablation leaves a record; Spend is capped per Run | smoke | One paid `ablate.ts` on one A/A record with `--units 3 --cap 3`. Inspect `ablation.json`, `--report` re-printing it, and the refusal on a second run. |
| A calibration set is frozen per key; A Gate measures Needed share only when asked; Every Gate leaves a record and a report | `summarise` plus the calibration writer over fake summaries; smoke | The writer refuses a second set for a key and refuses a failed control. `gate.ts --report` on a folder with fabricated `ablation.json` files prints Needed share. |
| Every Run leaves a self-contained record | `bench-tokens` / Gate smoke | `run.json` has `piChart` on a clean tree and lacks it with a dirty `src/`. |

## Risks / Trade-offs

- **[omp 18.11 no longer routes Anthropic Calls through `fetch` under `PI_PROXY_ANTHROPIC`]** → Task 1.2 is a free check that fails fast. If it fails, the change stops and returns to planning: the alternative, a local HTTPS proxy, changes decision 2.
- **[omp times out a request held open for the sends]** → Task 1.3 holds a stubbed request open for 10 minutes at no cost and watches for a retry or abort. If omp times out, the change stops and returns to planning, because decision 2 would need to change.
- **[The Floor is rebuilt from today's host: skills, rules, omp config]** → the faithful band catches drift per Call. Unfaithful Calls are counted, never ablated.
- **[Cutting a unit early makes the server drop thinking blocks signed against the old prefix]** → the count check excludes the unit. If many early units are miscounted, the miscounted share says so.
- **[Plain omp's units cost about $0.93, so a $10 cap judges only about 10 per Run]** → calibration needs at least 5 plain-omp Runs. That is the budget item in the proposal.
- **[The A/A records live in `/tmp` and may vanish]** → the pi-chart half of calibration uses them if present. Otherwise it needs five new pi-chart Gate Workload Runs, about $22 more. Task 5.2 states which held.
- **[Sends at temperature 1 make single matches noisy]** → that is why there are 4 shams per condition, plus the stability gate and the unclear band.

## Migration Plan

`bench/ablation/calibration.json` starts as `{ "sets": [] }`. The real calibration set runs only with the user's go-ahead, and its entry is committed with this change. If declined, the file stays empty and the archive commit says so. Rollback: delete the four scripts and `--ablate`. `piChart` in `run.json` is additive, and older readers ignore it.
