# context-manager

Assembles a fresh Context Pack for every Turn of a coding agent, so the context window stops growing.

The agent's window is rebuilt each Turn from what that Turn needs, rather than inherited from everything that came before. The Assembler owns the window and measures what it costs, and four Stores supply it: the **Thread Store** holds the Turns so they outlive the session, the **Doc Store** carries curated Concepts, the **Graph Store** answers structural questions from a parse, and the **Spec Store** checks that a Codebase is set up for spec-driven work — the one Store that puts nothing in a pack.

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
omp install .
```

`mise trust` is required before the pinned Bun resolves in a fresh clone. `omp install .` links the extension for every session on the machine — there is no symlink to place and no path to configure.

Then, in any session:

```
/context-manager setup
```

That starts the Thread Store's Postgres and creates a bundle directory. Running `/context-manager` with no argument checks the installation instead and says what is missing, with the command that fixes each thing:

```
  ok   embedder runtime  /home/you/.bun/bin/bun
  not  thread store      not reachable; turns are not recorded and nothing is recalled
      run `context-manager setup`
  ok   harness memory    off, as it must be
  ok   doc bundle        none at /home/you/.context-manager/bundle; curated knowledge is simply empty
  ok   codebase graph    extraction off; set CM_GRAPH=on to derive one
```

Nothing else is required. The embedder finds its own Bun, the Thread Store defaults to what this project's `compose.yaml` serves, and a store that is not running degrades to the harness's own history rather than failing — which `/pack` reports, so a session spent running without it is visible rather than mysterious.

## Configure

The harness's own memory backend **must** be off. Two systems injecting recalled content into one window makes a bad pack impossible to diagnose (ADR-0003). In `~/.omp/agent/config.yml`:

```yaml
memory:
  backend: off
