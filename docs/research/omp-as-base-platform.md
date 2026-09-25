# omp as a base: viability assessment

## What pi is

**"PI" is `pi-mono`, an upstream monorepo by Mario Zechner. `omp` (Oh My Pi) is a hard fork of it.** There is no separate product called "PI" that omp sits on top of — omp *is* the descendant.

Hard evidence, in-repo:

- `omp://porting-from-pi-mono.md` is titled *"Porting From pi-mono: A Practical Merge Guide"* and opens: *"This guide is a repeatable checklist for porting changes from pi-mono into this repo."* It records a **"Last Sync Point (historical upstream marker)" — `Commit: b21b42d032919de2f2e6920a76fa9a37c3920c0a`, `Date: 2026-03-22`**, and notes the commit *"is an upstream pi-mono marker and may not exist in this repo's local object database."* That is a fork relationship with periodic backports, not a dependency.
- The same doc, §3 *"Replace import scopes"*: *"Upstream uses different package scopes."* with the mapping table `@mariozechner/pi-coding-agent → @oh-my-pi/pi-coding-agent`, `@mariozechner/pi-agent-core → @oh-my-pi/pi-agent-core`, `@mariozechner/pi-tui → @oh-my-pi/pi-tui`, `@mariozechner/pi-ai → @oh-my-pi/pi-ai`, `@mariozechner/pi-utils → @oh-my-pi/pi-utils`. It adds: *"Some upstream packages publish under the `@earendil-works/*` scope instead of `@mariozechner/*`. Map it the same way."*
- §15 is titled **"Intentional Divergences"** and states: *"Our fork has architectural decisions that differ from upstream. **Do not port these upstream patterns**"* — with tables for UI architecture, component naming, API naming, auth storage, tool architecture, and test framework. A "Features We Added (Preserve These)" list follows (StatusLineComponent, multi-credential auth, capability-based discovery, MCP/Exa/SSH, LSP writethrough, bash interception).
- `omp://extension-loading.md` confirms the lineage is still load-bearing at runtime: *"a scoped Bun `onLoad` hook rewrites legacy pi-package specifiers (`@mariozechner/*`, `@earendil-works/*`) and bare `@sinclair/typebox` onto the host-bundled copies before evaluation"*, via `src/extensibility/legacy-pi-ai-shim.ts` and `src/extensibility/legacy-pi-coding-agent-shim.ts`. Upstream pi extensions still load.

Corroboration outside the docs: the repo `LICENSE` (fetched from `raw.githubusercontent.com/can1357/oh-my-pi/main/LICENSE`) carries **three copyright lines**, the first being `Copyright (c) 2025 Mario Zechner` — the pi-mono author — followed by `Copyright (c) 2025-2026 Can Bölük` and `Copyright (c) 2026 Stencil Labs, Inc.`. The GitHub README states *"omp is a fork of pi-mono by Mario Zechner, extended with a batteries-included coding workflow."*

**What "pi-mono" means:** *pi* monorepo. Upstream ships `@mariozechner/pi-ai` (unified multi-provider LLM API), `@mariozechner/pi-agent-core` (agent runtime), `@mariozechner/pi-coding-agent` (the CLI), `@mariozechner/pi-tui`, `@mariozechner/pi-mom`. Upstream `@mariozechner/pi-coding-agent` is at **0.73.1, last published ~4 months ago**; omp's `@oh-my-pi/pi-coding-agent` is at **18.1.21, published within hours**. Upstream is effectively dormant relative to the fork.

**The `pi` prefix is residue, and it is everywhere** — treat it as a naming artifact, not a separate system:
- packages: `@oh-my-pi/pi-tui`, `pi-ai`, `pi-agent-core`, `pi-natives`, `pi-utils`, `pi-coding-agent`, `pi-catalog`
- Rust crates: `pi-natives`, `pi-shell`, `pi-ast`, `pi-walker`, `pi-vcs`, `pi-voice`, `pi-iso`, `pi-builtins` (`omp://native-crates.md`)
- env vars: `PI_CODING_AGENT_DIR`, `PI_CONFIG_DIR`, `PI_CONFIG_FILES`, `PI_SMOL_MODEL`, `PI_TUI_RESIZE_SCROLLBACK`, `PI_NATIVE_VARIANT`, `PI_DEBUG_STARTUP` (with `.env` parsing mirroring `OMP_`→`PI_`: *"an `OMP_`-prefixed key is also mirrored to the matching `PI_`-prefixed name"* — `omp://providers.md`)
- the extension API object is literally named `pi`: `pi.on(...)`, `pi.registerTool(...)`, `pi.zod`, `pi.pi` (`omp://extensions.md`)
- legacy config dir `.pi` and manifest key `pkg.pi`: *"`pkg.omp` preferred; fallback to `pkg.pi` remains"* (`omp://porting-from-pi-mono.md` §15); *"The generic helpers in `src/config.ts` do **not** include `.pi` in source discovery order"* (`omp://config-usage.md`).

**`pi-native` is a red herring for this question.** `omp://toolconv/pi-native.md` is explicit: *"`pi-native` is the lossless transport between a pi-ai client and an `omp auth-gateway`. It is **not a textual tool-call dialect**: there is no `<call:NAME>` grammar, parser, renderer, or `PI_DIALECT=pi-native` value in the current implementation."* The doc records that the old in-band dialect *"was deleted outright (v16.2.2, `053da98`, 2026-06-27) along with its selection knobs (`tools.format: "pi"`, `PI_DIALECT=pi`)."* (It is, however, directly useful to this project — see Provider request path, seam F.)

