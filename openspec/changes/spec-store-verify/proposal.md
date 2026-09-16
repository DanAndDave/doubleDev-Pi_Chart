# Proposal: Spec Store verification

Triage: needs-triage
Blocked by: assembler-owns-window

## What to build

A Codebase's stated intent is available and correctly structured. The tool verifies that a Codebase's OpenSpec directory is initialized the way we want and initializes it when it is not. This is the one Store the project does not own and the one that feeds nothing into a Context Pack.

## Acceptance criteria

- [ ] A bare Codebase is initialized to a conforming OpenSpec tree
- [ ] An already-conforming Codebase is detected as such and left untouched
- [ ] A malformed or partial OpenSpec tree yields a precise diagnosis naming what is wrong
- [ ] Verification never rewrites existing specs or changes

## Non-goals

Planning artifacts for this change — delta specs, design, and tasks — are written by `/opsx-propose`. This file is the slice statement and its blocking edges only.
