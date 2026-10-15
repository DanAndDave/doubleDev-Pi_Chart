# Measuring both arms alike

Type: grilling
Status: closed
Blocked by: 02-where-the-measures-are-computed

## Question

How does each measure get one definition that applies equally to plain omp and pi-chart? Settle the following:

- What a plain-omp Call's "window parts" are, given that its window is the whole accumulated history (or a compaction summary of it).
- Where plain omp's figures come from, given that it has no Accounting.
- Which Measures exist on one Arm only, and how the comparison reports them. Examples: recall Pulls (plain omp has no recall tool), and compaction (pi-chart suppresses it).
- What is normalised, and by what: per Call, per Turn, per Run, or per Pass.

## What's known

- A Re-fetch is defined by an identical tool result, so both Arms can compute it from Journals alone. Only a Re-fetch of a result that had left the window is a Lapse; telling the two apart needs each Arm's window contents per Call (ticket 01).
- Both arms write Journals under the default session root (`scripts/bench-tokens.ts:28`). [INFERENCE] Whether plain-omp Conversations reach the Thread Store depends on a later pi-chart process ingesting them; this has not been verified.
- Provider `usage` per Call is in both arms' Journals, and it is what every existing comparison uses.

## Resolution

- **Shared window parts.** Every Call's Context Window is split into the same parts on both Arms; a part an Arm lacks is empty there.

  | Part | pi-chart | plain omp |
  |---|---|---|
  | system prompt | yes | yes |
  | Opening | yes | — |
  | Pin | yes | — |
  | summary | — (compaction suppressed) | the compaction summary, if any |
  | tail | the Turns it kept | every Turn since the last compaction |
  | current Turn | yes | yes |

- **Glossary.** Context Window now means what a Call sent, whatever the Arm; "rebuilt each turn" moves to Context Pack. Utilisation is a share of the Context Window, not the Context Pack, and is measured on tail plus summary on both Arms.
- **One-Arm Measures** (Pulls, compactions, Opening and Pin attribution) appear as rows whose other side reads "n/a"; no headline figure is built from them. Lapse stays comparable: plain omp Lapses through a Re-fetch after compaction and through failed Probes. The report states that the Arms recover Lapses by different routes; zero Pulls on plain omp is not zero Lapses.
- **Normalisation:**

  | Measure | Unit |
  |---|---|
  | Cost | per Run, plus per Pass |
  | Lapses, Re-fetches, Pulls | per Run, by distance band |
  | Utilisation | per Call, token-weighted over the Run |
  | Retention | per Probe, by band and by part |
  | Needed (Ablation) | per ablated Call |

  Nothing is divided by Turns; a Run's Turn count is fixed by the Workload.
- **No Thread Store for plain omp.** Ticket 02 computes everything from the Journal plus Accounting, so plain-omp Conversations need no ingestion; the open [INFERENCE] above no longer matters.