**Bottom line for the user's phrasing:** "use PI as a base" resolves to one of two different decisions. Basing on *pi-mono* means a 4-month-stale, much smaller upstream. Basing on *omp* means the harness already running, which is where all the extension seams, the Rust core, and the active release cadence live. The two are not stacked; they are a fork pair.

## Distribution and licensing

**Source is public. License is MIT.**

- Repository: `https://github.com/can1357/oh-my-pi`. This is corroborated *inside* the harness docs, not only by search: `omp://config-usage.md` cites *"([#4867](https://github.com/can1357/oh-my-pi/issues/4867))"* for the keybindings profile-inheritance behavior.
- License, fetched verbatim from `main/LICENSE`: `MIT License` / `Copyright (c) 2025 Mario Zechner` / `Copyright (c) 2025-2026 Can Bölük` / `Copyright (c) 2026 Stencil Labs, Inc.` MIT permits *"use, copy, modify, merge, publish, distribute, sublicense, and/or sell"* — a fork is unambiguously permitted, attribution being the only condition. Upstream pi-mono is also MIT.
- npm scope `@oh-my-pi`. `@oh-my-pi/pi-coding-agent` is live on npm (latest **18.1.21**, description *"Coding agent CLI with read, bash, edit, write tools and session management"*), alongside `@oh-my-pi/pi-ai`, `@oh-my-pi/pi-agent-core`, `@oh-my-pi/omptype`.
- Nix: `nix run github:can1357/oh-my-pi` and `nix profile install github:can1357/oh-my-pi`. `omp://local-models.md` confirms an in-repo Nix package: *"The Nix package (`nix/package.nix`) sets this by default."*
- Docs site / collab service: `omp://user-facing-packages.md` names *"production client: <https://my.omp.sh/>"*.

Public vs private packages, from `omp://user-facing-packages.md` verbatim:

| Package | Status | Bin / entry |
| --- | --- | --- |
| `@oh-my-pi/pi-coding-agent` | public (npm) | `omp` |
| `@oh-my-pi/omptype` | *"Package: public `@oh-my-pi/omptype`; install with `bun add @oh-my-pi/omptype`; requires Bun 1.3.14 or newer."* | library |
| `@oh-my-pi/snapcompact` | *"Package: public `@oh-my-pi/snapcompact`"* | library |
| `@oh-my-pi/pi-mnemopi` | *"Package: public `@oh-my-pi/pi-mnemopi`; bin: `mnemopi`"* | `mnemopi` |
| `@oh-my-pi/omp-stats` | *"Package: `@oh-my-pi/omp-stats`; bin: `omp-stats`; main user path: `omp stats`"* | `omp-stats` |
| `@oh-my-pi/browser-relay` | *"Package: private `@oh-my-pi/browser-relay`"* | `omp browser-relay` |
| `@oh-my-pi/collab-web` | *"Package: private `@oh-my-pi/collab-web`"* | web SPA |
| `@oh-my-pi/pi-metaharness` | *"Package: private `@oh-my-pi/pi-metaharness`; bin: `metaharness`"* | bench manager |
| `@oh-my-pi/typescript-edit-benchmark` | *"Package: private `@oh-my-pi/typescript-edit-benchmark`"* | fixtures |
| `robomp` | Python 3.11+, bin `robomp` | GitHub triage service |

"Private" here means `"private": true` in `package.json` (not published to npm) — the **source is still in the public MIT repo**. Nothing is proprietary.

Native binaries ship as optional-dependency leaves (`omp://natives-architecture.md`): *"Release publishing generates `@oh-my-pi/pi-natives-<platform>-<arch>` optional-dependency leaf packages and injects them at the same version into the core manifest. `LEAF_TARGETS` in `gen-npm-packages.ts` is the authoritative publish target list."* Supported tags: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`, with `modern`/`baseline` x64 variants.

**Risk note:** the third copyright holder is `Stencil Labs, Inc.` (2026). MIT is irrevocable for code already published, so a future relicense of *new* work cannot retroactively affect a fork taken today — but it is worth pinning a commit if long-term divergence is planned.

## Stack and layout

**Runtime is Bun, not Node.** `omp://porting-from-pi-mono.md` §7 states it as a preserved infrastructure invariant:

> *"Runtime is Bun (no Node entry points for the main CLI). Package manager is Bun (no npm lockfiles). … CLI shebangs use `bun` (not `node`, not `tsx`). TypeScript packages generally use source files directly; `@oh-my-pi/pi-natives` exports generated native bindings from `packages/natives/native`. CI workflows run Bun for install/check/test."*

`omp://sdk.md`: *"Requires Bun 1.3.14 or newer."* (`@oh-my-pi/omptype` is the exception — it is *"published as compiled ESM"* and runs on Node 20+.)

Build/verify commands (`omp://porting-from-pi-mono.md` §10): `bun check`, `bun test` (*"Tests use Bun's runner (not Vitest)"*, with `vi` imported from bun per §15), `bun install --frozen-lockfile` after updating `bun.lock`. **There is no TS compile step for most packages** — source files are consumed directly, which materially lowers the cost of a fork or an in-tree extension.

Bun-specific conventions that a fork must respect: Bun Shell `$` and `Bun.spawn` for processes; native `fetch`; `bun:sqlite` (not `better-sqlite3`); automatic `.env` loading; text embeds `import X from "./p.md" with { type: "text" }` for prompts — *"Never build prompts in code; prompts are static `.md` files rendered with Handlebars."* `Promise.withResolvers()` and ES `#` private fields are the house style.

**Languages:** TypeScript (agent, TUI, providers, tools), Rust (~80k lines per the README), Python (`python/robomp` only, plus the optional MLX tiny-model worker venv).

### Repo layout

