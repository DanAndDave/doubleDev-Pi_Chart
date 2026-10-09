# Proposal: Pins — User-Written Context Every Pack Carries

Triage: ready-for-agent
Blocked by: None

## Why

Everything a Context Pack carries beyond the tail and the prompt is chosen by retrieval: a recollection, a Concept or a neighbourhood enters only when it ranks, and leaves the moment it does not. A user who needs the agent to keep something in mind for the rest of a Conversation — a constraint, a target, a convention for this piece of work — has no way to say so except repeating it, and the Pack drops it again once it falls out of the tail.

## What Changes

- A **Pin** (CONTEXT.md): text the user writes with `/pins add <text>`, or `/pins add` alone to write it in the harness's editor. Every Context Pack of the Conversation carries every Pin, whole, until the user removes it with `/pins rm <id>` or `/pins rm all`. `/pins` prints each Pin with its id and size. One command with verbs, like `/pack`, because omp already owns `/pin` (pinning a session in its resume list).
- Pins are recorded in the Journal (ADR-0009): they survive resume and `/tree`, are inherited by Conversations forked or branched from this one, and are absent from new or unrelated Conversations.
- A Pack carries its Pins as one part, `pinned`, placed immediately before the current Turn, each attributed as the user's own pinned text. The part is never shortened, never dropped by its Budget, and never reduced for the Ceiling.
- A new Budget, `pins` (count) and `pins-tokens` (size), settable with `/pack budget` and the environment. `/pins add` refuses a Pin that would take the Conversation's Pins over either, saying by how much.
- A footer status shows whether the Conversation holds Pins, how many and how large, and says when the last Call went out unassembled and so did not carry them.
- `/pack`, `/pack diff` and `/pack summary` report the `pinned` part like any other, identifying Pins by id.

## Capabilities

### New Capabilities

- `pins`: writing, removing, listing and showing Pins, and their lifetime across resume, `/tree`, fork, branch and unrelated Conversations.

### Modified Capabilities

- `context-assembly`: a Pack carries every Pin, before the current Turn, irreducible; the Ceiling never reduces Pins.
- `pack-inspection`: the `pinned` part is examined, compared and summarised, and its Budget is changeable within a session.

## Impact

- `src/harness.ts` (`appendEntry`, `getEntries`, `ui.setStatus`, `ui.editor`, `session_switch`, `session_branch`), new `src/pins.ts`, `src/assembler.ts` (`pinned` part, ordering), `src/config.ts` (Budget fields and settings), `src/extension.ts` (commands, session handlers, status), `src/accounting.ts` / `src/inspection.ts` / `src/report.ts` (Pin ids on the recorded part).
- ADR-0009 records why Pins live in the Journal rather than a Store. CONTEXT.md gains **Pin**; **Context Pack**, **Budget** and **Ceiling** mention it.
- No migration: accounting parts are stored as JSON, and records written before Pins existed read back with no `pinned` part.