```

The extension checks this at session start and reports loudly if it is still active — and says so too when the harness does not report its backend at all, because an invariant that cannot be checked is not a confirmed one.

Every setting below has a working default. They exist for tuning, not for setup.

Each part of a pack is bounded twice — by a count of items and by a size in estimated tokens — and is trimmed to whichever binds first. A count says something a size cannot (`CM_TAIL_TURNS=0` means "only the current Turn"), and a size says what a count cannot: one Turn carrying six file reads costs two orders of magnitude more than one carrying a sentence.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CM_TAIL_TURNS` | `8` | Completed Turns carried verbatim ahead of the current one. `0` keeps only the current Turn. |
| `CM_RECALL_TURNS` | `4` | Turns a pack may carry that were recalled by meaning. `0` disables recall. |
| `CM_RECALL_MAX_DISTANCE` | `0.52` | How distant a Turn may be and still be recalled, as cosine distance. Measured, not chosen: over 99 real Turns, a prompt asked in other words reaches its own Turn within 0.52 in 92% of cases and no off-topic text comes within it at all. |
| `CM_DATABASE_URL` | this project's compose default | Thread Store connection. An unreachable store degrades to the harness's own history. |
| `CM_BUN` | found | The Bun that runs the embedding worker. Located automatically — including under version managers, whose shims fail outside a directory they know. Set it only to override. |
| `CM_DOC_CONCEPTS` | `2` | Concepts a pack may carry from the Doc Store. `0` disables curated knowledge. |
| `CM_DOC_MAX_DISTANCE` | `0.5` | How distant a Concept may be and still be carried. Measured on curated prose, separately from recall: genuine hits land at 0.24–0.42 and unrelated queries at 0.61+. |
| `CM_DOC_BUNDLE` | `~/.context-manager/bundle` | The OKF bundle read as the Doc Store. Machine-wide: one bundle serves every Codebase. |
| `CM_GRAPH_SYMBOLS` | `3` | Symbols whose connections a pack may carry. `0` disables structure. |
| `CM_GRAPH` | off | `on` derives a graph, which writes `graphify-out/` into the codebase. An existing one is read either way. |
| `CM_SPECS` | on | `off` stops the extension checking the codebase's OpenSpec tree. |
| `CM_PACK_TOKENS` | `110000` | The whole pack's ceiling in estimated tokens. When the parts together exceed it they are reduced in a fixed order — structure, then curated knowledge, then the weakest recollections, then the oldest Turns of the tail. The current Turn is never dropped. Derived, not chosen: a 200,000-token window less this project's measured ~28,000 Floor, divided by the estimator's measured worst-case bias of 1.5. |
| `CM_TAIL_TOKENS` | `25000` | Size Budget for the verbatim tail. Its most recent Turn is always kept, shortened if it cannot fit whole, because that Turn is what the current one is reasoning about. |
| `CM_RECALL_TOKENS` | `8000` | Size Budget for recalled Turns. A Budget too small to hold one readable recollection carries none. |
| `CM_DOC_TOKENS` | `5000` | Size Budget for curated knowledge. A Concept too large for it is dropped rather than shortened — the bundle holds others, and `walk_documentation` reaches the rest at no Budget. |
| `CM_GRAPH_TOKENS` | `3000` | Size Budget for structure. |
| `CM_PACK_WARN_SHARE` | `0.75` | The share of the ceiling at which the extension says a Conversation's packs are creeping up. Reported once per Conversation; a pack that cannot be brought under the ceiling at all is reported every time. |
| `CM_TAIL_DEADLINE_MS` | `1500` | How long a Call waits for the verbatim tail before assembling without it. The tail is one indexed read — 47.9 ms at worst against this machine's 388-Turn store — so anything slower is a Store in trouble. |
| `CM_RECALL_DEADLINE_MS` | `5000` | How long a Call waits for recall. Its worst measured read is 81.4 ms, most of it embedding the query, and a fresh embedder adds 350 ms loading the model. |
| `CM_DOC_DEADLINE_MS` | `5000` | How long a Call waits for curated knowledge. |
| `CM_GRAPH_DEADLINE_MS` | `5000` | How long a Call waits for structure. |
| `CM_RETAIN_DAYS` | unset | Retire Turns that entered the Store longer ago than this, with their messages. Unset means nothing is ever removed: how long the Store keeps a Turn is your policy. Turns stored before arrival times were recorded have no age and are never retired, and Accounting survives whatever goes. |
| `CM_EXPLAIN_CANDIDATES` | `12` | How many excluded candidates each part of a Call records by identity, so `/pack why` can name them. Measured: pooling this machine's 403 real Turns into one Conversation, the Turn a user would ask about sat as deep as rank 12 among the candidates, and a head of 5 would have named it in fewer than half the cases it was reachable at all. What is beyond the head is still counted. |

## Recall

Ingested Turns are embedded with a pinned local model, so a decision made far outside the verbatim tail can still reach the model. A Turn is recalled only when it is similar enough to be worth carrying, so a Conversation with nothing relevant to say contributes nothing rather than its least-irrelevant Turns. Recalled Turns arrive as an attributed recollection — `[recalled from turn N of this conversation]` — under their own Budget, and can never displace the verbatim tail or the current prompt.

A Turn is embedded as a **bounded representation of the whole Turn**: its prompt, what the agent said, each tool call with the arguments it was made with, and what those calls returned. The model reads 512 tokens and silently drops the rest, so the parts compete for a share of a character allowance rather than being concatenated and cut — of the 48 Turns here larger than that cut, 3 used to carry their own conclusion inside their vector and 47 now do, and none carried a tool call at all before. A recall query carries the model's query instruction; a stored Turn never does, so rewording the instruction cannot invalidate the corpus.

A stored vector is valid only for the content and the model that produced it. A Turn whose text changes loses its vector and is re-embedded by the same background pass that embeds a new Turn; a vector produced by another embedding model is never ranked, counts as pending, and the condition is reported once naming both models. Recall over the current Conversation is exact rather than approximate — every Turn of it holding a valid vector is scored — so a growing corpus cannot quietly starve one Conversation's recall; `/pack` says when a recall could not see part of its Conversation because embedding has not caught up.

The model runs **out of process**, under the project's own Bun. The harness's bundled runtime cannot load the model's native dependencies (`Could not load the "sharp" module`), so the worker is spawned on first use and reused for the session. Nothing leaves the machine and no API key is needed; the first run downloads the model and caches it.

## Curated knowledge

