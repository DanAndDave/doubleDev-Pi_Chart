## Context

OKF is a format and nothing else. Its own non-goals rule out storage, serving, query, and validation tooling; its reference implementation is a BigQuery-and-Gemini proof of concept that is not published to PyPI. Concretely it gives us: markdown files with YAML frontmatter, one Concept per file, Concept ID = bundle-relative path minus `.md`, `type` as the only required key, conformance rules that forbid rejecting unknown keys or types, `status`/`stale_after` for lifecycle and freshness, `generated`/`verified` for provenance, and `index.md` for progressive disclosure. The spec is v0.2, five weeks old, with zero releases.

Everything else in this slice is ours to build, and the two interesting decisions are where we must go *beyond* the format without leaving it.

See `proposal.md` for motivation, `specs/doc-store/spec.md` for the contract, and `docs/research/open-knowledge-format.md` for the primary-source detail behind every claim above.

## Goals / Non-Goals

**Goals:**

- Read a bundle without trusting it: one bad file names itself and costs nothing else.
- Stay a well-behaved OKF consumer, so the bundle remains readable by any other tool that speaks the format.
- Leave a seam `doc-store-recall` can index through without reshaping anything here.

**Non-Goals:**

- Chunking, embedding, ranking, Budgets. Nothing here reaches a Context Pack.
- Authoring or editing Concepts, beyond the one frontmatter key identity requires.
- Implementing the format's Attested Computation half, which is about sanctioned SQL and has nothing to do with agent context.

## Decisions

### Identity is an extension key, not a sidecar index

OKF's identifier is the file path, so `git mv` silently destroys a Concept and creates a new one — fatal once `doc-store-recall` keys embeddings by identity. We add one frontmatter key holding a generated identifier, assigned on first read and written back.

The format explicitly sanctions this: producers "MAY include any additional keys" and consumers "MUST NOT reject documents with unrecognized fields". So the bundle stays conformant and any other OKF tool still reads it.

Alternative considered: a sidecar index mapping paths to identifiers. Rejected because it is a second source of truth that desynchronises the moment someone moves a file outside our tooling — which, for a corpus edited by hand and by agents, is the normal case rather than the exception.

Consequence: reading a bundle can write to it. That is confined to assigning a missing identity, and it is why the spec requires the rest of the frontmatter to be left alone.

### Validation reports, never throws

A malformed Concept yields a diagnostic naming the file and the reason, and the read continues. A corpus that fails whole because someone fat-fingered one YAML block is a corpus people stop trusting. This matches the format's own conformance posture, which forbids rejecting a bundle for unknown types, unknown keys, broken links, or a missing listing.

### Trust tiers are derived at read time, never stored

`unverified`, `machine-confirmed`, and `human-reviewed` are computed from `verified` entries and the `human:` actor prefix, exactly as the spec derives them, and never written into the file. Storing a tier would mean a stale opinion in a document whose whole point is provenance, and the spec is explicit that it records signals rather than verdicts.

### Progressive disclosure is synthesised when absent

`index.md` is optional in the format, and the spec permits a consumer to synthesise one. We always present a listing, reading the level's own `index.md` when there is one and deriving it from the directory otherwise, so a caller never has to care which. This is the one piece of OKF that is already the same idea as this project — read a level, decide what to open — and it is what `doc-store-recall` will use to avoid embedding the whole corpus blindly.

### Field names are pinned, and drift degrades rather than breaks

Every OKF field name is read defensively: a missing or reshaped field yields an absent value, not a crash. Against a v0.2 draft with no releases, a reader that assumes the spec holds still is a reader that breaks on someone else's commit.

## Risks / Trade-offs

- **Reading mutates the bundle when it assigns identity** → confined to one key, never touching existing fields, and covered by a scenario asserting the rest of the frontmatter is unchanged. A read-only mode is not offered because a Concept without identity is not yet usable by the next slice.
- **An identity key is a private extension another OKF tool will not understand** → it is namespaced and ignorable, which is precisely what the format's extension rules promise.
- **OKF may change under us** → field names pinned to a read commit, defensive reads, and the format is markdown on a filesystem, so the worst case is re-reading a spec rather than migrating data.
- **The bundle is machine-wide, so it is outside any repo's backup** → out of scope here, but worth noting: it is the one Store with no Codebase to live in, which is exactly why it was made global.

## Testing seams

One seam per requirement, preferring the highest seam that can actually fail on the behaviour.

| Requirement | Seam |
| --- | --- |
| Concepts are read from the bundle | Bundle-reader boundary, against fixture bundles on disk. |
| Conformance is checked without rejecting the bundle | Bundle-reader boundary, with a fixture bundle containing one deliberately malformed Concept. |
| Unrecognized content is preserved | Concept-parser boundary. |
| Trust and freshness are surfaced | Concept-parser boundary, with an injected clock so staleness is not tested against wall time. |
| The bundle can be walked a level at a time | Bundle-reader boundary, asserting which files were opened for a listing. |
| Concept identity survives a move | Bundle-reader boundary against a temporary bundle: read, move a file, read again. |
| A missing or empty bundle is not a failure | Bundle-reader boundary, pointed at a path that does not exist. |

Fixture bundles are committed under the test tree rather than generated, so the shapes under test are readable in review. Tests that assign identity copy their fixture to a temporary directory first, because that path writes.

## Open Questions

- Whether the identity key should be namespaced under a single object holding future extensions, or kept flat. Deferred: it changes one key name and a line of the parser, not the specs or the task breakdown.
