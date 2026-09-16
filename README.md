# context-manager

Assembles a fresh Context Pack for every Turn of a coding agent, so the context window stops growing.

The agent's window is rebuilt each Turn from what that Turn needs, rather than inherited from everything that came before. This is the first slice: the Assembler owns the window and measures what it costs. The four Stores it will draw from — Doc, Spec, Thread, Graph — arrive in later slices.

See `CONTEXT.md` for the vocabulary and `docs/adr/` for the decisions.

## Requirements

- [omp](https://github.com/can1357/oh-my-pi) — the harness this loads into
- Bun (pinned in `mise.toml`; `mise install` provides it)

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
| `CM_ACCOUNTING_DIR` | `~/.context-manager/accounting` | Where per-Conversation accounting is written. |

## What it records

One JSONL file per Conversation, append-only. Every Call gets a `pack` entry when its Context Pack is assembled, and a `measurement` entry once the harness reports what the window actually cost — often after the process that assembled it has exited, which is why the file is append-only rather than rewritten. Reading merges them and groups Calls under their Turn, so a tool-using Turn reads as one Turn with several Calls:

- `floorTokens` — the Floor, reported by the harness as `nonMessageTokens`: system prompt, tool schemas, skills, and rules. Not controlled by the Assembler.
- `packTokens` — the measured pack size, `promptTokens − nonMessageTokens`; for a Turn, the widest its window reached.
- `calls[].parts` — which part of the Assembler contributed what, counted locally and **approximate**. Never used for the pack-versus-Floor figures.
- `calls[].unassembled` — set when assembly failed and the harness's own array was used for that Call.

## Develop

```sh
bun test          # fast, deterministic, no model and no network
bun run typecheck
CM_LIVE=1 bun test test/headless.test.ts   # runs real sessions against a real model
```

The live tests are separate because they call a provider. They cover the three claims that are only true when the harness and the provider agree: that a pack reaches the model, that the Journal keeps what the model never saw, and that window sizes are reported.
