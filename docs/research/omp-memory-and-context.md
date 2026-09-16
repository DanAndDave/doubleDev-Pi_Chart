## Mnemosyne

**Naming.** The doc file is `omp://mnemosyne-memory-backend.md` but every identifier inside it is **Mnemopi**: title `# Mnemopi memory backend`, config value `memory.backend: mnemopi`, package `@oh-my-pi/pi-mnemopi`, settings namespace `mnemopi.*`, env prefix `MNEMOPI_*`. "Mnemosyne" appears only in the filename. Treat `mnemopi` as the real identifier.

**What it is.** One of five values of `memory.backend` (`omp://memory.md`): `off` (default), `local`, `hindsight`, `mnemopi`, `sharpshooter`. Mnemopi is the *local* long-term memory engine.

### Storage engine

- **SQLite**, not Postgres. `omp://mnemosyne-memory-backend.md`: "Opens one or more local Mnemopi SQLite databases according to the configured bank scoping."
- **Multiple databases, one per bank.** "Project-local banks other than the shared bank are stored as sibling bank databases managed by Mnemopi's `BankManager`."
- **Vectors + FTS.** Embeddings are on by default; `mnemopi.noEmbeddings: false` default, and setting it true "Pass `noEmbeddings` to `Mnemopi` and force FTS-only recall."
- **Embedding models** (`mnemopi.embeddingVariant`, default `en`): "`en` = `BAAI/bge-base-en-v1.5` (768d), `multilingual` = `intfloat/multilingual-e5-large` (1024d). `mnemopi.embeddingModel`/`MNEMOPI_EMBEDDING_MODEL` override it; changing it rebuilds stored embeddings on the next writable start." Remote OpenAI-compatible embeddings supported via `mnemopi.embeddingApiUrl` / `mnemopi.embeddingApiKey`.
- **LLM for extraction/consolidation** (`mnemopi.llmMode`, default `smol`): "`smol` resolves the configured pi-ai `tiny` role then `smol`; `remote` uses the settings below; `none` disables LLM calls."

### Schema / entities

Not given as DDL, but the entity model is explicit:

- **Stores**: `working`, `episodic`, `fact`. From `omp://tools/memory_edit.md`: `details` is `{ status, bank?, store? }` "where … store is `"working" | "episodic" | "fact"`". Fact rows are immutable: "Fact-table rows are read-only" (`omp://mnemosyne-memory-backend.md`).
- **Row fields** exposed by `read memory://<memory-id>` as YAML frontmatter: "(`id`, `bank`, `store`, `memory_type`, timestamps, `importance`, `veracity`, `session_id`, `metadata`)".
- **Indexed text columns**: "working-memory FTS indexing (`COALESCE(embed_text, content)`)" — so rows carry `content` plus an optional `embed_text` projection.
- **Banks** are the top-level partition, managed by `BankManager`.
- **Graph**: an episodic graph exists. `mnemopi.proactiveLinking` (default `false`): "Ingest new memories into the episodic graph and link them to related entities/memories as they are stored".

### What gets written, and when

Both automatic and tool-driven.

Automatic (`omp://mnemosyne-memory-backend.md`):
1. "Recalls relevant memories into a `<memories>` block for the first model turn of a session" — gated by `mnemopi.autoRecall` (default `true`).
2. "Retains completed conversation turns into the retain bank after agent turns, no more often than `mnemopi.retainEveryNTurns`" (default `4`), gated by `mnemopi.autoRetain` (default `true`).
3. Auto-retain row shape (`omp://tools/retain.md`): "Mnemopi auto-retain stores prepared transcripts with `source: "coding-agent-transcript"`, `importance: 0.65`, `veracity: "unknown"`, and `memoryType: "episode"`."

Tool-driven `retain` (`omp://tools/retain.md`): `rememberScoped(...)` with "`source: "coding-agent-retain"`, `importance: 0.75`, `scope: "bank"`, `extract: true`, `extractEntities: true`, `veracity: "tool"`, `memoryType: "fact"`, and metadata `{ session_id, cwd, context, tool: "retain" }`".

Consolidation/promotion ("sleep"): `/memory enqueue` "forces retention of the current session, flushes pending fact extractions, and runs Mnemopi sleep/consolidation for eligible working-memory rows". Age gate: "`sleepAllSessions` selects unconsolidated working-memory rows older than `Math.floor(workingMemoryTtlHours / 2)` hours (12 hours with the default 24-hour TTL). Fresh rows therefore remain in working memory after an immediate enqueue."

