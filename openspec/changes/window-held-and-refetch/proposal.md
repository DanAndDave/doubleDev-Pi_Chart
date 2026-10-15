# Proposal: Window held and Re-fetch

Triage: ready-for-agent
Blocked by: None (`measures-walking-skeleton` is archived)

## Why

Lapse and Re-fetch both depend on what each Call's Context Window held, and nothing computes that yet. The Measures script (`scripts/measures.ts`) reads a Run record but cannot say whether an earlier tool result was still in the window when the agent fetched it again. Every later slice of `context-need-measures` builds on the per-Call window this change introduces: Pulls, Plants, revisits, Utilisation and Ablation.

Decisions: `context-need-measures/questions/01`, `02`, `03`.

## What Changes

- **Window parts per Call, for both Arms.** Each main-Journal Call's Context Window is split into the same parts on both Arms: system prompt, Opening, Pin, summary, tail, current Turn. A part an Arm lacks is empty.
  - pi-chart: the Turns and Pins Accounting records per Call, joined to the Journal by Turn and Call index.
  - plain omp: the Journal's active branch up to that Call, cut at the latest compaction.
  - Everything after this per-Arm step is shared code.
- **Re-fetch.** A non-empty, non-error tool result identical to the most recent earlier result with the same content, when that earlier result was received in an earlier Turn. Each Re-fetch is classified as:
  - **held**: the earlier result was still in the window of the Call that made the tool call; this is model redundancy, counted apart;
  - **left**: the earlier result had left that window; this is a Lapse;
  - **unknown**: the record cannot say, for example because that Call's Accounting is missing or its tail was carried shortened. Counted apart, never as held or left.
- **First Lapse route.** A Re-fetch classified left is a Lapse.
- **Per Run, by distance band.** Re-fetches by class, per Run, split by the Turns between the two results into five contiguous bands: 1–5, 6–7, 8–12, 13–24, ≥ 25. The three planned bands (≤ 5, 8–12, ≥ 25) keep their bounds, and the two between them are reported rather than dropped, so the bands add up to the Run's total.
- **"n/a" for one-Arm Measures.** Report rows for Measures that exist on one Arm only read "n/a" on the other side and get no ratio. Compactions per Run (plain omp only) is the first such row. Pulls (next slice) follow it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `measures`: window parts per Call, Re-fetch held / left / unknown, Lapses per Run by band, compactions per Run, and "n/a" rows for one-Arm Measures.

## Impact

- `src/journal.ts`: the active-branch reader also returns the branch's compactions, positioned in the same Turn and message coordinates as its Turns. `readJournal` and ingest are unchanged in behaviour.
- `scripts/measures.ts`: per-Call windows for both Arms, Re-fetch detection and classification, new fields in `RunMeasures` and `aggregate`, CLI lines.
- `scripts/bench-tokens.ts`: report rows for the new Measures.
- `test/measures.test.ts`, `test/journal.test.ts`: fixture Run records with Accounting, a plain-omp compaction, and Re-fetches on both sides of an eviction.
- No extension behaviour change.
- Spend: none. The kept `read-only-40` record at `/tmp/bench-ro40/` already holds three pi-chart Re-fetches of Turns 4 and 5 after their eviction, and the plain-omp Run of the same record has none. Compaction is proven on fixtures and on a real compacted Journal from `~/.omp/agent/sessions/`.
