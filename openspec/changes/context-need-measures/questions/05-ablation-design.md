# Ablation design

Type: grilling
Status: closed
Blocked by: 04-can-a-call-be-replayed, 12-context-attribution-methods

## Question

How is a window part shown to be needed by removing it? Settle the following:

- **Removal unit.** A tail Turn, a tool-call group, the Opening, a Pin, a pulled recall result, or something else.
- **Change test.** How "the next action changed" is judged: the same tool and arguments, a normalised match, or a judge model. Judge-model calibration is part of this.
- **Noise floor.** How it is measured, for example by re-sending the unablated Call k times.
- **Sampling.** Which Calls are sampled, and how many per Conversation.
- **Cost.** The cost per ablated Call, and the cap per run.
- **Calibration.** Whether Ablation's Needed verdicts calibrate the cheaper Utilisation judgement of Used, and how.

## Resolution

- **Units:** one per sampled Call, never from the Call's own Turn. Both Arms: one earlier tool-call group (call + result) or the prose of an earlier Turn (prompt + assistant text). Plain omp only: the compaction summary. pi-chart only: the Opening, one Pin, or one Pull result. The Floor is never a unit.
- **Removal:** cut from the finished request after the Assembler built it; the freed space is not refilled ("needed in *this* window").
- **Sampling:** draw Calls holding at least one unit, pick one unit per Call with probability proportional to its tokens; the plain sample mean estimates a token-weighted share and Calls stay independent.
- **Redundancy:** one-at-a-time removal is a lower bound on need. A unit whose identical content is held elsewhere in the window is flagged *duplicated* and its Needed share reported separately. No Shapley search.
- **Next action changed:** compare the resend's tool calls with the original's first tool call (or *reply*) on (tool, target). Targets: `read`/`edit`/`write` path (range ignored); `grep`/`glob` pattern + path; `bash` command, whitespace collapsed; free-text tools (`find`, recall, docs, `task`, `web_search`, `eval`, `ask`) tool name alone; no tool call is *reply*, and on a Probe Call the Probe's checker decides. No judge model.
- **Noise:** a sham at the unit's position that removes nothing, k = 4 resends per condition. The counting endpoint must show sham − ablated = the unit's tokens, else the unit is excluded. A Call is stable if the sham matches in ≥ 3 of 4; unstable Calls are counted, reported as a share, and redrawn without paying for ablated sends. Needed = ablated matches ≤ 1 of 4 (≈ 5% false rate at a 0.75 true match rate); 2 of 4 is *unclear*. Needed share = Needed / judged units, Wilson 95% interval, with unstable and unclear shares beside it.
- **Cost:** ≈ $0.29 per unit on pi-chart, $0.93 on plain omp (8 resends; the sham writes the cache, the ablated resends read it). Untested arithmetic from ticket 12's prices. Hard cap $10 per Run; sampling stops at the cap.
- **Where it runs:** comparison report, 40 units per Arm (20 on each of 2 Runs), reference model only, ≈ $49 on top of ticket 17's cap. Calibration set once per Workload version, 50 units per Arm + 20 null units, ≈ $67. Gate: off unless `--ablate`; the Gate report shows Needed share as "not measured" otherwise (10 units per side gives ≈ ±30 points).
- **Validation:** positive control, ablate the Plant's Turn on every Probe Call where it is still held; ≥ 80% must come out Needed or the instrument is not trusted. Negative control, 20 null units (a second sham); the empirical false Needed rate should be ≈ 5%.
- **Calibration for ticket 19:** each calibration unit carries both a Used and a Needed verdict; this set is the ground truth for the Utilisation rule (ARES-style correction), frozen with the Workload version and reset like the A/A figures.
- **Instrument:** `scripts/ablate.ts` reads a finished Run and reuses the replay wrapper (`evidence/replay-ext.ts`) in send mode. Offline in ticket 02's sense (after the Run), though unlike the other Measures it costs model calls.
