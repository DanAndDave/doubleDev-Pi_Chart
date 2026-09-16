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
| `CM_DATABASE_URL` | unset | Thread Store connection. Unset means run with no store: the tail falls back to the harness's own history. |

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
```

Two suites are gated, for two different reasons. The store-backed tests need real Postgres because "the schema applies" and "SQL returns Turns in order" mean nothing against a fake. The live tests need a provider because they cover the claims that are only true when the harness and the model agree: that a pack reaches the model, that the Journal keeps what the model never saw, and that window sizes are reported.

`test/fixtures/*.json` are message arrays captured from real sessions. Regenerate them with `test/capture-extension.ts`, which records what the harness passes to the `context` event and changes nothing:

```sh
CM_CAPTURE_FILE=/tmp/capture.jsonl omp -p -e test/capture-extension.ts "<prompt>"
```
