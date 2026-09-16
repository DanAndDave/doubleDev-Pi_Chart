# Proposal: Doc Store bundle read and validate

Triage: needs-triage
Blocked by: assembler-owns-window

## What to build

Durable knowledge has a home that outlives every Codebase: one machine-wide OKF bundle. This slice makes it readable and trustworthy — Concepts parsed from markdown with YAML frontmatter, conformance checked, `index.md` progressive disclosure walked, and the trust and freshness signals the format defines surfaced.

OKF specifies no validator and no identifier scheme beyond the file path, so both are ours. The spec version is pinned to a known commit because it is a five-week-old draft at v0.2.

## Acceptance criteria

- [ ] A conforming bundle is read and its Concepts listed with their type, status, and freshness
- [ ] A non-conforming Concept is reported with the file and the reason
- [ ] Unknown frontmatter keys and unknown types are preserved and tolerated, per the format's conformance rules
- [ ] A stale Concept and an unverified Concept are distinguishable from a human-reviewed current one
- [ ] Concept identity survives a file rename within the bundle

## Non-goals

Planning artifacts for this change — delta specs, design, and tasks — are written by `/opsx-propose`. This file is the slice statement and its blocking edges only.
