## 1. The port override

- [ ] 1.1 Read `store-hygiene`'s resolution of `CM_PG_PORT` before touching the sentence, and record which wording applies: the variable became readable in code, or it did not
- [ ] 1.2 If it became readable, scope `README.md:131` to what the code consults — the default URL only, not a `CM_DATABASE_URL` the user supplied — and check the sentence names the `loadConfig` line that reads it (`src/config.ts:86-108`)
- [ ] 1.3 If it did not, replace the sentence with the port `compose.yaml:10` publishes, and check that no `CM_PG_PORT` remains in `README.md` while `src/config.ts:71-72,86-108` still reads none

## 2. The settings table

- [ ] 2.1 Add `CM_EMBED_MODEL` to the table at `README.md:58-70`, its default the pinned model, and check the default against the fallback at `src/embedder-worker.ts:17`
- [ ] 2.2 State in that row what a wrong width costs — every embed batch throws into the worker's background stderr while everything else carries on — and check the phrasing against the failure mode `src/bun-runtime.ts:9-14` records eliminating for `CM_BUN`
- [ ] 2.3 Say that mixing models corrupts ranking until `recall-fidelity` records provenance per vector, and check the row claims only today's behaviour against the hardcoded width at `src/embedder.ts:57` and the width-only schema at `src/postgres-store.ts:96-97`
- [ ] 2.4 Grep `README.md` for every `CM_*` mention and reconcile that list against what is read at `src/config.ts:86-108`, `src/bun-runtime.ts:25` and `src/embedder-worker.ts:17`, and record both directions — documented and unread, read and undocumented — so the table is complete rather than two items less wrong
- [ ] 2.5 Keep the variables read outside `src/` out of the settings table: the suite gates `CM_LIVE`, `CM_EMBED`, `CM_GRAPHIFY`, `CM_OPENSPEC` and the capture path `CM_CAPTURE_FILE` (`test/capture-extension.ts:19`), and check each stays where the testing section already documents it
- [ ] 2.6 Resolve every further discrepancy that pass turns up — document a variable the code reads, drop one nothing reads — and check each edit against the `file:line` that reads it, or against its absence from all three readers

## 3. What reading a bundle writes

- [ ] 3.1 State in the curated-knowledge section that reading a bundle writes one frontmatter key into every conformant Concept that lacks an identity, and check against the rewrite at `src/doc-store.ts:264-290`
- [ ] 3.2 State that this happens on every session start, so a version-controlled bundle goes dirty unannounced, and check against the `ensureIdentities` call in `readBundle` at `src/doc-store.ts:333`
- [ ] 3.3 Give it the emphasis the Graph Store's repository write already carries at `README.md:99`, naming what is written and why rather than warning without a reason, and check the reason against `src/doc-store.ts:257-263`

## 4. What an unreachable Thread Store costs

- [ ] 4.1 Correct `README.md:13` to name everything that stops — the tail falls back to the harness's own history, and recall, curated knowledge, cross-Conversation search and cross-Conversation Accounting stop with it — and check the wording against `src/install.ts:88` and the registrations the no-database branch omits (`src/extension.ts:887-906` against `:921-939`)
- [ ] 4.2 Correct the same understatement at `README.md:43`, where a store that is not running is priced as degrading to the harness's own history, and check it against the same two branches
- [ ] 4.3 Correct the `CM_DATABASE_URL` row at `README.md:63` to the same breadth, and check that curated knowledge is included because the Concept index lives in Postgres (`src/postgres-store.ts:819`)
- [ ] 4.4 Grep `README.md` for every remaining restatement of the fallback and confirm three places were corrected and no fourth survives, checking each hit against `src/install.ts:84-88`

## 5. Where audits live

- [ ] 5.1 Add one line at `docs/agents/issue-tracker.md:61` naming `docs/audits/<date>-<topic>.md` beside the `docs/research/` convention it already records, no index file, and check the pattern against the directory's own `docs/audits/2026-09-16-functionality-audit.md`

## 6. Verification

- [ ] 6.1 Confirm the diff is `README.md` and `docs/agents/issue-tracker.md` alone — nothing under `src/`, `test/`, or `openspec/specs/` changed, because every claim here is documentation catching up to shipped behaviour
- [ ] 6.2 Re-read every corrected claim against the `file:line` cited for it and confirm each still matches, since sibling changes move lines
- [ ] 6.3 Confirm `openspec validate audit-docs-debt` passes with `skip_specs: true` in `.openspec.yaml` and no `specs/` directory present, and that `openspec status --change audit-docs-debt` reports no missing artifact
