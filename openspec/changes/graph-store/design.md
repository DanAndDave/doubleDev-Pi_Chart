## Context

Three Stores are in place and all three retrieve by meaning. This one must not: "what calls `assemble`?" has one correct answer, and an embedding would turn a fact into a guess.

graphify (`graphifyy` on PyPI, CLI `graphify`) parses ~40 languages with tree-sitter and writes `graphify-out/graph.json` in NetworkX node-link form. Measured on this repo's `src/` — 18 files — before designing anything:

| | |
| --- | --- |
| Cold extraction, `--code-only` | 0.64s, 244 nodes, 592 edges |
| Re-extraction, nothing changed | 0.45s, "18 cached/unchanged, 0 re-extracted" |
| Refresh after editing one file | 0.67s |
| `graph.json` | 273 KB, about 15 KB per file |
| One symbol's neighbourhood | 4 edges, ~63 tokens |

Two findings from that measurement shaped the design, and both contradict what the tool's flags suggest.

**`--code-only` is not programmatic-only.** The run above produced 18 `INFERRED` edges (3% of the total, `calls` and `indirect_call` at confidence 0.8) and 10 non-code nodes (`ADR-0002` as a `concept`, `ref_bun`, `ref_yaml`). The flag means "skip the LLM passes over docs and images", not "emit nothing it had to guess". The filter belongs in our adapter, keyed on each edge's own `confidence` field, not on a flag.

**A machine-wide install is not available.** No `uv`, `uvx`, `pipx`, or `pip` on this machine; `python3 -m venv` works and installs `graphifyy` in about 8 seconds.

## Goals / Non-Goals

**Goals:**

- A structural question answered from the graph, with no file read in the Turn.
- Nothing carried that a parser did not establish.
- Keeping the graph current costing about what the edit cost.

**Non-Goals:**

- Natural-language graph queries, graphify's MCP server, its agent hooks, or its semantic passes.
- Writing to the graph, or cross-repository graphs.
- Competing with the Doc Store: prose is its job, structure is this one's.

## Decisions

### A private interpreter, not a machine-wide install

graphify is installed into a virtual environment the context manager owns, at a version it pins. `python3 -m venv` is the one Python packaging tool that is always present, and a private environment cannot collide with whatever else the machine has.

Pinned because the research says the project ships rapidly and the schema is expected to move. An unpinned dependency whose output we parse is a break waiting for an unrelated day.

### The graph lives in the Codebase, where graphify puts it

`graphify extract <path>` writes `<path>/graphify-out/`, with no option to redirect it. That is also the tool's intent: the directory is meant to be committed so a team shares one map.

So the Graph Store does not fight it. The cost is honest and must be stated: pointing the context manager at a Codebase creates a directory in it. `CM_GRAPH=off` is the way to decline, and the README says so plainly rather than burying it.

### Trust is a field, not a flag

Every edge is carried only if its own `confidence` says `EXTRACTED`, its relation is one the adapter knows to be programmatic, and both endpoints are code nodes. Three conditions rather than one, because the measurement showed each excludes something the others do not: confidence catches the 0.8 guesses, the relation list catches `cites`, and the node kind catches `ADR-0002`.

An unknown relation is left out rather than assumed harmless. A schema that moves should cost recall, never correctness.

### Symbols are found by name, deterministically

Identifiers in the prompt are matched against node labels after both are reduced to letters and digits — so `recordPack`, `record_pack`, and `.recordPack()` are one name. An identifier that matches nothing is split on case boundaries and its parts are tried, but only then: measured against real prompts, matching whole identifiers first keeps `recordPack` from dragging in every `Pack`.

| prompt | symbols found |
| --- | --- |
| "who calls assemble and what does it call?" | `assemble()` |
| "what happens when recordPack is called?" | the three `.recordPack()` definitions |
| "where is embedPending used?" | `.embedPending()` |
| "what is the capital of Peru" | none |

Running it against a live agent changed the rule once more. Asked "which functions call parseConcept ... do not read, grep, or list any files", the pack carried `parseConcept()`, `.read()` and `.list()` — 457 tokens, two thirds of it spent on English words that happen to name methods. So only the strongest evidence in a prompt counts: an unmistakable name (`parseConcept`, `record_pack`, `.read`, `read()`) outranks a capitalised one (`Pack`), which outranks a plain word (`read`), and weaker tiers are dropped rather than merely ordered behind. The same question then carried one symbol and 220 tokens, with the same answer.

No embedding is involved. A name is exact, and the Thread Store already owns the case where the agent does not know what something is called.

### Refreshing happens on session start, in the background

`graphify update <path>` re-extracts only changed files, so the refresh costs the edit rather than the corpus — 0.67s against 0.64s cold on a small tree, and the gap widens with size. It runs where indexing already runs: at session start, behind the schema, off the request path.

### One vector-free neighbourhood per symbol

A carried symbol brings its direct connections, both directions, each naming the file and line of the other end. One hop, because two hops on a hub symbol is the whole Codebase, and 63 tokens for a hop means the Budget can be generous in symbols rather than stingy in depth.

## Risks / Trade-offs

- **A directory appears in the user's repository** → graphify's own convention, and the only way to use it; `CM_GRAPH=off` declines, and the README leads with it rather than hiding it.
- **Installing a Python package on first use is slow and surprising** → measured at 8 seconds, once per machine, in the background, reported when it happens, and skipped entirely when graphify is already present.
- **A pinned version goes stale** → the adapter states what it requires and fails loudly when it is not met, which is the signal to move the pin.
- **Name matching finds the wrong `handle`** → a Budget in symbols bounds the damage, and the pack inspector names what was carried, so a bad match is visible rather than mysterious.
- **The graph is only as good as tree-sitter's resolution** → the measured graph missed some callers through re-exports. Structure is offered as a starting point, not as proof of absence, and the spec never claims completeness.

## Testing seams

| Requirement | Seam |
| --- | --- |
| A Codebase's structure is available without being asked for | Extractor boundary with a stub graphify on PATH; one gated test against the real tool. |
| Only programmatic connections are carried | Adapter boundary, over a fixture graph holding inferred edges, concept nodes, and unknown relations. |
| The graph keeps up with the Codebase | Extractor boundary: assert the refresh command, not a full extraction; gated real-tool test for the incremental claim. |
| An unexpected extraction is reported, never guessed at | Adapter boundary with malformed fixtures. |
| The symbols in play are found by name | Pure selection boundary, over the fixture graph. |
| Packs carry the structure around the symbols in play | `assemble()` boundary. |
| The structure budget is independent of the others | `assemble()` boundary: exhaust one Budget, assert the others intact. |
| The pack is accounted for by part | Inspection API boundary. |

## Open Questions

None. The install path, the filter, and the matching rule were measured before this was written.
