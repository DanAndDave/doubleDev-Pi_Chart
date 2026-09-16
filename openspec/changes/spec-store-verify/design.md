## Context

This is the last of the four Stores and the only one that is not ours. OpenSpec owns the format, the CLI, and the workflows; the Spec Store's whole job is to answer "is this Codebase set up the way our work assumes?" and to fix it when asked.

That framing survives contact with the measurement. Everything below was established by running the real CLI against trees built for the purpose.

**The CLI is permissive about shape.** Against a tree missing `specs/`, a tree missing `changes/archive/`, and a tree missing `config.yaml`, both `openspec list` and `openspec validate --all --strict` exit 0 and report "No active changes found" / "No items found to validate". Only a wholly absent root is caught, and that is the one case nobody needs help noticing.

**The CLI is exact about content.** A change folder holding only `tasks.md` produces exit 1 and `✗ [ERROR] file: Change must have at least one delta. No deltas found.`

**`openspec init` is idempotent and non-destructive.** Run over a tree already holding `openspec/specs/billing/spec.md` and a `config.yaml` with custom `context:`, both survived verbatim; run over a tree missing `specs/` and `changes/archive/`, both appeared. Exit 0 in each case.

## Goals / Non-Goals

**Goals:**

- A precise answer to whether a Codebase is set up for this work.
- A way to make it so that cannot damage what is already there.

**Non-Goals:**

- Anything in a Context Pack. This Store feeds nothing, by requirement.
- Re-implementing `openspec validate`, authoring specs, or running workflows.
- Repairing malformed content. Content is the author's; structure is the setup's.

## Decisions

### The division follows the measurement, not the intuition

The obvious design delegates everything to the CLI. The measurement says that would miss exactly the failures worth catching: a tree missing `specs/` reports success three different ways.

So the split is by what each side can actually see. The Spec Store checks **shape** — root, `specs/`, `changes/`, `changes/archive/`, `config.yaml` — because nothing else does. OpenSpec checks **content**, because it defines what valid content is, and its message is surfaced verbatim rather than paraphrased into something that will drift from it.

### Initialization is asked for, never assumed

The Graph Store writes a cache into a Codebase at session start, and that was already worth an opt-out. An `openspec/` tree is not a cache: it is a claim about how a project is run, and planting one in every repository an agent happens to open would be presumptuous.

So verification is automatic and read-only; initialization happens when someone asks for it. That is also what makes "never rewrites existing specs or changes" true by construction rather than by care — though the measurement shows `openspec init` would not damage them anyway.

The same restraint governs what is said at session start: a tree that exists and is broken is a problem worth a line every session, but a Codebase with no tree has simply not chosen this way of working, and saying so every session would be nagging about a decision that was never ours. `specs` answers either case on demand.

### Repair is delegated, for the same reason as diagnosis

Filling gaps by hand would mean writing our own `config.yaml`, which is OpenSpec's file and will change with OpenSpec. `openspec init` fills exactly the gaps and leaves the rest, measured. So initialization is that command, not a directory-by-directory reconstruction.

### An unavailable CLI is an unknown, not a pass

If `openspec` cannot be run, content conformance is unknown. Reporting "nothing wrong" would be a lie of the most useful-looking kind, and this project has already been bitten by a Store that silently contributed nothing.

## Risks / Trade-offs

- **Our shape check and OpenSpec's expectations could drift** → the shape is five paths, all of them created by `openspec init` itself, so the check is anchored to what the tool produces rather than to a document about it.
- **Asking the CLI costs a process** → so session start does not: it runs the shape check alone, which is five `stat` calls, and content is diagnosed only when `specs` is asked. The shape check is the one that catches what nothing else does.
- **A Codebase that is not spec-driven gets told so every session** → it does not: session start reports only a tree that exists and is wrong, and a Codebase can decline the check entirely with `CM_SPECS=off`.

## Testing seams

| Requirement | Seam |
| --- | --- |
| A Codebase's stated intent is verified without being changed | Verifier over temporary trees on a real filesystem; each case a tree built to be wrong in one way. |
| Verification changes nothing | Same seam: compare the tree before and after. |
| A Codebase can be brought up to a conforming tree | Verifier with a stubbed command runner for the unit case; one gated test against the real `openspec init`. |
| Existing intent is left alone | Gated real-CLI test: initialize over a populated tree and compare contents. |
| Malformed content is diagnosed by the tool that defines it | Command boundary with a stubbed runner; one gated test against a change the real CLI rejects. |
| OpenSpec is not available | Command boundary: a runner that fails. |
| The Spec Store contributes nothing to a Context Pack | `assemble()` boundary: the pack with and without a Spec Store is identical. |

## Open Questions

None.
