# Context Manager

A context manager for coding agents. Four durable stores hold what the agent knows; an assembler rebuilds the agent's context window from them on every turn, so nothing accumulates that the next turn does not need.

## Language

### The window and what fills it

**Context Window**:
The messages sent to the model for a single turn. It is rebuilt each turn rather than grown.
_Avoid_: context, context memory, memory

**Context Pack**:
The bundle the assembler produces for one turn: the prompt plus everything retrieved from the stores to support it. The unit that fills a Context Window.
_Avoid_: payload, bundle, prompt context

**Assembler**:
The component that selects what enters a Context Pack, under a fixed budget per store.
_Avoid_: retriever, orchestrator, router

**Budget**:
The share of a Context Pack a single store may occupy. Set per store, independently.

**Floor**:
The part of a Context Window the Assembler cannot reach: system prompt, tool schemas, skills, and rules. Measured, budgeted around, and deliberately left intact.
_Avoid_: overhead, preamble, base context

**Journal**:
The harness's append-only on-disk record of a Conversation. The source of record the Thread Store derives from, and untouched by anything the Assembler does.
_Avoid_: transcript, log, session file

### The stores

**Store**:
A durable home for knowledge that outlives a Context Window. There are exactly four, each with one job and one substrate.
_Avoid_: memory, memory layer, backend

**Doc Store**:
Long-lived curated knowledge, held as an OKF bundle. Machine-wide: one corpus serving every Codebase.
_Avoid_: knowledge base, docs, long-term memory

**Spec Store**:
The OpenSpec directory inside a Codebase, recording intended behaviour. The only store this project does not own: it verifies the directory is initialized as expected and initializes it when it is not.
_Avoid_: specs, requirements store

**Thread Store**:
The record of what happened: every Turn's prompt, response, tool call, and artifact, in one Postgres database across all Conversations.
_Avoid_: history, conversation memory, episodic memory

**Graph Store**:
The programmatic structure of a Codebase — which code calls, imports, and inherits from which — produced by graphify and held inside that Codebase. Carries no documentation links.
_Avoid_: code graph, knowledge graph, index

### Units

**Codebase**:
A repository a coding agent is working in. The Spec Store and Graph Store live inside one; the Doc Store and Thread Store live outside every one.
_Avoid_: project, repo, workspace

**Conversation**:
One continuous line of work with the agent. The default retrieval scope of the Thread Store: reaching outside the current Conversation is an explicit query, never a default.
_Avoid_: session, thread, chat

**Turn**:
One prompt and the agent's complete response to it, including the tool calls made along the way. The unit the Thread Store records and the Assembler serves.
_Avoid_: message, exchange, interaction

**Concept**:
One unit of knowledge in the Doc Store: a single markdown file with frontmatter, per OKF. Its identifier is its path within the bundle.
_Avoid_: document, note, entry
