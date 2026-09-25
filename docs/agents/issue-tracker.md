# Issue tracker: OpenSpec

Issues, specs, and plans for this repo live in `openspec/`, managed by the OpenSpec CLI (`@fission-ai/openspec`). There is no GitHub/GitLab/Jira tracker for this repo: a **change folder is the ticket**.

## Layout

```
openspec/
├── config.yaml                          # project config (schema: spec-driven)
├── specs/<capability>/spec.md           # source of truth: how the system behaves today
└── changes/
    ├── <change-id>/                     # an open ticket
    │   ├── .openspec.yaml               # schema, created, skip_specs, retire_capabilities
    │   ├── proposal.md                  # why + scope + approach
    │   ├── specs/<capability>/spec.md   # delta specs (## ADDED/MODIFIED/REMOVED/RENAMED Requirements)
    │   ├── design.md                    # technical approach
    │   └── tasks.md                     # implementation checklist
    └── archive/<YYYY-MM-DD>-<change-id>/  # closed tickets
```

`<change-id>` is a kebab-case slug (`add-dark-mode`, `fix-auth-expiry`).

## Commands

Terminal (use these for reading state; they are safe and non-interactive):

| Command | Use |
| --- | --- |
| `openspec list` | List active changes |
| `openspec show <change-id>` | Read a change; `--json`, `--deltas-only` for parsing |
| `openspec status --change <change-id>` | Artifact progress (proposal / specs / design / tasks) |
| `openspec validate <change-id>` / `--all` | Structural check before implementation |
| `openspec new change <change-id>` | Scaffold an empty change folder |
| `openspec archive <change-id> [--skip-specs] [-y]` | Close a change: merge deltas into `specs/`, move to `archive/` |
| `openspec update` | Regenerate tool instruction files after a CLI upgrade |

Agent workflows (this harness, from `.omp/commands/`): `/opsx-explore`, `/opsx-propose`, `/opsx-apply`, `/opsx-sync`, `/opsx-update`, `/opsx-archive`. In Claude Code the same commands spell as `/opsx:propose` etc. Six more workflows (`new`, `continue`, `ff`, `bulk-archive`, `verify`, `onboard`) are available via `openspec config profile` + `openspec update`.

## When a skill says "publish to the issue tracker"

Create a change folder, do not open an issue anywhere:

1. `openspec new change <change-id>` (or `/opsx-propose "<what you want>"` to have the workflow draft the artifacts).
2. Write `proposal.md` (intent, scope with explicit non-goals, approach).
3. Write delta specs under `specs/<capability>/spec.md` using `## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements` / `## RENAMED Requirements`, each requirement carrying at least one `#### Scenario:` block.
4. `openspec validate <change-id>` before handing the change to implementation.

`openspec validate` **errors** when a change has no delta. For a genuine no-spec change (tooling, CI, docs, pure refactor), set `skip_specs: true` in that change's `.openspec.yaml` rather than inventing a fake requirement.

## When a skill says "fetch the relevant ticket"

`openspec show <change-id>` (add `--json` when parsing), or read the files under `openspec/changes/<change-id>/` directly. The user will normally name the change id.

## Per-skill mapping

- **`to-spec`**: the spec is `openspec/changes/<change-id>/proposal.md` plus the delta specs under that change's `specs/`. Behaviour contracts belong in the delta specs; implementation detail belongs in `design.md`, never in a spec.
- **`to-tickets`**: tracer bullets become numbered checklist items in one change's `tasks.md` when they ship together. Split into separate change folders only when each is independently shippable. OpenSpec has no native blocking links, so record edges as a `Blocked by: <change-id>, <change-id>` line near the top of `proposal.md`.
- **`implement`**: work `tasks.md` top to bottom (or run `/opsx-apply`), driving `tdd` at the seams agreed in `design.md`, then `code-review` before committing.
- **`triage`**: see `triage-labels.md`. State is a `Triage:` line in `proposal.md`, because OpenSpec has no label vocabulary.
- **`wayfinder`**: the effort is a change folder. The map is `openspec/changes/<effort>/map.md`; child decision tickets are `openspec/changes/<effort>/questions/NN-<slug>.md` with `Type:`, `Status:`, and `Blocked by:` lines. Both are extra files inside the change folder; `openspec validate` and `openspec status` ignore them, so they are safe to add.
- **`research`**: findings go to `docs/research/<topic>.md`, not into a change folder, unless the question belongs to a specific effort's `questions/`.
- **audits**: a systematic read of the whole system against its own specs goes to `docs/audits/<date>-<topic>.md`, beside the `docs/research/` convention above. Dated, because an audit describes the system on a day; named by topic, because the next one is about something else. No index file — the directory listing is the index.

## Closing work

`openspec archive <change-id>` merges the change's deltas into `openspec/specs/` and moves the folder to `openspec/changes/archive/<date>-<change-id>/`. Use `--skip-specs` for infrastructure, tooling, or docs-only changes. A `wontfix` change is archived the same way with `--skip-specs`, with the reason recorded in `proposal.md` first.

## PRs as a request surface

**Off.** This repo has no remote, so external pull requests are not part of the triage queue.
