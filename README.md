# context-manager

Assembles a fresh Context Pack for every Turn of a coding agent, so the context window stops growing.

The agent's window is rebuilt each Turn from what that Turn needs, rather than inherited from everything that came before. Two slices are in: the Assembler owns the window and measures what it costs, and the Thread Store holds the Turns it draws on so they outlive the session. The Doc, Spec, and Graph Stores arrive in later slices.

See `CONTEXT.md` for the vocabulary and `docs/adr/` for the decisions.

## Requirements

- [omp](https://github.com/can1357/oh-my-pi) — the harness this loads into
- Bun (pinned in `mise.toml`; `mise install` provides it)
- Docker, for the Thread Store's Postgres. Without it the extension still runs — the verbatim tail just falls back to whatever history the harness itself carries.

## Install

```sh
git clone <repo> context-manager && cd context-manager
mise trust && mise install
bun install
```

`mise trust` is required before the pinned Bun resolves in a fresh clone.

## Load it

Point the harness at the extension:

```sh
omp -e /path/to/context-manager/src/extension.ts
```

To load it for every session in a project, link it into that project's `.omp/extensions/`, or into `~/.omp/agent/extensions/` for every session on the machine.

## Configure

The harness's own memory backend **must** be off. Two systems injecting recalled content into one window makes a bad pack impossible to diagnose (ADR-0003). In `~/.omp/agent/config.yml`:

```yaml
memory:
  backend: off
```

The extension checks this at session start and reports loudly if it is still active.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CM_TAIL_TURNS` | `8` | Completed Turns carried verbatim ahead of the current one. `0` keeps only the current Turn. |
| `CM_RECALL_TURNS` | `4` | Turns a pack may carry that were recalled by meaning. `0` disables recall. |
| `CM_RECALL_MAX_DISTANCE` | `0.5` | How distant a Turn may be and still be recalled, as cosine distance. Measured, not chosen: genuine hits land at 0.30–0.39 and unrelated prompts at 0.51+ on the pinned model. |
| `CM_DATABASE_URL` | unset | Thread Store connection. Unset means run with no store: the tail falls back to the harness's own history. |
| `CM_BUN` | `bun` | The Bun used to run the embedding worker. Set it to an absolute path when `bun` is not on the harness's `PATH`. |

## Recall

Ingested Turns are embedded with a pinned local model, so a decision made far outside the verbatim tail can still reach the model. A Turn is recalled only when it is similar enough to be worth carrying, so a Conversation with nothing relevant to say contributes nothing rather than its least-irrelevant Turns. Recalled Turns arrive as an attributed recollection — `[recalled from turn N of this conversation]` — under their own Budget, and can never displace the verbatim tail or the current prompt.

The model runs **out of process**, under the project's own Bun. The harness's bundled runtime cannot load the model's native dependencies (`Could not load the "sharp" module`), so the worker is spawned on first use and reused for the session. Nothing leaves the machine and no API key is needed; the first run downloads the model and caches it.

## Start the Thread Store

```sh
docker compose up -d
export CM_DATABASE_URL=postgres://context_manager:context_manager@localhost:55432/thread_store
```

The schema is created and migrated forward automatically on connect; there is no setup step. The port is overridable with `CM_PG_PORT`.

## What it records

The Thread Store holds two things, both keyed by Conversation, Turn, and Call.

**Turns**, ingested from the harness's Journal after each Turn completes — prompts, responses, tool calls, tool results, artifacts. This is a derived index, never the record: the Journal on disk is the record, and dropping the database and re-ingesting restores it (ADR-0002).

**Accounting**, one row per Call, read back grouped under its Turn:

- `floorTokens` — the Floor, reported by the harness as `nonMessageTokens`: system prompt, tool schemas, skills, and rules. Not controlled by the Assembler.
- `packTokens` — the measured pack size, `promptTokens − nonMessageTokens`; for a Turn, the widest its window reached.
- `calls[].parts` — which part of the Assembler contributed what, counted locally and **approximate**. Never used for the pack-versus-Floor figures.
- `calls[].tailSource` — `thread-store` or `harness-fallback`, so a session spent running without the store is visible afterwards rather than mysterious.
- `calls[].unassembled` — set when assembly failed and the harness's own array was used for that Call.

## Develop

```sh
bun test          # fast, deterministic, no container, no model, no network
bun run typecheck

# Store-backed: real SQL against the Compose database
CM_DATABASE_URL=postgres://context_manager:context_manager@localhost:55432/thread_store \
  bun test test/postgres-store.test.ts

# Live: real sessions against a real model
CM_LIVE=1 bun test test/headless.test.ts

# Model: exercises the pinned embedding model rather than the stub
CM_EMBED=1 bun test test/embedder.test.ts
```

Two suites are gated, for two different reasons. The store-backed tests need real Postgres because "the schema applies" and "SQL returns Turns in order" mean nothing against a fake. The live tests need a provider because they cover the claims that are only true when the harness and the model agree: that a pack reaches the model, that the Journal keeps what the model never saw, and that window sizes are reported.

`test/fixtures/*.json` are message arrays captured from real sessions. Regenerate them with `test/capture-extension.ts`, which records what the harness passes to the `context` event and changes nothing:

```sh
CM_CAPTURE_FILE=/tmp/capture.jsonl omp -p -e test/capture-extension.ts "<prompt>"
```

## Reaching other conversations

Recall into a Context Pack never leaves the current Conversation — that scoping has held since the first slice and still does. When the answer is somewhere else, the agent calls `recall_across_conversations`, which searches every ingested Conversation under the same relevance threshold and returns hits with the Conversation and Codebase they came from.

It is a tool rather than a second recall tier on purpose: assembly stays deterministic, and a session that went looking elsewhere is readable in the transcript afterwards.

## Inspect a pack

`/pack` in the harness shows what the last Call's Context Window was made of:

```
Turn 6, call 0
  recalled       ~112 tokens (3 of 3) turns 1, 3, 0
  verbatim-tail  ~67 tokens (2 of 2) turns 4, 5
  current-turn   ~18 tokens
  window        pack 3984 + floor 25588 (floor is 87% of the window)
```

- `/pack` — the last Call
- `/pack diff` — what entered and left since the Call before it
- `/pack summary` — the whole Conversation, with average Budget spend
- `/pack budget <tail|recall> <n>` — change a Budget from the next Call; in memory only, so it never leaks into the next session

Part sizes are the local approximation and are labelled as such. Pack-versus-Floor uses the harness's own reported figures on both sides.