**Caveat: `omp://tree.md` is not a repo tree.** It documents the `/tree` slash command — *"`/tree` opens the interactive **Session Tree** navigator"*. No single doc contains a directory listing. The layout below is assembled from source paths cited across `native-crates.md`, `natives-architecture.md`, `user-facing-packages.md`, `compaction.md`, `rpc.md`, and `config-usage.md`, and every entry is directly attested:

```
oh-my-pi/
├── packages/
│   ├── coding-agent/     # `omp` CLI, agent session, tools, extensibility, modes
│   │   └── src/{cli/,cli-commands.ts,config/,discovery/,capability/,
│   │             extensibility/{extensions,hooks,custom-tools,plugins,skills},
│   │             modes/{composer.ts,controllers/,components/,theme/,rpc/},
│   │             session/,tools/,prompts/,export/,sdk.ts,config.ts}
│   ├── tui/              # @oh-my-pi/pi-tui renderer
│   │   └── src/{tui.ts,terminal.ts,utils.ts,keys.ts,keybindings.ts,
│   │             kitty-graphics.ts,components/{image.ts,composer/}}
│   ├── ai/               # @oh-my-pi/pi-ai — transports, auth, gateway
│   │   └── src/{stream.ts,providers/,registry/{oauth/},dialect/factory.ts,
│   │             auth-gateway/server.ts,utils/{event-stream.ts,openai-http.ts,
│   │             http-inspector.ts,schema/normalize.ts}}
│   ├── agent/            # agent-loop + compaction
│   │   └── src/{agent.ts,agent-loop.ts,compaction/{compaction.ts,pruning.ts,
│   │             shake.ts,branch-summarization.ts,compaction-v2-streaming.ts,prompts/}}
│   ├── catalog/          # @oh-my-pi/pi-catalog — model/provider descriptors
│   │   └── src/{models.ts,types.ts,provider-models/{descriptors.ts,
│   │             descriptor-types.ts,openai-compat.ts},compat/{openai.ts,rules/}}
│   ├── natives/          # @oh-my-pi/pi-natives JS loader (native/, scripts/)
│   ├── utils/            # @oh-my-pi/pi-utils (dirs.ts, json-parse.ts, logger)
│   ├── omptype/          # public schema lib (+ /typebox, /zod, /ark subpaths)
│   ├── snapcompact/  stats/  mnemopi/  metaharness/
│   ├── browser-relay/  collab-web/  typescript-edit-benchmark/
├── crates/               # Rust workspace (root Cargo.toml lists members)
│   ├── pi-natives/       # N-API cdylib, the only JS-facing crate
│   ├── pi-builtins/  pi-shell/  pi-ast/  pi-iso/  pi-walker/  pi-vcs/  pi-voice/
│   └── vendor/brush-core/  # vendored shell engine (workspace patch)
├── python/robomp/        # FastAPI GitHub triage service
├── nix/package.nix
├── scripts/bazel-natives.ts
└── docs/                 # the 131 omp://*.md files
```

### How the natives relate to the TS layer

`omp://natives-architecture.md`: *"`@oh-my-pi/pi-natives` combines a JavaScript ESM loader with a Rust Node-API addon"* — the package layer *"selects, loads, and validates the correct `.node` addon, then exposes generated named ESM exports"*; the Rust layer *"implements those exports and supplies napi-rs-generated TypeScript declarations."*

Key properties:
- **No hand-written wrapper layer.** *"There is no `packages/natives/src` wrapper layer. Root consumers call generated N-API exports directly."*
- Three entrypoints: `@oh-my-pi/pi-natives` (eager), `/desktop` and `/clipboard` (lazy, *"so workers can import their JS wrapper without loading the large addon"*).
- Naming: *"Default snake_case Rust names become camelCase JavaScript names."*
- Version gate: *"Every install or compiled candidate must expose the version sentinel computed from `package.json#version`, such as `__piNativesV17_2_5`."* **A fork that bumps the TS version without rebuilding the addon will fail to load.** Workspace loads skip the check.
- Boundary (`omp://native-crates.md`): `pi-natives` (N-API) → `pi-ast`/`pi-iso`/`pi-vcs`/`pi-voice`/`pi-walker` and `pi-shell` → `brush-core` + `pi-builtins`.
- Capabilities the TS side depends on: *"search, globbing, workspace scans, AST matching/editing, code summaries, syntax highlighting, text layout, token counting, and structured diffs; shell, PTY, process, file-lock, isolation … PDF inspection/Markdown conversion, SVG rasterization … and in-process Git/Jujutsu operations."* `omp://theme.md` notes syntax highlighting comes from natives; `omp://user-facing-packages.md` notes *"rasterization and PNG encoding require `@oh-my-pi/pi-natives`."*

**Practical consequence for this project:** an extension or a fork that only touches the TS layer **does not need a Rust toolchain** — it consumes prebuilt `.node` leaves from npm. Rust is only in play if native primitives change.

## TUI architecture and extensibility

### Two-layer split with one seam

`omp://tui-runtime-internals.md` states ownership precisely:

> *"**`packages/tui`** owns terminal lifecycle, input normalization, focus, overlays, image protocols, cursor placement, scheduling, explicit history writes, and mutable viewport painting.*
> ***`packages/coding-agent`** owns transcript order, block finality, tool allocation, editor/status chrome, and the `TerminalFrameProvider` implementation in `modes/composer.ts`."*

and: *"The terminal core never interprets messages, tools, transcript blocks, or finality."*

The single seam between them (`omp://tui-core-renderer.md`):

> *"A product installs a `TerminalFrameProvider` with `TUI.setFrameProvider()`. On each render the provider receives the current `ViewportSize` and returns a `TerminalFramePlan`"*

