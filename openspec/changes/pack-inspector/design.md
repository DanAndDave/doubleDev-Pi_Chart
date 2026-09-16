## Context

Accounting already records, per Call, which parts a pack had, each part's approximate size, the harness-reported `promptTokens` and `nonMessageTokens`, the tail's provenance, and whether assembly failed. What it does not record is *what* a part contributed: a recalled Turn is a number, not an identity, so "why did this pack contain that?" is unanswerable after the fact.

The Assembler already trims recall to its Budget and knows how many candidates it discarded. That knowledge is currently thrown away at the end of `assemble()`.

The harness offers `registerCommand`, which is the natural surface: the inspector's whole point is looking at the session you are in, and a slash command puts it there without a second process or a web page.

See `proposal.md` for motivation and the two delta specs for the contract.

## Goals / Non-Goals

**Goals:**

- Answer three questions in the session where they arise: what is in this pack, what changed since the last one, and what is this Conversation costing.
- Make the open question from `thread-store-recall` — is Turn-granularity recall too coarse — answerable by looking.
- Record enough that the answer survives the session.

**Non-Goals:**

- Changing any Budget default. Evidence first; the change is a later decision.
- A UI beyond text in the harness. A pack is a list of parts; a table is the right shape.
- Token-accurate Budgets. Budgets stay measured in Turns here; making tokens the unit is what this slice's evidence would justify.

## Decisions

### The Pack carries its own provenance, and accounting stores it

`assemble()` already computes everything an inspector needs and discards most of it. Each `PackPart` gains what it contributed — for recall, the Turn indices; for the tail, the Turns it carried — plus the Budget that bounded it and how many candidates it had. Accounting persists that.

The alternative was to reconstruct provenance at inspection time by re-running assembly. Rejected: it would answer "what would a pack look like now", not "what did the model actually get", and those diverge the moment the store changes. The record has to be written when the pack is built.

### A part that was trimmed says so

"Recall contributed 2 Turns" and "recall contributed 2 of 11 candidates, the rest dropped" are different facts, and only the second tells you the Budget is the binding constraint. Candidate count is the cheapest possible signal that a Budget is too small, and it costs one integer per part.

### Diffing compares content, not sizes

Two packs differ usefully in *what* they carried, not by how many tokens apart they were. The diff reports entering, leaving, and unchanged content by part and identity. This is the view that makes an unstable recall — a recollection that flickers in and out between Calls — visible, and flickering recall is the most likely way Turn-granularity embedding fails.

### Budget changes live in memory, not in a file

A Budget set mid-session applies from the next Call and is forgotten when the session ends. Tuning is an experiment you run for a few Turns, and an experiment that silently persists into tomorrow's sessions is a trap. The environment variables remain the way to set a default you mean to keep.

### Migration adds detail without rewriting history

The new per-part detail is additive. Calls recorded before it read back with the detail absent, which the spec requires explicitly — a store full of older rows must stay readable, because ADR-0002's "drop it and re-ingest" only restores Turns, not the accounting that described packs which no longer exist.

## Risks / Trade-offs

- **Recording what each part contributed grows accounting rows** → indices and counts, not content; the Turns themselves are already stored once.
- **An inspector is only as honest as the approximation behind it** → part sizes remain the local approximation and stay labelled approximate; pack-versus-Floor uses harness-reported figures on both sides, as it already does.
- **A slash command is harness-specific** → it is a thin adapter over an inspection API that is testable without the harness, the same shape as the `context` handler.
- **Live Budget changes make a session non-reproducible** → the Budget in force is recorded per Call, so a pack can still be explained afterwards.

## Testing seams

| Requirement | Seam |
| --- | --- |
| A call's pack can be examined | Inspection API boundary, over accounting written by the in-memory store. |
| A part reports how much of its budget it spent | `assemble()` boundary for the recorded numbers; inspection API for how they read. |
| Two packs can be compared | Inspection API boundary, two recorded Calls. |
| A conversation's windows can be summarised | Inspection API boundary, including the empty Conversation. |
| Budgets can be changed within a session | Extension handler boundary: change, then assert the next Call's pack. |
| Inspection never alters what it inspects | Inspection API boundary: read accounting, inspect, read again, compare. |
| Accounting attributes pack contents (modified) | Store boundary against real Postgres for the round-trip, including a row written without the new detail. |

## Open Questions

None. The question this slice exists to answer — what the Floor actually costs and whether recall earns its Budget — is answered by running it, which is task 6.