Shutdown durability is deliberately weak: "Interactive and print exits give this drain 1.5 seconds. If the budget expires, shutdown detaches the in-flight drain… Working-memory rows already written remain durable, but promotion or embedding for the last few turns can remain incomplete".

### Retrieval mechanism

Hybrid, with an opt-in 4-channel fusion mode:

- Default: vector + FTS. `mnemopi.noEmbeddings: true` degrades to FTS-only.
- `mnemopi.polyphonicRecall` (default `false`): "Enable 4-voice polyphonic recall (vector, graph, fact, temporal) with reciprocal rank fusion".
- `mnemopi.enhancedRecall` (default `false`): "Enable the tiered query result cache for repeated/similar recall queries".
- Call shape (`omp://tools/recall.md`): "scoped recall queries every resolved recall bank with `recallEnhanced(query, recallLimit, { includeFacts: true, channelId: bank })`, merges/deduplicates results by id/content, sorts them, and truncates to `recallLimit`".
- Results are **previews**: "Recall results carry clipped content previews, not full rows… The cap is `RecallOptions.contentPreviewChars` (default `500`; `0` disables clipping)", with `truncated: true` and `full_length` on the internal row (not surfaced by the tool — `details = {}`).

### Scope

`mnemopi.scoping`, default `per-project`:
- `global` — "one shared bank for recall and writes".
- `per-project` — "writes to and recalls from a bank derived from the current working directory alone — its basename plus a stable hash of its absolute path, independent of the surrounding git layout".
- `per-project-tagged` — "writes to the project-local bank and recalls from both the project-local bank and the shared global bank, with duplicate recall results merged".

Session scope: recall "reads cross-session memory data" (`omp://tools/recall.md`) — i.e. memory is cross-session *within a bank*, but there is no conversation-id-scoped store and no explicit cross-conversation query API. Subagents: "Subagents do not own separate Mnemopi retain loops; they alias the parent state when a parent Mnemopi state exists, and otherwise remain inert."

### On-disk location

"The default shared database lives under the agent memories directory in `mnemopi/mnemopi.db`; project-scoped banks use sibling database paths under that Mnemopi directory." Overridable by `mnemopi.dbPath` ("Optional SQLite database path", default "agent memories dir"). Agent dir default is `~/.omp/agent` (`omp://tools/learn.md`: "the default agent directory is `~/.omp/agent`"), so the effective path is `~/.omp/agent/memories/mnemopi/mnemopi.db` — the `memories/` segment is stated as "the agent memories directory" but the exact concatenation is not spelled out verbatim. `/memory clear` "removes every scoped Mnemopi SQLite database and sidecar WAL/SHM files for the active configuration" (WAL mode confirmed by the sidecar mention).

### Failure mode

"Backend startup is best-effort. If database/model initialization fails, the session continues with Mnemopi inert and logs a warning; memory tools then report that the backend is not initialized."

### The other backends, for contrast

- `local` (`omp://memory.md`) — no database. A two-phase background pipeline at startup: "**Phase 1 — per-session extraction**" over persisted session files, "**Phase 2 — consolidation**" writing `MEMORY.md`, `memory_summary.md`, `skills/`. Job queue is "`packages/coding-agent/src/memories/storage.ts` — SQLite-backed job queue and thread registry". Lessons live in `<agent-dir>/memories/<encoded-cwd>/learned.md`.
- `hindsight` — remote HTTP server, default `http://localhost:8888`, `POST /v1/default/banks/{bank_id}/memories/recall`.
- `sharpshooter` — "Friction-gated project decision files (architecture/product/style), consolidated in the background". No dedicated doc.

## Memory tool family

