# Where the measures are computed

Type: grilling
Status: closed
Blocked by: —

## Question

Where is each measure computed? The options are:

- offline, by a script over Journals (or the Thread Store derived from them);
- live, by the extension, recorded per Call;
- a split between the two. If split, which measures go where?

## What's known

- `openspec/specs/pack-accounting/spec.md:136` says Accounting "SHALL NEVER become a second copy" of the Journal, and a candidate that was not carried keeps only its identity, size and reason. Utilisation and re-fetch detection need message content, so a live record would either reference content by Journal entry id or break that requirement.
- The Thread Store holds every Turn's messages (`turn_messages`), derived from the Journal (ADR-0002). The `structure-match-precision` audit (`openspec/changes/archive/*structure-match-precision/audit.sql`) already judged a part against the full stored Turn in SQL. That is a precedent for the offline route.
- The plain-omp arm runs `--no-extensions`, so it records no Accounting. Any measure computed live exists for one arm only (see "Measuring both arms alike").

## Resolution

- **Offline only.** Every Measure is computed after a Run ends, from what is already recorded. The extension records nothing new, and Accounting does not become a second copy of the Journal (`pack-accounting/spec.md:136`).
- **Content** comes from the Journal for both Arms.
- **What each Call's window held** comes from a different place per Arm:
  - **pi-chart:** the Turn identities Accounting records per Call (`pack-accounting/spec.md:49,128`), resolved against the Journal.
  - **plain omp:** the Journal's active branch up to that Call, with compactions marked.
- **One code path for both Arms.** Everything after the per-Arm "what the window held" step is shared, so the two Arms are measured alike.
- **Where the code lives:** a separate script that reads one finished Run (Journal plus, for pi-chart, Accounting). `scripts/bench-tokens.ts` calls it when a Run ends and stays the only benchmark harness.
- **Why separate:** Measures can be recomputed on old Runs at no model cost. That matters while the Utilisation rule is still being tuned.
