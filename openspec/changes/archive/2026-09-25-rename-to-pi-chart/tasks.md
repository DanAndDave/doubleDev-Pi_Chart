## 1. The baseline that makes this safe

- [x] 1.1 Capture a Pack from every Journal on this machine at four configurations, before any edit, the way `assembler-shape` did

  `scripts/rename-baseline.ts`, the instrument that change deleted,
  restored for this one: 312 Journals, **2,684 Packs** — 477 reduced by
  the ceiling, 2,207 unbound, 248 carrying something elided.

- [x] 1.2 Verify it reproduces against a frozen copy of the session root

  Two runs against `/tmp/cm-journals`, byte for byte identical. The copy
  is what makes that true: the live session root is being appended to
  while the script reads it.

## 2. The name the code speaks

- [x] 2.1 Rename the entry point, the package, the command and its subcommand, and the stderr prefix

  `piChart()` in `src/extension.ts`, `"name": "pi-chart"`, the
  `/pi-chart` command with its `setup` subcommand, and `[pi-chart]` on
  stderr. The plugin link was re-made under the new name and a live
  session loads it.

- [x] 2.2 Rename the three elision markers, and verify a shortened message carries the new one

  `[pi-chart elided …]`, `[pi-chart elided … here]` and `[pi-chart
  dropped … of tool metadata …]`. Carried by 18,455 messages in the
  comparison below. Every assertion in `test/elision.test.ts` is
  untouched — they check what the marker says, not the name in it — and
  its one edit is the renamed field.

- [x] 2.3 Rename `cmShortened` to `piChartShortened`, and verify nothing reads either

  Written in three places, read in none — it exists so a reader of a
  Journal can tell shortened content from short content. Rows already
  written keep the old field; nothing migrates.

## 3. The name the operator types

- [x] 3.1 Move every setting to `PICHART_*`, including `CM_BUN`, `CM_EMBED_MODEL`, the four test gates and the capture path, and verify `loadConfig` reads none of the old names

  25 settings, four gates and the capture path. `loadConfig` names none
  of the old ones, which "is named, with what replaces it, and changes
  nothing" proves by setting two of them and reading the defaults back.

- [x] 3.2 Report every `CM_*` still set at session start beside the variable that replaces it, and verify it is said once and does not change what is configured

  It rides the `problems` channel `loadConfig` already had, so it is
  reported where a bad retention age is. Live, with `CM_TAIL_TURNS=2`
  left set: `[pi-chart] CM_TAIL_TURNS is not read: this is pi-chart now,
  and the setting is PICHART_TAIL_TURNS.` Making the scan skip every
  variable fails the test.

- [x] 3.3 Move the default bundle and graphify paths to `~/.pi-chart/`, and verify the install check reports a bundle left at the old default rather than moving it

  `~/.pi-chart/bundle` and `~/.pi-chart/graphify`. The graphify
  directory is a virtualenv the Graph Store builds, so it is simply
  rebuilt. A bundle at the old default is named with the two ways to
  reach it — "a bundle left where the old name put it is named, not
  moved" — and no code moves it. Removing the check fails that test.

- [x] 3.4 Rename the container and the database role, and verify the default URL and the compose file agree

  `pi-chart-thread-store`, role and password `pi_chart`, database
  `thread_store` unchanged. "The default url and the compose file name
  the same store" reads `compose.yaml` and asserts the role, the
  password, the database and the fallback port against
  `defaultDatabaseUrl()` — the drift that leaves a store running and
  unreachable.

## 4. The name the prose uses

- [x] 4.1 Rewrite the README, `CONTEXT.md` and `AGENTS.md`
- [x] 4.2 Rewrite `docs/adr/` and `docs/audits/`
- [x] 4.3 Rewrite the archived changes, leaving every measured figure, command argument and collected-Journal name exactly as it was

  74 files rewritten in one pass, 417 occurrences. What was held back:
  the names of Journal directories a measurement was collected in —
  `cm-cache-run`, `cm-cache-control`, `cm-projA`, `cm-projB`. They are
  directories that exist on this machine, and
  `measure-pack-cache.ts --journals --group governed=cm-cache-run` has
  to keep reproducing the figure the archive quotes. One quoted
  observation was restored after the sweep rewrote it: `doc-authoring`'s
  live run wrote `by: context-manager@zero` into a Concept, which is
  what happened.

- [x] 4.4 Verify no occurrence of the old name survives outside the evidence named above

  `grep -rI` for `context-manager`, `Context Manager`, `contextManager`,
  `context_manager` and `CM_` leaves five kinds of hit, all deliberate:
  this change folder, which is about the old prefix; the scan in
  `src/config.ts` and the test that drives it; the stranded-bundle path
  in `src/install.ts` and its tests; the Journal directory names above;
  and the common noun "a context manager for coding agents", which is
  what this is, in `CONTEXT.md` and `docs/research/`.

## 5. Verification

- [x] 5.1 Compare Pack for Pack against the baseline, and account for every difference

  2,684 Packs. **300 changed**, and **0** changed what they selected.
  18,455 messages differ, and every one of them was elided on at least
  one side:

  | | messages |
  | --- | --- |
  | identical once the name and the field are normalised | 3,825 |
  | head and tail also moved | 14,628 |
  | no longer shortened at all | 2 |

  The middle row is the marker's length rather than its wording:
  `pi-chart` is eight characters shorter than `context-manager` and
  `piChartShortened` five longer than `cmShortened`, so the room a head
  and a tail have shifts and the retry loop lands an iteration earlier or
  later. The last row is the same arithmetic at the boundary: a message
  that sat just over its allowance now fits, and is carried whole.

  Token deltas run **−106 to +406** with a median of 1, and the number of
  Packs whose irreducible content exceeds the ceiling is **317** before
  and after.

- [x] 5.2 Run the default, store-backed and live suites and the type checker

  `bunx tsc --noEmit` clean; **553** default tests pass; **690** with
  `PICHART_DATABASE_URL` set.

- [x] 5.3 Run a governed Conversation configured only with `PICHART_*`, and confirm it assembles, records and answers

  Three Turns against the vendored bundle with `PICHART_TAIL_TOKENS=1200`:
  it read a 302-line file, answered from curated knowledge, and recorded
  `verbatim-tail ~1146 tokens (1 of 8, content shortened)` beside two
  Concepts.

  Then against the renamed container itself. `docker compose up -d --wait`
  starts `pi-chart-thread-store` on the volume the new project name gives
  it, a session with no `PICHART_DATABASE_URL` at all reaches it on the
  default URL, and the store answers `role: pi_chart` with the Turns and
  Calls it recorded. The old volume, `context-manager_thread-store-data`,
  is left where it is: it holds a derived index the Journal can rebuild,
  and removing somebody's volume is not a rename.

  The plugin has to be linked again — `omp install .` — because the
  harness registers an extension by package name. Until it is, the
  extension is not loaded at all, which is how this was found.

  One thing this turned up and did not cause: against a Docker-backed
  Thread Store, `session_shutdown` exceeds the harness's 2,000 ms handler
  budget. Reproduced with the pre-rename code against the same store, so
  it is older than this change and is recorded in the audit rather than
  fixed here.

- [x] 5.4 Run a Conversation with a `CM_*` variable still set and confirm the report names it

  Shown under 3.2, on every Call of that Conversation's session start.
