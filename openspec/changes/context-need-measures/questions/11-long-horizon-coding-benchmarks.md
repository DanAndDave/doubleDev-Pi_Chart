# Long-horizon coding benchmarks

Type: research
Status: closed
Blocked by: —

## Question

Which published benchmarks or methods grade coding agents over long multi-turn Conversations with automatic pass/fail? "Long" means long enough that a context manager must drop history, roughly 25k+ tokens of accumulated Turns. For each candidate, report:

- task count;
- typical Turns and tokens per task;
- grading mechanism;
- licence;
- run cost;
- whether it fits a harness that runs one CLI process per Turn and continues the Conversation;
- whether tasks can be chained into one Conversation.

Include single-shot suites only to say why they do or don't adapt.

## Resolution

Almost every well-known coding benchmark is graded automatically but is **one prompt long**: SWE-bench Verified/Live/Pro, SWE-rebench, SWE-EVO, Terminal-Bench, Commit0 and SWE-Gym give the agent a single instruction and then run tests. A benchmark's "turns" are agent steps, which pi-chart calls Calls. Under one-process-per-Turn, such a task is **one Turn**. pi-chart carries the current Turn whole and only shortens it under the Ceiling (`CONTEXT.md`, *Ceiling*, *Elision*), so these suites never exercise Turn eviction or recall `[INFERENCE]`. Since early 2026, a small group of benchmarks has been published that **deliver several fixed prompts into one persistent workspace and agent session, with executable tests at each step**. These are the direct fit:

- **EvoCode-Bench**: 26 tasks, 227 rounds, 5–15 rounds per task, cumulative tests, one session across rounds.
- **SlopCodeBench**: 36 problems, 196 checkpoints, hidden tests plus regression tests. It starts a fresh session per checkpoint, so it would need `-c` added.
- **Harbor's multi-step task format**: per-step instructions and tests. `--resume-trajectory` continues the agent's session. Harbor's Claude Code agent implements this by launching `claude --continue` for each step, which is exactly the `omp -p -c` pattern.

**Simulator-driven suites** add a user model and are noisier. SWE-Interact and SWE-Together grade the end result with the original tests or an LLM rubric. MINT, τ-bench and Lost-in-Conversation are too short or not about coding. **Chaining** separate single-prompt tasks into one Conversation is published only as SWE-Bench-CL: 273 SWE-bench Verified tasks in 8 chronological per-repo sequences. Its own authors report the harness was unreliable and their results inconclusive. LoCoBench-Agent is long (10K–1M tokens, up to 50 turns) but runs its own agent loop with built-in compression and scores continuous composite metrics, not pass/fail.

### Candidates

"Turns" means user prompts per task, i.e. the number of `omp -p` processes. "Calls" means model requests within the task.