```ts
interface HistoryBatch { id: number; rows: string[]; kind?: "append" | "replay"; }
interface TerminalFramePlan { history?: HistoryBatch; viewport: string[]; }
```

History is an append stream written exactly once per monotonic id and acknowledged; the viewport is diffed. *"Products decide finality and submit finalized rows only through ordered `HistoryBatch` values"*, and *"Ordinary frames diff and repaint the viewport only. They never rewrite, audit, clear, or replay retained history."*

This is **a genuinely clean architecture for a new product**: `packages/tui` is a general-purpose renderer with no coding-agent knowledge. Writing a different product against it is a supported shape — but `setFrameProvider` is a `TUI` method, **not** exposed through `ExtensionAPI`. An extension cannot install one.

The component contract (`omp://tui.md`) is minimal:

```ts
export interface Component {
  render(width: number): readonly string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate?(): void;
  setIgnoreTight?(ignore: boolean): any;
  dispose?(): void;
}
```

with memoization semantics: *"An unchanged component may (and should) return the **same array reference** it returned last time … Reference equality enables container memoization."* Width must be measured with `visibleWidth()`, truncated with `truncateToWidth()`, wrapped with `wrapTextWithAnsi()`, tabs via `replaceTabs()`.

### What an extension CAN add without forking

All from `omp://extensions.md` / `omp://tui.md`:

| Surface | API | Notes |
| --- | --- | --- |
| Arbitrary interactive component | `ctx.ui.custom(factory, { overlay? })` | Factory gets `(tui, theme, keybindings, done)`. Without `overlay` it *"replaces the editor component with your component"*; with it, mounts *"as a bottom-centered overlay"* anchored `bottom-center` at full width. `done(...)` is mandatory. |
| Persistent widget | `ctx.ui.setWidget` / `setHookWidget(...)` | *"renders real widget components above or below the editor … (`placement: "aboveEditor" \| "belowEditor"`; string-array content capped at 10 lines)"* |
| Replace the input editor | `ctx.setEditorComponent(factory)` | *"`setEditorComponent` is wired to the live editor"* (no-op in ACP/RPC/headless) |
| Composer layout | `pi.registerComposerShape({ label, description, style })` | Full `ComposerStyle` contract: `renderTop`/`renderRow`/`renderBottom`, `sideBorders`, `verticalChrome`, `statusAttachment`, `bottomBar`. Adds an entry to **Appearance → Composer Shape**. Built-in ids `box`, `claude`, `pi`, `borderless`, `rule`, `field`, `rail` *"cannot be replaced"*. |
| Message rendering | `pi.registerMessageRenderer(customType, fn)` | returns a pi-tui Component |
| Thinking-block decoration | `pi.registerAssistantThinkingRenderer(fn)` | *"display-only supplemental UI below each visible assistant thinking block"*; *"Renderers must not mutate messages"* |
| Tool call/result rendering | `renderCall` / `renderResult` on `registerTool` | `options: { expanded, isPartial, spinnerFrame? }`, mounted by `ToolExecutionComponent` |
| Autocomplete | `ctx.ui.addAutocompleteProvider(factory)` | *"wraps the built-in editor provider (factories apply in registration order …)"* |
| Keybinding | `pi.registerShortcut(...)` | Reserved chords are ignored: `ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+k`, `ctrl+p`, `ctrl+l`, `ctrl+o`, `ctrl+t`, `ctrl+g`, `ctrl+q`, `alt+m`, `shift+tab`, `shift+ctrl+p`, `alt+enter`, `escape`, `enter` |
| Status text | `ctx.ui.setStatus(key, text)` | *"stored per key, sorted by key name, sanitized … joined and width-truncated"* |
| Terminal title, notifications, theme switching | `setTitle`, `notify`, `setTheme(name)` | |

A custom component receives a `KeybindingsManager` so it can match action ids — but note the caveat: *"an in-memory instance carrying the default bindings, **not** the user's `keybindings.yml`"*.

### What an extension CANNOT do

- **Header and footer are explicit no-ops.** `omp://extensions.md`, interactive controller: *"Current no-op methods in this controller: `setFooter`, `setHeader`"*. `omp://porting-from-pi-mono.md` §15 explains why: upstream's `FooterDataProvider` was replaced by omp's `StatusLineComponent`, and `ctx.ui.setHeader()` / `ctx.ui.setFooter()` are *"No-op stubs in current extension contexts — Not currently wired to replace the TUI status/header UI."*
- **No access to `TUI.setFrameProvider()`**, `TranscriptContainer`, block finality, or the status line's content model. Transcript ordering and retirement are compiled-in.
- **No fullscreen surface registration.** `omp://tui.md` notes built-in fullscreen surfaces (Agent Hub) are *"mounted … outside `ctx.ui.custom(...)`"*. Extensions get bottom-anchored overlays only.
- **No sandboxing** (`omp://extension-loading.md`): *"Extensions are **not sandboxed** (same process/runtime). They share one `EventBus` and one `ExtensionRuntime` instance."* `omp://extensions.md` warns a raw `setInterval` throw *"surfaces as a process-level `uncaughtException` … **the whole session is torn down**"* — use `ctx.setInterval`/`ctx.setTimeout`.

### Themeable vs compiled-in

Themeable (`omp://theme.md`): a JSON file at `~/.omp/agent/themes/<name>.json` (dir from `getCustomThemesDir()`, overridable by `PI_CODING_AGENT_DIR`) sets **~66 required color tokens** across core text/borders (11), background blocks (7), message/tool text (5), markdown (10), diff+syntax (12), thinking/mode borders (8 + optional `thinkingMax`), status-line segments (13). Plus optional `vars` (nested refs, circular refs throw), `export`, and `symbols` (`preset: unicode|nerd|ascii`, `overrides`, `spinnerFrames` split into `status` ~12.5fps and `activity` ~30fps). Box glyphs split `boxRound.*` (all chrome) vs `boxSharp.*` (junctions everywhere, table corners only). Live reload: *"watches `<customThemesDir>/<currentTheme>.json` only when that file exists"*; built-ins are not watched and win name collisions. `previewTheme` applies without persisting.

