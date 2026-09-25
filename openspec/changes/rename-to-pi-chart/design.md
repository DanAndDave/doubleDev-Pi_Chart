## Context

A rename is a refactor with a user-facing blast radius. The inventory behind this one: 25 `CM_*` variables (23 read by `loadConfig`, plus `CM_BUN` and `CM_EMBED_MODEL`), four test gates (`CM_LIVE`, `CM_EMBED`, `CM_GRAPHIFY`, `CM_OPENSPEC`) and one capture path, the `/context-manager` command and its `setup` subcommand, the `[context-manager]` stderr prefix, three elision markers, `contextManager()`, `cmShortened`, `~/.context-manager/{bundle,graphify}`, the `context-manager-thread-store` container with its `context_manager` role, `generated.by: context-manager@<host>`, and prose across the README, `CONTEXT.md`, `AGENTS.md`, `docs/` and fifteen archived changes.

## Goals / Non-Goals

**Goals:**

- One name, everywhere it is spoken: to an operator, to a model, to the filesystem, to Postgres.
- A configuration written for the old name that fails where it can be seen, not silently.
- Nothing about what the system does changes, and the suite is the evidence.

**Non-Goals:**

- A compatibility layer. `CM_*` is not read at all, and the old command is not registered.
- Moving the operator's own files. Derived state is rebuilt; written state is reported.
- Renaming things that merely carry the old prefix and are not the project: collected Journal directories, and the `cm-` prefix on temporary directories a test creates and deletes within the same run.

## Decisions

### `PICHART_`, not `PI_`

The harness reads `PI_CODING_AGENT_DIR` and its siblings. A variable named `PI_DOC_BUNDLE` would sit in the same namespace as the harness's own and be read by a person as the harness's own. `PICHART_` is unambiguous at the cost of four characters, and a variable name is read far more often than it is typed.

### The old prefix is diagnosed, never honoured

Reading `CM_*` as a fallback would mean two names for one setting for as long as anyone left the fallback in. Ignoring it silently would mean a session that looks configured and runs on defaults — the undiagnosable failure ADR-0003 forbids.

So `loadConfig` does not look at `CM_*`, and session start names every one still set beside the variable that replaces it. It is a report, in the same voice as the memory-backend and model-swap reports, and it says the old variable does nothing.

### `cmShortened` becomes `piChartShortened`, and nothing migrates

The field marks a message the Assembler shortened. It is written, never read — it exists so a reader of a Journal can tell shortened content from short content. Rows already written keep the old field; a message is what was sent, and nothing rewrites it. Renaming it shifts the token estimate of a shortened message by the difference in field-name length, which is why the byte-for-byte check below is run over real Journals rather than asserted.

### Derived state is rebuilt, written state is reported

`~/.context-manager/graphify` is a virtualenv the Graph Store builds; pointing at `~/.pi-chart/graphify` rebuilds it, which costs a minute and nothing else. `~/.context-manager/bundle` is the operator's own Concepts. No code moves it, and setup does not create an empty bundle over the top of it: both the check and the setup path report it and say to move it or to set `PICHART_DOC_BUNDLE`. A rename that relocates somebody's documents is not a rename.

### The container, the role and the compose project change together

`pi-chart-thread-store`, role `pi_chart`, project `pi-chart`. The project name is not cosmetic: a compose volume is scoped to it, and a renamed container on the volume the old project made starts on a cluster that was initialised under the old role — a store that is healthy and refuses every connection. The Thread Store is derived from the Journal (ADR-0002), so the honest migration is the one already documented: start the new container and re-ingest. An operator who would rather keep the old one points `PICHART_DATABASE_URL` at it; the schema is untouched, and the migration list does not care what the role is called.

### The archive is rewritten, the evidence is not renamed

Archived changes and ADRs are prose about this system and say its name. Figures, commands and file paths inside them stay exactly as they were measured: `--group governed=cm-cache-run` names Journal directories that exist on this machine, and a documented command that no longer reproduces its figure is worse than a stale name.

## Risks / Trade-offs

- **A silent behaviour change hiding inside a rename** → every Pack this produces is compared byte for byte against the same Journals the `assembler-shape` baseline used, and the only expected differences are the marker's text and the field's name.
- **A missed reference** → the check is not "grep finds nothing"; it is that a live Conversation configured entirely under `PICHART_*` assembles, records, and answers, and that a `CM_*` left set is reported.
- **The archive's figures reading as though they were collected under the new name** → they were not, and they are unchanged; only the prose around them moves.

## Testing seams

| Requirement | Seam |
| --- | --- |
| Settings are read under the new prefix | `loadConfig(env)` — a pure function over an environment object. |
| A setting under the old prefix is reported, not honoured | `loadConfig` for the value, the extension harness for the report. |
| The install check names the bundle left at the old default | `Installation.check` and `Installation.setup`, with the filesystem stubbed. |
| Nothing else changed | The existing suite, plus a Pack-for-Pack comparison over this machine's Journals. |
| The name reaches a live session | A governed Conversation configured only with `PICHART_*`. |

## Open Questions

None.
