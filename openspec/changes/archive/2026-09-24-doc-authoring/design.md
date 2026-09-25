## Context

The Doc Store reads. The only write anywhere in a bundle is `ensureIdentities` inserting one frontmatter line (`src/doc-store.ts:264-290`), and both archived proposals excluded authoring by name.

The parts exist: conformance is checked (`src/concept.ts:88-91`), identity is written atomically (`:275-285`), the index is hash-keyed and incremental (`src/postgres-store.ts:811-837`). Missing are a write surface, an index pass narrow enough for mid-Turn, and honesty in three places — a section labelled as a Concept (`src/assembler.ts:628-635`), an unreadable Concept served as empty (`src/doc-store.ts:140`, `src/extension.ts:525-533`), a Concept hidden by a listing that omits it (`src/doc-store.ts:239-254`). See `proposal.md` and the deltas.

## Goals / Non-Goals

**Goals:**

- A conclusion worth keeping recorded without leaving the Conversation.
- Authored knowledge that cannot outrank reviewed knowledge.
- Retrieval and walking agreeing before the next Call.
- A carried fragment that reads as a fragment.

**Non-Goals:**

- Deleting Concepts, cross-bundle authoring, a review workflow.
- Reorganising the bundle: authoring writes where it is told.
- Changing what retrieval ranks on.

## Decisions

### The write surface is a tool that writes whole Concepts

A command is the operator's surface, and a human typing one is already outside the Conversation — the cost this slice removes. A tool is reachable from inside a Turn and composes with `walk_documentation`: walk to where a Concept belongs, write it there. The Floor grows by one tool schema.

`write_documentation` takes an identifier, a type, a title, a summary, a body, optionally exclusions and sources, and whether this creates or revises. Rejected: a patch interface — a patch against curated prose needs the Concept read first, which walking already does, and a whole document is the only shape that makes atomicity trivially true. A revision merges, so a body edit cannot drop the author's sources. Creation refuses an identifier the bundle holds and revision refuses one it does not; one upsert would make "I thought this was new" indistinguishable from overwriting someone's work.

### The write is a temporary file renamed into place

Exactly as `ensureIdentities` writes (`src/doc-store.ts:283-285`), for the reason stated there: the bundle is the user's curated prose, usually under version control, and a crash must not leave half a Concept. Rejected: writing in place under a lock, a cross-session protocol buying nothing rename does not. Identity is assigned at creation rather than deferred to the next `ensureIdentities` pass, because the index is keyed by it and the Concept must be indexable in the Turn that wrote it.

### The single-Concept re-index is the existing incremental path, scoped

`indexConcepts` already embeds only sections whose hash moved (`src/postgres-store.ts:834-837`). What it is not is scopable: `pruneConcepts` deletes every indexed identity absent from the map passed to it (`:888-894`), so handing it one Concept empties the corpus. The scoped entry point prunes within the given identity only, and is otherwise the same code. Rejected: re-passing the whole bundle per write — it embeds nothing extra but re-parses every file, growing with the corpus rather than the edit. Session start stays the full reconciler.

### `verified:` is refused, not discouraged

Trust is derived from verifiers (`src/concept.ts:145-158`) and retrieval orders on it (`src/postgres-store.ts:955`). Rejected: allowing the key and telling the model not to use it. A convention held only in a tool description lapses the moment that description falls out of the window, and the failure is silent and permanent — a self-awarded human tier ranks a draft above a reviewed Concept forever. The refusal is explicit rather than a silent strip: an agent told nothing believes it recorded a review.

The same hole sits one step along — revise a reviewed Concept and its review vouches for text no human read. So a verification older than the Concept's most recent machine-recorded change stops counting toward the tier. Derived, not destructive: the dated signature stays for whoever re-reviews. Rejected: deleting the review, and refusing the revision, which puts a human in front of every correction.

### Attribution names the part and points at the rest

The curated header becomes the Concept, the part carried and how many parts exist — `[curated knowledge: metrics/gross-margin — section 2 of 4]` — plus the note that the whole Concept is readable through `walk_documentation` at no Budget. That pointer turns a fragment from a false answer into a lead. Section index is already stored (`src/postgres-store.ts:811-824`) and the count is a window count over those rows, so attribution needs nothing the section table does not already hold.

### What a Concept excludes rides the index; what it was drawn from does not

A Pack carries the exclusions, so they have to be reachable on the Call the model waits on. Two ways: a nullable `exclusions` column written with the section, or opening the Concept's file for every hit during assembly. The column wins — the row already carries `text`, `trust` and `stale` for exactly this reason, and reading files under a retrieval deadline makes assembly depend on the filesystem's mood. It is derived and rebuildable on ADR-0002's terms, and an older row reads back without it.

