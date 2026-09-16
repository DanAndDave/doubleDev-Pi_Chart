## 1. Fixtures and parsing

- [x] 1.1 Add fixture bundles under the test tree — a conforming bundle with nested levels, a Concept carrying only a type, a Concept with unknown keys and an unknown type, and one deliberately malformed Concept — and verify each file is present and readable
- [x] 1.2 Add a YAML frontmatter dependency and implement splitting a Concept file into frontmatter and body, and verify both are available separately for a fixture Concept
- [x] 1.3 Parse the frontmatter families the format defines — type, title, description, tags, status, freshness, provenance — reading every field defensively so a missing or reshaped field yields an absent value, and verify against the fixtures

## 2. Conformance

- [x] 2.1 Treat a Concept as conformant when its frontmatter parses and carries a non-empty type, and verify a Concept carrying only a type is accepted
- [x] 2.2 Report a Concept whose frontmatter cannot be parsed with its path and reason, and verify the rest of the bundle is still read
- [x] 2.3 Report a Concept with no type as non-conformant, and verify the reason names the missing field
- [x] 2.4 Preserve unknown frontmatter keys and unknown types, and verify both survive a read

## 3. Trust and freshness

- [x] 3.1 Report lifecycle status, defaulting to stable when absent, and verify against fixtures declaring each status and none
- [x] 3.2 Derive staleness from the freshness moment against an injected clock, and verify a passed moment is stale and a future one is not
- [x] 3.3 Derive the trust tier from verification entries and the human actor prefix, and verify unverified, machine-confirmed, and human-reviewed are distinguished

## 4. Reading the bundle

- [x] 4.1 Implement reading a bundle into Concepts addressed by bundle-relative path without the extension, excluding the format's reserved files, and verify against the nested fixture bundle
- [x] 4.2 Verify a missing or empty bundle yields no Concepts and no error
- [x] 4.3 Implement listing one level — its Concepts and sub-levels with their descriptions — reading the level's own listing file when present, and verify deeper Concepts are not read
- [x] 4.4 Synthesise a listing for a level that has none, and verify it matches what the level contains

## 5. Identity

- [x] 5.1 Assign and persist an identity to a Concept that has none, and verify it is written to the file
- [x] 5.2 Verify assigning identity leaves the Concept conformant and its other frontmatter unchanged
- [x] 5.3 Verify a Concept moved to a different path within the bundle is recognisable as the same Concept, with its path reported as changed

## 6. Verification

- [x] 6.1 Point the reader at a real OKF bundle from the specification's own repository and confirm it reads without diagnostics
- [x] 6.2 Run the full suite and the type checker, and confirm `openspec validate doc-store-bundle` passes
