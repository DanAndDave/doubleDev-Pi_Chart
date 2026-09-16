# External per-turn context control in coding agents

## Claude Code surfaces

### Hook events (all documented at [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks))

Cadences: **per session** `SessionStart`, `SessionEnd`; **per turn** `UserPromptSubmit`, `Stop`, `StopFailure`; **per tool call** `PreToolUse`, `PostToolUse`. Full event list includes `Setup`, `UserPromptExpansion`, `PermissionRequest`, `PermissionDenied`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `MessageDisplay`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `TeammateIdle`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`, `PreCompact`, `PostCompact`, `PreModelSwitch`, `PostModelSwitch`, `Elicitation`, `ElicitationResult`.

Handler types: `command`, `http`, `mcp_tool`, `prompt`, `agent`. Configured in `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed policy settings, plugin `hooks/hooks.json`, skill frontmatter, subagent frontmatter. Hooks merge across levels rather than overriding.

### What a hook may inject

| Field | Effect |
|---|---|
| `hookSpecificOutput.additionalContext` | "passes a string from your hook into Claude's context window. Claude Code wraps the string in a **system reminder** and inserts it into the conversation at the point where the hook fired." Capped at **10,000 characters**; over that it is spilled to a file in the session directory and Claude gets a path + preview. Multiple hooks on the same event all deliver. |
| Plain-text stdout on exit 0 | Added as context **only** on `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `PostModelSwitch`. Every other event writes stdout to the debug log only. |
| `SessionStart.initialUserMessage` | "String used as the first user message of the session… Unlike `additionalContext`, which attaches to an existing turn, this **creates** the turn." Applies in `-p` non-interactive mode. |
| `SessionStart.watchPaths` / `sessionTitle` / `reloadSkills` | Register `FileChanged` watches, rename session, re-scan skill dirs. |
| `systemMessage` | User-visible warning only; also arrives as `SDKInformationalMessage` in `--output-format stream-json`. |

Injection points by event: `SessionStart`/`SubagentStart` → start of conversation before first prompt; `UserPromptSubmit`/`UserPromptExpansion` → alongside the submitted prompt; `PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`PostToolBatch` → next to the tool result; `Stop`/`SubagentStop` → end of turn, conversation continues so Claude acts on it.

### What a hook may block or rewrite

| Event | Control |
|---|---|
| `UserPromptSubmit` | `decision: "block"` + `reason` rejects and **erases** the prompt (exit 2 equivalent). `suppressOriginalPrompt: true` hides it from the block message. |
| `PreToolUse` | `permissionDecision` = allow/deny/ask/defer, plus **`updatedInput`** — replaces tool arguments before execution. |
| `PostToolUse` | **`updatedToolOutput`** replaces the tool's result; `decision: "block"` returns feedback to the model. |
| `PermissionRequest` | `decision` object incl. `updatedInput`. |
| `Stop` / `SubagentStop` | `decision: "block"` prevents stopping and continues the conversation — the documented way to drive extra turns externally. |
| `PreCompact` | Exit 2 **blocks compaction**. No summary rewriting field. |
| `MessageDisplay` | `displayContent` replaces on-screen text. **"Display-only: the transcript and what Claude sees keep the original."** |
| `PostCompact`, `SessionEnd`, `InstructionsLoaded`, `Setup`, `Notification`, `StopFailure`, `CwdChanged`, `DirectoryAdded`, `FileChanged` | "No decision control. Used for side effects like logging or cleanup." |

### Can a hook REPLACE or CLEAR the accumulated transcript?

**No.** Direct quote from the decision-control section: *"`UserPromptSubmit`: can't replace the prompt; it only injects `additionalContext` alongside it."* The complete set of rewrite fields is `updatedInput` (PreToolUse, PermissionRequest), `updatedToolOutput` (PostToolUse), `displayContent` (MessageDisplay, display-only). There is **no** event and **no** field that removes, truncates, reorders, or substitutes prior conversation messages. `PreCompact` can only veto compaction; it cannot supply the replacement summary. `SessionStart` with matcher `clear`/`compact` fires *after* the user or the auto-compactor already did the clearing — it can only re-add context, not initiate the clear.

