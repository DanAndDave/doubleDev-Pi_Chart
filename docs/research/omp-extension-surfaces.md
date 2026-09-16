# Hook events

All events below are dispatched by `ExtensionRunner` in the default runtime; `omp://hooks.md` notes "`--hook` is treated as an alias for `--extension`" and that hook factories "are loaded as extension modules so their `pi.on(...)` handlers bind to the runtime event bus." Events marked **ext-only** are absent from the `HookAPI` catalog in `omp://skills/authoring-hooks.md`.

| event | fires when | read | inject | block | rewrite |
|---|---|---|---|---|---|
| `context` | "Before each LLM API call" (`omp://skills/authoring-hooks.md`) | `event.messages` — "the current accumulated list" (`omp://skills/authoring-hooks.md`) | yes, by returning an array containing new messages | no | **YES — the entire message array.** "`context` → can return `{ messages?: Message[] }`" (`omp://hooks.md`); "Handlers run in order; each receives the output of the previous handler" (`omp://skills/authoring-hooks.md`) |
| `before_provider_request` **ext-only** | before the provider request is issued | provider request payload | via payload | not documented | **YES — the wire payload.** "`before_provider_request` (may replace provider request payload — the replacement is applied by every provider that fires the hook, which is all of them except `devin-agent`, which does not fire it)" (`omp://extensions.md`) |
| `after_provider_response` **ext-only** | after a provider response | response | not documented | no | not documented |
| `before_agent_start` | "Before agent starts a turn" (`omp://skills/authoring-hooks.md`); for ordinary prompts and "for each steering or follow-up batch containing user work when that batch is actually dequeued" (`omp://extensions.md`) | `prompt` ("the already-transformed text of every selected user message, joined with two newlines"), `images` (`omp://extensions.md`) | yes — "`{ message?: { customType; content; display; details; attribution } }`" (`omp://hooks.md`); "Returned custom messages are appended once after the original batch" (`omp://extensions.md`) | no | **system prompt only.** "Handlers chain from the current base system prompt. Their final override governs the next provider request and its continuations… Overrides remain complete replacements" (`omp://extensions.md`). Originals are NOT rewritten: "originals retain their order, identity, attribution, and metadata" |
| `input` **ext-only** | on user input; "In interactive mode, `input` handlers run before the built-in first-message auto-title check" (`omp://extensions.md`) | user input | via `pi.sendMessage` etc. | not documented | prompt text transformation implied but not specified — see Not documented. `await pi.setSessionName(...)` from `input` "can set the persisted session name" (`omp://extensions.md`) |
| `tool_call` | "Before every tool execution" (`omp://skills/authoring-hooks.md`); for model-issued calls "at arg-prep time in the agent loop" (`omp://extensions.md`) | `event.toolName`, `event.input`, `event.toolCallId` | `reason` text reaches the model as the tool error | **YES.** "If **any** handler returns `{ block: true }`, execution stops immediately… If a handler **throws**, the tool is also blocked (fail-closed)" (`omp://skills/authoring-hooks.md`) | **tool arguments.** "A non-blocking handler that returns `input` replaces the arguments the tool executes with (the raw execution input, not the normalized `event.input` view); ignored when `block` is true" (`omp://hooks.md`) |
| `tool_result` | "After every tool execution" (`omp://skills/authoring-hooks.md`) | `toolName`, `toolCallId`, `input`, `content`, `details`, `isError` (`omp://hooks.md`) | via replacement content | no | **YES — tool output.** `{ content?; details?; isError? }`. "`content` replaces the full content array for the LLM" (`omp://skills/authoring-hooks.md`). Under extensions it is "middleware-style: handlers run in extension order and each sees prior modifications" (`omp://extensions.md`). Under legacy `HookToolWrapper`, `isError` "is typed but not applied" (`omp://hooks.md`) |
| `tool_execution_start` / `_update` / `_end` **ext-only** | tool execution progress | execution state | no | no | no — "(observability)" (`omp://extensions.md`) |
| `tool_approval_requested` / `_resolved` **ext-only** | "only when a tool requires approval and an approval handler is registered" (`omp://extensions.md`) | approval state | no | no | no — "(observability)" |
| `session_start` | "On initial session load" | `ctx.sessionManager.getBranch()` | via `pi.sendMessage` / `appendEntry` | no | no |
| `session_before_switch` | "Before session switch" | — | — | **`{ cancel?: boolean }`** | no |
| `session_switch` | after switch | — | — | no | no |
| `session_before_branch` | "Before session branch" | — | — | **`{ cancel?: boolean; skipConversationRestore?: boolean }`** | `skipConversationRestore` suppresses conversation restore |
| `session_branch` | after branch | — | — | no | no |
| `session_before_compact` | "Before compaction" | — | — | **`{ cancel?: boolean }`** | **YES — can supply the compaction result.** `{ cancel?: boolean; compaction?: CompactionResult }` (`omp://hooks.md`) |
| `session.compacting` | "During compaction (inject context)" (`omp://skills/authoring-hooks.md`) | — | **`{ context?: string[]; prompt?: string; preserveData?: Record<string, unknown> }`** (`omp://hooks.md`) | no | the compaction `prompt` |
| `session_compact` | after compaction | saved entry | no | no | no |
| `session_before_tree` | "Before tree navigation" | — | `summary?: { summary: string; details?: unknown }` | **`{ cancel?: boolean }`** | the branch summary |
| `session_tree` | after tree navigation | — | — | no | no |
| `session_shutdown` | on shutdown; "emits `session_shutdown` once" during dispose (`omp://sdk.md`) | — | — | no | no |
| `session_stop` **ext-only** | "main-session stop hook, awaited before settle… never fires for task/subagent sessions, and defers until agent-owned background jobs are fully idle" (`omp://extensions.md`) | `event.stop_hook_active`, `event.turn_id` (`omp://skills/authoring-extensions.md`) | **`{ continue: true, additionalContext }`** — "capped at 8 consecutive continuations" | **`{ decision: "block", reason }`** | no |
| `agent_start` / `agent_end` | agent loop lifecycle | messages on `agent_end` | no | no | no — "`agent_end` remains notification-only" (`omp://extensions.md`) |
| `turn_start` / `turn_end` | "Start/End of a user→agent turn" | `ctx.getContextUsage()` | no | no | no |
| `message_start` / `message_update` / `message_end` **ext-only** | message lifecycle | "`message_end` receives a detached message snapshot" | no | no | **no — explicitly.** "use `tool_result` or `context` when an extension needs to change provider context" (`omp://extensions.md`) |
| `auto_compaction_start` / `_end`, `auto_retry_start` / `_end`, `ttsr_triggered`, `todo_reminder` | reliability/runtime signals | state | no | no | no |
| `goal_updated`, `credential_disabled` **ext-only** | runtime signals | state | no | no | no |
| `mcp_notification` **ext-only** | "for every JSON-RPC notification received from a connected MCP server, AFTER the manager's own handling" (`omp://extensions.md`) | `{ server, method, params }` | yes, via `pi.sendUserMessage(..., { deliverAs: "steer" })` | no | no |
| `user_bash` / `user_python` **ext-only** | standalone `!`-bash / python runs | command | — | — | **`{ result }` override** (`omp://extensions.md`) |
| `resources_discover` **ext-only** | — | — | — | — | "`ExtensionRunner.emitResourcesDiscover(...)` is implemented, but there are no `AgentSession` callsites invoking it in the current codebase" (`omp://extensions.md`) |