| Tool | Backends | Trigger | What it does | Where data lands |
|---|---|---|---|---|
| `recall` | `hindsight`, `mnemopi` only (`omp://tools/recall.md`: "absent for `"off"` and `"local"`") | Model-elected (`loadMode = "discoverable"`, `approval = "read"`). Separate **automatic** path exists: `MnemopiSessionState.maybeRecallOnAgentStart(...)` on first turn | Query-only search of scoped banks. Bullets: `- <content> (id: <id>) [<source>] (<YYYY-MM-DD>) c:<score>`. Empty result sets `useless = true` | Nothing written. "None on success for the explicit tool path… does not update `lastRecallSnippet` or refresh the system prompt" |
| `retain` | `hindsight`, `mnemopi` | Model-elected. Automatic sibling: auto-retain every `mnemopi.retainEveryNTurns` (4) / `hindsight.retainEveryNTurns` (3) | Stores `items: Array<{content, context?}>`. Mnemopi = synchronous local write; Hindsight = queued batch | Mnemopi: scoped SQLite retain bank (`memoryType: "fact"`, `importance: 0.75`). Hindsight: server bank via `POST /v1/default/banks/{bank_id}/memories`. **Not a durability receipt** — "`rememberScoped(...)` catches each write failure and returns `undefined`; `retain` ignores that return and still reports the requested count" |
| `reflect` | `hindsight`, `mnemopi` | Model-elected | Hindsight: real server-side synthesis (`POST …/reflect`). Mnemopi: **no synthesis** — "local recall plus formatting. It does not implement the synthesis promised by the generic model-facing `reflect` prompt" | Nothing persisted |
| `memory_edit` | `mnemopi` **only** ("absent for `"off"`, `"local"`, and `"hindsight"`") | Model-elected | `op: "update" \| "forget" \| "invalidate"` by `id`. `update` is wholesale content replacement; `forget` hard-deletes working rows; `invalidate` soft-supersedes working/episodic and records `replacement_id`. Fact rows → `not_editable` | Mutates the scoped SQLite DB. "it does not rewrite already injected `<memories>` context" |
| `learn` | `hindsight`, `mnemopi`, `local` — and requires `autolearn.enabled = true` (default `false`) | Model-elected, `loadMode = "essential"`. "Subagents do not discover or auto-receive it" | Stores one durable lesson; optional `skill: {action, name, description, body}` writes a managed `SKILL.md` | Mnemopi: SQLite (`source: "coding-agent-learn"`, `importance: 0.8`, `memoryType: "fact"`). Local: `<agent-dir>/memories/<encoded-cwd>/learned.md`. Hindsight: retain queue. Skills: `<agent-dir>/managed-skills/<sanitized-name>/SKILL.md` |
| `manage_skill` | any (requires `autolearn.enabled`) | Model-elected, `approval = "write"` | `create`/`update`/`delete` a managed skill; calls `refreshSkills` so the active session sees it immediately (unlike `learn`) | `<agent-dir>/managed-skills/<name>/SKILL.md`, capped 64,000 UTF-8 bytes |

All five memory tools declare `approval = "read"` even when they write — `omp://tools/retain.md`: "`approval = "read"`… even though successful calls enqueue or perform memory writes."

Read-back path: `read memory://<memory-id>` returns the full row with YAML frontmatter; "The coding-agent's model-facing prompts require this read before any `memory_edit update`, since `update` replaces content wholesale and would otherwise discard the unseen tail of a clipped preview."

## Context clearing and rebuild primitives

omp has **five** distinct context-mutating operations. Three of them genuinely replace the live model message array.

### `new_context` (experimental) — closest thing to per-turn replacement

Gated: "Requires `compaction.experimentalContextManagement = true`" (default `false`), plus all four of `context_notes`, `new_context`, `read`, `grep` active (`omp://tools/new-context.md`).

Input is `{}`. Output is `New context window requested.` It is a *request*: "The tool itself does not commit a compaction boundary or synchronously reset the conversation." The owning agent "processes the request through its maintenance lifecycle before the next provider request."

What survives (`omp://compaction.md`): "`new_context` requests rollover at the next safe tool-loop boundary. Rollover retains complete recent tool-call/result units and the notebook **without calling a summarization model**." And (`omp://tools/new-context.md`): "It rebuilds active context with the latest notebook and retained recent messages, leaving original journal entries available through `history://current/full`."

This is a **deterministic, model-free context rebuild already in-harness.** It is not per-turn (it is model-elected or threshold-driven), and it does not let an external component choose what goes in — the notebook is the only steerable payload.

### `context_notes` (experimental)

"Read or replace the current branch's persistent experimental context notebook." `text` omitted → read; `text: ""` → clear; otherwise wholesale replace. Cap **16,384 UTF-8 bytes**; "Oversized writes fail before appending." Persisted as an `experimental_context_notes` custom entry with `{ version: 1, text }`.

"Only the latest visible revision is injected into model context, including after resume or fork. A context reset clears the visible notebook" (`omp://compaction.md`).

### `/clear` — the real context reset

`omp://session-operations-export-share-fork-resume.md`, `AgentSession.resetSessionContext()`:
- "Drops live messages, queued steer/follow-up turns, pending tool calls, error state, checkpoint/rewind and deferred tool state, and session-stop continuation state."
- "Rotates provider-side session state, re-primes advisors, invalidates append-only model context, and resets memory promotion so the next turn rebuilds from the base system prompt and current project instructions."
- **Survives**: "Retains the session id, title, cwd, model, settings, active plan path, and transcript file."
- "Appends a durable `reset_boundary`. The collapsed live transcript and rebuilt model context begin after the latest boundary, while the JSONL transcript and full-transcript export retain the pre-reset history on disk."
- Sticky rules are re-read: "It is re-discovered from disk when a session starts and on session-scoped rebuilds such as `/clear` and `/new`" (`omp://context-files.md`).

