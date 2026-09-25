# pi-chart

## Workflow

Planning and building follow a fixed pipeline: chart the fog (`wayfinder`) → decide (`grill-with-docs`) → slice into tracer bullets (`to-tickets`) → plan the slice (`/opsx-propose`) → build it (`/opsx-apply` + `tdd`) → close it (`code-review`, `/opsx-archive`). One change per session.

Each artifact has a single writer: Matt Pocock's skills own alignment, vocabulary, and slicing; OpenSpec owns `proposal.md`, delta specs, `design.md`, `tasks.md`, and `openspec/specs/`. `/opsx-propose` writes the spec, so `to-spec` and `implement` are not used here.

Read `docs/agents/workflow.md` before starting a new effort, planning or editing a change, slicing work into tickets, or implementing tasks: it holds the per-phase steps, the writer table, and the `## Testing seams` requirement that connects `design.md` to `tdd`.

## Agent skills

### Issue tracker

Issues are OpenSpec change folders under `openspec/changes/<change-id>/`; specs are the source of truth in `openspec/specs/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, recorded as a `Triage:` line in a change's `proposal.md` (OpenSpec has no labels). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.
