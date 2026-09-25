# Proposal: The Project Is Called Pi Chart

Triage: ready-for-agent

## Why

The repository this ships from is `Pi_Chart`, and everything inside it says `pi-chart`. A name in two places is a name nobody can search for: an operator reading `[pi-chart]` on stderr, a variable called `PICHART_DATABASE_URL`, a directory at `~/.pi-chart/bundle` and a repository called Pi Chart are four things until someone explains they are one.

`context-manager` was also never a name so much as a description — "a context manager for coding agents" — which is why it collides with the Python language feature, with the concept `CONTEXT.md` defines, and with every other tool that manages context.

## What Changes

- **Everything the name reaches, in one pass.** The package, the command, the stderr prefix, the environment prefix, the on-disk directories, the container, the database role, the elision marker, the entry point, and the message field a shortened message carries.
- **`CM_*` becomes `PICHART_*`.** Not `PI_*`: the harness already owns that prefix (`PI_CODING_AGENT_DIR`), and a reader scanning for `PI_` should not have to know which of two systems a variable belongs to.
- **A configuration under the old prefix fails loudly rather than silently.** Nothing reads `CM_*` any more, so a session started with one would quietly run on defaults. Session start names every `CM_*` still set and the variable that replaces it. That is diagnosis, not a compatibility shim — the old name does nothing, and is said to do nothing.
- **The Thread Store's old Postgres keeps working, or is rebuilt.** The default role changes with the container, so an existing store is reached by pointing `PICHART_DATABASE_URL` at it. Rebuilding instead costs one re-ingest and loses nothing, because the Journal is the record (ADR-0002).
- **The archive is rewritten too.** Proposals, designs, task evidence and ADRs say Pi Chart. What is *not* rewritten is the name of anything that exists on disk and is not the project: the Journal directories a measurement was collected in (`cm-cache-run`, `cm-cache-control`) are data, and renaming them in prose would make a documented command stop reproducing its figure.

**Not in scope:** what anything does. No Budget, threshold, default or assembly rule changes. No Store gains or loses a capability. The one behavioural difference is the one the rename forces: a Turn carrying an elided part re-embeds once, because the marker's text is part of what a Turn is embedded from.

## Capabilities

### Modified Capabilities

- None. Every requirement in `openspec/specs/` is about what the system does, and none names a variable, a command or a marker's text — so this declares `skip_specs: true` per `docs/agents/issue-tracker.md` rather than inventing a requirement to hold a string.

## Impact

- **Published surface:** 25 environment variables, one slash command, one package name, one container, two `$HOME` directories and one database role all change at once. There is no deprecation window, because there is no user but this machine and none of it is published to a registry. The harness registers an extension by package name, so the plugin must be linked again with `omp install .`; until it is, nothing loads.
- **Existing state:** `~/.context-manager/graphify` is a derived cache and is simply rebuilt. `~/.context-manager/bundle` is the operator's own writing and is *not* moved by any code — the check reports it and says what to do, because moving somebody's documents without asking is not a rename.
- **Context Windows:** the elision marker moves, and a Turn is embedded from the text its messages compose, so a Turn whose embed text holds the marker now fingerprints differently. What that costs is less than it sounds: `ingest` resumes from the Turn the Store already has and reconsiders only that one, so stored vectors stay as they are and a Conversation re-embeds its head Turn at most. A corpus holding both markers is a corpus that ranks both, because the vectors are the same model's — nothing here touches `recall-fidelity`'s rule, which is about the model, not the text.
- **Accounting:** `cmShortened` becomes `piChartShortened` on messages the Assembler shortens. Rows already written keep the old field; nothing reads either one, so nothing migrates.