## Events that modify/drop/reorder/replace already-present messages, or rewrite the outgoing request

Three, explicitly:

1. **`context`** — replaces the whole model-facing message array per LLM call. The bundled example filters messages out (`omp://hooks.md`: `event.messages.filter(...)`) and the authoring skill's example maps and truncates every `toolResult` (`omp://skills/authoring-hooks.md`). Nothing in either doc constrains the returned array to be a subset, a superset, or in original order.
2. **`before_provider_request`** — "may replace provider request payload" (`omp://extensions.md`). This is post-conversion, at the provider boundary.
3. **`tool_result`** — replaces content/details of results already produced, before they reach the model.

Counter-cases worth noting: `message_end` is explicitly disqualified ("detached message snapshot"), and `before_agent_start` explicitly cannot touch the originals ("originals retain their order, identity, attribution, and metadata").

# Can external code own the per-turn message array?

## Verdict: **YES for (b) and (c), from an in-process extension. PARTIAL for (a).**

### (b) Supply the exact message array sent to the model for a turn — **YES**

`omp://hooks.md`, event surface:

> `context` → can return `{ messages?: Message[] }`

`omp://skills/authoring-hooks.md`, event catalog table:

> | `context` | Before each LLM API call | `{ messages?: Message[] }` |

and its "Context modification contract" section:

> Return `{ messages: [...] }` from a `context` handler to rewrite the message list before each LLM API call
>
> - `event.messages` is the current accumulated list.
> - Handlers run in order; each receives the output of the previous handler.
> - Return `undefined` (or nothing) to pass messages through unmodified.

`omp://hooks.md` lists this under "What hooks can mutate":

> - LLM context for a single call via `context` (`messages` replacement chain)

and under ordering:

> - `context`: chained; each handler receives prior handler's message output

`context` is listed in the `ExtensionAPI` event surface too (`omp://extensions.md`, "Prompt and turn lifecycle": `before_agent_start` / `before_provider_request` / `after_provider_response` / `context`), and `omp://extensions.md` directs extensions at it for exactly this purpose:

> `message_end` receives a detached message snapshot, so use `tool_result` or `context` when an extension needs to change provider context

So a single registered handler can return a freshly assembled array each turn. The core does the same thing internally: `omp://tools/rewind.md` documents that rewind "replaces both the turn's active message array and `agent.state.messages`. The exploratory branch and successful rewind tool result are therefore absent from the next provider call."

**Caveat — scope.** `context` governs what the provider sees for that call. It does not erase the durable session: session entries persist independently and are rebuilt by `buildSessionContext` (`omp://compaction.md`), and the TUI renders its own display transcript. A context pack assembled in `context` is per-request, not a session mutation — which is exactly the stated goal, but the TUI will still show the full local transcript.

### (c) Intercept and rewrite the request payload pre-flight — **YES**

`omp://extensions.md`:

> - `before_provider_request` (may replace provider request payload — the replacement is applied by every provider that fires the hook, which is all of them except `devin-agent`, which does not fire it)

This is the only mention of the event in the documentation set. The payload type name and handler return shape are not documented (see Not documented).

### (a) Clear the conversation — **PARTIAL: not from a hook, not over RPC; adjacent controls exist**

No hook event, RPC command, or `ExtensionAPI` method in the docs clears the conversation. `/clear` is a TUI built-in:

> Interactive `/clear` clears the current conversation context in place. It is available only in the TUI and is rejected while a response is streaming or a foreground bash/Python execution is running. (`omp://session-operations-export-share-fork-resume.md`)

> | `/clear` | Interactive slash command | Yes (clears live/model conversation context) | No; retains session identity, metadata, transcript file, and full on-disk history | Appends a durable `reset_boundary` |

And `omp://slash-command-internals.md` confirms it is not reachable from a headless host: "TUI-only built-ins are omitted from ACP availability and dispatch." The RPC command list (`omp://rpc.md`) contains no `clear` — only `new_session`, `switch_session`, `branch`, `compact`, `handoff`.

What external code *can* do:

- **`ExtensionCommandContext`** (command handlers only): `newSession(...)`, `switchSession(...)`, `branch(entryId)`, `navigateTree(targetId, { summarize })`, `compact(opts?)`, `reload()` (`omp://extensions.md`, `omp://skills/authoring-extensions.md`).
- **`ctx.compact(...)`** on the general handler context (`omp://extensions.md`).
- **`session_before_compact`** can return `{ compaction?: CompactionResult }` — supply a compaction result rather than letting the model summarize; `session.compacting` can return `{ context?: string[]; prompt?: string; preserveData? }` (`omp://hooks.md`).
- **`new_context` tool**, gated on `compaction.experimentalContextManagement = true`: "commits a normal compaction boundary without generating another recursive summary. It rebuilds active context with the latest notebook and retained recent messages, leaving original journal entries available through `history://current/full`" (`omp://tools/new-context.md`). Note its disclaimer: "The tool itself does not commit a compaction boundary or synchronously reset the conversation."

### Net

For the stated design — "a deterministic assembler that builds a fresh context pack per turn" — **no fork is needed.** A single extension registering `pi.on("context", …)` returns the assembled array on every provider call; the durable session keeps accumulating underneath. Forking becomes relevant only if you also want the TUI transcript itself cleared each turn, which no documented surface exposes.

# Extension model

**Language / format.** "An extension is a TS/JS module exporting a default factory" (`omp://extensions.md`). Auto-scanned directories accept `.ts` and `.js`; "explicitly named files and installed-plugin manifest entries may also use `.mjs` and `.cjs`" (`omp://extension-loading.md`). Factory selection: "the module itself if it is a function, otherwise `module.default`"; it "may return `void` or a promise; loading awaits it." Packaging manifest is `package.json` `omp.extensions` (legacy `pi.extensions` accepted), an array of entry paths.