| Candidate | Tasks | Turns / Calls / tokens per task | Grading | Licence | Run cost (reported) | Fits `omp -p -c` per Turn? | Chains into one Conversation? |
|---|---|---|---|---|---|---|---|
| **EvoCode-Bench** (2026) | 26 tasks, 227 rounds | **5–15 Turns**. ~24.4B tokens over 3,657 execution records ≈ 6.7M per record `[INFERENCE: arithmetic]` | Binary reward per round from **cumulative** tests (all still-active earlier requirements). MT@4 fail-stop score, plus SR from a reference-completed state | Repo MIT; dataset CC-BY-NC 4.0 | Heavy: 24.4B tokens for 13 agents × 26 tasks × 4 attempts | **Yes, native.** One container and one agent session persist across rounds. Ships Harbor multi-turn extensions | Yes, by design (rounds within a task) |
| **SlopCodeBench** (2026) | 36 problems, 196 checkpoints (~5.4 per problem) | **~5 Turns**. 2 h limit per run, no turn or cost cap. 13.18B tokens in total | Hidden functional tests plus all earlier checkpoints' tests as regression. Erosion and verbosity also scored | MIT (repo) | Opus 4.5–4.7: $2.17–$3.17 per checkpoint, $425–$621 per model run | **Partly.** The workspace carries forward, but "we do not provide the prior conversation's context". Adding `-c` turns it into a Conversation `[INFERENCE]` | Yes, workspace chain. Conversation chain only if adapted |
| **Harbor multi-step tasks** (method + runner) | Any task authored in the format | N steps, each with `instruction.md` and `tests/` | Per-step verifier reward. Trial reward is `mean` or `final`. `min_reward` early stop | Apache-2.0 | n/a | **Yes.** `--resume-trajectory` "requires an agent with native resume support". The Claude Code agent appends `--continue` per step. omp would need a `BaseInstalledAgent` with `resume=True` `[INFERENCE]` | Yes. The environment always persists; the session persists with resume |
| **SWE-Interact** (Scale, 2026) | 75 (25 each from SWE-bench Pro, SWE Atlas, DeepSWE) | ~3–8 user-agent exchanges. 108–425 steps, 0.35–0.36M tokens per trial (GPT 5.5, Opus 4.8) | The **original task's verifier** (unit tests and/or rubrics) on the final state. LLM user simulator with persona | Apache-2.0 | $9.84–$11.80 per trial (2.3–3.5× the single-turn version) | **Poorly as shipped.** The user speaks through an MCP `ask_user` **tool** inside one agent run, so it is one Turn with many Calls. Would need re-plumbing so that each user message becomes a Turn `[INFERENCE]` | Within task only |
| **SWE-Together** (2026) | 109 (from 11,260 real sessions; 23 come from "Pi-staging") | Variable. The simulator injects user turns or a no-op. 30k–74k output tokens and 10.7–23.3 min per task | **LLM rubric judge** with a 0.85 threshold, plus deterministic verifiers. Not purely automatic | Apache-2.0 | Not given in $ | Possible: each injected message becomes a new `omp -p -c` `[INFERENCE]`. Simulator variance differs between arms | Within task only |
| **MTAC-IFBench** (2026) | 100 | 7.04 Turns, 91 constraints per instance | Per-item checklist: verification scripts **plus judge agents** (Playwright) | Dataset CC-BY-4.0 | Judge cost noted as a limitation | Yes: fixed per-turn instructions `[INFERENCE]` | Within task |
| **SWE-Bench-CL** (2025) | 273 tasks in 8 per-repo chronological sequences (22–50 each) | 22–50 Turns if run as one Conversation | SWE-bench tests per task, plus continual-learning metrics (forgetting, transfer) | MIT | Not reported. Authors call their own results "inconclusive and unreliable" with "frequent harness execution issues" | Yes, but each task has its own base commit and Docker image, so the repo changes under the Conversation between Turns `[INFERENCE]` | **Yes, by design**: the only published chain of separate tasks |
| **LoCoBench-Agent** (Salesforce, 2025) | 8,000 scenarios (synthetic codebases) | Up to 50 turns. 10K–1M tokens of context. Best models average 12–20 turns | Composite continuous scores (comprehension and efficiency, 9 metrics). **No binary pass/fail** | Apache-2.0 | Not reported | **No.** Own ReAct loop with its own 3-tier context compression, which would confound pi-chart | Within scenario |
| **SWE-EVO** (2025) | 48 | 1 Turn (a release note bundling many PRs). Edits span ~21 files | FAIL_TO_PASS and PASS_TO_PASS tests (~874 per task), plus Fix Rate | MIT | Not reported in $ | One Turn only. Splitting the bundled PRs into one Turn each is named as future work by the authors | Could be split per PR `[INFERENCE]` |
| **SWE-bench Pro** (2025) | 1,865 (731 public) | 1 Turn. Paper caps at 50 turns (Calls) and $2 | FAIL_TO_PASS and PASS_TO_PASS tests | MIT code; GPL source repos | ≤ $2 per task in the paper's runs | One Turn only. OpenAI found 27–34% of tasks broken and retracted its recommendation (Jul 2026); SWE-Bench Pro Verified (Sep 2026) re-curates it | Only by external chaining |
| **SWE-bench Verified / Live / SWE-rebench** | 500 / 1,319+ monthly / 21k+ | 1 Turn | FAIL_TO_PASS and PASS_TO_PASS in Docker | MIT / MIT / CC-BY-4.0 | Not measured here | One Turn only. OpenAI: Verified "increasingly contaminated", flawed tests | Only by external chaining (as SWE-Bench-CL does) |
| **Terminal-Bench 2.0 / 2.1** | 89 (2.1 fixes 28 of them) | 1 Turn. Most trials take < 25 Calls and < 10M tokens, < 20 min. Outliers reach ~100M tokens and 2 h | pytest checks on final container state | Apache-2.0 | "$1 to $100" per full run, depending on model | One Turn only. The Harbor runner fits (see above) | Only by external chaining, and every task has its own container |
| **Commit0** (2024) | 54 libraries (lite: 16) | 1 Turn as specified. Spec alone is 10k–300k tokens | % of the library's unit tests passing | MIT | Claude 3.5 Sonnet, 3-stage agent on lite: ~$99 | One Turn, or one Turn per module `[INFERENCE]`. Long inputs make it a Ceiling test | Per-module split possible `[INFERENCE]` |
| **SWE-Gym** (2024) | 2,438 | 1 Turn | Unit tests | Code Apache-2.0, data MIT | n/a (training set) | One Turn only | No |
| **MINT** (2023) | 586 (136 coding: HumanEval 45 + MBPP 91) | ≤ 5 turns. ~3M prompt tokens for the whole eval | Task answer check. GPT-4-simulated feedback | Apache-2.0 | ~$100 per evaluated LLM | Yes, but far below 25k tokens | No |
| **τ-bench / τ²-bench** | 115 retail + 50 airline (+ telecom in τ²) | Tens of turns with a simulated user | Final **database state** against the goal state. pass^k | MIT | Not reported | Shape fits, but the tasks are not coding | No |
| **Lost in Conversation** (method) | Shards single-turn tasks, incl. code | One shard revealed per turn | The original task's grader | MIT | n/a | A recipe for making any test-graded prompt multi-Turn | n/a |