Compiled-in: layout, transcript structure, viewport allocation, tool-collapse tiers (*"three or more rows: full tool renderer; two rows: semantic folded card; one row: stable label/activity line…"*), status-line segment set, resize policy (coding agent sets `rebuild`; raw TUI defaults `preserve`).

Keybindings (`omp://keybindings.md`): `~/.omp/agent/keybindings.yml`, *"a YAML mapping whose keys are keybinding action IDs and whose values are either one chord string or an array of chord strings. It is **not** read from `~/.omp/agent/config.yml`, and there is no nested `keybindings` object."* Empty array disables. Profiles merge the default profile's file under their own. `/hotkeys` lists active chords.

**Verdict on the TUI:** additive UI is well supported and does not require a fork. **Replacing** chrome (header/footer/status line/transcript) is fork-only surgery today. For this project that likely does not matter — a context-pack assembler needs a status indicator and maybe an inspector overlay, both of which `setStatus` + `ctx.ui.custom({ overlay: true })` already cover.

## Provider request path

### How a request is built and dispatched

1. **Context reconstruction** (`omp://compaction.md`): `buildSessionContext` walks the active branch — latest compaction → one `compactionSummary` message; kept entries from `firstKeptEntryId`; later entries; `branch_summary` → `branchSummary`; `custom_message` → `custom`.
2. **LLM projection**: *"Those custom roles are then transformed into LLM-facing messages in `convertToLlm()`: `compactionSummary` and `branchSummary` become user messages rendered through the static templates … while `custom` messages pass through as developer messages with their raw content (no template)."*
3. **Agent loop**: `packages/agent/src/agent-loop.ts` drives turns; `AgentSession` (`packages/coding-agent/src/session/agent-session.ts`) *"subscribes to agent events, persists messages, drives extension hooks, and applies session behaviors (retry, compaction, TTSR, streaming-edit abort checks)"* (`omp://provider-streaming-internals.md`).
4. **Dispatch**: *"`streamSimple()` (`packages/ai/src/stream.ts`) maps generic options and dispatches to a provider stream function."* Dispatch keys on the wire API, not the vendor — `omp://adding-a-provider.md`: *"since stream dispatch keys on `model.api`, not `model.provider`."*
5. **Normalization back**: every provider emits the same `AssistantMessageEvent` sequence into `AssistantMessageEventStream`.

### Where message-array replacement can be injected

Seven seams, ordered from most-documented to most-exotic. **The answer to the assignment's explicit question: yes, there is a documented seam, and it is not fork-only surgery.**

**A. `context` event — THE seam. Documented, supported, exactly the required shape.**

`omp://hooks.md` lists it under Agent/context events: **`` `context` → can return `{ messages?: Message[] }` ``**. Under *"What hooks can mutate"*, first bullet: *"**LLM context for a single call via `context` (`messages` replacement chain)**"*. Conflict semantics: *"`context`: chained; each handler receives prior handler's message output."* The doc's own example:

```ts
pi.on("context", async (event) => {
  const filtered = event.messages.filter(
    (msg) => !(msg.role === "custom" && msg.customType === "debug-only"),
  );
  return { messages: filtered };
});
```

It is listed in `omp://extensions.md`'s current event surface under *"Prompt and turn lifecycle"*, so it is live on the extension runner (not just the legacy hook runner). Returning a wholly-constructed array — not a filter of the incoming one — is the natural generalization and is what a deterministic assembler needs. **This replaces what the model sees without touching what the TUI shows or what the session file stores.** That is precisely the "clear the window each prompt, keep the TUI" requirement.

Two constraints the docs make clear:
- It fires **per LLM call**, not per user turn — *"for a single call"*. A tool-loop turn issues many calls. An assembler must therefore be stable across calls within a turn, or it will thrash the provider's prompt-cache prefix on every tool result.
- `omp://extensions.md` steers you here deliberately: *"`message_end` receives a detached message snapshot, so use `tool_result` or `context` when an extension needs to change provider context."*

**B. `before_agent_start` — system prompt replacement.** `omp://extensions.md`: *"Handlers chain from the current base system prompt. Their final override governs the next provider request and its continuations until another prompt or user-containing batch prepares policy. Overrides remain complete replacements, including strings or arrays unrelated to the base; the host never infers or rebases text patches."* Handlers must be re-entrant: *"a source-base retry can call the entire `before_agent_start` chain again for the same submission"*, capped at *"three attempts … per delivery"*. It can also return a custom message (`{ customType, content, display, details, attribution }`) appended once after the batch. This is the correct home for the OKF-doc / OpenSpec preamble half of a context pack.

**C. `before_provider_request` — raw payload replacement.** `omp://extensions.md`, one line, verbatim and complete: *"`before_provider_request` (may replace provider request payload — the replacement is applied by every provider that fires the hook, which is all of them except `devin-agent`, which does not fire it)"*. Paired with `after_provider_response`. **This is the lowest-level documented seam and the only one that sees the actual provider-shaped body.** Its payload type, return shape, and ordering semantics are **not documented** anywhere in the 131 docs — it appears exactly once, in this list. Treat it as real but requiring source reading.