**Discovery roots** (`omp://extension-loading.md`, `omp://skills/authoring-extensions.md`):
- `<cwd>/.omp/extensions` (cwd-only — "it does not walk ancestors")
- `<agentDir>/extensions`, default `~/.omp/agent/extensions`, profile-aware (`~/.omp/profiles/<name>/agent/extensions`), `PI_CODING_AGENT_DIR`-aware
- hook factories at `<cwd>/.omp/hooks/pre|post/*.{ts,js}` and `<agentDir>/hooks/pre|post/*.{ts,js}` — "a factory placed **directly** in `hooks/` is not discovered" (`omp://hooks.md`)
- enabled installed plugins via `omp.extensions`/`pi.extensions`
- CLI `--extension`/`-e` (and `--hook` as an alias) and the `extensions:` config key

Load order is "1. Native auto-discovered modules 2. Discovered JS/TS hook factories 3. Installed plugin extension entries 4. Explicit configured paths", deduped by absolute path, first wins. Disable with `--no-extensions`, SDK `disableExtensionDiscovery`, or `disabledExtensions: [extension-module:<derivedName>]`.

**Lifecycle** (`omp://extensions.md`):

> 1. Extensions are imported and their factory functions run.
> 2. During that load phase, registration methods are valid; runtime action methods are not yet initialized.
> 3. `ExtensionRunner.initialize(...)` wires live actions/contexts for the active mode.
> 4. Session/agent/tool lifecycle events are emitted to handlers.
> 5. Every tool execution is wrapped with extension interception (`tool_call` / `tool_result`).

> calling action methods like `pi.sendMessage()` during extension load throws `ExtensionRuntimeNotInitializedError`

**What an extension may register** (`ExtensionAPI`, `omp://extensions.md`):
- events: `on(event, handler)`
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
- `registerMessageRenderer`, `registerAssistantThinkingRenderer`, `registerComposerShape`
- `registerProvider(name, config)` (with optional `usage: UsageProvider`, `fetchDynamicModels`), `unregisterProvider(name)`
- `registerFileWriteFallback`, `registerFileDeleteFallback`
- **Agents/subagents are not registered through `ExtensionAPI`** — they are discovered from `agents/` directories under extension/plugin roots (`omp://plugin-manager-installer-plumbing.md`: "Task-agent discovery scans the same roots' `agents/`").

**Runtime actions:** `sendMessage`, `sendUserMessage`, `appendEntry`, `exec`, `getActiveTools`/`getAllTools`/`setActiveTools`, `getCommands`, `getSessionName`/`setSessionName`, `setModel`, `getThinkingLevel`/`setThinkingLevel`, `getServiceTiers`/`setServiceTier`, `events` (shared bus), plus `pi.logger`, `pi.zod`, `pi.arktype`, `pi.typebox`, `pi.pi`.

`sendMessage` delivery modes: `deliverAs: "steer" | "followUp" | "nextTurn" | "aside"`, plus `triggerTurn`.

**What it can access.**
- **Message history: yes, read-only.** `ctx.sessionManager` is annotated "(read-only)". The documented pattern is `ctx.sessionManager.getBranch()` iterating persisted entries. `omp://extensions.md` warns the `entry.message.role` discriminant is camelCase (`toolResult`, not `tool_result`) and that "a filter that compares against snake_case constants, or lowercases `role` first… matches no branch and **silently drops** the entry with no error or log."
- **Durable state:** `pi.appendEntry("com.example.my-extension.state", data)` — "The `customType` namespace is global: use a package- or reverse-domain-qualified value."
- **Model client: not directly.** `ctx.modelRegistry`, `ctx.model`, and `ctx.models` (`list()`, `current()`, `resolve(spec)`, `family(model)`) are a "read-only facade for picking and comparing models"; no documented method issues a model request. Providers can be *registered* (`registerProvider`), which is the documented way to own transport.
- Also: `ctx.ui`, `ctx.hasUI`, `ctx.cwd`, `ctx.getContextUsage()`, `ctx.getAsyncJobSnapshot()`, `ctx.compact(...)`, `ctx.isIdle()`, `ctx.hasPendingMessages()`, `ctx.abort()`, `ctx.shutdown()`, `ctx.getSystemPrompt()`, `ctx.memory`, `ctx.setInterval`/`setTimeout`/`clearTimer`, `ctx.localProtocolOptions`.

