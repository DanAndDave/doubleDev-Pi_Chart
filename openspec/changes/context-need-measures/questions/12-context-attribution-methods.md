# Context attribution methods

Type: research
Status: closed
Blocked by: —

## Question

What methods attribute an LLM's output to parts of its input context? Examples: leave-one-out ablation, ContextCite-style surrogate models, attention or gradient attribution, and judge-model relevance labelling. For each method, report:

- what access it needs (black-box API or weights);
- its cost per attributed output;
- how it decides "the output changed", especially for tool-using agents whose output is a tool call rather than prose;
- how it handles sampling noise;
- any published validation of it against ground truth.

## Resolution

Researched 2026-10-14 against the primary papers, the provider docs and the benchmark docs listed under Sources.

**Answer.** Published context attribution falls into three families.

1. **Likelihood-based "contributive" methods.** These are leave-one-out (LOO), ContextCite, AttriBoT, Shapley/TracLLM, AT2, and gradient or attention saliency. None of them regenerates. Each keeps the original response fixed and measures how its log-probability moves when context parts are removed. So the change test is a continuous number and sampling noise never enters. In exchange, they need per-token log-probabilities of a *given* response, which in practice means open weights. pi-chart's bench model, `claude-opus-5-5`, does not offer this. The Messages API reference has no log-probability option. Since Claude Opus 4.6, models reject any `temperature` other than 1.0, and Anthropic states that output "will not be fully deterministic" even at 0.
2. **Generation-based ablation.** This works through a black-box API. It regenerates under each ablation and compares outputs with a match function:
   - BLEU in TracLLM's black-box variant;
   - embedding cosine in AgentSHAP;
   - action-match and the probability of a bad outcome, with confidence intervals, in Causal Agent Replay (CAR).

   It needs repeated samples per condition to separate an effect from noise.
3. **Judge-model labelling.** This includes self-citation. It is cheap, but it measures *corroboration* ("does this source support it"), not *cause*. Validation is modest: about 80% macro-F1 on AttributionBench, 14.2% step-level accuracy on Who&When, and self-citation precision of 0.22 in TracLLM.

Agent-specific work exists but is thinly validated. The largest set is 16 human-labelled cases; the alternatives are synthetic causal models and 60 simulated traces. No paper defines "the output changed" for a tool call beyond scoring the likelihood of the serialised call or matching regenerated actions. The nearest ready-made equivalence rule is the Berkeley Function Calling Leaderboard (BFCL) Abstract Syntax Tree (AST) matcher.

One finding matters directly to pi-chart. Plain LOO misses parts that are *redundant*, meaning another part independently carries the same information. In TracLLM, LOO precision was 0.17–0.21, against 0.94–0.98 for Shapley-based search. Coding-agent trajectories are full of redundant copies (AgentDiet).

### Methods

In the table, "logprobs" means log-probabilities of a fixed, teacher-forced response, which needs weights or a provider that exposes them. |C| is the number of context units.