`sources:` stay out of the index. They qualify provenance rather than meaning, and a Pack that carried every citation would spend a Budget the exclusions need; an agent reading the Concept whole through `walk_documentation` gets them.

### An authored Concept's lifecycle and provenance are the machine's, not the author's

A revision preserves what it does not name — except `status` and `generated`, which record that a machine changed the text. Leaving `status: stable` on prose an agent rewrote would keep a human's lifecycle claim over text no human read, which is the same hole the `verified:` rule closes one step along. A deprecated Concept stays deprecated: a revision corrects what a superseded Concept says, it does not put it back in service.

### A Concept's summary joins the matched text, if measurement allows

Default: the description prepended to every section's embedded text beside the title, because the first section alone leaves the rest of a Concept unfindable by the author's paraphrase. The risk is measurable — one description repeated across sections drags them toward a common vector, flattening the section-level discrimination `doc-store-recall` measured. Task 1 measures it against the recorded table — genuine 0.244-0.419, unrelated 0.610-0.653 — with a sibling of `scripts/measure-doc-threshold.ts` that carries the three placements, real summaries, the vendored bundle and section-shaped probes, checked in as `scripts/measure-summary-placement.ts` so the figures can be re-derived. If the genuine range rises or the gap narrows, the description goes to the first section only. Every hash moves, so session start re-embeds the corpus once.

### A curated listing is reconciled by appending, never by interleaving

The listing wins because its order and wording are the author's judgement about what matters first — already this Store's rule (`openspec/specs/doc-store/spec.md:86`). Interleaving unlisted Concepts alphabetically would put a fresh draft above the Level's headline Concept, destroying that judgement. So: curated entries first in the author's order, then the Concepts the listing omits, alphabetically, marked as absent from it. Rejected: synthesising the whole listing when it is incomplete, which discards an ordering to fix an omission. Authoring appends its entry, so reconciliation shrinks over time.

### Unreadable is reported by the surface that already knows

`open` already returns the problem (`src/doc-store.ts:140`); the walk tool ignores it and renders the empty body (`src/extension.ts:525-533`). A rendering fix plus a broken-entry marker in a Level; the reader is unchanged.

## Risks / Trade-offs

- **The agent fills the bundle with noise** → drafts enter unverified, ranked below reviewed Concepts, each naming the machine that wrote it. Pruning stays a human job.
- **One embed per write on a shared embedder** → on the tool call's own Call, not the Call the model waits on; a concurrent query queues behind one batch, as `doc-store-recall` already accepted.
- **Reconciled listings change how existing bundles walk** → additively, curated ordering first.
- **Authoring dirties a version-controlled bundle** → already true of `ensureIdentities`, now larger and deliberate. Document it as the Graph Store is documented.
- **A scoped re-index can drift** → session start reconciles, hash-keyed, so it costs nothing when nothing drifted.
- **Carried Concepts grow by their exclusions and sources** → `token-budgets` is the stated blocker; the curated part's token Budget clamps them.

## Testing seams

| Requirement | Seam |
| --- | --- |
| A Concept can be authored from inside a Conversation | `DocStore` boundary, fixture bundle in a temp directory. |
| Authored knowledge carries machine provenance and cannot claim human review | `DocStore` for the write and the refusal; `parseConcept` for a review older than the change. |
| A Concept authored during a Conversation is retrievable within it | Store boundary (`PICHART_DATABASE_URL`), stub embedder: write, re-index, retrieve, assert what was embedded. |
| A Concept's exclusions and sources travel with it | `DocStore` boundary for what open serves; `assemble()` for what reaches a Pack. |
| A Concept is findable by what it says it is about | Model suite (`PICHART_EMBED=1`) over the measurement corpus — only the real model makes the claim true. |
| A Concept that cannot be read is reported as unreadable | Extension tool boundary, temp bundle holding an unreadable and a non-conformant file. |
| A Concept the listing omits is still reachable | `DocStore` boundary, fixture bundle whose listing names a subset. |
| Packs carry curated knowledge under its own budget (modified) | `assemble()` boundary, synthetic multi-part hit. |

The `DocStore` boundary over a fixture bundle in a temp directory is the target seam: the highest one that sees authoring, conformance, unreadable Concepts and listings, needing no container and no model. Only the retrievability rows need the store-backed suite and only the paraphrase row the model suite; the default suite stays container-free, model-free and network-free.

## Open Questions

None. Two settle on evidence:

- Whether the description joins every section or only the first: task 1's measurement, against the rule above.
- Whether promoting a draft from inside a session is worth a surface. Deferred until drafts exist.
