# Card footer

`cardFooter(concept)` returns a single line of fields joined by ` :: ` (a space, two colons, a space). The fields, in order:

1. The Concept's id, as is.
2. `by <who>`: the `by` of the Concept's `generated` provenance, or `by nobody` when it records none.
3. `<n> part` when cardSections gives exactly one section, `<n> parts` otherwise (including `0 parts`).
4. The footer marks from notes/badges.md, each as its own field.

Example: `glossary/card :: by agent:omp :: 3 parts :: seal=B :: cites=1`