Timeouts matter for a per-turn assembler: `UserPromptSubmit` default timeout is **30 s** (vs 600 s elsewhere), and *"a `UserPromptSubmit` command, HTTP, or MCP tool hook that reaches its timeout is canceled and its output, including any `additionalContext`, is discarded. The prompt still reaches Claude without that context."* — i.e. the injection **fails open**.

Replay caveat: *"Claude Code saves the injected text in the session transcript. For mid-session events like `PostToolUse` or `UserPromptSubmit`, when you resume with `--continue` or `--resume`, Claude Code **replays the saved text rather than re-running the hook** for past turns"* — stale injections persist across resume.

MCP-tool hooks on `SessionStart` are skipped at launch ("no MCP client context") and only run when `SessionStart` fires again after `/clear` or compaction.

### `/clear` and `/compact` semantics

- `/clear [name]` (aliases `/reset`, `/new`): "Start a new conversation with empty context. Pass a name to label the previous conversation in the `/resume` picker." Session cost counters reset. Fires `SessionEnd` with reason `clear` and `SessionStart` with source `clear`. Recoverable via `/resume` or the rewind menu's previous-session entry. ([commands](https://code.claude.com/docs/en/commands))
- `/compact [instructions]`: summarizes conversation history in place; optional focus instructions; a `# Compact instructions` section in CLAUDE.md persists them. `/autocompact <tokens>` sets the auto-compact window.
- **What survives compaction** ([context-window](https://code.claude.com/docs/en/context-window)): system prompt + output style still apply; project-root CLAUDE.md, unscoped rules, auto memory, and the plan-mode plan are **re-injected from disk**; path-scoped rules and nested CLAUDE.md reload when a matching file is next read; Claude Code **re-reads up to five** files (most recently modified first; >5,000 tokens comes back as a path reference); invoked skill bodies re-injected capped at 5,000 tokens/skill and 25,000 total; **"Context that hooks added earlier — summarized with the rest of the conversation"**; `SessionStart` hooks matching source `compact` run and their output is added. Skill *descriptions* are the one startup block **not** re-injected.
- Other manual levers: `/rewind` → "Summarize from here"/"Summarize up to here"; `/btw` asks a side question "without adding to the conversation"; `/context` shows the live breakdown.

### CLAUDE.md auto-loading ([memory](https://code.claude.com/docs/en/memory))

Load order, broadest → most specific: managed policy (`/etc/claude-code/CLAUDE.md` on Linux; `/Library/Application Support/ClaudeCode/CLAUDE.md` on macOS; `C:\Program Files\ClaudeCode\CLAUDE.md`), user `~/.claude/CLAUDE.md`, project `./CLAUDE.md` or `./.claude/CLAUDE.md`, local `./CLAUDE.local.md`. All files from cwd upward load at launch and are **concatenated, not overridden**; subdirectory CLAUDE.md files load on demand when Claude reads files there. `@path/to/file` imports expand at launch, max depth 4, skipped inside code spans/fences. `.claude/rules/*.md` (recursive) load unconditionally unless they carry `paths:` frontmatter globs, in which case they load only when a matching file enters context. `~/.claude/rules/` is user-scope. Controls: `claudeMdExcludes`, `--setting-sources`, `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`, managed-settings `claudeMd` key. Claude Code reads `CLAUDE.md`, **not** `AGENTS.md` — bridge with `@AGENTS.md` or a symlink. **Auto memory** is Claude's own notes at `~/.claude/projects/<project>/memory/MEMORY.md`, loaded every session (first 200 lines or 25 KB).

Explicitly: *"Claude treats them as context, not enforced configuration. To block an action regardless of what Claude decides, use a `PreToolUse` hook instead."*

### MCP in Claude Code ([mcp](https://code.claude.com/docs/en/mcp))

Transports: `http` (`streamable-http` alias), `sse` (deprecated), `stdio`, `ws`. Scopes: local, project (`.mcp.json`, committed, requires approval + workspace trust), user (`~/.claude.json`). WebSocket is recommended specifically for *"remote MCP servers that push events to Claude unprompted"*. **Tool-definition deferral is the default**: only tool names and server instructions enter context until Claude uses a tool (`ENABLE_TOOL_SEARCH=auto|false` to change). Claude Code answers MCP `roots/list` with the launch directory plus every `--add-dir`/`/add-dir`/`additionalDirectories` directory and emits `notifications/roots/list_changed` on change. MCP prompts surface as slash commands. `CLAUDE_PROJECT_DIR` is set in the spawned stdio server's environment. MCP servers can act as **channels** that push messages into a session.

### Output styles ([output-styles](https://code.claude.com/docs/en/output-styles))

Markdown files in `~/.claude/output-styles/`, `.claude/output-styles/`, or the managed dir; frontmatter `name`, `description`, `keep-coding-instructions`, `force-for-plugin`. Built-ins: Default, Proactive, Concise, Explanatory, Learning. *"Claude Code sends the active style's instructions with every request"* and re-reminds Claude mid-conversation. They change the **system prompt**, not the transcript. Selected via `outputStyle` in settings or `/config`.

### Subagents

A subagent runs in a **fresh, separate context window**: its own (shorter) system prompt, its own copy of CLAUDE.md (the built-in `Explore`/`Plan` agents skip it), same MCP servers and skills, a task prompt written by the parent instead of a user prompt, and **no** parent conversation history or main-session auto memory. Optional per-subagent memory via `memory: project|local|user` frontmatter writing its own `MEMORY.md` (first 200 lines / 25 KB into its system prompt). `/fork` inherits the parent's full conversation and system prompt. This is the only documented in-harness mechanism that gives a task a genuinely clean window — but the parent's window is unaffected apart from the returned summary.

### `--resume` / session files on disk ([claude-directory](https://code.claude.com/docs/en/claude-directory), [agent-sdk/sessions](https://code.claude.com/docs/en/agent-sdk/sessions))

| Path | Contents |
|---|---|
| `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` | "Full conversation transcript: every message, tool call, and tool result" — JSONL, one record per line, **not encrypted at rest** |
| `…/<session>.orphaned-<ts>-<suffix>.jsonl`, `…<session>.jsonl.superseded-<ts>` | Prior transcripts set aside, hidden from the picker |
| `…/<session>/subagents/` | Subagent transcripts |
| `…/<session>/tool-results/` | Large tool outputs spilled to files |
| `~/.claude/projects/<project>/memory/` | Auto memory (exempt from the age sweep) |
| `~/.claude/history.jsonl` | Every prompt typed, with timestamp + project path |
| `~/.claude/file-history/<session>/`, `plans/`, `debug/`, `tasks/`, `shell-snapshots/`, `backups/` | Checkpoints, plan-mode plans, debug logs, task lists, shell state, `.claude.json` backups |

Directory encoding: *"replace every non-alphanumeric character in the absolute working directory with `-`: `/Users/me/proj` becomes `-Users-me-proj`"*; names over 200 chars are truncated + hashed. Overridable with `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_PROJECT_DIR_NAME`. Retention is `cleanupPeriodDays` (default 30). Commands: `/resume`, `/branch`, `/fork`, `--continue`, `--resume`, `--fork-session`; SDK `resume`, `continue`, `forkSession`, `persistSession: false` (TS) / `CLAUDE_CODE_SKIP_PROMPT_HISTORY` (Py), and a `SessionStore` adapter for shared storage. On resume, `SessionStart` receives `source: "resume"|"fork"` plus `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd`.

**Nothing in the docs sanctions editing these `.jsonl` files to rewrite history.** The format is described as an artifact, not an API; `--resume` reads what Claude Code wrote.

---

## MCP capabilities and limits

Spec revision **2025-06-18** ([specification](https://modelcontextprotocol.io/specification/2025-06-18)). JSON-RPC 2.0, stateful connections, capability negotiation between **hosts**, **clients**, **servers**.

**Servers offer:**
- **Resources** — "Context and data, for the user or the AI model to use." `resources/list`, `resources/read`, `resources/templates/list` (RFC 6570 URI templates), optional `subscribe` and `listChanged` capabilities with `notifications/resources/updated` and `notifications/resources/list_changed`. Crucially: *"Resources in MCP are designed to be **application-driven**, with host applications determining how to incorporate context based on their needs."* ([resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources))
- **Prompts** — "Templated messages and workflows for users." `prompts/list`, `prompts/get` returning `messages[]` of role `user`/`assistant` with text, image, audio, or **embedded resource** content. *"Prompts are designed to be **user-controlled**… with the intention of the user being able to explicitly select them"*, typically as slash commands. ([prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts))
- **Tools** — functions the model executes.

**Clients offer:** **Sampling** (`sampling/createMessage`; server-initiated LLM calls with `messages`, `systemPrompt`, `modelPreferences`, `maxTokens` — *"there **SHOULD** always be a human in the loop with the ability to deny sampling requests"*, and *"The protocol intentionally limits server visibility into prompts"*), **Roots** (filesystem/URI boundaries), **Elicitation** (server-initiated requests for user input).

### Can a server push context unprompted?

Only as **notifications**, not as conversation content. A server may emit `notifications/resources/updated`, `notifications/resources/list_changed`, `notifications/prompts/list_changed`, `notifications/tools/list_changed`. These tell the **client** something changed; the client decides whether to read and whether to surface it to the model. Sampling inverts the call direction but creates a **nested, separate** LLM interaction — the server supplies its own `messages` array, gets a completion back, and none of it lands in the host's user-facing conversation.

### Can a server influence conversation history?

**No.** There is no protocol method to read, delete, replace, or reorder the host's message list. `prompts/get` returns messages the **user** must choose to insert; embedded resources ride along inside those messages. Resources are "application-driven" by design. The security principles reinforce this: hosts must obtain explicit user consent before exposing data to servers and before invoking tools. MCP is a **supply-side** protocol for context; the host owns assembly.

---

## Other harnesses

| Harness | Persistent instruction files | Retrieval / indexing | Pluggable context-assembly step? | Per-turn transcript control | Evidence |
|---|---|---|---|---|---|
| **Claude Code** | `CLAUDE.md` hierarchy + `.claude/rules/*.md` (`paths:` globs), auto memory `MEMORY.md` | MCP servers (deferred tool schemas), skills, subagents, code-intelligence plugins | **Yes, additive only** — `UserPromptSubmit`/`SessionStart` `additionalContext` (10 k chars), `PreToolUse.updatedInput`, `PostToolUse.updatedToolOutput` | **No.** "can't replace the prompt; it only injects `additionalContext` alongside it". `/clear` and `/compact` are user/auto-triggered | [hooks](https://code.claude.com/docs/en/hooks), [context-window](https://code.claude.com/docs/en/context-window) |
| **OpenAI Codex CLI** | `AGENTS.md`; `~/.codex/config.toml`, `.codex/config.toml` | MCP servers; `mcp_tool` hook handlers | **Yes, additive only** — full hook system (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SubagentStart/Stop`, `Stop`, `Interrupt`, `SessionEnd`) with `hookSpecificOutput.additionalContext` "added as extra **developer** context", `additionalContextLimit` (default **2500** tokens, `0` = uncapped), `PreToolUse.updatedInput`, `PostToolUse` result replacement, `Stop` `decision: "block"` creating a continuation prompt. Hooks need explicit trust (`/hooks`, hashed) | **No.** `UserPromptSubmit` offers only `additionalContext` or `decision: "block"`. `updatedMCPToolOutput` "parsed but not supported yet" | [learn.chatgpt.com/docs/hooks](https://learn.chatgpt.com/docs/hooks), [openai/codex docs/config.md](https://github.com/openai/codex/blob/main/docs/config.md) |
| **Cursor** | `.cursor/rules/*.mdc` (`alwaysApply` / `globs` / `description` / manual `@`-mention), User Rules, Team Rules (dashboard), `AGENTS.md` | Instant Grep (custom search engine, encrypted file paths), codebase indexing, **Explore subagent** with its own context window | **Partial** — MCP servers; rule selection is agent- or glob-driven, not a callable assembly hook. No documented pre-prompt user hook | **No.** "When applied, rule contents are included at the start of the model context." Append-only | [cursor.com/docs/rules](https://cursor.com/docs/rules), [agent/tools/search](https://cursor.com/docs/agent/tools/search) |
| **Aider** | `CONVENTIONS.md` via `/read-only`, `.aider.conf.yml` | **Repo map**: tree-sitter symbol map ranked by a graph algorithm over the file-dependency graph, budgeted by `--map-tokens` (default 1 k), "adjusts the size of the repo map dynamically based on the state of the chat" | **No plugin API.** Context is manipulated by *human* commands: `/add`, `/drop`, `/read-only`, `/clear`, `/reset`, `/tokens`, `/map`, `/map-refresh`, `/copy-context`, `/save`, `/load` | **Closest built-in**: `/clear` clears chat history, `/reset` "Drop all files and clear the chat history", and the repo map is recomputed per request. But it's interactive, and `/load` executes commands from a file — no programmatic retrieval hook | [repomap](https://aider.chat/docs/repomap.html), [usage/commands](https://aider.chat/docs/usage/commands.html) |
| **Continue.dev** | `config.yaml` `rules`, `AGENTS.md` | `@File`, `@Code`, `@Diff`, `@Currentfile`, `@Terminal`, `@Open`, `@Clipboard`, `@Tree`, `@Problems`, `@Debugger`, `@Repository Map` (`repo-map`, `includeSignatures`), `@OS` | **Yes — the only true retrieval plugin surface.** `@HTTP` provider POSTs `{query, fullInput}` to your URL and expects `200 OK` with `{name, description, content}` or an array of them. Plus any MCP server via `mcpServers`. Deprecated `@Codebase`/`@Docs` now steer users to MCP | **No** transcript replacement; providers **add** context items to the request | [customize/deep-dives/custom-providers](https://docs.continue.dev/customize/deep-dives/custom-providers) |
| **Cline** | `.clinerules`, MCP | MCP servers, checkpoints | **No pre-prompt hook documented.** Context management is internal | **Closest to replacement, but agent-internal**: Auto Compact "Creates a comprehensive summary… **Replaces the conversation history with the summary**… Continues exactly where it left off." Not externally programmable; falls back to "standard rule-based context truncation" on non-supported models | [docs.cline.bot/features/auto-compact](https://docs.cline.bot/features/auto-compact) |
| **Roo Code** | Custom instructions, `.roo/rules`, MCP | MCP servers, checkpoints | **Partial** — the condensing *prompt* is user-customizable (`customSupportPrompts.CONDENSE`), with an auto-trigger threshold slider and a manual **Condense Context** button. "Condensing always uses your active conversation provider/model." Also auto-truncates 25 % and retries on context-limit errors | **No external API.** You can steer *what the summarizer preserves*, not supply the context yourself | [Intelligent Context Condensing](https://roocodeinc.github.io/Roo-Code/features/intelligent-context-condensing/) |

---

## Verdict: plugin vs own-the-loop

**"Clear the context window on every prompt and send only what is needed" is not achievable as a plugin to any of the surveyed harnesses. It requires owning the loop.** The universal shape of every existing extension point is *append before the model call*; the transcript itself is harness-private state.

Evidence per harness:

- **Claude Code (interactive CLI) — impossible.** The decision-control table enumerates every rewrite field in the product: `updatedInput`, `updatedToolOutput`, `displayContent`. None touches conversation history, and the docs state outright that `UserPromptSubmit` *"can't replace the prompt; it only injects `additionalContext` alongside it."* `PreCompact` can only veto compaction; `PostCompact` has "No decision control"; `MessageDisplay` is "Display-only: the transcript and what Claude sees keep the original." `/clear` has no hook-invocable form — `SessionStart` merely observes `source: "clear"`. You can *approximate* the goal (subagents for isolated windows, `additionalContext` for injection, `Stop` blocking to drive turns, aggressive `/autocompact`), but old turns still occupy the window and injections are capped at 10 k chars and fail open after 30 s.
- **Claude Code via Agent SDK / `claude -p` — achievable, and this is the cheapest real path.** This is owning the loop while reusing the harness. Per turn, run a fresh `query()` with `persistSession: false` (TS) or `CLAUDE_CODE_SKIP_PROMPT_HISTORY` (Py), no `resume`/`continue`, `settingSources: []` to suppress automatic CLAUDE.md/rules/output-style loading, and either `systemPrompt: {type: "preset", preset: "claude_code", append: …}` or a fully custom string. You assemble the entire prompt; Claude Code keeps the tool loop, permissions, and MCP. A `SessionStart` hook returning `initialUserMessage` can even seed the first turn in `-p` mode. Documented at [agent-sdk/sessions](https://code.claude.com/docs/en/agent-sdk/sessions) and [agent-sdk/modifying-system-prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts). Cost: you lose the interactive TUI and re-pay cache writes each turn unless you use `excludeDynamicSections: true` for a stable cached prefix.
- **Codex CLI — impossible as a plugin.** Richest third-party hook system after Claude Code, and it still tops out at `additionalContext` (default 2500-token threshold), `PreToolUse.updatedInput`, `PostToolUse` result substitution, and `Stop` continuation prompts. `UserPromptSubmit` supports exactly two outcomes: inject or block. No history API.
- **Cursor — impossible.** "When applied, rule contents are **included at the start of** the model context." No user-authored pre-prompt hook exists in the rules docs; the Explore subagent isolates *search* context, not the main thread.
- **Aider — impossible as a plugin, closest by hand.** `/reset` ("Drop all files and clear the chat history") plus per-request repo-map recomputation is functionally "clear and re-assemble", but it is an interactive command, not an extension API. The only automation seam is `/load` executing a command file.
- **Continue.dev — impossible for replacement, best-in-class for injection.** `@HTTP` is a genuine pluggable retrieval endpoint (`POST {query, fullInput}` → `{name, description, content}`) and MCP covers the rest, but providers contribute **items appended to the request**; there is no provider API that returns a whole message list.
- **Cline — impossible externally.** Auto Compact does "Replaces the conversation history with the summary" — exactly the primitive needed — but it is internal, model-driven, and exposes no configuration hook for supplying the replacement yourself.
- **Roo Code — impossible externally.** You can rewrite the condensing *prompt* (`customSupportPrompts.CONDENSE`) and set the trigger threshold; you cannot supply the condensed content. Condensing is pinned to the active conversation model by design.
- **Raw API client — trivially achievable.** Anthropic/OpenAI message APIs are stateless: every request carries the full `messages` array you construct. "Clear every turn" is simply not carrying history forward. This is what Letta/MemGPT does.

**Design consequence for a four-layer context manager:** ship both. (a) A *plugin* profile that installs a `UserPromptSubmit` hook + MCP server into Claude Code/Codex and an `@HTTP` provider into Continue — additive retrieval, works inside the user's existing tool, honest about not clearing. (b) An *owned-loop* profile built on the Claude Agent SDK with `settingSources: []`, `persistSession: false`, and a fresh session per turn — this is where true per-turn replacement lives, and it still inherits Claude Code's tools, permissions, and MCP client so you are not rebuilding a harness.

---

## Prior art

| Project | Repo | Layer it manages | Coding-agent integration | Per-turn replacement or retrieval tool? |
|---|---|---|---|---|
| **mem0** | [mem0ai/mem0](https://github.com/mem0ai/mem0) — Apache-2.0, Python, ~65 k★ — "The Memory Layer for AI Agents" | Extracted conversational facts in a vector store (+ optional graph memory) | Python/TS SDK you call from your own loop; hosted platform; `mem0-mcp-server` exposes memory as MCP tools to Cursor/Claude Code/Codex | **Retrieval tool + explicit `search`/`add` calls.** No transcript replacement — your loop decides what to prepend |
| **OpenMemory MCP** | [mem0ai/mem0 /openmemory](https://github.com/mem0ai/mem0/tree/main/openmemory) | Local private memory: Docker + Postgres + **Qdrant** vector store, nothing leaves the machine | MCP server exposing `add_memories`, `search_memory`, `list_memories`, `delete_all_memories`; cross-client (store in Cursor, read in Claude) | **Retrieval tool only.** MCP cannot replace history (see § MCP limits) |
| **Letta (ex-MemGPT)** | [letta-ai/letta](https://github.com/letta-ai/letta) — Apache-2.0, ~25 k★ — "Platform for stateful agents" | Full agent state: core memory blocks in-context, archival + recall memory paged out, self-editing memory tools | **Owns the loop** — it is the agent server/runtime, not a plugin; REST API + ADE. Also ships an MCP server | **True per-turn assembly.** The MemGPT design *is* OS-style paging of the context window each call — the closest published prior art to the brief. Cost: you adopt Letta's agent, not your coding CLI |
| **Zep** | [getzep/zep](https://github.com/getzep/zep) — ~4.9 k★; includes `mcp/zep-mcp-server/`, `ontology/`, `zep-eval-harness/` | Temporal knowledge graph (Graphiti) over chat history + business data | SDK from your own loop; `zep-mcp-server` for MCP clients | **Retrieval + memory-context string** you inject yourself; no harness-side replacement |
| **cognee** | [topoteretes/cognee](https://github.com/topoteretes/cognee) — ~31 k★, Python — "open-source AI memory platform for agents… self-hosted knowledge graph engine" | ECL (extract-cognify-load) pipelines into a knowledge graph + vector store | `cognee-mcp/` server; ships its own `.claude/skills/` | **Retrieval tool.** Adds `search`/`cognify` tools; the agent must choose to call them |
| **claude-context** | [zilliztech/claude-context](https://github.com/zilliztech/claude-context) — MIT, TypeScript, ~12.5 k★ — "Code search MCP for Claude Code. Make entire codebase the context for any coding agent" | **Layer 4-adjacent**: semantic code index (Milvus/Zilliz) over the repo, with incremental file-sync | MCP server; also a VSCode extension and Chrome extension. Repo ships an `evaluation/` harness comparing MCP semantic search vs grep on SWE-bench-style cases | **Retrieval tool.** Replaces *how* the agent finds code, not *what is in the window* |
| **ByteRover / Cipher** | [campfirein/byterover-cli](https://github.com/campfirein/byterover-cli) (formerly Cipher) | Dual memory layer: "System 1" (concepts, business logic, past interactions) + "System 2" (model reasoning traces) | MCP server across Cursor, Claude Code, Cline, Roo, Windsurf, Gemini CLI, Kiro, Trae, Amp, Warp; plus its own CLI with ~24 built-in tools | **Both modes**: retrieval tool when used via MCP; per-turn assembly only inside its own CLI, which owns the loop |

**Pattern across all prior art:** everything that integrates *as a plugin* (mem0/OpenMemory/Zep/cognee/claude-context/ByteRover-over-MCP) is a **retrieval tool** the agent must elect to call, or a hook that appends. Everything that performs *genuine per-turn context assembly* (Letta/MemGPT, ByteRover's own CLI) **owns the agent loop**. No project in this set achieves per-turn context replacement inside a third-party coding CLI — because, as documented above, no third-party coding CLI exposes the primitive.

---

## Sources

**Claude Code**
- Hooks reference — https://code.claude.com/docs/en/hooks
- Memory / CLAUDE.md / rules / auto memory — https://code.claude.com/docs/en/memory
- Context window, compaction survival — https://code.claude.com/docs/en/context-window
- Commands (`/clear`, `/compact`, `/resume`, `/branch`, `/fork`, `/btw`, `/context`, `/autocompact`) — https://code.claude.com/docs/en/commands
- Skills & dynamic context injection — https://code.claude.com/docs/en/skills
- `.claude` directory & on-disk session layout — https://code.claude.com/docs/en/claude-directory
- MCP in Claude Code — https://code.claude.com/docs/en/mcp
- Output styles — https://code.claude.com/docs/en/output-styles
- Reduce token usage / hooks as preprocessors — https://code.claude.com/docs/en/costs
- Agent SDK overview — https://code.claude.com/docs/en/agent-sdk/overview
- Agent SDK sessions (resume/fork/`persistSession`, `~/.claude/projects/<encoded-cwd>/*.jsonl`) — https://code.claude.com/docs/en/agent-sdk/sessions
- Agent SDK system prompts & `settingSources` — https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts

**MCP**
- Specification 2025-06-18 overview — https://modelcontextprotocol.io/specification/2025-06-18
- Server › Resources — https://modelcontextprotocol.io/specification/2025-06-18/server/resources
- Server › Prompts — https://modelcontextprotocol.io/specification/2025-06-18/server/prompts
- Client › Sampling — https://modelcontextprotocol.io/specification/2025-06-18/client/sampling
- Schema — https://github.com/modelcontextprotocol/specification/blob/main/schema/2025-06-18/schema.ts

**Other harnesses**
- Codex CLI hooks — https://learn.chatgpt.com/docs/hooks
- Codex config (`allow_managed_hooks_only`) — https://github.com/openai/codex/blob/main/docs/config.md
- Cursor rules — https://cursor.com/docs/rules
- Cursor search / Explore subagent — https://cursor.com/docs/agent/tools/search
- Aider repo map — https://aider.chat/docs/repomap.html
- Aider in-chat commands — https://aider.chat/docs/usage/commands.html
- Continue.dev context providers (incl. `@HTTP`) — https://docs.continue.dev/customize/deep-dives/custom-providers
- Cline Auto Compact — https://docs.cline.bot/features/auto-compact
- Roo Code Intelligent Context Condensing — https://roocodeinc.github.io/Roo-Code/features/intelligent-context-condensing/

**Prior art**
- mem0 — https://github.com/mem0ai/mem0
- OpenMemory MCP — https://github.com/mem0ai/mem0/tree/main/openmemory
- Letta (MemGPT) — https://github.com/letta-ai/letta
- Zep — https://github.com/getzep/zep
- cognee — https://github.com/topoteretes/cognee
- claude-context — https://github.com/zilliztech/claude-context
- ByteRover CLI (Cipher) — https://github.com/campfirein/byterover-cli

**Uncertainty notes**
- "ByteRover" resolves to several artifacts: the maintained CLI at `campfirein/byterover-cli` (formerly Cipher), a community mirror `hoathaithanh/byterover-cipher-memory-layer`, and the hosted byterover.dev product. Capability claims for ByteRover above come from repo/vendor descriptions and secondary write-ups, not a first-party spec page — treat the "96.1 % benchmark accuracy" figure as vendor marketing, unverified.
- Codex CLI hook docs are served at `learn.chatgpt.com/docs/hooks`; `github.com/openai/codex/blob/main/docs/config.md` redirects most configuration reference to `developers.openai.com/codex/config-*`. Both are OpenAI-official.
- Cursor's docs contain no user-invocable pre-prompt hook; absence is inferred from a complete read of the rules and search pages rather than from an explicit "no hooks" statement.
