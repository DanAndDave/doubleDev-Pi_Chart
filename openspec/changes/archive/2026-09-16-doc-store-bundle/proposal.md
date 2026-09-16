# Proposal: Doc Store bundle read and validate

Triage: ready-for-agent
Blocked by: assembler-owns-window

## Why

The Thread Store remembers what happened; nothing yet holds what was *decided*. Standards, conventions, and hard-won conclusions currently live either in a Codebase (and die with it) or in the Conversation that produced them (and scroll away). The Doc Store is the one layer that outlives every Codebase, and it is the reason the project bothers with a document format at all.

This slice makes that corpus readable and trustworthy before anything retrieves from it. OKF gives a format and deliberately nothing else: no validator, no identifier beyond the file path, no retrieval. Reading and conformance are therefore real work, and doing them first means `doc-store-recall` indexes content already known to be well-formed rather than discovering rot at query time.

## What Changes

- Add the Doc Store: one machine-wide OKF bundle, read as Concepts — markdown files with YAML frontmatter, addressed by their path within the bundle.
- Validate conformance as the format defines it: `type` is the only required key, unknown keys and unknown types are preserved rather than rejected, and a non-conforming Concept is reported with its file and reason rather than failing the whole bundle.
- Surface the trust and freshness signals OKF specifies: `status`, `stale_after`, and the trust tier derived from `generated` and `verified`.
- Walk `index.md` progressive disclosure, which is the format's own answer to reading a corpus without loading it whole — the same instinct as this project's.
- Give every Concept an identity that survives being moved within the bundle, since OKF's identifier is its path and a rename would otherwise silently create a different Concept.

**Not in scope:** chunking, embedding, indexing, retrieval, and Budgets — all `doc-store-recall`. Nothing here enters a Context Pack. Also not in scope: authoring or editing Concepts; this slice reads.

## Capabilities

### New Capabilities

- `doc-store`: The machine-wide corpus of curated knowledge held as an OKF bundle. Covers reading Concepts, conformance, trust and freshness, progressive disclosure, and rename-stable identity.

### Modified Capabilities

None. Nothing this slice adds reaches a Context Pack, so `context-assembly` is untouched.

## Impact

- **New dependency:** a YAML parser for frontmatter. Nothing else — OKF is markdown on a filesystem, and its reference implementation is a BigQuery-specific proof of concept not published to any registry.
- **New:** a bundle location, machine-wide rather than per-Codebase, configured like the Thread Store's connection.
- **External pin:** OKF is a draft at v0.2, five weeks old at the time of writing, with no releases. Field names are pinned to a known commit and the reader tolerates drift rather than trusting the spec to hold still.
- **Deliberate extension:** rename-stable identity is not in OKF. The format sanctions extra frontmatter keys — consumers "MUST NOT reject documents with unrecognized fields" — so identity is carried in one, keeping the bundle conformant and readable by any other OKF consumer.
- **Blocks:** `doc-store-recall`, and through it `pack-inspector`.
