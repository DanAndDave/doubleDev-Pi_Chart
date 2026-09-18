# Proposal: Authoring Curated Knowledge

Triage: ready-for-agent

## Why

The Doc Store is the one Store meant to outlive every Codebase, and it is the only one the agent cannot contribute to. The single write anywhere in a bundle is `ensureIdentities` inserting one `cm_identity` line (`src/doc-store.ts:264-290`); `src/install.ts:153-154` creates an empty `decisions/` directory that nothing ever fills. No tool authors — `src/extension.ts:421-463` registers exactly `recall_across_conversations` and `walk_documentation` — no command does (`:500-535` registers three), and no `doc-store` requirement covers writing. Both archived Doc Store proposals excluded it by name: "authoring or editing Concepts; this slice reads" (`openspec/changes/archive/2026-09-16-doc-store-bundle/proposal.md:20`).

So a conclusion worth keeping costs a detour out of the Conversation: hand-write conformant YAML, where a file without `type:` is silently non-conformant and never indexed (`src/concept.ts:88-91`), then restart, because indexing runs only at `session_start` (`src/extension.ts:228-252`). A Concept edited mid-Conversation is served stale by retrieval while `walk_documentation` reads the new text off disk (`src/doc-store.ts:130-143`).

What does reach a Context Pack is mislabelled. `searchConcepts` returns the best section per identity via `DISTINCT ON` (`src/postgres-store.ts:828-834`) and the Assembler heads it `[curated knowledge: <id>]` with no section marker (`src/assembler.ts:556-563`), so a fragment reads as the whole Concept. The OKF fields that exist to prevent that — `not:`, `sources:`, `description` — sit in `frontmatter` (`src/concept.ts:86`) read by nothing, while `splitConcept` embeds title plus body piece alone (`src/sections.ts:50-57`). The vendored bundle uses all three (`test/fixtures/okf-acme-retail/metrics/gross-margin.md:12-26`).

## What Changes

- A `write_documentation` tool creates or revises one Concept: conformant frontmatter, `status: draft`, a `generated:` provenance block, temporary-file-then-rename as `ensureIdentities` already writes (`src/doc-store.ts:283-285`), and a re-index of that one Concept so retrieval and walking agree before the next Call.
- **The agent never writes `verified:`.** Trust is derived from verifiers (`src/concept.ts:145-158`) and retrieval ranks on it (`src/postgres-store.ts:849`). An agent that could self-award `human:` would promote its own draft above a reviewed Concept, so the tier the Doc Store ranks on stays human-granted. Authoring earns `unverified`.
- A verification older than a Concept's most recent machine-recorded change stops counting toward its trust tier. Without this the `verified:` refusal is bypassable: revising a human-reviewed Concept leaves an old review vouching for text no human read, which promotes the agent's edit to the top retrieval tier by the back door. The dated signature stays in the file, so nothing is destroyed.
- Attribution names the section and says more exists, and carries the Concept's `description`, `not:` entries and `sources:` with it.
- A Concept becomes findable by its author's own summary, by joining `description` to the text each section is indexed under — the default, subject to the measurement in `design.md` that would overturn it for first-section-only.
- An unreadable Concept is reported as unreadable, not served as an empty Concept: `open` returns `nonConformant(id, "", problem)` (`src/doc-store.ts:140`) and `walkBundle` never inspects `problem`/`conformant` (`src/extension.ts:485-493`).
- A curated `index.md` is reconciled against the Level's files, so a Concept omitted from a listing is still walkable rather than invisible (`src/doc-store.ts:232-255`), and authoring maintains the listing it writes into.

**Not in scope:** the docs token ceiling and oversized-section clamping (`token-budgets`); the deterministic candidate-set tiebreak in `searchConcepts` (`store-hygiene`); query-side embedding changes for Turns (`recall-fidelity`). Deleting Concepts, cross-bundle authoring, and review workflow stay out.

## Capabilities

### Modified Capabilities

- `doc-store`: gains authoring with machine-granted trust only, index freshness within a Conversation, and honest reporting of unreadable and unlisted Concepts.
- `context-assembly`: "attributed to the Doc Store and identified" is already a requirement of packs carrying curated knowledge; a section is not the Concept it names, so the contract tightens to identifying the part carried and what it belongs to.

## Impact

- **Schema:** none new. Section rows already carry `hash` (`src/postgres-store.ts:705-718`), so a single-Concept re-index is the existing incremental path scoped to one identity.
- **Configuration:** none. The bundle path is already configured.
- **Assembly:** curated messages grow by the disambiguation and provenance they now carry, which `token-budgets` already clamps — it shipped, so a Concept with a long `not:` block is elided visibly rather than enlarging an unbounded part.
- **Performance:** one embed per written Concept, on the tool call, not the Call the model waits on.
- **Migration:** existing bundles are untouched; Concepts already carrying `verified:` keep their tier.
- **Completes:** the Doc Store as a Store the agent uses rather than only reads.
