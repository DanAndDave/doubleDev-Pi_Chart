# Proposal: Correct the 2026-10-13 token benchmark's findings

Triage: ready-for-agent
Blocked by: None

## Why

`docs/benchmarks/2026-10-13-token-usage.md` leaves one finding as an `[INFERENCE]`, attributes another to a less direct mechanism, and leaves the memory-check miss unexplained. The run's own accounting in the Thread Store (`call_accounting`, keyed by the three pi-chart runs' Codebases in `2026-10-13-token-usage.json`) settles all three:

- **Turns 1–6 write more** not because "recall and retrieval change between Calls", but because the structure part changes between Calls of the same Turn: 21 of 26 consecutive Call pairs on turns 1–6 (30 of 64 over all twelve turns), against 0 for recalled Turns, curated knowledge and Pins. The leading run was non-empty on turns 2–7 (2.8k–20.5k tokens), so the changing structure part sat after it and before the breakpoint on the Turn's last message, rewriting everything from there on. The stated ratio, "1.6–3×", is also wrong against the document's own cache-write table: 2.5× over turns 1–6, 1.4× to 7.7× per turn.
- **From turn 8**, the recorded `leading_tokens` is 0 on every Call in all three runs: the tail slid, the run the harness sent ahead of the assembled parts emptied, and nothing but the Floor was read from cache. That states the finding directly instead of citing the general prefix rule.
- **The memory check:** the run that answered `UNKNOWN` (`/tmp/pichart-bench-41BItz`) had turn 1 excluded by recall at distance 0.545 against the 0.52 threshold; the other two runs carried it.

ADR-0010 and `README.md` already state the corrected turn 1–6 mechanism and cite this document for its figures, but quote the same wrong "1.6–3×" ratio. The document itself is the last place giving the old explanation.

## What Changes

- Rewrite the Findings section of `docs/benchmarks/2026-10-13-token-usage.md` in place with the three corrected findings and drop the `[INFERENCE]`. A dated line at the head of Findings says it was corrected on 2026-10-14, what changed and why; the original wording stays in git history. Tables, charts and run data are unchanged.
- Add one line under Findings pointing to the benchmarks that followed (`-parts-follow-turn`, `-tail-evicts`, `-briefings-kept`), without restating their results.
- Correct the turn 1–6 ratio to 2.5× in the document, `README.md` and ADR-0010's context paragraph. ADR-0010 changes only the figure it quotes; its decision is unchanged.
- Add `audit.sql` to this change folder that reproduces the three figures from `call_accounting`, and cite it from the document.
- Delete the stray `docs/benchmarks/Untitled`, and rewrite `HANDOFF.md` to the post-archive state.

Not changing: `scripts/bench-tokens.ts`. The figures are a one-off reading of the Thread Store, and making every bench run depend on the database is not worth it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — documentation only; `skip_specs` is set.

## Impact

- `docs/benchmarks/2026-10-13-token-usage.md` (Findings section only).
- `README.md` and `docs/adr/0010-assembled-parts-follow-the-turn-in-progress.md` (the quoted turn 1–6 ratio only).
- `openspec/changes/benchmark-doc-corrections/audit.sql` (new; archived with the change).
- `docs/benchmarks/Untitled` (deleted), `HANDOFF.md` (rewritten); both untracked.