### Implications for pi-chart

- **Single-prompt suites cannot measure eviction or recall.** Every byte is in the current Turn, which pi-chart never evicts. Options:
  - (a) Use them only as a **no-harm check**: same outcome and cost as vanilla when nothing is evicted. This is cheap, because the arms should match.
  - (b) Turn them into Conversations: split them (SWE-EVO per PR, Commit0 per module, Lost-in-Conversation sharding) or chain them (SWE-Bench-CL-style sequences).
  - Trade-off: (b) creates a new, unpublished benchmark that the comparison must defend on its own.
- **Fixed-prompt multi-round suites keep the arms alike.** EvoCode-Bench, SlopCodeBench (with `-c`) and Harbor multi-step tasks send byte-identical Turn prompts to both arms. User-simulator suites (SWE-Interact, SWE-Together, MINT, τ) adapt to the trajectory, so the arms see different prompts. That adds variance and an extra model to pin.
- **EvoCode-Bench is the closest ready-made match.** Each round is a Turn with a binary test result; cumulative tests catch an agent that forgot an earlier requirement. Its supersession and conflict rounds are a natural, non-artificial analogue of planted-fact retention `[INFERENCE]`. Costs:
  - expensive (millions of tokens per attempt);
  - Docker infrastructure;
  - dataset licence is NC.
  - Its 5–15 rounds may or may not push the accumulated Turns past the tail Budget. This needs measuring before adopting it.
- **Two runner options.**
  - (a) Write an omp Harbor installed agent with resume support (`omp -p` then `omp -p -c`). This unlocks Terminal-Bench, EvoCode-Bench, SWE-Interact and Harbor's SWE-bench adapters with no new task authoring.
  - (b) Port the per-step "instruction + test script" format into `scripts/bench-tokens.ts` as a verifier hook after each Turn.
  - (a) gets public tasks and containers; (b) honours the map's note to reuse the existing instrument and avoids Docker.
- **Chaining independent tasks into one Conversation** (SWE-Bench-CL-style, or a Terminal-Bench playlist) gives very long Conversations cheaply. But each Turn's history mostly becomes irrelevant to the next task. That inflates measures of unneeded context and rewards aggressive eviction, so it may tune Budgets toward forgetting `[INFERENCE]`. It also requires a workspace reset or swap between Turns.
- **Benchmark validity caveats** to carry into the comparison report: SWE-bench Verified is contaminated; ~30% of SWE-bench Pro tasks are broken (OpenAI audits); Terminal-Bench 2.1 re-fixed 28 of its 89 tasks. Outcome deltas on these suites carry label noise on top of run variance.
- **Size against the current cost reference.** About $3.77–$4.89 per 40-Turn Conversation (map). Per published trial: SWE-Interact ≈ $10–12, SlopCodeBench ≈ $2–3 per checkpoint. A 26-task EvoCode pass per arm is likely well above the bench-tokens budget `[INFERENCE]`.

### Sources