This is TUI-only and "rejected while a response is streaming".

### `checkpoint` / `rewind`

Gated by `checkpoint.enabled` (default `false`).

`checkpoint` writes nothing durable of its own: it captures three in-memory fields — `checkpointMessageCount`, `checkpointEntryId` (`sessionManager.getEntries().at(-1)?.id ?? null`), `startedAt`. "Despite the summary string `Create a git-based checkpoint to save and restore session state`, the implementation does not call git and does not snapshot filesystem state" (`omp://tools/checkpoint.md`).

`rewind` **does** replace the working context, deferred to `turn_end` (`omp://tools/rewind.md`):
- `branchWithSummary(checkpointEntryId, report, …)` records a `branch_summary` at the checkpoint point.
- Appends a hidden persisted `rewind-report` custom message.
- "it rebuilds the display/LLM session context from the new active branch, and replaces both the turn's active message array and `agent.state.messages`. The exploratory branch and successful rewind tool result are therefore absent from the next provider call."

Survives: the branch summary, the retained report, and everything before `checkpointEntryId`. Not restored: "filesystem or git state… artifacts… blob-store payloads… prompt history rows… auth or other agent storage". Non-destructive on disk: "abandoned entries remain in the `.jsonl` log but leave the active branch."

### `/fresh` vs `/new` vs `/delete`

`/fresh` resets **provider-side** state only: "Mints a fresh provider session id and re-keys hindsight and mnemopi memory to it, and invalidates the append-only context so the next turn re-sends the full local transcript to the provider… Leaves the local transcript, session file, and session identity unchanged." `/new` starts an empty conversation with a new identity/transcript path. `/delete` best-effort deletes then starts new.

### TTSR mid-stream truncation

`omp://ttsr-injection-lifecycle.md`: with `contextMode: "discard"` (the default), a triggered rule "drops the targeted partial assistant output with `agent.replaceMessages(...slice(0, targetAssistantIndex))`" then `agent.continue()`. So `replaceMessages` is a real internal primitive — but it is not exposed through the extension or hook API.

**Bottom line for the four-store design:** per-*turn* context replacement does **not** exist as a user-facing feature. But `new_context`, `rewind`, and TTSR all prove the underlying machinery (rebuild from journal + swap `agent.state.messages`) exists and is exercised. And the `context` hook (see Overlap) already hands an external component the full message array per LLM call.

## Compaction

### Triggers (six, `omp://compaction.md`)

1. Manual `/compact [instructions]`.
2. Overflow recovery — "after a same-model assistant error that matches context overflow".
3. Incomplete-output recovery — `stopReason === "length"`.
4. Threshold maintenance — after a successful turn exceeding `resolveThresholdTokens(...)`.
5. Mid-turn threshold maintenance — "before the next provider request when a tool-loop turn crosses the threshold and `compaction.midTurnEnabled !== false`".
6. Idle — `runIdleCompaction()`.

Defaults: `compaction.enabled = true`, `compaction.keepRecentTokens = 20000`, `compaction.thresholdPercent = -1` / `thresholdTokens = -1` (reserve-based threshold), `compaction.methodOrder = ["remote", "snapcompact", "handoff", "shake", "soft"]`, `compaction.asyncEnabled = true`, `compaction.idleEnabled = false`.

### Preserved vs summarized

Boundary is `firstKeptEntryId` on the `CompactionEntry`. "What the LLM sees: `system | summary | usr | ass | tool | tool | ass | tool`" — i.e. system prompt, one `compactionSummary` message, then every entry from `firstKeptEntryId` onward.

Hard rules: "never cut at `toolResult`". Valid cut points are message entries with roles `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`, plus `custom_message` and `branch_summary` entries.

Pre-compaction pruning (`pruneToolOutputs`) protects newest 40,000 tool-output tokens, requires ≥20,000 estimated savings, and "Never prune `skill` tool results, `read` results of `skill://` paths, or reads of the active plan reference file". Pruned results become `[Output truncated - N tokens]`; useless ones become `[Uneventful result elided]`.

Display is not reset: "Only the LLM context resets at the compaction boundary; the scrollback above the divider stays intact, including across session resume."

### Is summarization replaceable? Yes — three levels.

