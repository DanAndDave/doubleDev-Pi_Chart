## Context

`CONTEXT.md` defines a Level as "the unit of progressive disclosure: read a Level, decide what to open". `DocStore.list()` implements exactly that, and is genuinely lazy: it reads the descriptions of the Concepts directly beneath a Level and nothing deeper, preferring a curated listing file when one exists.

Nothing in a session can reach it. The only production construction of a `DocStore` is `readBundle`, which calls `ensureIdentities()` and `concepts()`; no command and no tool exposes a listing, and `byIdentity` likewise has no caller outside tests. So the vocabulary promises an agent something it cannot do.

## Goals / Non-Goals

**Goals:**

- An agent that can see the shape of the corpus, not only the parts retrieval chose.
- A surface that costs nothing unless it is used.

**Non-Goals:**

- Changing Concept retrieval, its threshold, or the Doc Store Budget.
- Writing to the bundle. Walking reads.
- A second path by which Concepts enter a pack. They enter one way: `curated`.

## Decisions

### A tool, not a pack part

Retrieval puts Concepts in the window whether or not the agent wanted them; that is what a Budget is for. Walking is the opposite: it is the agent deciding it needs to see the map, and paying for it out of its own reasoning rather than out of assembly's allowance.

So this is a tool the agent calls, alongside `recall_across_conversations`, and the Context Pack is untouched by it. That also keeps assembly deterministic: a Turn's pack does not depend on what the agent chose to look at while answering.

### One tool with two questions, not two tools

`walk_documentation` takes an optional Level and an optional Concept. Listing and opening are the same activity — read a Level, decide what to open — and splitting them into two tools makes the agent choose between them before it knows what is there.

### An absent Level is not an empty one

A Level with nothing in it and a Level that does not exist look identical in a listing and mean opposite things. The first says "this part of the corpus is empty"; the second says "you guessed a name". The tool distinguishes them, for the same reason the Spec Store distinguishes an absent tree from an unreadable one.

### No bundle is an answer, not a failure

A machine with no curated knowledge is the ordinary case, and the Doc Store already treats it that way at indexing. Walking says so plainly rather than raising into the agent's tool result.

## Risks / Trade-offs

- **Another tool in the agent's list is another thing to ignore** → its description says what it is for, and it costs nothing when unused. The alternative — a Level in every pack — costs Budget on every Turn for a question most Turns do not ask.
- **The agent may walk instead of asking a question retrieval would answer better** → both exist, and the pack inspector shows what retrieval carried; if walking displaces recall in practice, that is measurable rather than guessed.

## Testing seams

| Requirement | Seam |
| --- | --- |
| Reading the top of a bundle | Tool boundary over a fixture bundle. |
| Walking into a level | Same seam, one level down. |
| Opening one concept | Same seam, by Concept id. |
| Walking does not load the corpus | `DocStore` boundary: count what was read. |
| A level that is not there | Tool boundary. |
| A bundle that is not there | Tool boundary with no bundle configured. |
| Walking costs no budget | `assemble()` and the extension seam: the pack is identical whether or not the tool was called. |

## Open Questions

None.
