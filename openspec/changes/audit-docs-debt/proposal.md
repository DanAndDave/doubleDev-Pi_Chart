# Proposal: Documentation Debt From The Functionality Audit

Triage: ready-for-agent

## Why

`README.md:131` offers `CM_PG_PORT` as the Thread Store's port override. `compose.yaml:10` honours it; `DEFAULT_DATABASE_URL` hardcodes `localhost:55432` (`src/config.ts:71-72`) and `loadConfig` never reads it (`:86-108`). Set it and Postgres listens on one port while the extension dials another: nothing ingested, nothing recalled, no curated knowledge, no durable Accounting — and `/context-manager` answers `not reachable … run context-manager setup`, naming the command just run.

`CM_EMBED_MODEL` is read at `src/embedder-worker.ts:17` and inherited by the spawned worker (`src/embedder.ts:147-151`), yet appears in no table; a model of another width throws every embed batch into background stderr — the quiet degradation `src/bun-runtime.ts:9-14` records removing for `CM_BUN`. `readBundle` calls `ensureIdentities` on every start (`src/doc-store.ts:333`), rewriting conformant Concepts' frontmatter through a temp file and rename (`:264-290`): specified, but a bundle under version control goes dirty unannounced, and the README saves its "**It writes into your repository**" warning for the Graph Store (`README.md:99`).

An unreachable Thread Store is priced at the verbatim tail alone (`README.md:13`, restated at `:43` and `:63`; the audit's `:23` has moved). It also costs recall (`src/extension.ts:715-720`), curated knowledge, whose index lives in Postgres (`docs: store`, `:863`; `src/postgres-store.ts:819`), `recall_across_conversations`, registered only with the store (`:357`, `:862`), and cross-Conversation Accounting (`:874`). `src/install.ts:88` already says it correctly.

## What Changes

- The `CM_PG_PORT` sentence is made true against whatever `store-hygiene` decides: kept and scoped to the default URL if the variable becomes readable, replaced by "the port `compose.yaml` publishes" if it does not.
- `CM_EMBED_MODEL` joins the settings table (`README.md:58-70`) beside `CM_BUN`: pinned default, another width breaks every embed in silence, mixing models corrupts ranking until `recall-fidelity` records provenance per vector.
- The Doc Store section gains the Graph Store's warning in its own terms: reading a bundle writes one frontmatter key into Concepts lacking an identity, so a tracked bundle shows a diff.
- All three fallback sentences are restated to match `src/install.ts:88`: the tail falls back to the harness's own record, and recall, curated knowledge, cross-Conversation search and cross-Conversation Accounting stop with it.
- One line at `docs/agents/issue-tracker.md:61` names `docs/audits/<date>-<topic>.md` beside the `docs/research/` convention — a pointer, no index file, matching `docs/research/`, because a directory nothing names is where the next audit will not land.

**Not in scope:** every code change in the audit. A claim only code can make true is documented as today's behaviour, naming the sibling that changes it: `store-hygiene` for the port, `recall-fidelity` for vector provenance.

## Capabilities

### Modified Capabilities

- None. Every item is documentation catching up to specified behaviour: `doc-store` already requires an identity for a Concept lacking one, and no requirement mentions `CM_PG_PORT`, `CM_EMBED_MODEL`, or the breadth of a Thread Store outage. No requirement text changes, so this change declares `skip_specs: true`.

## Impact

- **Schema, configuration, assembly, performance, migration:** none; nothing under `src/` is touched. `.openspec.yaml` carries `skip_specs: true` per `docs/agents/issue-tracker.md:48` — how a genuine no-spec change passes `openspec validate` without a fabricated requirement — and closing uses `openspec archive --skip-specs`.
- **Ordering, not dependency:** the port wording must agree with `store-hygiene`, which owns the code decision; either resolution yields a correct README, so no edge is recorded — only a rule to write this after that lands. Nothing waits on a human or an unmeasured quantity, hence `ready-for-agent`.
- **Cost:** an honest README is longer and less inviting: declining the Thread Store reads as declining three capabilities, and the Doc Store admits it writes to disk. Both true today, both silent today.
- **Completes:** the audit's documentation debt, leaving its remaining items entirely code.