**Sandboxing: none.** `omp://extension-loading.md`:

> - Extensions are **not sandboxed** (same process/runtime).
> - They share one `EventBus` and one `ExtensionRuntime` instance.

`omp://extensions.md`:

> Extensions run **in-process with no isolation**. A raw `setInterval`/`setTimeout`/detached-promise callback that throws runs outside the handler-dispatch try/catch… **the whole session is torn down**

`omp://plugin-manager-installer-plumbing.md`: "Plugin code executes in-process when custom tool modules are imported; no sandboxing… The plugin package itself is trusted code once installed."

Partial containment does exist: handler exceptions are caught and reported as extension errors, `ctx.setInterval`/`setTimeout` "run the callback with the same isolation as handler dispatch" and "are cleared automatically on `session_shutdown`", and load failures are per-path (`{ path, error }`) without aborting other extensions.

**Registry scope caveat for a machine-wide context manager:** "**The registries are process-wide.** A process can host several sessions (a subagent gets its own runner), so a handler may be consulted for a denied write or delete from any session in the process" (`omp://extensions.md`, re: file fallbacks). `req.sessionId` vs `ctx.sessionManager.getSessionId()` is the documented discriminator.

**Distribution.** MIT, published to npm as `@oh-my-pi/pi-coding-agent` (latest 18.1.21), source at github.com/can1357/oh-my-pi; "omp is a fork of pi-mono by Mario Zechner." Forking is legally and practically available. [web sources: npmjs.com/package/@oh-my-pi/pi-coding-agent, github.com/can1357/oh-my-pi]

# SDK and RPC

## SDK (in-process, Bun) — full control

`omp://sdk.md`: "The SDK is the in-process integration surface… Use it when you want direct access to agent state, event streaming, tool wiring, and session control from a Bun process." Requires Bun ≥ 1.3.14.

Entry: `createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>`, returning `{ session: AgentSession, extensionsResult, setToolUIContext, mcpManager?, modelFallbackMessage?, lspServers?, eventBus }`.

- **Send prompts:** `session.prompt(text, options?)`, `sendUserMessage(content, { deliverAs?, attribution? })`, `steer(text, images?, { attribution? })`, `followUp(text, images?, { synthetic?, attribution? })`, `sendCustomMessage({ customType, content, ... }, { deliverAs?, triggerTurn? })`, `abort()`.
- **Read transcript:** `session.subscribe(listener)` → `AgentSessionEvent` stream; `SessionManager` (`create`, `inMemory`, `continueRecent`, `list`, `open`); `session.sessionFile`. `agent_end` carries `messages` and `isTerminal?` — "Subscribers that use `agent_end` as a completion signal MUST wait for `isTerminal !== false`."
- **Mutate session state:** `getActiveToolNames()`, `getAllToolNames()`, `setActiveToolsByName(names)`, `refreshMCPTools(mcpTools)` — "System prompt is rebuilt to reflect active tool changes."
- **Fork/branch:** `SessionManager` "Supports resume/open/list/fork workflows." Branch/tree control is on `ExtensionCommandContext` (`branch(entryId)`, `navigateTree`). No `AgentSession.branch()` method is named in `omp://sdk.md`.
- **Own the message array:** no `createAgentSession` option or `AgentSession` method in `omp://sdk.md` supplies the per-turn messages. The route is still the `context` event, via `extensions: ExtensionFactory[]` (inline factories) or `additionalExtensionPaths`.
- **Isolation options:** `SessionManager.inMemory()` ("No filesystem persistence"), `Settings.isolated({...})`, `toolNames` + `restrictToolNames: true`, `enableMCP: false`, `disableExtensionDiscovery`, private `AgentRegistry` per session ("The default process-global registry admits only one `\"Main\"` identity per generation").
- **Subagent options:** `outputSchema`, `outputSchemaMode`, `requireYieldTool`, `taskDepth`, `parentTaskPrefix`.
- **Teardown:** `session.beginDispose()` then `await session.dispose()`.

## RPC (cross-process, stdio JSONL) — prompt/event granularity only