- EvoCode-Bench: [arXiv 2605.24110](https://arxiv.org/abs/2605.24110) and [HTML, appendices F.3, G.13, licensing](https://arxiv.org/html/2605.24110v1); [repo](https://github.com/UniPat-AI/EvoCodeBench)
- SlopCodeBench: [arXiv 2603.24755](https://arxiv.org/abs/2603.24755) and [HTML](https://arxiv.org/html/2603.24755); [repo (MIT)](https://github.com/SprocketLab/slop-code-bench)
- Harbor multi-step tasks: [docs](https://docs.harborframework.com/tasks/multi-step); [custom agents](https://docs.harborframework.com/agents/custom-agents); Claude Code agent `resume=True` and `--continue` per step: [claude_code.py](https://github.com/harbor-framework/harbor/blob/main/src/harbor/agents/installed/claude_code.py)
- SWE-Interact: [arXiv 2606.30573](https://arxiv.org/html/2606.30573v1); [repo (Apache-2.0)](https://github.com/scaleapi/SWE-Interact)
- SWE-Together: [arXiv 2606.29957](https://arxiv.org/html/2606.29957v1); [repo (Apache-2.0)](https://github.com/Togetherbench/SWE-Together)
- MTAC-IFBench: [arXiv 2609.14992](https://arxiv.org/html/2609.14992v1); [dataset](https://huggingface.co/datasets/thu-coai/MTAC-IFBench)
- SWE-Bench-CL: [arXiv 2507.00014](https://arxiv.org/html/2507.00014v1); [repo (MIT)](https://github.com/thomasjoshi/agents-never-forget)
- LoCoBench-Agent: [arXiv 2511.13998](https://arxiv.org/html/2511.13998v1); [repo (Apache-2.0)](https://github.com/SalesforceAIResearch/LoCoBench-Agent)
- SWE-EVO: [arXiv 2512.18470](https://arxiv.org/html/2512.18470v6); [repo (MIT)](https://github.com/SWE-EVO/SWE-EVO)
- SWE-bench Pro: [arXiv 2509.16941](https://arxiv.org/html/2509.16941v2); [repo (MIT)](https://github.com/scaleapi/SWE-bench_Pro-os); OpenAI audit: [Separating signal from noise](https://openai.com/index/separating-signal-from-noise-coding-evaluations/); [SWE-Bench Pro Verified, arXiv 2609.08149](https://arxiv.org/abs/2609.08149)
- SWE-bench Verified: [repo (MIT)](https://github.com/SWE-bench/SWE-bench); [OpenAI: why we no longer evaluate SWE-bench Verified](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)
- SWE-bench-Live: [arXiv 2505.23419](https://arxiv.org/abs/2505.23419); [dataset (MIT)](https://huggingface.co/datasets/SWE-bench-Live/SWE-bench-Live). SWE-rebench: [arXiv 2505.20411](https://arxiv.org/abs/2505.20411); [dataset (CC-BY-4.0)](https://huggingface.co/datasets/nebius/SWE-rebench)
- Terminal-Bench: [arXiv 2601.11868](https://arxiv.org/html/2601.11868); [2.1 release notes](https://www.tbench.ai/news/terminal-bench-2-1); [repo (Apache-2.0)](https://github.com/harbor-framework/terminal-bench-2)
- Commit0: [arXiv 2412.01769](https://arxiv.org/html/2412.01769); [repo (MIT)](https://github.com/commit-0/commit0)
- SWE-Gym: [arXiv 2412.21139](https://arxiv.org/abs/2412.21139); [repo (Apache-2.0)](https://github.com/SWE-Gym/SWE-Gym)
- MINT: [arXiv 2309.10691](https://arxiv.org/html/2309.10691); [repo (Apache-2.0)](https://github.com/xingyaoww/mint-bench)
- τ-bench: [arXiv 2406.12045](https://arxiv.org/html/2406.12045); τ²-bench: [arXiv 2506.07982](https://arxiv.org/abs/2506.07982); repos [tau-bench](https://github.com/sierra-research/tau-bench), [tau2-bench](https://github.com/sierra-research/tau2-bench) (MIT)
- Lost in Conversation: [arXiv 2505.06120](https://arxiv.org/html/2505.06120); [repo (MIT)](https://github.com/microsoft/lost_in_conversation)
- pi-chart terms: `CONTEXT.md` (*Turn*, *Call*, *Context Pack*, *Ceiling*, *Elision*); harness: `scripts/bench-tokens.ts` lines 11–13 and 274–280.
