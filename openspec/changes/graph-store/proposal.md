# Proposal: Graph Store from graphify

Triage: ready-for-agent
Blocked by: assembler-owns-window

## Why

The agent can now remember what was said (Thread Store) and what was decided (Doc Store), but it still learns a Codebase's shape by reading it — grep, open file, follow import, repeat. That is the most expensive thing it does, and the answer is already computable: a call graph is a parse away.

`doc-store-recall` retrieves prose by meaning. Structure is not prose. "What calls `assemble`?" has one correct answer, it does not degrade gracefully, and no embedding should be involved in producing it.

## What to build

The agent knows a Codebase's programmatic structure without reading files. The tool detects whether graphify is present in a Codebase, installs and configures it if not, runs a code-only extraction, and keeps the output current as the code changes. The pack carries a budgeted neighbourhood of the symbols in play.

Only programmatic edges count — calls, imports, inheritance. Documentation and semantically-inferred links are excluded. graphify's version is pinned and its output is read through an adapter, because the project ships rapidly and the schema is expected to move.

## Acceptance criteria

- [ ] Pointed at a Codebase without graphify, the tool installs and configures it and produces an extraction
- [ ] The extraction contains programmatic edges only; documentation and inferred similarity edges are absent
- [ ] The graph refreshes as the Codebase changes, without a full re-extraction each time
- [ ] A question about a symbol's callers is answered correctly with no file read and no grep in the Turn
- [ ] An unexpected graphify output schema is reported as a precise error, never silently mis-parsed

## Non-goals

Writing to the graph, querying it by natural language, graphify's semantic passes over docs and images, cross-repository graphs, and any use of its MCP server or agent hooks. The Doc Store already carries prose; this Store carries structure.