`omp --mode rpc`. "stdin: commands (`RpcCommand`)… stdout: a ready frame, command responses (`RpcResponse`), session/agent events, extension UI requests, host-tool requests/cancellations" (`omp://rpc.md`). Protocol v1 with opt-in v2 (`negotiate_protocol`) for lossless `rpc_chunk` reassembly; v1 frame cap 1 MiB, v2 reassembly cap 64 MiB.

**Can:** `prompt` / `steer` / `follow_up` / `abort` / `abort_and_prompt` / `new_session`; `get_messages`, `get_messages_page` (paged, ≤256 messages, cursor bound to session ID + durable leaf + message count, error codes `session_busy` / `stale_cursor`), `get_branch_messages`, `get_last_assistant_text`, `get_state` (includes `systemPrompt`, `dumpTools`, `contextUsage`, `messageCount`); `switch_session`, `branch(entryId)`, `set_session_name`, `handoff`, `compact`, `set_auto_compaction`; `set_model`, `cycle_model`, `set_thinking_level`, `set_fast_mode`; `set_steering_mode` / `set_follow_up_mode` / `set_interrupt_mode`; `set_todos`; `set_host_tools` (host-owned tools served back over stdio via `host_tool_call`/`host_tool_result`); `set_host_uri_schemes` (host-owned URL schemes via `host_uri_request`/`host_uri_result`); `set_subagent_subscription`, `get_subagents`, `get_subagent_messages(fromByte)`; `export_html`, `get_session_stats`, `bash`, login commands.

**Cannot:** there is no command to clear the conversation, replace the message array, inject a message at an arbitrary position, or intercept the provider request. `set_todos` is the only state-replacement command ("Replaces the in-memory todo state"). `set_host_uri_schemes` has a hard reservation: "`security://` is reserved… RPC hosts cannot register or shadow that scheme."

**Ordering caveat:** "`prompt` and `abort_and_prompt` are **acknowledged immediately**… command acceptance != run completion"; "Ordering across concurrent commands is not guaranteed — clients MUST match responses on `id`, not on emission order."

**Clients:** TypeScript `RpcClient` (`packages/coding-agent/src/modes/rpc/rpc-client.ts`, "a convenience wrapper, not the protocol definition") and Python `omp-rpc` (import package `omp_rpc`).

**Assessment for the context manager:** RPC is sufficient to *drive* omp headlessly and to *read* the transcript, but insufficient to *own* the per-turn message array. That capability exists only in-process, through the extension/hook event bus — reachable from RPC mode too, since extensions load in RPC mode (`ctx.ui` is "backed by RPC `extension_ui_request` events").

# System prompt

Four layers, per `omp://system-prompt-customization.md`.

| Surface | Scope | Replace or append |
|---|---|---|
| `--append-system-prompt <text-or-file>` | CLI, highest append precedence | append to rendered prompt |
| `APPEND_SYSTEM.md` | project then user; bases ordered `.omp`, `.claude`, `.codex`, `.gemini` | append |
| `--system-prompt <text-or-file>` | CLI, highest precedence | swaps the template |
| `SYSTEM.md` | project then user, same base order | swaps the template |
| `PERSONALITY.md` | user agent directory only — "there is no project-level or other-config-base lookup" | replaces the personality preset text |
| `TITLE_SYSTEM.md` | project then user | replaces the title-generation prompt only |
| SDK `CreateAgentSessionOptions.systemPrompt` | SDK only | **full provider-facing replacement** |
| `before_agent_start` handler return | per turn, per extension | **complete system-prompt override** |

**What `SYSTEM.md` does NOT replace:**

> `SYSTEM.md` does not become a raw, sole system message. The CLI stores it as `CreateAgentSessionOptions.customSystemPrompt`, and `buildSystemPrompt` renders `custom-system-prompt.md` instead of the default `system-prompt.md`.

It retains: custom + append text, discovered context files, discovered skills, always-apply rules and the rulebook listing, secret-redaction guidance, plus "The separate project/environment footer… workstation data, deeper-directory context pointers, optional workspace information, and the final completion requirements." What is lost is "the content unique to the default instruction template: its built-in role/personality text, tool inventory and general tool policy, internal-URL catalog, exploration/delegation/workflow rules, and `xd://` protocol guidance." Selective inheritance is explicitly unsupported: "If a custom prompt still needs the default tool policy or workflow, copy and maintain the required guidance yourself."

**Full replacement is SDK-only:**

