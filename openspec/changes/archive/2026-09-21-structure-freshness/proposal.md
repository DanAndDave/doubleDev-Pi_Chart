# Proposal: Structure that keeps up with the Codebase

Triage: ready-for-agent

## Why

`refresh()` runs only at `session_start` (`src/extension.ts:229-235`), and `graph()` keys its cache on `graph.json`'s own mtime, never against a source file (`src/graph-store.ts:159-181`). Once the agent edits code, every later Context Pack carries pre-Conversation `file:line` coordinates: line numbers drift with the first insertion, new symbols are absent, deleted ones presented as live callers. A Concept declares itself `(stale)` (`src/assembler.ts:629`); structure declares nothing. "The graph keeps up with the Codebase" (`openspec/specs/graph-store/spec.md:51-63`) holds once per Conversation and not after.

Candidates are as narrow as the graph is old. `structureFor` passes `current.prompt` (`src/extension.ts:810`) and `reconstructTurns` fills `prompt` only from a `user` message (`src/turns.ts:18-22`), so on a tool-loop Call — most Calls of an agentic Turn — structure derives from a sentence written ten steps ago: "Fix this" after ten reads yields nothing, while the harness knows which files are in play. A path matches nothing either: `src/assembler.ts` tokenises to `src`, `assembler`, `ts`; `ts` is dropped for length and `assembler` never canonicalises to `assemble` (`src/symbols.ts:33-40,61-65`), though `GraphSymbol.file` is carried (`src/graph.ts:15`).

Decline the Thread Store and the Graph Store is never constructed: `graph` is registered only on the Postgres branch (`src/extension.ts:961-980`), though neither it nor `symbolsInPlay` needs Postgres (`:822-841`). `CM_DATABASE_URL=""` is the documented way to decline a Store (`src/install.ts:78-79`), and `/context-manager` still prints `codebase graph  extraction on` for one that does not exist (`:113-118`).

## What Changes

- Refresh at `agent_end` as well as `session_start`; graphify's extraction is content-hash incremental, so an unchanged tree is nearly free.
- Compare the extraction's age against the Codebase, not against itself: a neighbourhood whose graph predates the newest source file enters the Pack stamped stale, as a Concept already is.
- Draw candidates from the whole current Turn — prompt, assistant text, tool names, arguments and results — not the user's sentence alone.
- Match a path: a file in play resolves through `GraphSymbol.file`, and a token like `assembler` reaches `assemble`.
- Order a truncated neighbourhood by relation, not extraction order: callers and importers before `contains` and `method` members (`src/symbols.ts:159-190`, `src/graph.ts:44-58`), so a hub class cannot spend twelve slots restating its own members. The cap's size is measurement-backed and unchanged.
- Build the name and incident-edge indexes once per graph, beside the cached parse (`src/symbols.ts:42-47,127-136`): both are rebuilt per Call on the request path today, while the parse is cached for its measured ~370ms on a 50k-node graph.
- Register the Graph Store from one shared `Dependencies` literal, only Thread-Store-backed members conditional, and have the install check report it unavailable when it was never constructed.

**Not in scope:** the token ceiling and clamping of the structure part (`token-budgets`), and recollection fidelity (`recall-fidelity`). The Spec Store contributing nothing to a Pack is deliberately untouched: its specified role stops at verifying and diagnosing a tree (`openspec/specs/spec-store/spec.md:59-65`), a boundary rather than a defect, and carrying the active change in a Pack is a separate future ticket.

## Capabilities

### Modified Capabilities

- `graph-store`: freshness becomes continuous and disclosed; a symbol in play widens from the prompt to the Turn and admits file paths; a truncated neighbourhood is ordered by relation; the Store works without a Thread Store.
- `context-assembly`: the structure requirement is written around a prompt naming a symbol and says nothing about age (`openspec/specs/context-assembly/spec.md:189-196`). Both are observable in the Pack, so this is a spec-level contract, not implementation: the trigger becomes the Turn, and structure older than the Codebase is carried with its staleness declared.

## Impact

- **Schema and configuration:** none; `CM_GRAPH` still gates extraction.
- **Assembly and performance:** one freshness `stat` per Call and candidates drawn from a Turn's messages; in exchange, index construction over every symbol and edge leaves the request path and refresh moves to `agent_end`.
- **Sequencing:** no blockers — Graph Store and wiring only, so it runs in parallel with `token-budgets` and its dependants.
- **Completes:** the audit's two partial rows for structure — context-assembly's "Structure around symbols in play" and graph-store's "Structure available without being asked for" — which fail on the same wiring.
