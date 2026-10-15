# Proposal: Plants and Retention

Triage: needs-triage
Blocked by: pulls-and-recall-lapses

## Why

Retention per Plant today scores the codeword and build-number Probe by substring match, with no record of distance, fact kind or where the answer came from. A right answer could come from the window, from a Pull, or from a leak, and a wrong one could be a Lapse or a misreading. On `read-only-40`, pi-chart-0 got the build number wrong at Turn 40; nothing in its Measures says that this is a Lapse 37 Turns back, the same thing its three Re-fetch Lapses are. This slice turns Plants into a controlled matrix and attributes every answer, which also gives the third Lapse route: a failed Probe.

Decisions: `context-need-measures/questions/07`, `14`.

## What Changes

- **Plant kinds** declared in the Workload. A Plant with no kind is a literal, so existing Workloads and records keep their meaning.
  - **literal**: a fictional token.
  - **superseded**: a value that a later statement replaces. The old value is the near-miss distractor: an answer giving it is wrong, and is reported as stale.
  - **constraint**: a rule the agent must follow later. It is probed silently and scored by a deterministic rule: the value appears in the arguments of a tool call the Probe Turn made.
- **Placement**:
  - in a prompt;
  - in a tool result, from a file in the Workload's overlay that a prompt names.

  The Workload is rejected unless each Plant's value appears exactly where it is declared and nowhere else in the prompts.
- **Tools-forbidden Probes**: a prompt may declare that it forbids tools. Measures flag a breach when that Turn made a tool call. The Probes of `read-only-40` and `smoke` already say "Do not use any tools" and are declared so.
- **Distance and position**: Measures find the Turn where each Plant entered the Conversation, from the Journal. Each Probe is tagged with its distance from that Turn and with where the Plant sat in the Probe's window:
  - Opening, Pin or tail;
  - summary, for plain omp after a compaction;
  - evicted;
  - unplanted, when its file was never read;
  - unknown.
- **Attribution, offline from the per-Call window.** Each answered Plant gets a source and a result (right or wrong). The source is the first that holds the value, in this order:
  - a window part: Opening, Pin, tail or summary;
  - a Pull result received in the Probe Turn;
  - another tool result received in the Probe Turn;
  - none.

  A right answer with no source is a leak. A wrong answer despite a source is reported apart from Lapses.
- **Third Lapse route**: a failed Probe, meaning a wrong answer with no source for a Plant that had been evicted. It is counted on both Arms in the same five distance bands as the others, and never added to them.
- **Report**: Retention per Probe, by distance band and by position, plus a source × result table with leaks and stale answers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `benchmark-runs`:
  - the Workload's Plant declaration gains kind, superseded value and overlay file, and a prompt can forbid tools, all with validation;
  - the record keeps the Plants as declared and each prompt's tools flag.
- `measures`:
  - "Retention per Plant" scores by kind;
  - new requirements cover distance and position, source attribution, the failed-Probe Lapse route, and the report's Retention breakdowns.

## Impact

- `scripts/workload.ts`: the Plant and prompt fields and their validation.
- `scripts/bench-tokens.ts`: records the new fields, and the report gains the Retention breakdowns, the source table, and failed-Probe columns in the band table.
- `scripts/measures.ts`: scoring by kind, the Plant's Turn, position, source, and failed-Probe Lapses.
- `src/journal.ts`: a compaction's summary text, read for the summary part.
- `bench/workloads/read-only-40/` and `smoke/`: the Probe declares `tools: false`. Nothing sent changes, so the version stays 1, and each README says so.
- `README.md`: the Measures paragraph.
- Tests: Workload validation cases, plus fixture records for both Arms covering every kind, position and source, including a leak.
