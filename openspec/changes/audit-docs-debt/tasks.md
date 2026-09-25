## 1. The port override

- [x] 1.1 Read `store-hygiene`'s resolution of `CM_PG_PORT` before touching the sentence, and record which wording applies: the variable became readable in code, or it did not
- [x] 1.2 If it became readable, scope `README.md:131` to what the code consults — the default URL only, not a `CM_DATABASE_URL` the user supplied — and check the sentence names the `loadConfig` line that reads it (`src/config.ts:95-117`)
- [x] 1.3 If it did not, replace the sentence with the port `compose.yaml:10` publishes, and check that no `CM_PG_PORT` remains in `README.md` while `src/config.ts:80-81,95-117` still reads none

## 2. The settings table

- [x] 2.1 Add `CM_EMBED_MODEL` to the table at `README.md:58-70`, its default the pinned model, and check the default against the fallback at `src/embedder-worker.ts:19`
- [x] 2.2 State in that row what a wrong width costs — every embed batch throws into the worker's background stderr while everything else carries on — and check the phrasing against the failure mode `src/bun-runtime.ts:9-14` records eliminating for `CM_BUN`
- [x] 2.3 Say what a model swap now costs, and check the row against today's behaviour rather than the audit's: `recall-fidelity` shipped the provenance this task was waiting on, so a differing width is refused against the worker's reported identity (`src/postgres-store.ts:365-369`) and a same-width stranger is recorded per vector, excluded from ranking, and re-embedded — not silently mixed into one vector space. The row should say a swap costs a re-embedding of the corpus, not that it corrupts ranking
- [x] 2.4 Grep `README.md` for every `CM_*` mention and reconcile that list against what is read at `src/config.ts:95-117`, `src/bun-runtime.ts:25` and `src/embedder-worker.ts:19`, and record both directions — documented and unread, read and undocumented — so the table is complete rather than two items less wrong
- [x] 2.5 Keep the variables read outside `src/` out of the settings table: the suite gates `CM_LIVE`, `CM_EMBED`, `CM_GRAPHIFY`, `CM_OPENSPEC` and the capture path `CM_CAPTURE_FILE` (`test/capture-extension.ts:19`), and check each stays where the testing section already documents it
- [x] 2.6 Resolve every further discrepancy that pass turns up — document a variable the code reads, drop one nothing reads — and check each edit against the `file:line` that reads it, or against its absence from all three readers

## 3. What reading a bundle writes

- [x] 3.1 State in the curated-knowledge section that reading a bundle writes one frontmatter key into every conformant Concept that lacks an identity, and check against the rewrite at `src/doc-store.ts:264-290`
- [x] 3.2 State that this happens on every session start, so a version-controlled bundle goes dirty unannounced, and check against the `ensureIdentities` call in `readBundle` at `src/doc-store.ts:333`
- [x] 3.3 Give it the emphasis the Graph Store's repository write already carries at `README.md:99`, naming what is written and why rather than warning without a reason, and check the reason against `src/doc-store.ts:257-263`

## 4. What an unreachable Thread Store costs

- [x] 4.1 Correct `README.md:13` to name everything that stops — the tail falls back to the harness's own history, and recall, curated knowledge, cross-Conversation search and cross-Conversation Accounting stop with it — and check the wording against `src/install.ts:88` and the registrations the no-database branch omits (`src/extension.ts:927-946` against `:961-980`)
- [x] 4.2 Correct the same understatement at `README.md:43`, where a store that is not running is priced as degrading to the harness's own history, and check it against the same two branches
- [x] 4.3 Correct the `CM_DATABASE_URL` row at `README.md:63` to the same breadth, and check that curated knowledge is included because the Concept index lives in Postgres (`src/postgres-store.ts:925`)
- [x] 4.4 Grep `README.md` for every remaining restatement of the fallback and confirm three places were corrected and no fourth survives, checking each hit against `src/install.ts:84-88`

## 5. Where audits live