**D. Extension-registered provider / custom API.** `pi.registerProvider(name, config)` (`omp://extensions.md`) takes `baseUrl`, `api`, optional `usage`, and `fetchDynamicModels`. `omp://models.md` adds the decisive capability: extensions can register *"custom stream handler registration for new API IDs"* — and `omp://provider-streaming-internals.md` confirms the dispatcher handles *"extension-registered custom APIs"*. So an extension can own an entire wire protocol and see/rewrite everything before it goes out. `omp://adding-a-provider.md` also documents `prepareRequest` (*"Provider-owned request shaping before generic API dispatch. Returns the model and stream options to dispatch."*) and `mapSimpleOptions` on `ProviderDefinition` — the built-in equivalent of a middleware, though adding a `ProviderDefinition` to the `ALL` array in `packages/ai/src/registry/registry.ts` is a source edit, i.e. fork territory.

**E. Config-only proxy.** A custom `models.yml` provider with `baseUrl` pointing at your own process gives a zero-code interception point at the HTTP layer (`omp://providers.md`, `omp://models.md`). Crude — you get provider-specific wire formats, not canonical messages.

**F. `transport: pi-native` — out-of-process, canonical, zero fork. Strongly relevant here.** `omp://toolconv/pi-native.md`: a model opts in with

```yaml
transport: pi-native
baseUrl: http://gateway.internal:4000
```

*"When `model.transport === "pi-native"`, `streamSimple` bypasses the normal per-API provider implementation and calls `streamPiNative`."* The client posts to `/v1/pi/stream`:

```json
{ "modelId": "provider/model-id",
  "context": { "systemPrompt": ["..."], "messages": [], "tools": [] },
  "options": {}, "stream": true }
```

Crucially, this is **lossless canonical pi-ai types**, not a translated dialect: *"OpenAI/Anthropic-compatible routes translate and can lose pi-specific fields; pi-native sends the canonical types directly, preserving service tier, cache markers, thinking budgets, tool-choice variants, images, and tool-call IDs."* Gateway-side validation is deliberately shallow — *"Canonical message/tool internals are not revalidated at this boundary"*. A pi-chart gateway sitting on this endpoint could rewrite `context.messages` and `context.systemPrompt` wholesale, in a separate process, in any language, with **no omp code changes at all** — only a `models.yml` entry. This is the lowest-risk path to a working prototype.

**G. Compaction seams.** `session_before_compact → { cancel?, compaction? }` and `session.compacting → { context?: string[]; prompt?: string; preserveData? }` (`omp://hooks.md`) let an extension supply its own compaction result. And omp **already ships an experiment in this exact direction**: `compaction.experimentalContextManagement` (default `false`) enables `context_notes` — a per-branch notebook capped at *"**16,384 UTF-8 bytes**"* — and `new_context`, which *"rebuilds active context with the latest notebook and retained recent messages, leaving original journal entries available through `history://current/full`"* (`omp://tools/new-context.md`, `omp://tools/context-notes.md`). Notes-backed rollover *"requires all four tools to be active: `context_notes`, `new_context`, `read`, and `grep`."* This is a model-driven cousin of the proposed deterministic assembler — worth reading before designing, and a signal the maintainers consider this problem in scope.

### Practical recommendation

Build the assembler as an extension registering **`context`** (message array) + **`before_agent_start`** (system prompt) + **`tool_call`/`tool_result`** (to capture Thread Store records) + **`session_start`** (rehydrate). Use `ctx.setInterval` for background work, `pi.appendEntry("reverse.domain.state", …)` for durable state. If early results demand seeing the exact wire body, fall back to `before_provider_request` or the pi-native gateway. **None of this requires a fork.**

## Config

**Format:** YAML mappings. *"The canonical global file is YAML at `config.yml`; `config.yaml` is accepted as a compatibility filename. The generic config loader used for other files (for example `models.yml`) accepts `.yml`, `.yaml`, `.json`, and `.jsonc`"* (`omp://settings.md`). Dotted setting paths are written as nested mappings.

**Locations** (`omp://settings.md`, `omp://config-usage.md`):

| Scope | Path |
| --- | --- |
| Global settings | `~/.omp/agent/config.yml` (legacy `settings.json` migrated once, renamed `.bak`) |
| Project settings | `<cwd>/.omp/config.yml` (+ legacy `<cwd>/.omp/settings.json`) |
| CLI overlay | `--config <file>` (repeatable, never persisted); `PI_CONFIG_FILES` path-list (`:` Unix, `;` Windows) |
| Models | `~/.omp/agent/models.yml` / `.yaml` (legacy `models.json` migrated) |
| Keybindings | `~/.omp/agent/keybindings.yml` (`.yaml`/`.json` accepted + migrated) |
| Themes | `~/.omp/agent/themes/<name>.json` |
| Credentials | `~/.omp/agent/agent.db` (bun:sqlite) — *"Credentials stored exclusively in `agent.db`"* |
| Sessions | `~/.omp/agent/sessions/` (JSONL) |
| MCP | project `.omp/mcp.json` then `.omp/.mcp.json`, then user `mcp.json` / `.mcp.json` |
| Extensions | `<cwd>/.omp/extensions/`, `~/.omp/agent/extensions/`; hooks must live in `hooks/pre/` or `hooks/post/` |
| Skills | `<ancestor>/.omp/skills/*/SKILL.md`, `~/.omp/agent/skills/*/SKILL.md` |
| Prompt override | `SYSTEM.md`, `APPEND_SYSTEM.md`, `RULES.md`, `TITLE_SYSTEM.md`, `.omp/AGENTS.md` |

**Precedence**, verbatim from `omp://settings.md`:

```text
built-in defaults  <-  global config  <-  project config  <-  CLI overlays  <-  runtime overrides
```