1. **Cancel or fully substitute** — `session_before_compact` "Can: cancel compaction (`{ cancel: true }`); provide full custom compaction payload (`{ compaction: CompactionResult }`)". An extension supplying the whole `CompactionResult` bypasses the summarizer entirely.
2. **Alter prompt and inputs** — `session.compacting` "Can return: `prompt` (override base summary prompt); `context` (extra context lines injected into `<additional-context>`); `preserveData` (stored on compaction entry)".
3. **Redirect to your own HTTP endpoint** — `compaction.remoteEndpoint`: "custom omp summarizer endpoints receive `{ systemPrompt, prompt }` and must return JSON containing at least `{ summary }`"; OpenAI-compatible paths ending `/chat/completions` also work.

Caveats: internal summarizer guidance is *not* hook-visible — "Internal summarizer guidance… travels a separate `internalGuidance` channel on `CompactOptions` that reaches only native summarization, never this hook or `session.compacting`". And speculative compaction is disabled when you hook it: "Speculation is skipped while an extension registers `session_before_compact`."

Model-free methods already exist: `shake` ("inline, local reduction instead of calling a summarization model" — replaces tool results with `artifact://` refs) and `snapcompact` ("replaces the LLM summarization call with a local, deterministic archival pass" rendering history to PNG bitmap frames; "No model, API key, or network is involved").

Post-event: `session_compact` with `compactionEntry` and `fromExtension`.

Memory feeds compaction: "recalled memory is also available as extra context during compaction" (`omp://memory.md`); Mnemopi "Adds recalled memory as extra compaction context when compaction asks the memory backend for `preCompactionContext`".

## Auto-loaded context and TTSR

### Which files load automatically

Context-file providers (`omp://context-files.md`), in priority order 100→1: `native` (`.omp/AGENTS.md`), `omp-plugins` (90), `claude` (`.claude/CLAUDE.md`, 80), `agent-plugins` (75), `agents`/`claude-plugins`/`codex` (70), `gemini` (60), `opencode` (55), `cursor`/`windsurf` (50), `cline` (40), `github` (`.github/copilot-instructions.md`, 30), `vscode` (20), `agents-md`/`claude-md` (10), `mcp-json`/`ssh-json` (5), `builtin-defaults` (1).

Dedup: "**One user context file** is kept across all providers… **One project context file per directory depth**… **At the same depth, the higher-priority provider shadows the rest**… **Across depths, multiple files survive.**"

Injection order: "**farther project ancestors first**, then project files closer to the cwd, then the surviving user-scope file. Later files sit nearer the end of the generated context and are more prominent." Rendered as one `<repo-rules>` block with one `<file path="…">` element each.

Native project discovery is single-directory: "**The nearest non-empty `.omp/` directory owns native project discovery**… A missing file does not make discovery continue upward."

`@path` imports expand inline, "Imports recurse up to five hops", cycles skipped, missing target left literal.

Not-loaded deeper files become pointers: "Deeper-directory `AGENTS.md` files that were _not_ auto-loaded… are surfaced separately in a `<dir-context>` block that lists their paths".

### Conditional / glob-scoped loading (rules)

Rules are a separate axis from context files. `omp://rulebook-matching-pipeline.md` canonical shape:

```ts
interface Rule { name; path; content; globs?; alwaysApply?; description?; condition?; astCondition?; scope?; agents?; interruptMode?; _source }
```

`bucketRules(...)` assigns each rule to exactly one of three buckets, in this order:
1. **TTSR** — "Register rules with a non-empty `condition` or `astCondition` into `TtsrManager`; if registration succeeds, the rule is TTSR-only."
2. **Always-apply** — `alwaysApply === true`. "**Full rule content is auto-injected into the system prompt**".
3. **Rulebook** — has `description`, not TTSR, not always-apply. "Listed in system prompt by name+description; content read on demand via `rule://`."

Crucially, **globs do not drive loading**: "`globs` metadata is surfaced to prompt/UI and is used as a global path gate for TTSR matching, but it is not used to automatically select rulebook rules for `rule://`." And: "This is advisory/contextual: prompt text asks the model to read applicable rules, but code does not enforce glob applicability."

`agents:` gives per-agent scoping, evaluated once at session creation: "Filtering happens once, in `bucketRules(...)` at session creation, before TTSR registration: an unmatched rule joins no bucket, is never compiled into `TtsrManager`, and is not addressable via `rule://` in that session."

Sticky `RULES.md` is the one thing carried on *every* request: "It is loaded as an **always-apply rule**, not as a context file, so its full body is carried on every request — never demoted to an on-demand rulebook entry" (`omp://context-files.md`).

Dedup is name-only: "precedence and deduplication are **name-based only**. Two different files with the same `name` are considered the same logical rule."

### TTSR = Time Traveling Stream Rules

`omp://ttsr-injection-lifecycle.md`. It is **not** per-turn re-injection; it is *mid-stream* interception.