The Doc Store is an [OKF](https://github.com/google/okf) bundle of Concepts — decisions, standards, guides — that outlive any one Conversation. It is machine-wide, so a decision written once is available in every Codebase.

Concepts are indexed by **section** rather than whole. A Concept that covers a decision, its rationale and its consequences has three subjects, and one vector for all three matches none of them well; sections are how a Concept is found, and the Concept is what is returned. The index is derived from the bundle exactly as the Thread Store is derived from the Journal: re-indexing embeds only sections whose text changed, Concepts removed from the bundle leave, and dropping the index loses nothing.

Two lifecycle rules keep curated knowledge honest:

- **Deprecated Concepts are withheld**, never merely ranked lower. A superseded decision presented as current is the one failure this Store must not have.
- **Current and human-reviewed Concepts win ties.** Among matches of comparable relevance, fresher and reviewed knowledge comes first — a tie-break, not a trust score mixed into a distance, so it stays possible to say why a Concept was chosen.

Concepts arrive attributed — `[curated knowledge: decisions/0007-ledger-sharding]` — under their own Budget, and exhausting it never touches the verbatim tail or recalled Turns. `/pack` names the Concepts a Call carried.

Retrieval answers "what is relevant to this prompt". The `walk_documentation` tool answers the other question — "what is there" — by reading one **Level** at a time: its sub-levels and the Concepts directly in it, each with its description, without loading anything deeper. An author's own `index.md` listing wins over a synthesised one, because its ordering is a judgement about what matters first. Walking costs no Budget: it is the agent deciding it needs the map, so the Context Pack is the same whether or not it looked.

## Codebase structure

The Graph Store answers structural questions — what calls this, what does it import — from a parse rather than from a search. No embedding is involved: a symbol's name is exact, and "what calls `parseConcept`?" has one correct answer.

It uses [graphify](https://github.com/Graphify-Labs/graphify), installed at a pinned version into a private virtual environment under `~/.context-manager/graphify`, because this machine had no `uv`, `pipx` or `pip` and `python3 -m venv` is always there.

**It writes into your repository, so it is off by default.** `graphify extract` creates `graphify-out/` in the Codebase and offers no way to redirect it; graphify intends that directory to be committed so a team shares one map, but that is not a thing to do to someone's repo unasked. `CM_GRAPH=on` opts in, and an existing extraction is read either way.

Only what a parser established is carried. Three separate conditions, because each excludes something the others do not:

- the edge's own `confidence` is `EXTRACTED` — `--code-only` still emits inferred `calls` at confidence 0.8;
- the relation is one the adapter knows to be programmatic — which drops `cites` and `semantically_similar_to`;
- both ends are code — which drops documentation nodes like `ADR-0002` and bare references like `ref_bun`.

A relation the adapter does not recognise is left out rather than assumed harmless, and output that does not meet what the adapter requires raises an error naming the missing field. A moving schema should cost recall, never correctness.

Symbols are matched by name, ignoring case and punctuation, so `recordPack`, `record_pack` and `.recordPack()` are one name. A bare English word that matches only a *method* name is dropped when the prompt also names something unambiguously — measured live, "do not read, grep, or list any files" was spending 457 tokens on `.read()` and `.list()` for a question about something else. A bare word matching a function or a type is kept, because nothing in ordinary prose looks like `assemble`.

A symbol contributes at most twelve connections and says how many it left out, so one hub cannot swallow the Budget: measured over this repository, a neighbourhood is 72 tokens at the median and 305 at worst.

## Stated intent

The Spec Store is the one store this project does not own, and the only one that puts nothing in a pack. A Codebase's specs reach the agent through the workflow that reads them; this store's job is to make sure that workflow has something to read.

At session start it checks the shape of `openspec/` — the root, `specs/`, `changes/`, `changes/archive/`, and `config.yaml` — and speaks only when a tree exists and is wrong. A Codebase with no tree at all is not spec-driven, which is its own business; `/specs` answers on demand. That check is here rather than delegated because OpenSpec does not make it: measured, both `openspec list` and `openspec validate --all --strict` exit 0 on a tree missing `specs/`, missing `changes/archive/`, or missing `config.yaml`. Content is a different matter — OpenSpec defines what valid content is, so `specs` reports its words verbatim rather than a paraphrase that would drift.

Nothing is created unasked. An `openspec/` tree is a claim about how a project is run, not a cache that can be regenerated, so initialization happens when you ask:

- `/specs` — verify the tree and report what OpenSpec says about its content
- `/specs init` — create what is missing, through `openspec init`, which leaves existing specs, changes, and configuration untouched

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

# Tools: against the real graphify and the real OpenSpec CLI
CM_GRAPHIFY=1 bun test test/graphify.test.ts
CM_OPENSPEC=1 bun test test/openspec.test.ts
```

Four suites are gated, each because a fake would prove the wrong thing. The store-backed tests need real Postgres because "the schema applies" and "SQL returns Turns in order" mean nothing against a stub. The live tests need a provider because they cover the claims that are only true when the harness and the model agree: that a pack reaches the model, that the Journal keeps what the model never saw, and that window sizes are reported. The tool suites need the real graphify and OpenSpec because they are the only evidence that `--code-only` still emits inferred edges, that `openspec init` does not damage an existing tree, and that a malformed change is diagnosed in OpenSpec's own words.

`test/fixtures/*.json` are message arrays captured from real sessions. Regenerate them with `test/capture-extension.ts`, which records what the harness passes to the `context` event and changes nothing:

```sh
CM_CAPTURE_FILE=/tmp/capture.jsonl omp -p -e test/capture-extension.ts "<prompt>"
```

## Reaching other conversations

Recall into a Context Pack never leaves the current Conversation — that scoping has held since the first slice and still does. When the answer is somewhere else, the agent calls `recall_across_conversations`, which searches every ingested Conversation under the same relevance threshold and returns hits with the Conversation and Codebase they came from.

It is a tool rather than a second recall tier on purpose: assembly stays deterministic, and a session that went looking elsewhere is readable in the transcript afterwards.

## Inspect a pack

`/pack` in the harness shows what the last Call's Context Window was made of, including the parts that carried nothing and why:

```
Turn 6, call 0
  recalled       ~112 tokens (3 of 3, 2 refused against the 0.52 threshold) turns 1, 3, 0
  curated        absent: nothing met the threshold (4 refused against the 0.5 threshold)
  structure      absent: no store configured for it (no relevance threshold)
  verbatim-tail  ~67 tokens (2 of 2) turns 4, 5
  current-turn   ~18 tokens
  window        pack 3984 + floor 25588 (floor is 87% of the window)
  estimate      ~197 estimated against 3984 reported (0.05× the reported size)
```

- `/pack` — the last Call
- `/pack <turn>` or `/pack <turn>.<call>` — any Call the Conversation recorded. A Turn alone is its last Call; an address that was never recorded is refused, naming what is recorded, rather than answered with a different Call
- `/pack why <subject>`, or `/pack why <address> <subject>` — why content matching that subject was not carried: the candidates that were excluded, nearest first, each with its distance or size and the threshold or Budget that excluded it. A number is a Turn; anything else matches a Concept id or a symbol. A leading address is only an address when a subject follows it, so `/pack why 4` asks about Turn 4 and `/pack why 12 4` asks about Turn 4 as Turn 12 saw it
- `/pack diff` — what entered and left since the Call before it; `/pack diff <a> <b>` compares two named Calls
- `/pack summary` — the whole Conversation, with average Budget spend, how the estimate compared with the reported window sizes, and where the harness compacted
- `/pack budget <name> <n>` — change a Budget from the next Call; in memory only, so it never leaks into the next session. Counts: `tail`, `recall`, `docs`, `graph`. Sizes, in estimated tokens: `tail-tokens`, `recall-tokens`, `docs-tokens`, `graph-tokens`, and `pack` for the whole pack's ceiling

Part sizes are the local approximation and are labelled as such. Pack-versus-Floor uses the harness's own reported figures on both sides, and the `estimate` line puts our figure beside the harness's so the bias the Budgets are applied to is visible.

What a Call excluded is kept by identity, never by content: a Turn by its position, a Concept by its id, a symbol by its name, with the distance or size that decided. The Journal and the bundle stay the record of what was actually said.
