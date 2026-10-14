## 1. Reproduce the figures

- [x] 1.1 Write `audit.sql` in this change folder with the three selects from design §2, each scoped to the three pi-chart Codebases from `docs/benchmarks/2026-10-13-token-usage.json`, unwrapping `parts` whether it is a jsonb array or a jsonb string. Header comment: what it reads and the `psql "$(cat ~/.pi-chart/database.url)" -AF' | ' -f audit.sql` invocation. Verify: running it prints structure 21/26 (turns 1–6) and 9/38 (turns 7–12), recalled/curated/pinned 0 changed; `leading_tokens` non-zero on turns 2–7 and 0 on every Call of turns 8–12; run `/tmp/pichart-bench-41BItz` excluding turn index 0 at 0.5449 against 0.52 while the other two runs carry it.

## 2. Correct the document

- [x] 2.1 Rewrite the Findings section of `docs/benchmarks/2026-10-13-token-usage.md` (design §1): open with the dated correction line linking `openspec/changes/archive/<archive-date>-benchmark-doc-corrections/audit.sql`; replace the turn 8+ bullet's prefix-rule citation with the `leading_tokens` = 0 finding; replace the `[INFERENCE]` turn 1–6 bullet with the structure-part churn and its position after the leading run, and its ratio with 2.5× (1.4× to 7.7× per turn) as the cache-write table gives; extend the memory-check bullet with the recall exclusion at 0.545 vs 0.52. Keep the other three bullets, every table, chart and the JSON unchanged. Verify: no `[INFERENCE]` remains, `git diff --stat` touches only the Findings section, and each figure matches 1.1's output and the table.
- [x] 2.2 Add one line under Findings pointing to `2026-10-13-token-usage-parts-follow-turn.md`, `-tail-evicts.md` and `-briefings-kept.md` as where these findings were acted on, without their results (design §3). Verify: the three links resolve to files in `docs/benchmarks/`.
- [x] 2.3 Replace "1.6–3× as much cache as plain omp on turns 1–6" with "2.5× as much cache as plain omp over turns 1–6" in `README.md` ("The order of a pack") and ADR-0010's context paragraph. Verify: no "1.6–3" remains in `README.md`, `docs/` or `CONTEXT.md`.

## 3. Close out

- [x] 3.1 Delete the untracked `docs/benchmarks/Untitled`. Verify: `git status --short` no longer lists it.
- [x] 3.2 Run `openspec validate benchmark-doc-corrections`. Verify: valid.
- [x] 3.3 After `/opsx-archive`, check the archive path written in 2.1 resolves, then rewrite `HANDOFF.md` to the post-archive state: HEAD, checks, no open changes, and that the next step is charting new work. Verify: every change it names exists under `openspec/changes/archive/`, and the link from the document opens `audit.sql`.