Mechanism:
- On `turn_start`, `ttsrManager.resetBuffer()`.
- During `message_update`, monitors `text_delta`, `thinking_delta`, `toolcall_delta`. Regex via `checkDelta`/`checkSnapshot`; ast-grep via `checkAstSnapshot`. "With no explicit `scope`, a rule monitors assistant text and all tool arguments, but not thinking."
- On match with an interrupting rule: "The abort-pending flag is set and a TTSR resume gate is created. `agent.abort()` is called immediately." Retry scheduled at 50 ms.
- On retry: "if `contextMode === "discard"`, drops the targeted partial assistant output with `agent.replaceMessages(...slice(0, targetAssistantIndex))`", then injects `ttsr-interrupt.md` rendered as:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
{{content}}
</system-interrupt>
```

- Persists a hidden `custom_message` with `customType: "ttsr-injection"` plus a `ttsr_injection` entry, then `agent.continue()`.

Non-interrupting tool matches instead fold an in-band reminder into the tool result via `afterToolCall`:

```xml
<system-reminder reason="rule_violation" rule="{{name}}" path="{{path}}">
{{content}}
</system-reminder>
```

Repeat policy: `repeatMode` default `"once"`; `"after-gap"` re-triggers when "`messageCount - lastInjectedAt >= repeatGap`" (default `10`), and "`messageCount` increments on `turn_end`, so gap is measured in completed turns".

Manager defaults: `enabled: true`, `contextMode: "discard"`, `interruptMode: "always"`, `repeatMode: "once"`, `repeatGap: 10`, `builtinRules: true`, `disabledRules: []`.

### The genuinely per-request injection

One block is rebuilt on every provider request: "The current date and working directory no longer live in the footer: they are emitted as a `<system-reminder>` block on the first user turn of each provider request (`date-cwd-reminder.md`)" (`omp://system-prompt-customization.md`). Motivation is prompt-cache preservation — a direct precedent for how a per-turn context pack must be positioned to avoid destroying cache.

## Session persistence

### Format and location

`omp://session.md`. JSONL, one JSON object per line:

```
~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<sessionId>.jsonl
```

"`<encoded-cwd>` is derived from the canonicalized cwd (so symlink aliases share a bucket): `-<relative>` for directories under home, `-tmp-<relative>` for directories under the temp root, and `--<encoded-absolute>--` for anything else".

"Current files physically begin with a fixed-width, 256-byte `type: "title"` slot, followed by the session header and then `SessionEntry` values." Header is `type: "session"`, `version: 3` (`CURRENT_SESSION_VERSION`), with `id`, `timestamp`, `cwd`, `title`, `titleSource`, `additionalDirectories`, `previousSessionFiles`, `providerPromptCacheKey`, `parentSession`.

Entry union: `message`, `thinking_level_change`, `model_change`, `service_tier_change`, `compaction`, `branch_summary`, `reset_boundary`, `custom`, `custom_message`, `label`, `title_change`, `ttsr_injection`, `credential_pin`, `session_init`, `mode_change`.

Every non-header entry carries `{ id (8-char), parentId, timestamp }`. "The underlying model is append-only tree + mutable leaf pointer" — `branch(entryId)` moves only `leafId`; "Existing entries are not deleted in normal operation."

Role discriminants are **camelCase**: `user`, `developer`, `assistant`, `toolResult` ("**not** `tool_result`"), `bashExecution`, `pythonExecution`, `hookMessage`, `fileMention`. This is called out twice as an external-reader trap: "An extension keying off `message.role` that matches snake_case constants… will silently skip `toolResult`".

Sidecars:
- Blobs: `~/.omp/agent/blobs/<sha256>`. "Image data URLs in `image_url` fields are always content-addressed in the blob store and replaced with `blob:sha256:<hash>`"; other base64 image payloads externalize at 1,024 chars.
- Terminal breadcrumbs: `~/.omp/agent/terminal-sessions/<terminal-id>`.
- Subagent transcripts: `<session>/<AgentId>.jsonl` (`omp://session-operations-export-share-fork-resume.md`).
- Prompt history (separate subsystem): `~/.omp/agent/history.db`, "Table: `history(id, prompt, created_at, cwd, session_id)`", "FTS5 index: `history_fts`".

Truncation: "Strings over 500,000 characters are truncated with `"[Session persistence truncated large content]"`" (`MAX_PERSIST_CHARS = 500_000`).

### Readable/writable by an external process?

