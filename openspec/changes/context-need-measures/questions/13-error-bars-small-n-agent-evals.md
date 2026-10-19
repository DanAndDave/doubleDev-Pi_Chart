# Error bars for small-n agent evals

Type: research
Status: closed
Blocked by: —

## Question

How should a regression be decided in an LLM-agent eval with 3–10 runs per arm, paired by workload, where each run is a long multi-turn Conversation? Cover:

- interval methods for ratios and for pass rates;
- paired and clustered designs (Turns nested in runs);
- sequential or adaptive testing that stops early;
- how to set a minimum detectable effect against a cost cap;
- published practice from eval-methodology papers and lab posts. One example is Anthropic's "Adding error bars to evals".

Give concrete formulas or procedures, not just names.

## Resolution

**Answer.** Use the Conversation as the unit of analysis. Collapse every Turn-level measure to one number per run, pair the runs by workload, and run a paired *t* procedure on the per-pair log-ratio (cost and other positive quantities) or difference (rates). This is Miller's paired-differences recommendation ([Miller 2024](https://arxiv.org/abs/2411.00640) §4.2, eq. 7). With very few clusters it is also the procedure Ibragimov–Müller show stays valid: one estimate per cluster, then a *t* test with *G − 1* df ([Cameron & Miller 2015](https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015_February.pdf) §VI). At *n* = 3–10 several common tools fail:

- CLT *z*-intervals and percentile bootstraps undercover ([Bowyer et al. 2025](https://arxiv.org/abs/2503.01747); [Hesterberg 2015](https://arxiv.org/abs/1411.5279)). In a simulation run for this ticket, the percentile bootstrap covered 74% at *n* = 3 and 89% at *n* = 10, against 95% for *t*.
- Exact sign-flip, sign and Wilcoxon tests cannot reach two-sided *p* < 0.05 below 6 pairs.
- Pass/fail rates from 3–10 runs can detect only collapses, such as 90% falling to 30%.

So the gate needs three things to have teeth: a pre-stated margin (non-inferiority on the log-ratio, as in FDA bioequivalence); continuous per-run measures rather than pass rates; and either more pairs or a variance figure pooled from earlier calibration runs. The worked example: at per-Conversation cost CV ≈ 10% with 3 pairs, the detectable cost change at 80% power is about **×1.38 one-sided, ×1.59 two-sided**. Detecting ×1.10 needs about **15 pairs** (one-sided). Detecting ×1.05 needs about **54 pairs**.

### 1. Procedures

**Cost and other positive ratio measures (log-ratio, paired *t*).** For workload *i* = 1..*n*, take *m* ≥ 1 runs per arm:

```
d_i  = mean_k ln C_B,i,k − mean_k ln C_A,i,k        (B = candidate, A = baseline)
d̄    = Σ d_i / n ;   s_d = sqrt( Σ (d_i − d̄)² / (n−1) ) ;   SE = s_d / √n
CI   = exp( d̄ ± t_{1−α/2, n−1} · SE )               ratio of geometric means
one-sided regression bound:  U = exp( d̄ + t_{1−α, n−1} · SE )
```

- **Ratio of arithmetic means** (totals matter for Budgets). Use R̂ = ΣC_B/ΣC_A and the delta-method variance `Var(ln R̂) ≈ (1/n)[s_B²/ȳ_B² + s_A²/ȳ_A² − 2 s_AB/(ȳ_A ȳ_B)]`. An alternative is Fieller's exact interval ([Fieller 1954](https://doi.org/10.1111/j.2517-6161.1954.tb00159.x)). At CV ≈ 10% the geometric and arithmetic ratios differ by about exp(σ²/2) per arm, which cancels when the CVs are equal. `[INFERENCE]`
- **Bootstrap.** Resample *pair indices* (workloads) with replacement and keep each pair intact. Use bootstrap-*t* or the "expanded percentile" interval, not the plain percentile ([Hesterberg 2015](https://arxiv.org/abs/1411.5279) §5.3, §5.5). The plain percentile is "like using *z* instead of *t*" with divisor *n*, and is "terrible in small samples". At *n* = 3 there are only 10 distinct resamples, so the bootstrap has nothing to offer over *t*. Agarwal et al. likewise find that bootstrap CIs with 3 runs "underestimate the true 95% CIs", and that per-task bootstrap needs 20–30 runs ([Agarwal et al. 2021](https://arxiv.org/abs/2108.13264) §4.1, App. A.3).
- **Normality** of log cost is an assumption. With *n* ≤ 5 it cannot be checked from the data, so check it once on a calibration batch. `[INFERENCE]`

**Rates and proportions per run** (re-fetch rate, recall pulls per Turn, tail utilisation, planted-fact retention). Compute a per-run ratio-of-sums, for example `R_g = Σ refetches / Σ Turns`. Then run the same paired *t* on `d_i = R_B,i − R_A,i`, or on the logit or log scale when values sit near 0 or 1.

**Binary pass/fail per run (task outcome).**

- Single arm:
  - Wilson `(p̂ + z²/2n ± z·sqrt(p̂(1−p̂)/n + z²/4n²)) / (1 + z²/n)`;
  - Clopper–Pearson `[Beta⁻¹(α/2; k, n−k+1), Beta⁻¹(1−α/2; k+1, n−k)]`;
  - Jeffreys, the quantiles of `Beta(k+½, n−k+½)`.

  Bowyer et al. find that only Wilson and Bayesian intervals reach nominal coverage at small *N*, and recommend them ([§3.1](https://arxiv.org/abs/2503.01747)). Brown, Cai & DasGupta recommend Wilson or Jeffreys for small *n* ([2001](https://doi.org/10.1214/ss/1009213286)). With 0 failures in *n* runs, the 95% upper bound on the failure rate is ≈ 3/*n* ([Hanley & Lippman-Hand 1983](https://doi.org/10.1001/jama.1983.03330370053031)).
- Paired arms: exact McNemar on the discordant pairs *b* and *c*, `p = 2·BinomCDF(min(b,c); b+c, ½)`. Two-sided *p* < 0.05 needs **≥ 6 discordant pairs, all in one direction**. Bowyer et al. recommend a paired Bayesian posterior on θ_A − θ_B for small *N* (§3.4, Snippet 2/5).

Intervals computed for this ticket (statsmodels):

| k/n | Wilson 95% | Clopper–Pearson 95% | Jeffreys 95% |
| --- | --- | --- | --- |
| 3/3 | 0.44–1.00 | 0.29–1.00 | 0.46–1.00 |
| 2/3 | 0.21–0.94 | 0.09–0.99 | 0.18–0.96 |
| 10/10 | 0.72–1.00 | 0.69–1.00 | 0.78–1.00 |
| 9/10 | 0.60–0.98 | 0.56–1.00 | 0.62–0.99 |
| 5/10 | 0.24–0.76 | 0.19–0.81 | 0.22–0.78 |

Power of a one-sided Fisher exact test (α = 0.05, baseline 90% pass), computed for this ticket:

- *n* = 3 per arm: 0 at every alternative.
- *n* = 5: 0.37 against 30% pass.
- *n* = 10: 0.14 against 70%, 0.47 against 50%, 0.82 against 30%.

**Turns nested in runs (clustering).** Turns within one Conversation are correlated, and a naive Turn-level SE overstates precision. Miller measured clustered SEs up to 3.05× the naive ones on DROP ([Table 4, eq. 4/8](https://arxiv.org/abs/2411.00640)). Cluster-robust (sandwich) SEs over-reject with few clusters. With critical value 1.96, Cameron, Gelbach & Miller report rejection rates of .118 at *G* = 10 and .208 at *G* = 5, and *T*(*G* − 1) critical values still exceed .05 ([Cameron & Miller 2015](https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015_February.pdf) §VI.A). There are three options, in increasing complexity:

1. **Cluster summary + *t*(*G* − 1)** (Ibragimov–Müller, ibid. §VI). This is conservative for α ≤ 0.083 and is what §1 above does.
2. CR2 variance with Bell–McCaffrey df.
3. Wild cluster bootstrap. With *G* < ~10, two-point Rademacher weights give only 2^G distinct draws, so use Webb's 6-point weights ([Webb 2023](https://doi.org/10.1111/caje.12661)).

Turn-position pairing across arms (Turn *t* of arm A against Turn *t* of arm B) still has to be clustered by run.

**Gate framing.** One-sided tests answer three different questions:

- **Superiority-style:** fail only if *L* = exp(d̄ − t·SE) > 1. Lenient: at small *n*, real regressions pass.
- **Non-inferiority:** pass only if *U* < *M* for a margin *M*, such as 1.10. Strict: at small *n*, nothing passes.
- **Three-way:** fail if *L* > 1; pass if *U* < *M*; otherwise *inconclusive → add pairs*.

FDA average bioequivalence is the closest regulated analog. It requires the 90% CI of the geometric-mean ratio, computed on log-transformed data, to lie in 80.00–125.00% ([FDA guidance](https://www.fda.gov/media/163638/download)). That is two one-sided 5% tests ([Schuirmann 1987](https://doi.org/10.1007/BF01068419)). Gating several of the six measures needs a family-wise correction such as Holm, or a single primary measure. `[INFERENCE]`

### 2. Minimum detectable effect under a cost cap

Miller's sample-size relation ([eq. 9–10](https://arxiv.org/abs/2411.00640)), adapted to the log scale with *K* runs per arm per workload:

```
σ_d² = ω² + σ_A²/K_A + σ_B²/K_B        ω² = var of true per-workload log-ratios; σ² = within-workload run variance of ln C
MDE_log ≈ (t_{1−α(/2), n−1} + t_{1−β, n−1}) · σ_d / √n      (exact: noncentral t)
n       ≈ ((z_{1−α(/2)} + z_{1−β}) · σ_d / δ)² + z²_{1−α(/2)}/2     (Guenther's t-correction)
n_max   = floor( Cap / (K_A·c_A + K_B·c_B) )
```

- **Unit costs** (`map.md`; benchmark `docs/benchmarks/2026-10-14-token-usage-40-turns-mark-0.2.md` at `5c3275b`): c_pi-chart ≈ $3.77, c_omp ≈ $4.89. A pi-chart-vs-pi-chart gate pair costs about $7.54; a pi-chart-vs-omp pair costs $8.66.
- **K versus n.** Minimize `(ω² + 2σ²/K)(c₀ + K·c)`. This gives `K* = sqrt(2σ²c₀ / (ω²c))`, where c₀ is a fixed per-workload cost; this is the standard two-stage sampling optimum `[INFERENCE: derived]`. When c₀ ≈ 0, K* = 1, so new workloads beat repeats. Miller makes the same point: once σ²/K ≪ Var(x), more resamples barely help (§3.1).
- **One workload.** pi-chart has one 40-Turn workload today, so *K* > 1 is forced. The CI then covers run noise only, and any claim generalizes to that workload, not to "workloads" (Miller's super-population framing, §2). `[INFERENCE]`
- **Variance from history.** The largest cheap lever is σ estimated from pooled calibration runs: `s_p² = Σ(n_j−1)s_j² / Σ(n_j−1)`, with df = Σ(n_j−1). This moves the critical value from t_{2} = 4.30 toward z = 1.96. It holds only if the variance is stable across changes, which needs a periodic check. `[INFERENCE]`
- **A variance figure from 3 runs is itself very uncertain.** pi-chart's three runs ($3.5472, $3.7710, $3.7869) give a CV of 3.6%, but the χ² 95% CI on σ with df = 2 spans ×0.52 to ×6.28, so the true CV is anywhere in 1.9%–23% (computed).
- **Infrastructure noise.** Anthropic found that infra configuration alone moved Terminal-Bench 2.0 by 6 pp. Pass rates also fluctuated with time of day, and they recommend running at multiple times ([Anthropic 2026a](https://www.anthropic.com/engineering/infrastructure-noise)). Interleaving the arms in the same time window is a blocking choice that keeps such drift out of *d_i*. `[INFERENCE]`

### 3. Sequential and early-stopping options

Repeatedly peeking at a fixed-*n* test inflates the false-positive rate ([Johari et al. 2015](https://arxiv.org/abs/1512.04922)).

| Design | Procedure | Fit for 3–10 Conversations |
| --- | --- | --- |
| Fixed *n* | One analysis at *n*. | Simplest; no α spending. |
| Two-stage group sequential, one-sided α = 0.05 | Look at 5 pairs, then at 10. O'Brien–Fleming boundaries are *z* = 2.372, then 1.678 (nominal *p* 0.0088, then 0.0467). Pocock uses *z* = 1.877 at both looks. Two-sided α = 0.05 for reference: OBF 2.797/1.977, Pocock 2.178/2.178. All boundaries computed by simulation for this ticket. Mapped to *t*, the 5-pair OBF look needs *t*₄ > 3.89 and the final look *t*₉ > 1.876 `[INFERENCE: nominal-p carry-over to t is an approximation]`. Unequal looks use Lan–DeMets spending ([Pocock 1977](https://doi.org/10.1093/biomet/64.2.191); [O'Brien & Fleming 1979](https://doi.org/10.2307/2530245); [Lan & DeMets 1983](https://doi.org/10.1093/biomet/70.3.659)). | Good. OBF spends almost nothing early, so it stops early only on gross regressions. Add a non-binding futility or pass stop when *U* < *M*. |
| Three-way rule above | Inconclusive → run another batch of pairs. | Needs a cap on the total and α spending across batches; otherwise it is peeking. |
| Anytime-valid (mSPRT, confidence sequences, betting) | Always-valid *p*-values ([Johari et al.](https://arxiv.org/abs/1512.04922)); time-uniform CS ([Howard et al.](https://arxiv.org/abs/1810.08240)); betting CS for bounded means ([Waudby-Smith & Ramdas](https://arxiv.org/abs/2010.09686)). | Built for continuous monitoring of many units. At *n* ≤ 10 the price of uniform validity is a much wider interval `[INFERENCE]`. Better suited to Turn-level streaming than to gating per Conversation. |

### 4. Worked example: CV ≈ 10%, 3 paired runs per arm

The per-Conversation log-cost SD is `σ = sqrt(ln(1 + 0.10²)) = 0.0998`.

- **Independent run noise in each arm** (ρ = 0; the workload effect cancels in the pair): σ_d = √2·σ = 0.141, SE = 0.141/√3 = 0.0815, df = 2.
- **Half the noise shared within a workload** (ρ = 0.5): σ_d = 0.0998.

Computed with exact noncentral *t*, α = 0.05, 80% power:

| Design (n = 3) | 95% CI half-width | Smallest significant observed ratio, one-sided | MDE @80%, two-sided | MDE @80%, one-sided |
| --- | --- | --- | --- | --- |
| Paired t, ρ = 0 | ×/÷1.42 | ×1.27 | **×1.59** | **×1.38** (×1.25 at α = 0.10) |
| Paired t, ρ = 0.5 | ×/÷1.28 | ×1.18 | ×1.39 | ×1.26 |
| σ known from pooled history (z), ρ = 0 | — | — | ×1.26 | ×1.22 |
| One workload, 3 vs 3 unpaired, pooled t (df = 4) | — | — | ×1.36 | ×1.28 |
| Sign / Wilcoxon / sign-flip | cannot reject: min two-sided p = 2/2³ = 0.25 | — | — | — |
| Observed CV 3.6% (pi-chart's three runs), paired, ρ = 0 | ×/÷1.14 | — | ×1.18 | ×1.13 |

Scaling with *n* (paired, ρ = 0, one-sided / two-sided MDE): 5 pairs ×1.21/×1.27; 10 pairs ×1.13/×1.15; 20 pairs ×1.085/×1.10.

Pairs needed at 80% power, CV 10%:

- ×1.20: 6 one-sided, 7 two-sided (≈ $45–61).
- ×1.10: **15** one-sided, 20 two-sided (≈ $113–173).
- ×1.05: **54** one-sided, 68 two-sided (≈ $407–589).

At CV 3.6% the same targets need 3, 4 and 9 pairs.

Two side observations:

- With one workload, pairing buys nothing unless the arms share noise: 3 vs 3 unpaired (df = 4) beats 3 "pairs" (df = 2). `[INFERENCE from the table]`
- The present budget (~$26 for 3 per arm) can only catch cost moves of roughly 25–60%, depending on sidedness and ρ. A 10% move needs about 5× that budget, or a much lower true CV.

### 5. Published practice

| Source | Setting | Recommendation relevant here |
| --- | --- | --- |
| [Miller 2024](https://arxiv.org/abs/2411.00640) / [Anthropic post](https://www.anthropic.com/research/statistical-approach-to-model-evals) | Q&A evals with large *n* | Report the SEM; cluster SEs on the unit of randomization; resample *K* times and analyse question means; analyse paired differences (score correlation between models 0.3–0.7); power formula eq. 9–10. Calls bootstrapping "unnecessary" for large *n*. |
| [Bowyer et al. 2025](https://arxiv.org/abs/2503.01747) | *N* < a few hundred | CLT intervals and bootstrap "systematically under-cover". Use Wilson or Bayesian (Beta posterior) intervals; paired Bayes for comparisons. Library: `bayes_evals`. |
| [Agarwal et al. 2021](https://arxiv.org/abs/2108.13264) | Deep RL, 3–10 runs per task | Interval estimates via stratified bootstrap *across tasks*; IQM over mean or median; probability of improvement. Per-task bootstrap with 3–5 runs undercovers. |
| [Colas et al. 2018](https://arxiv.org/abs/1806.08295) | RL seeds | Power analysis to choose the number of seeds, for both *t* and bootstrap tests; warns when assumptions are violated. |
| [Hesterberg 2015](https://arxiv.org/abs/1411.5279) | Bootstrap teaching | Percentile bootstrap too narrow at small *n*; use *t*, bootstrap-*t* or expanded percentile. |
| [Cameron & Miller 2015](https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015_February.pdf) | Few clusters | CRVE over-rejects; use CR2 with Bell–McCaffrey df, wild cluster bootstrap, or a per-cluster estimate with *t*(*G* − 1). |
| [Madaan et al. 2024](https://arxiv.org/abs/2406.10229); [Heineman et al. 2025](https://arxiv.org/abs/2508.13144) | LLM benchmark variance | Quantify seed variance before comparing. Prefer continuous metrics (e.g. perplexity over accuracy) for a better signal-to-noise ratio. Drop noisy subtasks. |
| [Anthropic 2026a](https://www.anthropic.com/engineering/infrastructure-noise) | Agentic coding evals | Infra configuration swings scores by up to 6 pp. Distrust gaps below 3 pp until configurations match. Run at multiple times and days. |
| [Anthropic 2026b](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents); [τ-bench](https://arxiv.org/abs/2406.12045) | Agent evals | Run multiple trials. pass@k measures at-least-one success; pass^k measures consistency across *k* trials (0.75³ ≈ 42%). |
| [Kapoor et al. 2024](https://arxiv.org/abs/2407.01502) | Agent benchmarks | Report cost alongside accuracy and optimize the two jointly; agent evaluation lacks standardization and reproducibility. |

### Implications for pi-chart (options, not decisions)

- **Unit of analysis.** Collapse each measure to one value per Conversation, then paired *t* on log-ratios. The alternative is a Turn-level model with CR2 or wild-bootstrap SEs: more data used, but more fragile at *G* ≤ 10 and more code.
- **Gate rule.** Options are superiority (cheap, misses regressions), non-inferiority with margin *M* (honest, but rarely passes at *n* = 3), or three-way pass/fail/inconclusive with a capped top-up. The margin *M* and one- versus two-sided are the human calls. A one-sided α = 0.10 test buys ×1.25 instead of ×1.38 at *n* = 3, at the cost of doubling false alarms.
- **Cost cap against MDE.** About $26 detects ~×1.4; about $45 detects ~×1.2; about $115–130 detects ~×1.10 (CV 10%). If the true CV is near the observed 3.6%, $26–35 reaches ×1.10. A calibration batch of about 10 runs of one arm would pin down σ before choosing.
- **Pooled-σ calibration.** Store per-run log costs from every gate and A/A run, and use the pooled σ with its large df. This gives a big MDE gain at no extra spend per gate, but it assumes stable variance and needs drift monitoring.
- **Saved baseline versus fresh baseline.** A saved baseline halves spend, but loses pairing and same-time blocking. Plain omp's cost moved 1.3% between two runs, and infra drift is documented. A fresh paired baseline costs twice as much, but is robust to drift.
- **Workload count.** One workload with *K* repeats limits claims to that workload, and pairing then adds nothing. Several workloads at *K* = 1 give generalization and real pairing, but each new workload costs authoring effort (c₀).
- **Pass rates.** With 3–10 runs, task outcome can gate only collapses (≥ 6 one-way discordant pairs for McNemar). Options: report it with Wilson or Jeffreys intervals only; gate on "any new failure → inspect transcript"; or move to continuous per-run scores (planted-fact retention fraction), which have a better signal-to-noise ratio.
- **Early stopping.** A two-look OBF design (5 then 10 pairs) caps spend at the 10-pair cost and saves half on gross regressions. Anytime-valid methods are a poor fit at this *n*.
- **Multiplicity.** Gating several of the six measures needs Holm or Bonferroni correction, or a single primary gated measure with the rest reported only.

### Sources

- Miller, E. (2024). *Adding Error Bars to Evals.* https://arxiv.org/abs/2411.00640 — Anthropic summary: https://www.anthropic.com/research/statistical-approach-to-model-evals
- Bowyer, Aitchison, Ivanova (2025). *Don't Use the CLT in LLM Evals With Fewer Than a Few Hundred Datapoints.* https://arxiv.org/abs/2503.01747
- Agarwal et al. (2021). *Deep RL at the Edge of the Statistical Precipice.* https://arxiv.org/abs/2108.13264
- Colas, Sigaud, Oudeyer (2018). *How Many Random Seeds?* https://arxiv.org/abs/1806.08295
- Hesterberg, T. (2015). *What Teachers Should Know About the Bootstrap.* https://arxiv.org/abs/1411.5279
- Cameron & Miller (2015). *A Practitioner's Guide to Cluster-Robust Inference.* https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015_February.pdf
- Webb (2023). *Reworking wild bootstrap-based inference for clustered errors.* https://doi.org/10.1111/caje.12661
- Madaan et al. (2024). https://arxiv.org/abs/2406.10229 · Heineman et al. (2025). https://arxiv.org/abs/2508.13144
- Anthropic (2026a). *Quantifying infrastructure noise in agentic coding evals.* https://www.anthropic.com/engineering/infrastructure-noise
- Anthropic (2026b). *Demystifying evals for AI agents.* https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Yao et al. (2024). *τ-bench.* https://arxiv.org/abs/2406.12045 · Kapoor et al. (2024). *AI Agents That Matter.* https://arxiv.org/abs/2407.01502
- Johari, Pekelis, Walsh (2015). *Always Valid Inference.* https://arxiv.org/abs/1512.04922 · Howard et al. (2018). https://arxiv.org/abs/1810.08240 · Waudby-Smith & Ramdas. https://arxiv.org/abs/2010.09686
- Pocock (1977) https://doi.org/10.1093/biomet/64.2.191 · O'Brien & Fleming (1979) https://doi.org/10.2307/2530245 · Lan & DeMets (1983) https://doi.org/10.1093/biomet/70.3.659
- FDA, *Statistical Approaches to Establishing Bioequivalence* (May 2026). https://www.fda.gov/media/163638/download · Schuirmann (1987) https://doi.org/10.1007/BF01068419
- Brown, Cai, DasGupta (2001). https://doi.org/10.1214/ss/1009213286 · Fieller (1954). https://doi.org/10.1111/j.2517-6161.1954.tb00159.x · Hanley & Lippman-Hand (1983). https://doi.org/10.1001/jama.1983.03330370053031
- Computations (MDE via noncentral *t*, required *n*, binomial intervals, Fisher power, bootstrap coverage simulation, group-sequential boundaries): scipy/statsmodels script run for this ticket, not committed. Cost inputs: `docs/benchmarks/2026-10-14-token-usage-40-turns-mark-0.2.md` at `5c3275b`.
