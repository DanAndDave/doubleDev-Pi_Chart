# read-only-40

Read-only work over pi-chart's own source at `c6fe516`, 40 Turns: each Turn reads something new, so an accumulating window grows. Every reading prompt ends "Do not modify any files and do not spawn subagents.", so both Arms do the same work and the cost difference is the window.

The last prompt is a Probe. It asks for the codeword given in Turn 1 (`codeword`, `TANGERINE-42`) and the build number given in Turn 3 (`build`, `7341`), and each Plant is scored separately. The codeword sits in Turn 1's prompt, which the Opening carries. The build number sits only in a later Turn: with the default tail (`PICHART_TAIL_TURNS=8`, `PICHART_TAIL_TOKENS=25000`, `PICHART_TAIL_LOW_WATER=0.2`) it leaves the tail at the first Eviction, about Turn 6, and stays out of it for the remaining 34. So the Probe cannot be answered from the tail: the codeword comes from the Opening, the build number from recall. A cheaper Arm that forgot what it was told is visible as such.

No step is graded, so Cost per Pass is not applicable. The bundle is empty.

## Versions

- **v1:** the 40 prompts `scripts/bench-tokens.ts` carried inline up to `de5f8e0`, byte for byte, with the no-edits suffix now part of each prompt's text. Workspaces now carry `node_modules/`, which the inline workload's did not, so figures saved before v1 (for example `docs/benchmarks/2026-10-14-token-usage-40-turns-mark-0.2.md` at `5c3275b`) compare for plausibility only.
- **v1, amended:** the Probe declares `"tools": false`, which its text already said ("Do not use any tools"). Nothing sent changed, so the version stays 1. Records written before the amendment show the Probe as allowing tools; their Plants are literal by default.
