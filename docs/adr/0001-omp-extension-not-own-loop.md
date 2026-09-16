# Ship as an omp extension rather than owning the agent loop

Per-turn context replacement looked like it required owning the agent loop: Claude Code, Codex CLI, Cursor, Aider, Continue.dev, Cline, and Roo all expose additive-only extension points, and every prior-art memory system that integrates as a plugin degrades to a retrieval tool the agent may ignore. omp is the exception — its `context` extension event fires before each LLM API call and returns `{ messages?: Message[] }`, replacing the entire message array. We build the Assembler as an omp extension on that seam, which keeps the TUI, the provider layer, MCP/LSP, and the session tree that a fork or a bespoke harness would have cost us.

## Considered Options

- **Claude Agent SDK, stateless session per turn.** Real per-turn assembly, but no TUI and every turn re-pays prompt-cache writes.
- **Raw provider API client.** Total control, at the price of rebuilding tool execution, permissions, and sandboxing.
- **Fork omp.** MIT-licensed and therefore available, but a fork only buys chrome we do not need: `setHeader`/`setFooter` are no-ops and transcript ordering is compiled-in, while the cost is ~80k lines of Rust natives, 60+ providers, and the renderer.
- **Plugin that only adds retrieval tools.** Abandons the clean-window goal outright.

## Consequences

- Implementation language is fixed to TypeScript on Bun: omp loads extensions as TS modules. Python was otherwise the natural fit for graphify and the OKF reference parser, but an IPC boundary through the middle of the Assembler buys nothing when both are CLIs we shell out to.
- A `context` replacement is wire-only. Verified empirically: replacing the array with a single rewritten message made the model answer the injected prompt instead of the real one, while the session journal on disk retained the original user text and the TUI transcript kept showing it. The Assembler decides what the model sees; the journal stays the record of what happened.
- The Assembler governs messages only. A single-message turn still cost 30,447 tokens — system prompt, tool schemas, skills, and rules are outside the `context` hook's reach. That floor is accepted deliberately: it is what omp's own tooling runs on, and we are not trading omp's utility for a smaller window.
- We depend on an extension event that is documented but not contractually stable. If `context` changes shape, `before_provider_request` is the documented fallback, and the MIT license keeps a fork available as a last resort.
