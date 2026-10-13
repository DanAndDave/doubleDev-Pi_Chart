# Proposal: Assembled parts follow the Turn in progress

Triage: ready-for-agent
Blocked by: None

## Why

On the 2026-10-13 token benchmark (`docs/benchmarks/2026-10-13-token-usage.md`), pi-chart wrote 1.6–3× as much prompt cache as plain omp on turns 1–6, before the tail ever slid, and cost 2.3× as much over the Conversation. omp 18.10.3 places a cache breakpoint on the last message the extension handed back unchanged, which in a Pack is the end of the Turn in progress. Any assembled part sitting ahead of that breakpoint and changing between Calls makes the next Call write everything after it again. Structure re-matched on 30 of the benchmark's 64 consecutive in-Turn Call pairs, and recall changes at every Turn boundary. ADR-0010 records the mechanism and the decision.

## What Changes

- **BREAKING** (Pack order): a Context Pack carries the verbatim tail and then the Turn in progress, followed by a closing block of assembled parts: recalled Turns, curated knowledge, structure, then Pins. Before, the order was leading run, assembled parts, rest of tail, Pins, Turn in progress.
- The block opens with one fixed line saying it is background for the request above it and not a new request. A Pack with nothing assembled carries no such line.
- Pins move from just before the Turn in progress to the end of the block, the last thing in the Pack.
- The leading run is removed, along with the structural comparison that found it and the substitution of the harness's own message objects. The tail is no longer split.
- Replacing that, a tail Turn carried unshortened must reach the model exactly as it did while it was the Turn in progress, so the previous Turn is read from cache at every Turn boundary.
- `leading_tokens` and the `/pack` `prefix` line keep their names and now mean the tokens ahead of the assembled block.
- Acceptance includes a judged quality comparison against the current order (ADR-0006 required one for any reorder) and a re-run of `scripts/bench-tokens.ts` against the 2026-10-13 baseline.

Out of scope: the tail sliding from turn 8 on (`tail-evicts-to-low-water`) and structure matching too broadly (`structure-match-precision`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`: three requirements are removed for new ones. "A pack leads with what the harness already sent" becomes "Assembled parts follow the Turn in progress". "Packs carry the prompt and a verbatim tail" becomes "…an unsplit verbatim tail": no split, no substitution, plus the boundary invariant. "Packs carry every pin" becomes "Every pin closes the pack". They are removed and re-added because OpenSpec cannot drop a scenario from a MODIFIED requirement, and two of the old scenarios ("A split tail…", "Pins sit just before the current turn") describe removed behaviour.

## Impact

- `src/assembler.ts`: `compose`, part order, the opening line, ceiling headroom for it; `leadingRun`, `sameMessage` and `AssembleInput.supplied` removed.
- `src/extension.ts`: stops passing `supplied`.
- `src/report.ts`: wording of the `prefix` line.
- Tests that pin the old order: `test/assembler.test.ts`, `test/extension.test.ts`, `test/report.test.ts`, `test/postgres-store.test.ts`.
- Docs: ADR-0010 (written), ADR-0006 marked superseded (done), `CONTEXT.md` **Context Pack** (done), a new dated benchmark document beside the 2026-10-13 one.
