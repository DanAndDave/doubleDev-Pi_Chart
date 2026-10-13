# Proposal: Correct the 2026-10-13 token benchmark's findings

Triage: needs-triage
Blocked by: None

## Why

`docs/benchmarks/2026-10-13-token-usage.md` leaves one finding as an `[INFERENCE]` and attributes another to the wrong mechanism, and both are now settled by the harness source (omp 18.10.3) and the run's own accounting:

- Turns 1–6 write 1.6–3× more: not "recall and retrieval changing", but the structure part changing between Calls of a Turn (30 of 64 pairs; recall, Concepts and Pins on none) while sitting between the leading run and the breakpoint on the Turn's last message.
- Turns 8+: the finding cites "prompt caching reuses only an unchanged prefix"; the recorded `leading_tokens` is 0 on every turn 8–12 Call in all three runs, which is the more direct statement — the tail slid and the run emptied.
- The memory check: the run that answered `UNKNOWN` had turn 1 refused by recall at distance 0.545 against the 0.52 threshold; the other two carried it.

## What Changes

- Rewrite the Findings section with these mechanisms and figures, keep the tables, and drop the `[INFERENCE]`.
- `README.md` and `docs/benchmarks/` and `scripts/bench-tokens.ts` are uncommitted work; commit them with the corrected document.
- Open for grilling: whether corrections edit the dated document in place or append a dated note, given the document describes a run on a day.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — documentation only; `skip_specs` is set.

## Impact

- `docs/benchmarks/2026-10-13-token-usage.md`, possibly `scripts/bench-tokens.ts` if the report should print the per-part churn and the recall refusal.
