# Model pinning

Type: grilling
Status: closed
Blocked by: —

## Question

Which model, version and thinking level is the reference for the measures? What triggers a new baseline, such as a model update, an omp upgrade or a pricing change? Does a claim made on one model need re-running on a second before it counts as defensible?

## What's known

- Every benchmark so far used the harness's default model (`claude-opus-5-5`) and default thinking level. `scripts/bench-tokens.ts` accepts `--model` and `--thinking`.
- Plain omp's own cost rose from $0.80 to $1.00 per Conversation across the 2026-10-13 series (`docs/benchmarks/2026-10-14-token-usage.md` at `5c3275b`, "Since 2026-10-13"). Absolute figures drift; ratios were compared instead.

## Resolution

- **Reference:** `claude-opus-5-5` at the harness's default thinking level. Every Run records the exact model id and thinking level it ran with.
- **New baseline** when the model or omp changes. Because the Gate runs the previous commit fresh each time (ticket 08), this only matters for saved reference figures such as the A/A calibration and the pooled variance: those are reset on either change.
- **Price change:** no new Runs. Cost is recomputed from stored token counts and a dated price table.
- **Second model:** required only for the headline claim of the plain-omp comparison report. The Gate and Budget tuning use the reference model alone.