`omp://config-usage.md` states it with the overlay split: *"`defaults <- global <- project <- PI_CONFIG_FILES overlays <- --config overlays <- runtime overrides`"*, and *"Within either overlay list, later files override earlier files."*

**Merge rules — the load-bearing gotcha:** *"**Objects are deep-merged** … **Scalars and arrays are replaced wholesale** by the higher-precedence layer. A higher layer's array does not append to a lower layer's array."* The doc calls this out: *"Array replacement is the most common surprise: the project's `disabledProviders` does not extend the global list — it becomes the entire list for that project. The same applies to `enabledModels`, `cycleOrder`, `extensions`, and every other array-typed setting."* **This directly affects an extension distributed via the `extensions:` array** — a project-level `extensions:` silently drops the global one.

**Writes:** `omp config set`, `omp config reset`, `/settings` all write the **global** file. The only project write path is a model-role assignment under `modelRoleStorage: project`. *"Saves are debounced and re-read the file under a lock, so external edits made while a session is open are preserved."*

**Failure behavior:** *"Invalid global or native-project YAML is moved to a unique `.broken-<timestamp>-<pid>-<uuid>` sibling under a file lock, then startup fails with the original and backup paths."* Overlays are stricter: *"missing files, invalid YAML, and non-mapping document roots are hard errors. Overlay files are not quarantined."*

**Relocation:** `PI_CODING_AGENT_DIR` moves the `~/.omp/agent` base (config, `agent.db`, sessions, themes). `PI_CONFIG_DIR` changes the OMP user root for the generic helpers — and the two are *not* the same: *"`PI_CODING_AGENT_DIR` … does **not** change the generic `getConfigDirs()` / `findConfigFile()` OMP base."* Profiles (`omp --profile <name>`, `OMP_PROFILE`) relocate to `~/.omp/profiles/<name>/agent/...`, with keybindings the one inherited exception. XDG paths are opt-in via `omp config init-xdg`.

**Foreign-source discovery** is off by default at user level: *"`enabledProviders` opts foreign user-level configuration sources into discovery. Its default is empty"*. Discovery providers are priority-sorted: `native` 100, `omp-plugins` 90, `claude` 80, `agent-plugins` 75, `codex`/`agents` 70, `gemini` 60, `opencode` 55, `cursor`/`windsurf` 50, `cline` 40, `github` 30, `vscode` 20, `agents-md` 10, `mcp-json`/`ssh-json` 5, `builtin-defaults` 1. Dedup is first-wins by capability key — **except settings**: *"Settings capability items are not deduplicated … Providers are visited from highest to lowest priority, which means lower-priority provider settings can override higher-priority settings."*

**Also relevant:** `.env` files are loaded eagerly before any provider lookup with precedence `process env > <cwd>/.env > ~/.omp/agent/.env > ~/.omp/.env > ~/.env` — useful for the Postgres/pgvector connection string.

## Verdict: extend, fork, or rebuild

**Extend. Do not fork yet, and do not rebuild.**

### Why extend wins

1. **The core requirement is already a supported seam.** The premise that "no mainstream coding agent lets an external plugin replace the transcript" is **false for omp**. `context → { messages?: Message[] }` is a documented, chained, per-call replacement of exactly the array that goes to the model, and it does not disturb the persisted session or the rendered transcript. The user's hardest constraint is met by an extension, not a fork.
2. **License permits everything.** MIT, three holders, public source.
3. **Forking costs are real and permanent.** `omp://porting-from-pi-mono.md` is 15 sections of merge pain — *"Detect and handle reworked code"*, *"Protect improved features (regression trap list)"*, *"Defaults change silently"*, *"API options get dropped"*. That document exists because `can1357` maintains a fork of `pi-mono` and it is expensive. `@oh-my-pi/pi-coding-agent` publishes on a **sub-daily cadence** (18.1.21, *"last published 6 hours ago"*). A fork starts decaying immediately. Inheriting a second copy of that maintenance burden to obtain seams that already exist is a bad trade.
4. **Extensions are fully privileged.** Not sandboxed, same process, shared `EventBus`, can register tools, commands, providers, custom APIs, UI, renderers, file-write/delete fallbacks, and durable session entries. An extension can do nearly everything a fork could except swap compiled-in chrome.
5. **The TUI is kept for free** — the user's stated non-negotiable. Zero work.
6. **Distribution is solved.** Ship as a package with `omp.extensions` in `package.json`, install via `omp plugin install` / `omp install`, or reference by path in `extensions:`.

### What a fork would actually buy — and whether you need it

| Want | Extension? | If not, cost |
| --- | --- | --- |
| Replace message array per call | ✅ `context` | — |
| Replace system prompt per turn | ✅ `before_agent_start` | — |
| Replace raw provider payload | ✅ `before_provider_request` | undocumented types; read source |
| Own tools (doc store, thread query, graph query) | ✅ `pi.registerTool` | — |
| Own slash commands, keybindings, overlays, widgets, status | ✅ | — |
| Persist per-session state | ✅ `pi.appendEntry` + `getBranch()` | — |
| Own the model wire entirely | ✅ `registerProvider` w/ custom API, **or** `transport: pi-native` gateway | — |
| Replace header/footer/status-line chrome | ❌ no-ops | fork |
| Install a custom `TerminalFrameProvider` / replace transcript | ❌ | fork |
| New built-in `ProviderDefinition` in `registry.ts` | ❌ | fork |
| Change compaction defaults beyond settings | partial (`session.compacting`) | fork |

If the project later needs chrome replacement, the fork is **cheap to defer**: a soft fork (`git remote add upstream`, rebase periodically) touching only `modes/composer.ts` and `StatusLineComponent` is a small, stable diff — far smaller than a day-one fork touching context assembly.