> `CreateAgentSessionOptions.systemPrompt` is a different, lower-level API. A string or array replaces the fully rendered default blocks; a callback receives the rendered block array and returns its replacement. This can omit all generated context and safety blocks.
>
> The CLI flags and files do **not** set this property.

**Per-turn replacement via extension** — relevant to a per-turn assembler (`omp://extensions.md`, `before_agent_start`):

> Handlers chain from the current base system prompt. Their final override governs the next provider request and its continuations until another prompt or user-containing batch prepares policy. Overrides remain complete replacements, including strings or arrays unrelated to the base; the host never infers or rebases text patches.

Retry semantics matter here: "If a returned override's source base changes during preparation (for example, a handler awaits `ctx.setActiveTools()`), the host discards that attempt's returned custom messages and staged memory, then repeats policy preparation from the winning base. At most three attempts run per delivery… Handlers must tolerate re-entry."

**Templating:** "`SYSTEM.md`, `APPEND_SYSTEM.md`, `--system-prompt`, and `--append-system-prompt` are plain text… their contents are not recursively compiled as Handlebars." `{{cwd}}` reaches the model literally.

**Discovery:** "Discovery does **not** walk ancestors. Starting OMP in `<repo>/packages/api` does not discover `<repo>/.omp/SYSTEM.md`."

**Read access:** `ctx.getSystemPrompt()` (`omp://extensions.md`); RPC `get_state` returns `"systemPrompt": ["..."]` as an array (`omp://rpc.md`).

**Note for per-request budgeting:** "The current date and working directory no longer live in the footer: they are emitted as a `<system-reminder>` block on the first user turn of each provider request (`date-cwd-reminder.md`)." A `context` handler that replaces the message array must account for host-injected first-turn reminders.

# Not documented

These are absent from the doc set; do not assume either way.

1. **`before_provider_request` handler signature.** The event has exactly one sentence across all 131 docs (`omp://extensions.md` line 304). The payload type name, the return shape, whether the replacement is partial or total, and whether it fires on retries/continuations are all unspecified. `after_provider_response` has no description at all.
2. **The `Message` type accepted by `context`.** `omp://hooks.md` types it `Message[]` but the type is not defined in the docs. `omp://extensions.md` documents the *persisted* `entry.message.role` vocabulary (`user`, `developer`, `assistant`, `toolResult`, `bashExecution`, `pythonExecution`, `hookMessage`, `fileMention`, plus reconstructed `branchSummary`/`compactionSummary`/`custom`) but does not state that `context`'s `event.messages` uses that same discriminant set, nor whether `convertToLlm()` runs before or after the `context` hook.
3. **Validation of a `context` return.** No doc states whether the host validates the returned array (tool-call/tool-result pairing, first-message role, alternation). `omp://provider-quirks.md` shows providers repairing orphan tool results ("Omp folds orphan tool results into synthetic assistant note messages"), but whether that protects a hook-supplied array is not stated.
4. **`input` event contract.** Listed in the `ExtensionAPI` event surface with no payload or return type. `omp://extensions.md` references "Input hooks, commands, templates, and original attachment preprocessing are not rerun" and "the already-transformed text", implying input handlers can transform prompt text — but the return shape is never given.
5. **Ordering of `context` handlers relative to compaction, magic-keyword injection, memory recall, and `<system-reminder>` insertion.** Only intra-`context` chaining order is documented.
6. **`session_stop` payload fields.** `stop_hook_active` and `turn_id` appear only in an example (`omp://skills/authoring-extensions.md`); the full event type is not documented.
7. **Whether the TUI display transcript can be cleared or re-rendered programmatically.** `ctx.ui` has `setEditorText`, `setWidget`, `setStatus`, `custom`, `setEditorComponent` — nothing that clears or rewrites rendered conversation history. `setFooter` and `setHeader` are documented as "Current no-op methods."
8. **Any per-turn context-pack or assembler extension point by name.** The nearest documented constructs are `context_notes` + `new_context` under `compaction.experimentalContextManagement` and `history://current/full`, which are model-facing tools, not an external assembler API.
9. **Cross-process extension coordination.** Registries are documented as process-wide; nothing describes sharing state across concurrently running `omp` processes (relevant to a machine-wide global Doc Store).
10. **`AgentSession.branch()` / fork as a direct SDK method.** `omp://sdk.md` says `SessionManager` "Supports resume/open/list/fork workflows" and RPC exposes `branch`, but no `AgentSession`-level branch/fork method is named in the SDK doc.