**Readable: yes, trivially.** Plain JSONL at a documented path; `SessionManager.open(path)` / `listAll()` are exported SDK APIs (`omp://sdk.md`). `omp://memory.md` confirms the local memory pipeline itself is an external reader: "a model reads the session history and extracts durable signal" from persisted session files. The `--export <session.jsonl>` CLI path also reads a file with no running session.

**Writable: not safely while omp runs.** Constraints:
- "Completed entries update memory and are handed to file/memory storage synchronously in the append call once the lazy file-creation gate has been crossed. There is no `fsync`, so the guarantee covers software crashes, not power loss."
- "A new ordinary session remains memory-only until it contains an assistant message or a caller invokes `ensureOnDisk()`" — so a live session may have no file at all.
- "Concurrent completed appends supersede an in-flight atomic rewrite with an authoritative full-body rewrite so stale publication cannot clobber them." The in-process `SessionManager` holds authoritative in-memory `#entries` and rewrites the whole file on migration/rename/move — an external write would be clobbered.
- Blob refs must be resolved: "On load, persisted blob references are resolved back to the inline payload shapes expected by downstream transports."

The supported write path for an external component is in-process: `pi.appendEntry("com.example.my-extension.state", data)` with a reverse-domain `customType`, reconstructed on `session_start` by scanning `ctx.sessionManager.getBranch()` (`omp://extensions.md`).

## Overlap with a four-store context manager

### Store 1 — OKF markdown Doc Store, global/machine-wide

**Partially present, wrong shape.** omp has a global doc surface: `~/.omp/agent/AGENTS.md`, `~/.omp/agent/RULES.md`, `~/.omp/agent/rules/*.md`, `~/.omp/agent/managed-skills/<name>/SKILL.md`, and (with `memory.backend: local`) `MEMORY.md` / `memory_summary.md` / `learned.md` / `skills/` under `<agent-dir>/memories/<encoded-cwd>/`. There is a live protocol handler (`memory://`, `rule://`, `skill://`) and an agent-writable path (`manage_skill`, which calls `refreshSkills` so the change lands in the active session).

What's missing: retrieval is by *name* (`rule://<name>` exact match) or by whole-file injection. There is no structured-fragment addressing, no frontmatter-driven selection beyond the three-bucket split, and glob scoping is explicitly non-enforcing ("code does not enforce glob applicability"). The local-backend docs are also **per-project** (`<encoded-cwd>`), not machine-wide.

### Store 2 — OpenSpec in the target repo

**Absent.** No mention of OpenSpec in any of the 131 docs read. The nearest adjacency is plan mode (`mode_change` entry with `data: { planFile }`) and plan-file protection in pruning ("reads of the active plan reference file"). Verify/init would be entirely new.

### Store 3 — Postgres+pgvector Thread Store, per-conversation, cross-conversation query

**Half present, different engine, missing the query surface.**

Present: the thread store *is* the JSONL journal — chat history, tool calls, tool results, and artifacts all persisted with stable ids and a tree structure. Artifacts and blobs are content-addressed. `IndexedSessionStorage` exists as "shared local index plus ordered remote publication used by Redis/SQL-backed storage" — so a SQL backend for sessions is an anticipated shape, though Postgres/pgvector specifically is not documented.

Vectors exist but over the wrong thing: Mnemopi embeds *memories*, not the raw transcript. There is one bridge — auto-retain writes "prepared transcripts" as `memoryType: "episode"` rows — so a coarse vectorized transcript store already exists, at `retainEveryNTurns` granularity.

Missing: explicit cross-conversation query. `recall` takes `query` and nothing else — no session filter, no scope parameter, no "search other conversations" flag. Banks are the only partition, and they are project- or global-keyed, never conversation-keyed. `history://current/full` is bound tighter still: "The full-history route is bound to the calling session's current branch. It **never** falls back to another registered agent or an on-disk session search."

### Store 4 — graphify code graph, code-only edges

**Absent.** No `graphify`, no `graph.json`, no code-graph concept in any doc read. Structural code understanding exists as *queries*, not a store: LSP (13 operations), `ast-grep`, `ast-edit`, `astMatch` with Smart strictness inside TTSR. Mnemopi has "the episodic graph" but that links memories and entities, not code symbols.

### The assembler — the actual decision point

The premise that per-turn assembly requires owning the agent loop is **too pessimistic for omp specifically.** Two documented seams hand an external component the model context:

1. **`context` hook** — `omp://hooks.md`, under "Agent/context events": "`context` → can return `{ messages?: Message[] }`", with the worked example titled "Modify model context per LLM call". The handler receives `event.messages` and returns a replacement array. Nothing in the doc restricts it to filtering; the example filters, but the return type is the full array.
2. **`before_provider_request`** — `omp://extensions.md`: "`before_provider_request` (may replace provider request payload — the replacement is applied by every provider that fires the hook, which is all of them except `devin-agent`, which does not fire it)".

