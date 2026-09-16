# Workflow

How this repo combines Matt Pocock's skills with OpenSpec. Two systems ship a planning pipeline; this document assigns each artifact exactly one writer so the plan never exists twice.

Invocation: Matt's skills are `/skill:<name>` (they are user-invoked, so the agent reaches them only when asked). OpenSpec workflows are `/opsx-propose`, `/opsx-explore`, `/opsx-apply`, `/opsx-sync`, `/opsx-archive`. Terminal commands are in `issue-tracker.md`.

## Single writer per artifact

| Artifact | Written by |
| --- | --- |
| `CONTEXT.md`, `docs/adr/` | `domain-modeling` (usually via `grill-with-docs`) |
| Slice breakdown + blocking edges | `to-tickets` |
| `proposal.md`, `specs/*/spec.md`, `design.md`, `tasks.md` | `/opsx-propose`, then `/opsx-update` for edits |
| `tasks.md` checkboxes | `/opsx-apply` |
| `openspec/specs/` | `/opsx-archive` (merges the change's deltas) |
| `map.md`, `questions/NN-*.md` | `wayfinder` |

`to-spec` is redundant here: `/opsx-propose` writes the spec OpenSpec validates and archives. Harvest `to-spec`'s user-story and testing-decision sections into `proposal.md` and `design.md` when they add something; the change folder stays the single source.

`implement` is likewise redundant: `/opsx-apply` does the same work and keeps `tasks.md` in sync, which `openspec status` and `openspec archive` read. Borrow its discipline (tdd at seams, typecheck often, full suite once, code-review before commit).

## Phases

Each phase ends where the next one's input exists. Work one change per session; reach for `handoff` when context runs short mid-slice.

### 1. Chart the fog (multi-session efforts only)

`/skill:wayfinder`. Use it when the way to the destination isn't visible from here, which is most greenfield work. It charts decision tickets and resolves **one per session**. Physical layout for this repo is in `issue-tracker.md` under "Per-skill mapping".

When breadth-first grilling surfaces no fog, the effort fits one session: go straight to phase 2.

### 2. Decide what to build

`/skill:grill-with-docs` (= `grilling` + `domain-modeling`): relentless numbered rounds, each question carrying a recommended answer, until the design tree has no open frontier. Terms and decisions land in `CONTEXT.md` and `docs/adr/` as they settle.

Dispatch side quests rather than guessing: `/skill:research` for facts outside this repo, `/skill:prototype` when "how should it behave or look" is the open question.

Greenfield leverage: every term is still up for grabs, so `CONTEXT.md` written now sets the vocabulary every later change, task, and test name inherits.

### 3. Slice it

`/skill:to-tickets`. Each slice is a **tracer bullet**: a complete vertical path through every layer, demoable on its own, sized to one fresh context window.

- One independently shippable slice → one change folder.
- Slices that only ship together → numbered items in one change's `tasks.md`.
- The first greenfield slice is the **walking skeleton**: scaffold plus test harness plus one end-to-end path that runs. Everything else is blocked by it.
- A wide refactor (one mechanical change fanning across the codebase) is sequenced expand → migrate batches → contract, one change folder each, never forced into a tracer bullet.

### 4. Plan the slice

`/opsx-propose <change-id>` writes all four artifacts. It holds a planning boundary: no project code, and implementation waits for a fresh request.

Then add a `## Testing seams` section to `design.md`, naming the seam each requirement is tested through. Prefer existing seams; prefer the highest seam; one seam is the target. OpenSpec has no seam concept and `tdd` needs one, so this section is what connects the plan to the loop that verifies it.

Finish with `openspec validate <change-id>`. A change with no spec delta is an error by design; declare `skip_specs: true` in `.openspec.yaml` for tooling, CI, or docs-only work.

### 5. Build the slice

`/opsx-apply`, running `/skill:tdd` at the seams from `design.md`: red on the behaviour first, green, then refactor. Tick `tasks.md` as tasks land, typecheck regularly, run the full suite once at the end.

### 6. Close the slice

`/skill:code-review` (parallel standards and spec axes), fix what it raises, commit, then `/opsx-archive <change-id>`: deltas merge into `openspec/specs/` and the folder moves to `openspec/changes/archive/<date>-<change-id>/`. Return to the phase 3 frontier.

## Standing habits

- `/skill:improve-codebase-architecture` every few days: surveys for deepening opportunities and grills through the one you pick.
- `/skill:codebase-design` when placing a seam or deciding what a module hides.
- `/opsx-explore` for brownfield "what's the cleanest path here" once code exists; `grilling` stays the entry point while the answer is a decision only the human can make.
- `Triage:` lines earn their place when queueing changes for AFK agents; see `triage-labels.md`.
- `.omp/skills/openspec-*`, `.omp/commands/`, and `.claude/` are generated: `openspec update` rewrites them. Repo instructions live in `AGENTS.md` and `docs/agents/`.
