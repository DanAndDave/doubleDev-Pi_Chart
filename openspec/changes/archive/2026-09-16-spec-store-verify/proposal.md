# Proposal: Spec Store verification

Triage: ready-for-agent
Blocked by: assembler-owns-window

## Why

Three Stores now feed the pack and one does not exist yet. The Spec Store is the odd one: the project does not own it, it holds a Codebase's stated intent rather than its history, and it contributes nothing to a Context Pack.

What it does is make the other work possible. Every workflow this project runs — propose, apply, archive — assumes a conforming `openspec/` tree, and a Codebase that half has one fails in ways that look like tool bugs rather than missing structure.

## What to build

A Codebase's stated intent is available and correctly structured. The tool verifies that a Codebase's OpenSpec directory is initialized the way we want and initializes it when it is not. This is the one Store the project does not own and the one that feeds nothing into a Context Pack.

## Acceptance criteria

- [ ] A bare Codebase is initialized to a conforming OpenSpec tree
- [ ] An already-conforming Codebase is detected as such and left untouched
- [ ] A malformed or partial OpenSpec tree yields a precise diagnosis naming what is wrong
- [ ] Verification never rewrites existing specs or changes

## Non-goals

Reading specs into a Context Pack, authoring or editing specs and changes, running the propose/apply/archive workflows, and replacing anything `openspec validate` already checks.