Plus, for a full embed: `CreateAgentSessionOptions.systemPrompt` — "A string or array replaces the fully rendered default blocks; a callback receives the rendered block array and returns its replacement. This can omit all generated context and safety blocks" (`omp://system-prompt-customization.md`).

So: **a context manager can replace the entire per-turn model input from a hook, keeping the TUI, with no fork.** What it cannot do from a hook is prevent the journal from growing — but it doesn't need to: `buildSessionContext` output is exactly the input to the `context` hook, and the journal remains the durable record the assembler queries.

What omp already does that the design assumed it would have to build:
- Deterministic, model-free context rebuild from a journal (`new_context` + `history://current/full`).
- A steerable per-branch scratchpad that survives rollover/resume/fork (`context_notes`).
- Per-request injection positioned to preserve prompt cache (`date-cwd-reminder.md`).
- Full model-context replacement per LLM call (`context` hook).
- Local SQLite vector+FTS memory with per-project/global scoping, importance, veracity, and an edit API.
- Append-only branchable transcript with stable entry ids, blob externalization, and export/share.

What omp does not do and the manager must supply:
- Code graph of any kind.
- OpenSpec.
- Postgres/pgvector (SQLite only; `IndexedSessionStorage` hints at a SQL session backend but Postgres is not documented).
- Explicit cross-conversation retrieval.
- Machine-wide (as opposed to per-project) markdown doc store with fragment addressing.
- Any notion of "clear the window every prompt" as a policy — every clearing primitive (`/clear`, `new_context`, `rewind`) is event- or threshold-driven, never per-turn.

**Fork assessment:** not required for the assembler. The `context` hook plus `before_provider_request` plus `CreateAgentSessionOptions.systemPrompt` cover per-turn replacement. A fork would only be needed to change *when* the window resets (making rollover unconditional rather than threshold-driven) or to remove the growing journal from the provider path entirely — and `context` returning a fresh array already achieves the latter's observable effect. Note two friction points: `compaction.experimentalContextManagement` requires `restart after enabling to refresh available tools`, and registering `session_before_compact` disables speculative compaction.

Distribution is public: MIT-licensed, `github.com/can1357/oh-my-pi`, npm `@oh-my-pi/pi-coding-agent` with `omp` as the binary — so forking is legally and practically available, and the SDK (`bun add @oh-my-pi/pi-coding-agent`, requires Bun ≥1.3.14) is a supported embedding surface either way.

## Not documented

- **"Mnemosyne"** as a product name. Only the doc *filename* uses it; all identifiers are `mnemopi`.
- **Mnemopi SQL schema.** Table names, column types, indexes, and the vector index implementation (sqlite-vec? custom?) are never stated. Only field names visible through `memory://<id>` frontmatter and `COALESCE(embed_text, content)`.
- **Exact default Mnemopi DB path.** Stated as "the agent memories directory in `mnemopi/mnemopi.db`"; the literal absolute path is never written out.
- **`workingMemoryTtlHours` as a configurable setting.** Referenced in the sleep age-gate formula with a "default 24-hour TTL" but absent from the `mnemopi.*` settings table.
- **`sharpshooter` backend.** Listed in the `memory.backend` table with a one-line description and an em-dash for its guide. No dedicated doc.
- **Polyphonic recall internals.** RRF constant `k`, per-voice weights, and how the graph/temporal voices are scored.
- **`experimental_context_notes` entry type in the session taxonomy.** `omp://tools/context-notes.md` says writes append "an `experimental_context_notes` custom entry with `{ version: 1, text }`", but `omp://session.md`'s `custom` `customType` table does not list it.
- **Whether the `context` hook's returned `messages` are persisted or transient.** `omp://hooks.md` shows only the filtering example; it does not say whether a wholesale replacement affects the journal, the display transcript, or only the wire payload. This is the single most load-bearing unanswered question for the design.
- **Hook ordering between `context` and `before_provider_request`**, and whether both fire for compaction/summarization side-requests.
- **Whether `agent.replaceMessages(...)` is reachable from the extension/SDK API.** It appears only in the TTSR internals doc.
- **Any Postgres or pgvector support.** `IndexedSessionStorage` is described as "used by Redis/SQL-backed storage" with no further detail, no config keys, and no schema.
- **Cross-conversation / cross-session recall parameters.** No documented way to scope `recall` to a session id or to query another conversation's transcript.
- **Code graph, graphify, OpenSpec.** Zero occurrences across the docs read.