### Why not rebuild

Rebuilding forfeits: 60+ providers with OAuth/rotation/broker, ~80k lines of Rust (embedded shell, parallel walker, tree-sitter AST, gitoxide VCS), the differential renderer with its resize/anchor/image machinery, MCP/LSP/DAP, compaction, session tree/branch/fork/resume, and skills/hooks/plugins. The context manager is the novel part; none of the rest is.

### Recommended staging

1. **Prototype out-of-process, zero code in omp.** Stand up the assembler behind `transport: pi-native` + a `models.yml` provider pointing at it. Rewrite `context.messages` / `context.systemPrompt` server-side. Proves the context-pack design with no coupling.
2. **Move in-process as an extension.** `context` + `before_agent_start` + `tool_call`/`tool_result` capture + `session_start` rehydrate. Add `ctx.ui.custom({ overlay: true })` for a pack inspector and `ctx.ui.setStatus` for a live pack-size indicator. Register `retrieve`-style tools for the four stores.
3. **Fork only on a concrete chrome blocker.** Pin the upstream commit, keep the diff minimal, adopt `omp://porting-from-pi-mono.md` §11–§14 as the sync discipline (it is written for exactly this).

### Sharp edges to design around

- `context` fires **per LLM call**, not per user turn. Recomputing the pack on every tool-loop iteration invalidates the provider prompt-cache prefix and costs real money. Memoize per turn; key on turn id.
- **Prompt caching interacts badly with volatile prefixes.** omp carries `promptCacheKey`, `cacheRetention`, `cachedContent`, Anthropic cache markers. A pack that reorders its head each call defeats all of it.
- `before_agent_start` must be **re-entrant** — *"at most three attempts run per delivery"*; side effects cannot be rolled back.
- **Role strings are camelCase in session entries** (`toolResult`, not `tool_result`). `omp://extensions.md` warns explicitly: a filter that lowercases or uses snake_case *"matches no branch and **silently drops** the entry with no error or log, so a session capture keyed off `role` loses every tool result"*. This will bite the Thread Store ingest.
- **Arrays replace, never merge**, across config layers — including `extensions:`.
- **No sandboxing**: an uncaught throw in a raw timer kills the session. Use `ctx.setInterval`/`ctx.setTimeout`.
- **Native sentinel** `__piNativesV<version>` must match if you ever fork and bump versions without rebuilding the addon.
- `pi-native` gateway validation is **shallow by design** — *"Canonical message/tool internals are not revalidated at this boundary"* — so a malformed rewritten pack surfaces as an opaque upstream error.
- Postgres is a new external dependency; omp itself standardizes on `bun:sqlite` (`agent.db`, `stats.db`, model cache). Expect no in-repo precedent for a Postgres pool.

## Not documented

Gaps found in the 131 harness docs — each of these needs source reading, not guessing:

1. **`before_provider_request` / `after_provider_response` payload and return types.** They appear exactly once, in the `omp://extensions.md` event list. No shape, no ordering rule, no conflict-resolution rule, no example. The parenthetical *"may replace provider request payload"* is the entire specification.
2. **The `Message[]` type used by the `context` event.** `omp://hooks.md` gives `{ messages?: Message[] }` but never defines `Message`. It is not the persisted `AgentMessage` (whose roles are camelCase and which is described in `omp://extensions.md`) and not the raw provider wire shape. The mapping between session entries, `convertToLlm()` output, and this event's array is not spelled out.
3. **Whether `context` can alter the system prompt or tool array.** Only `messages` is documented as returnable. `omp://toolconv/pi-native.md` shows the canonical `Context` is `{ systemPrompt, messages, tools }`, so the other two fields exist — but no doc says the `context` hook can touch them.
4. **Exactly when `context` fires** relative to compaction, mid-turn maintenance, retries, and subagent turns. "For a single call" is the only granularity given.
5. **`TUI.setFrameProvider()` reachability from an extension.** Documented as a product-level API in `omp://tui-core-renderer.md`; absent from every extension surface list. Whether an extension can obtain the live `TUI` instance (it does receive `tui` as the first arg to a `ctx.ui.custom` factory) and legally call `setFrameProvider` on it is not stated either way.
6. **Repo directory tree.** No doc contains one. `omp://tree.md` is the `/tree` slash command. The layout in this report is reconstructed from cited source paths.
7. **Build system beyond Bun scripts.** `scripts/bazel-natives.ts` is listed in `omp://natives-architecture.md` authoritative files, but no doc explains whether Bazel is required, optional, or CI-only. Rust build/release detail is deferred to `omp://natives-build-release-debugging.md`, which was not read.
8. **Any plugin API for registering a fullscreen surface**, a status-line segment, or a transcript block renderer (as opposed to a *message* renderer).
9. **Whether `@oh-my-pi/pi-tui` is separately published to npm.** It is referenced as a package import throughout and mapped from `@mariozechner/pi-tui`, but `omp://user-facing-packages.md` (which explicitly indexes only *"README-only user-facing package CLIs"*) does not list it, and search did not confirm an npm entry.
10. **pgvector / Postgres precedent.** None. Every documented store is SQLite or JSONL.
11. **`registerProvider` custom stream-handler signature.** `omp://models.md` asserts *"custom stream handler registration for new API IDs"* is possible; neither it nor `omp://extensions.md` gives the function shape.
12. **OpenSpec.** Not mentioned in any of the 131 docs. There is no built-in integration to verify or initialize against.
13. **graphify / `graphify-out/graph.json`.** Not mentioned in any doc. No built-in code-graph consumer exists; `omp://native-crates.md` shows `pi-ast` (tree-sitter/ast-grep) as the nearest in-house capability.