- [x] 5.1 Add one line at `docs/agents/issue-tracker.md:61` naming `docs/audits/<date>-<topic>.md` beside the `docs/research/` convention it already records, no index file, and check the pattern against the directory's own `docs/audits/2026-09-16-functionality-audit.md`

## 6. Verification

- [x] 6.1 Confirm the diff is `README.md` and `docs/agents/issue-tracker.md` alone — nothing under `src/`, `test/`, or `openspec/specs/` changed, because every claim here is documentation catching up to shipped behaviour
- [x] 6.2 Re-read every corrected claim against the `file:line` cited for it and confirm each still matches, since sibling changes move lines
- [x] 6.3 Confirm `openspec validate audit-docs-debt` passes with `skip_specs: true` in `.openspec.yaml` and no `specs/` directory present, and that `openspec status --change audit-docs-debt` reports no missing artifact

## 7. What the reconciliation found

> **1.x** `store-hygiene` made `CM_PG_PORT` readable, so the sentence is kept and scoped: it moves the port on both sides — `compose.yaml` publishes it, the default URL `loadConfig` builds dials it — and is read only when `CM_DATABASE_URL` is unset. It also gains a settings-table row, which the audit's ticket-3 note assigned here.
>
> **2.4** Reconciled both directions by script over `README.md` against every `CM_*` read under `src/`, `test/` and `scripts/`: **read by `src/` and undocumented: none; documented and read nowhere: none.** The five gates read only by the suite — `CM_LIVE`, `CM_EMBED`, `CM_GRAPHIFY`, `CM_OPENSPEC`, `CM_CAPTURE_FILE` — stay in the testing section, where the commands that use them are.
>
> **2.3** The audit's "mixing models corrupts ranking" is out of date for Turns and still true for Concepts, so the row says both: a wrong width is refused by `embedPending`; a same-width swap costs a re-embedding of the Turns, which record their model per vector, and leaves the Concept index ranking across two models until the bundle changes or the index is dropped. That asymmetry is a code gap with no owner, recorded in the audit for whoever plans next.
>
> **3.x** The write is on the indexing path, not the reading one: `readBundle` calls `ensureIdentities`, and `readBundle` is wired only where a Thread Store is configured. Walking never writes. The section says so in the Graph Store's terms — what is written, why it must be, and that a tracked bundle goes dirty the first time.
>
> **4.x** Three restatements corrected and a fourth found in "What it records". The audit's own wording was too kind to the unreachable case: declining the store with `CM_DATABASE_URL=""` keeps Accounting for the Conversation in progress, so `/pack` answers; a store configured and unreachable keeps none. The README now distinguishes them, because they fail differently.
>
> **6.x** The diff is `README.md` and `docs/agents/issue-tracker.md`; nothing under `src/`, `test/` or `openspec/specs/` changed. 531 default tests pass, `tsc` is clean — both unchanged, as they must be — and `openspec validate audit-docs-debt --strict` passes under `skip_specs`.

## 8. Review

One axis, documentation being the whole of it, against `03f1edb`.

**One P1, acted on.** The first draft told the same lie the audit did, one level down: it said an unreachable Thread Store keeps Accounting in memory so `/pack` still answers. It does not — that branch exists only when the store is declined outright, and with a store configured but down, `/pack`'s first read throws. Declined and unreachable are now described separately, in all three places.

**Two P2s.** The `CM_EMBED_MODEL` row claimed a same-width swap costs a re-embedding rather than corrupted ranking; true of Turns, false of Concepts, whose sections carry no model. And "reading a bundle writes into it" overstated: the write is on the indexing path, which a declined Thread Store never reaches.

**Five P3s**: two banned synonyms introduced by the draft, a fourth fallback restatement the sweep missed, "four suites are gated" where five are, `file:line` citations in a user-facing document — replaced by symbols, since stale citations are the failure this change exists to correct — and a missing `design.md`, which every other change in the tree carries.