| Method | Access | Cost per attributed output | "Output changed" means | Sampling noise | Published validation |
|---|---|---|---|---|---|
| **LOO, likelihood** ([AttriBoT §2.2](https://arxiv.org/abs/2411.15102)) | logprobs | \|C\|+1 forward passes | Δ log p(original response) when one unit is removed | None from sampling: the response is fixed. KV caching causes small floating-point drift (AttriBoT §4.2.2). | Defines the target that the others approximate. It fails under redundancy: precision 0.17–0.21 when two injected texts each suffice ([TracLLM Table 1](https://arxiv.org/abs/2506.04202)). |
| **LOO / ablation, generation-based** | black-box API | (\|C\|+1)·k generations for k samples per condition [INFERENCE: arithmetic] | A match function on the regenerated output: exact, BLEU, embedding cosine, action-match or task outcome (see the rows below) | Must estimate a noise floor from k repeats of the unablated input. Not avoidable on Claude: no temperature control and no determinism. | No standalone validation. It appears as the black-box variants below. |
| **ContextCite** ([Cohen-Wang et al. 2024](https://arxiv.org/abs/2409.00729)) | logprobs | 32 ablations (sources kept with p=½), i.e. "32× more expensive than generating the original response". Parallel, and shared across statements in one response. | Logit-scaled p(response); a sparse linear (Lasso) surrogate whose weights are the scores | Response fixed, no resampling. Faithfulness self-check: hold out ablations and compute LDS (§C.4). | Top-k log-prob drop and LDS (Spearman correlation of predicted vs actual ablation effects). Beats attention, gradient, semantic similarity and LOO on top-k drop and LDS. Tested on Llama-3-8B, Phi-3-mini and Mistral-7B with up to 1,000 examples per benchmark, plus a limited Llama-3-70B check. Sentence-level sources. |
| **AttriBoT** ([Liu et al., ICLR 2025](https://arxiv.org/abs/2411.15102)) | weights for target or proxy | Over 300× cheaper than exact LOO, "30× faster than … generating the response". Combines KV caching, hierarchical pruning and a small proxy model. | Approximates LOO Δ log p | As for LOO | Mean Average Precision (mAP) at recovering the outlier sources of exact Llama-3.1-70B LOO. Proxies tested are smaller models of the *same* family. On HotpotQA human labels: "300× speed up with only 10% drop in mAP". |
| **Shapley / TracLLM** ([Wang et al., USENIX Security 2025](https://arxiv.org/abs/2506.04202)) | logprobs; a black-box BLEU variant exists | O(K·e·log n) queries for top-K texts with e permutations. 359–645 GPU-seconds per output (Llama-3.1-8B), against 182–464 s for LOO. | Δ p(output); in the black-box variant, BLEU between regenerated and original output | Denoising takes the max over marginal contributions instead of the mean; ensembles across methods | Ground truth comes from planted malicious texts across 6 datasets and 13 attacks. Precision 0.94–0.98 and recall 0.77–0.84 on prompt injection. Includes memory attribution for an EHRAgent (50 "experiences" in context). Black-box variant reported effective (Table 10). |
| **AT2, learned attention** ([Cohen-Wang et al. 2025](https://arxiv.org/abs/2504.13752)) | weights (attention) | Under 1 forward pass per output, after a one-off training cost of about 64,000 forward passes per model | Trained to predict ablation effects on log p | None (deterministic) | "On par" with per-example surrogates using 32–256 ablations, by top-k drop and LDS. Also attributes a reasoning model's thoughts. |
| **Attention / gradient saliency**: average attention, gradient norm, gradient×input, Integrated Gradients, AttnLRP ([Inseq](https://arxiv.org/abs/2302.13942), [AttnLRP](https://arxiv.org/abs/2402.05602)) | weights | 1 forward pass (attention) or 1 backward pass (gradients) | Gradient of log p(response), or attention mass | None | Consistently below ContextCite. Attention "fares quite poorly" on Phi-3-mini (ContextCite §4). Gradient precision 0.06 in TracLLM. [Jain & Wallace 2019](https://arxiv.org/abs/1902.10186): attention "frequently uncorrelated with gradient-based measures". AttnLRP's rules violate implementation invariance ([2510.18810](https://arxiv.org/abs/2510.18810)). Gradients ran out of memory on long agent cases ([Qian et al.](https://arxiv.org/abs/2601.15075) Table 1). |
| **MIRAGE** ([Qi et al., EMNLP 2024](https://arxiv.org/abs/2406.13663)) | weights | Contrastive with/without-context pass plus saliency | Context-sensitive answer tokens, then paired with documents | None | "High agreement with human answer attribution" on multilingual extractive QA |
| **Self-citation**: ask the model which sources it used | black-box | 1 extra call | None. It is a claim, not a test. | Unaddressed | Precision 0.22 and recall 0.17 (Llama-3.1-8B, TracLLM Table 1). Misled by "Do not cite this passage" even with GPT-4o (Table 5). |
| **Judge-model relevance/support labelling** ([AttributionBench](https://arxiv.org/abs/2402.15089), [ARES](https://arxiv.org/abs/2311.09476)) | black-box | 1 judge call per (statement, source) or per trajectory | Judge's verdict of "supported" or "relevant": corroborative, not causal (ContextCite §2.1) | The judge is itself stochastic. ARES corrects judge error with prediction-powered inference (PPI) on "a few hundred" human labels. | GPT-4 and fine-tuned models reach about 80% macro-F1. Over 66% of errors come from missing fine-grained detail. |
| **Judge-model failure attribution in agent logs** ([Who&When, ICML 2025](https://arxiv.org/abs/2505.00212); [Trace, Amazon](https://cdn.amazon.science/c0/79/f83fdf204958afcde5b390007fcf/kdd-enterprise-agent.pdf)) | black-box | Ranges from 1 call for the whole log ("all-at-once") to 1 call per step. Trace's holistic variant uses 16× fewer calls than its per-node variant. | Judge names the responsible agent, step or node | Unaddressed | Who&When: best 53.5% agent-level, 14.2% step-level, with o1 and R1 still short of "practical usability". Trace: 72.7% node accuracy on 60 simulated traces. |
| **Temporal likelihood gain, agentic attribution** ([Qian et al. 2026](https://arxiv.org/abs/2601.15075)) | logprobs | 2T+1 prefix forward passes, then a sentence-level pass inside the top components | g_i = log p(a_T \| prefix ≤ i) − log p(a_T \| prefix ≤ i−1). a_T is the realised action *as text*, tool call included. | None (fixed action) | 8 smolagents trajectories on Llama-3.1-70B. Ground truth is the intersection of 5 annotators. Hit@1 0.94, against 0.81 for LOO and ContextCite. |
| **AgentSHAP** ([Horovicz 2025](https://arxiv.org/abs/2512.12597)) | black-box | About n+ρ·2ⁿ agent runs: 130 for 8 tools at ρ=0.5. The unit is a *tool's availability*, not a context span. | Cosine similarity of text-embedding-3-large embeddings between the response and the all-tools response | Monte Carlo. 3 repeat runs, 0.945 mean cosine consistency. | API-Bank on GPT-4o-mini. Removing the top-SHAP tool cut quality by 0.67, a "13x" larger drop than removing the lowest. |
| **Causal Agent Replay (CAR)** ([Shah 2026](https://arxiv.org/abs/2606.08275)) | black-box (hosted or local) | K rollouts per intervened step. Budget-bounded Monte Carlo Shapley over steps. | P(bad outcome) after `do_resample(step)`. Replay fidelity is reported as an "action-match rate". | Treats noise as the object of study: Wilson and bootstrap intervals, never caches v(S). Notes that hosted models are nondeterministic at T=0 and that a local single-stream seeded model replays exactly. | Synthetic causal models with planted structure only. It recovers the pivotal step and a two-step interaction (φ≈0.44/0.45). Single-author preprint. |
| **Policy-level ablation of context management** ([Complexity Trap, NeurIPS DL4C 2025](https://arxiv.org/abs/2508.21433); [AgentDiet](https://arxiv.org/abs/2509.23586)) | black-box | Whole-benchmark reruns per policy | Task solve rate on SWE-bench Verified | Multiple runs or configurations, not per-Call | Masking observations older than M Turns "halves cost" while matching LLM summarisation's solve rate. AgentDiet's LLM reflection module removes "useless, redundant, and expired" content: 39.9–59.7% fewer input tokens "while maintaining the same agent performance". |

### Tool-call change tests in the literature

- **Likelihood of the serialised call.** Qian et al. score log p(a_T) for the realised action, tool call included. Needs logprobs.
- **Normalised structural match.** The BFCL AST checker:
  - parses the call;
  - requires the function name to match;
  - requires all `required` parameters to be present and allows no parameters outside the doc;
  - type-checks strictly (no string booleans; int accepted for float only in Python);
  - compares lists in order unless permutations are listed as acceptable.

  Answers are matched against a set of acceptable values ([BFCL blog](https://gorilla.cs.berkeley.edu/blogs/8_berkeley_function_calling_leaderboard.html)).
- **Execution or state equivalence.** BFCL executable categories; τ-bench compares final database state to a goal state and reports pass^k over k trials ([Yao et al. 2024](https://arxiv.org/abs/2406.12045)).
- **Similarity of output text.** BLEU (TracLLM black-box) or embedding cosine (AgentSHAP). These were designed for prose. [INFERENCE] Neither threshold has been validated for tool arguments.
- **Action match or outcome under rollout.** CAR's action-match rate, and P(bad) over K rollouts.

### Noise facts relevant to any generation-based test

- Anthropic's Messages API rejects every `temperature` except 1.0, and every `top_p` below 0.99, on models released after Claude Opus 4.6. It also states that "even with `temperature` of `0.0`, the results will not be fully deterministic" ([API reference](https://platform.claude.com/docs/en/api/messages); [glossary](https://platform.claude.com/docs/en/about-claude/glossary)).
- 1,000 temperature-0 completions of one prompt on Qwen3-235B produced 80 unique outputs, first diverging at token 103. Batch-invariant kernels fix this, but only for self-hosted inference ([Thinking Machines 2025](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/)).
- Five "deterministic" LLMs over 10 runs showed "accuracy variations up to 15%", with a gap of up to 70% between best and worst possible runs ([Atil et al.](https://arxiv.org/abs/2408.04667)).

### Implications for pi-chart (options and trade-offs, no decisions)

- **Likelihood methods cannot run on the bench model.** ContextCite, AttriBoT, AT2, gradients and temporal gain all need logprobs or weights that `claude-opus-5-5` does not expose. That leaves three options:
  - (a) Generation-based ablation on the real model. It is faithful to the arm being measured, but noisy and k-times more expensive.
  - (b) Likelihood attribution on an open-weights proxy model. It is cheap and noise-free, but it measures the proxy's need, not Opus's. AttriBoT validated proxies only within one model family, and Claude has no open sibling. [INFERENCE] Cross-family transfer is unvalidated.
  - (c) Use (a) on a sample to calibrate (b), or to calibrate a judge.
- **Change test.** Four candidates, from strictest to loosest:
  - Exact tool name plus arguments. Cheapest. At a fixed temperature of 1.0 it will flag sampling variation as change unless a noise floor is subtracted.
  - BFCL-style normalised AST match. Ready-made rules, but still strict on argument values such as paths, search strings and edit text. [INFERENCE] Free-text arguments such as `bash` commands and edit bodies would need per-tool normalisers.
  - Same tool only. Coarse and less noisy, but misses argument-level dependence.
  - Outcome-level, as CAR and the policy ablations do. Closest to "needed", but it costs a rollout per sample.
- **Noise floor is mandatory under generation.** CAR's pattern (k resends of the unablated Call, Wilson or bootstrap intervals, an effect counted only when its interval excludes zero) is the only published agent-specific template. The trade-off is k: more samples cost more, fewer widen the intervals. Ticket 13 (small-n error bars) covers the statistics.
- **Redundancy undercounts need under LOO.** A file read twice, a recall pull that duplicates a tail Turn, or a Pin restating the Opening would each score near zero when removed alone. The options are:
  - Accept LOO as a lower bound on need.
  - Ablate groups or random subsets, as ContextCite does with p=½ masks. More calls, and it needs a model of the response.
  - Shapley or TracLLM search. Handles redundancy, but costs about 2–3× LOO in TracLLM's timings.
- **Removal unit.** Published units are sentences (ContextCite), components (Qian et al.: user, thought, tool, observation, memory), tools (AgentSHAP) and steps (CAR). A tail Turn or tool-call group maps most naturally to Qian et al.'s components. Their coarse-to-fine scheme is to score components first, then score sentences inside the top ones.
- **Ablation cost depends on where the unit sits.** [INFERENCE from the [prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)] Caching covers prefixes only, so removing a unit invalidates the cache for everything after it. An ablated Call pays the uncached input rate on the suffix plus fresh output, including thinking. At Opus 5.5 prices that is $4/MTok uncached input (cache writes $5), $0.20/MTok cache hits and $20/MTok output. Ablating old Turns is dearer than ablating recent ones.
- **Judges are the cheap path, and their accuracy is the risk.** Published accuracy is about 80% for claim support and 14–73% for locating steps in agent logs. Judges also answer "is this relevant" rather than "was this used". If tail utilisation uses a judge, ARES-style PPI shows how to correct it with a small set of ground-truth labels, which ablation could supply. Self-citation, asking the model which Turns it used, has the weakest published record.
- **Validation by planting.** TracLLM (injected texts), CAR (synthetic causal models) and Trace (simulated faults) all validate against planted ground truth. This lines up with the planted-fact measure (tickets 07 and 14) as a possible validation set for whichever attribution method is chosen.

### Sources

- Cohen-Wang, Shah, Georgiev, Madry. *ContextCite: Attributing Model Generation to Context*. NeurIPS 2024. https://arxiv.org/abs/2409.00729 (code: https://github.com/MadryLab/context-cite)
- Liu, Kandpal, Raffel. *AttriBoT: A Bag of Tricks for Efficiently Approximating Leave-One-Out Context Attribution*. ICLR 2025. https://arxiv.org/abs/2411.15102
- Cohen-Wang, Chuang, Madry. *Learning to Attribute with Attention (AT2)*. 2025. https://arxiv.org/abs/2504.13752 (code: https://github.com/MadryLab/AT2)
- Wang, Zou, Geng, Jia. *TracLLM: A Generic Framework for Attributing Long Context LLMs*. USENIX Security 2025. https://arxiv.org/abs/2506.04202
- Qi, Sarti, Fernández, Bisazza. *Model Internals-based Answer Attribution for Trustworthy RAG (MIRAGE)*. EMNLP 2024. https://arxiv.org/abs/2406.13663
- Achtibat et al. *AttnLRP*. ICML 2024. https://arxiv.org/abs/2402.05602 ; *When LRP Diverges from Leave-One-Out in Transformers*. https://arxiv.org/abs/2510.18810
- Jain, Wallace. *Attention is not Explanation*. NAACL 2019. https://arxiv.org/abs/1902.10186
- Sarti et al. *Inseq*. ACL 2023 demo. https://arxiv.org/abs/2302.13942
- Li, Yue, Liao, Sun. *AttributionBench*. Findings of ACL 2024. https://arxiv.org/abs/2402.15089
- Saad-Falcon et al. *ARES*. NAACL 2024. https://arxiv.org/abs/2311.09476
- Zhang et al. *Which Agent Causes Task Failures and When? (Who&When)*. ICML 2025. https://arxiv.org/abs/2505.00212
- Zhao, Misra, Pandey. *Trace: TRajectory Attribution for Automated Context Engineering*. Amazon. https://cdn.amazon.science/c0/79/f83fdf204958afcde5b390007fcf/kdd-enterprise-agent.pdf
- Qian et al. *The Why Behind the Action: Unveiling Internal Drivers via Agentic Attribution*. 2026. https://arxiv.org/abs/2601.15075
- Horovicz. *AgentSHAP*. 2025. https://arxiv.org/abs/2512.12597
- Shah. *Causal Agent Replay: Counterfactual Attribution for LLM-Agent Failures*. 2026. https://arxiv.org/abs/2606.08275
- Lindenbauer et al. *The Complexity Trap*. NeurIPS 2025 DL4C. https://arxiv.org/abs/2508.21433
- Xiao, Gao, Peng, Xiong. *AgentDiet: Reducing Cost of LLM Agents with Trajectory Reduction*. https://arxiv.org/abs/2509.23586
- Patil et al. *Berkeley Function Calling Leaderboard*. https://gorilla.cs.berkeley.edu/blogs/8_berkeley_function_calling_leaderboard.html
- Yao et al. *τ-bench*. https://arxiv.org/abs/2406.12045
- Anthropic. Messages API reference (`temperature`, `top_p`). https://platform.claude.com/docs/en/api/messages ; Glossary (non-determinism). https://platform.claude.com/docs/en/about-claude/glossary ; Prompt caching. https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- He et al. *Defeating Nondeterminism in LLM Inference*. Thinking Machines, 2025. https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/
- Atil et al. *Non-Determinism of "Deterministic" LLM Settings*. https://arxiv.org/abs/2408.04667
