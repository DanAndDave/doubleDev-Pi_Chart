# Pi Chart

Assembles a fresh Context Pack for every Turn of a coding agent, so the context window stops growing.

The agent's window is rebuilt each Turn from what that Turn needs, rather than inherited from everything that came before. The Assembler owns the window and measures what it costs, and four Stores supply it: the **Thread Store** holds the Turns so they outlive the session, the **Doc Store** carries curated Concepts, the **Graph Store** answers structural questions from a parse, and the **Spec Store** checks that a Codebase is set up for spec-driven work — the one Store that puts nothing in a pack.

See `CONTEXT.md` for the vocabulary and `docs/adr/` for the decisions.

## Requirements

- [omp](https://github.com/can1357/oh-my-pi) — the harness this loads into
- Bun (pinned in `mise.toml`; `mise install` provides it)
- Nothing more for the Thread Store: it is embedded (PGlite — Postgres compiled to WASM, with an official pgvector build), runs in this process, and persists to `~/.pi-chart/store`. A fresh machine needs only Bun. To run against a real Postgres server instead — for a heavier corpus — set `PICHART_DATABASE_URL` to any pgvector-capable one (a system package, [Postgres.app](https://postgresapp.com), or a hosted [Neon](https://neon.tech)/[Supabase](https://supabase.com)); `compose.yaml` serves one for `docker compose up`. Declining the store with `PICHART_DATABASE_URL=""` keeps Accounting for the Conversation in progress, so `/pack` still answers; a configured server that is unreachable keeps none, and `/pack` answers only once it is back.

## Install

```sh
git clone <repo> pi-chart && cd pi-chart
mise trust && mise install
bun install
omp install .
```

`mise trust` is required before the pinned Bun resolves in a fresh clone. `omp install .` links the extension for every session on the machine — there is no symlink to place and no path to configure.

### Coming from `context-manager`

This was called `context-manager` until it was called Pi Chart, and four things carry the old name on a machine that ran it:

- **The plugin link.** The harness registers an extension by package name, so run `omp install .` again. Until you do, nothing loads and no session says anything.
- **Settings.** Every `CM_*` is now `PICHART_*`. Nothing reads the old names; a session that finds one says so at startup and `/pi-chart` lists it, so a stale variable is visible rather than silently ignored.
- **The bundle.** Concepts at `~/.context-manager/bundle` are yours, so nothing moves them. Both `/pi-chart` and `/pi-chart setup` name them and wait: move the directory to `~/.pi-chart/bundle`, or point `PICHART_DOC_BUNDLE` at where it is.
- **The Thread Store.** `compose.yaml` names its own project now, so `/pi-chart setup` starts a fresh Postgres under the `pi_chart` role rather than a renamed container on a cluster that only answers to the old one. The old volume, `context-manager_thread-store-data`, is left alone; it holds a derived index the Journal rebuilds, so `docker volume rm context-manager_thread-store-data` is safe once you have re-ingested. `~/.context-manager/graphify` is a cache and can go the same way.

Then, in any session:

```
/pi-chart setup
```

With no `PICHART_DATABASE_URL` set, that opens the embedded Thread Store at `~/.pi-chart/store` (creating it) and a bundle directory — no server, daemon, or container. Set `PICHART_DATABASE_URL` to your own pgvector Postgres and setup checks it is reachable instead, never starting a server it does not own. Running `/pi-chart` with no argument checks the installation instead and says what is missing, with the command that fixes each thing:

```
  ok   embedder runtime  /home/you/.bun/bin/bun
  not  thread store      not reachable; turns are not recorded and nothing is recalled
      run `pi-chart setup`
  ok   harness memory    off, as it must be
  ok   doc bundle        none at /home/you/.pi-chart/bundle; curated knowledge is simply empty
  ok   codebase graph    extraction off; set PICHART_GRAPH=on to derive one
```

Nothing else is required. The embedder finds its own Bun, and the Thread Store is embedded by default — Postgres-in-WASM with pgvector, persisting to `~/.pi-chart/store` (move it with `PICHART_STORE_DIR`) — or the server `PICHART_DATABASE_URL` names. A store that will not open degrades rather than failing: the tail comes from the harness's own history, and recall, curated knowledge, cross-Conversation search and Accounting wait for the store to come back. Each Call says on stderr what it assembled without, and `/pack` records it for the Calls the store was there to record.

## Configure

The harness's own memory backend **must** be off. Two systems injecting recalled content into one window makes a bad pack impossible to diagnose (ADR-0003). In `~/.omp/agent/config.yml`:

```yaml
memory:
  backend: off
```

The extension checks this when a Conversation starts and reports loudly if it is still active — and says so too when the harness does not report its backend at all, because an invariant that cannot be checked is not a confirmed one. What it cannot do is remove the content: every backend injects into the system prompt, which is the Floor, and the Assembler does not supply the Floor. So the state is recorded against every Call as `off`, `active` or `unconfirmed`; `pack <turn>` says whether that Call ran with a second injector, and `pack summary` names every Call of the Conversation that did (ADR-0004).

Every setting below has a working default. They exist for tuning, not for setup.

Each part of a pack is bounded twice — by a count of items and by a size in estimated tokens — and is trimmed to whichever binds first. A count says something a size cannot (`PICHART_TAIL_TURNS=0` means "only the current Turn"), and a size says what a count cannot: one Turn carrying six file reads costs two orders of magnitude more than one carrying a sentence.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PICHART_TAIL_TURNS` | `8` | Completed Turns carried verbatim ahead of the current one. `0` keeps only the current Turn. |
| `PICHART_RECALL_TURNS` | `4` | Turns a pack may carry that were recalled by meaning. `0` disables recall. |
| `PICHART_RECALL_MAX_DISTANCE` | `0.52` | How distant a Turn may be and still be recalled, as cosine distance. Measured, not chosen: over 99 real Turns, a prompt asked in other words reaches its own Turn within 0.52 in 92% of cases and no off-topic text comes within it at all. |
| `PICHART_DATABASE_URL` | unset — the store is embedded | A Postgres server to use in place of the embedded store, for a heavier corpus. Any pgvector-capable one works — a system package, Postgres.app, or a hosted Neon/Supabase — and setup checks that server rather than opening the embedded store. Empty (`""`) declines the store; a configured server that is unreachable loses the same parts by accident. Either way the tail comes from the harness's own history and recall, curated knowledge and cross-Conversation search stop with it — declined keeps Accounting for the Conversation in progress, unreachable keeps none. |
| `PICHART_BUN` | found | The Bun that runs the embedding worker. Located automatically — including under version managers, whose shims fail outside a directory they know. Set it only to override. |
| `PICHART_EMBED_MODEL` | `Xenova/bge-small-en-v1.5` | The model the embedding worker loads. The schema stores one vector width, so a model of another width is refused by the embedding pass itself (`embedPending`), which reports the mismatch rather than writing vectors the index cannot rank; recall and curated knowledge stay empty until the width matches again. A same-width model is accepted, and both Stores record which model made each vector: a vector from another model is never ranked, and is embedded again by the pass that keeps the index in line. So a swap costs one re-embedding of the Turns and one of the Concept sections, in the background, and a search says how much of the index it could not see while that is happening rather than reading as a corpus with nothing relevant in it. Measured by `scripts/measure-model-swap.ts` between two 384-dimension models over the vendored bundle: 33 sections re-embedded in 3.0s, nothing on any pass after that, and the same five Concepts at the same distances once the swap is reversed. |
| `PICHART_DOC_CONCEPTS` | `2` | Concepts a pack may carry from the Doc Store. `0` disables curated knowledge. |
| `PICHART_DOC_MAX_DISTANCE` | `0.5` | How distant a Concept may be and still be carried. Measured on curated prose, separately from recall: genuine hits land at 0.24–0.42 and unrelated queries at 0.61+. |
| `PICHART_STORE_DIR` | `~/.pi-chart/store` | Where the embedded Thread Store persists, so it outlives the process. Used only when `PICHART_DATABASE_URL` is unset. |
| `PICHART_DOC_BUNDLE` | `~/.pi-chart/bundle` | The OKF bundle read as the Doc Store. Machine-wide: one bundle serves every Codebase. |
| `PICHART_GRAPH_SYMBOLS` | `3` | Symbols whose connections a pack may carry. `0` disables structure. |
| `PICHART_GRAPH` | off | `on` derives a graph, which writes `graphify-out/` into the codebase. An existing one is read either way. |
| `PICHART_SPECS` | on | `off` stops the extension checking the codebase's OpenSpec tree. |
| `PICHART_PACK_TOKENS` | `300000` | The whole pack's ceiling in estimated tokens. When the parts together exceed it they are reduced in a fixed order — structure, then curated knowledge, then the weakest recollections, then the oldest Turns of the tail. The current Turn is never dropped. Sized for large-context models: 300,000 estimated tokens presumes a reported window of ~478,000 (this ceiling × the estimator's measured 1.5× worst-case bias, plus this project's ~28,000 Floor). On a 200,000-token window, lower it so the pack cannot overrun the window it cannot see. |
| `PICHART_TAIL_TOKENS` | `25000` | Size Budget for the verbatim tail. Its most recent Turn is always kept, shortened if it cannot fit whole, because that Turn is what the current one is reasoning about. |
| `PICHART_RECALL_TOKENS` | `8000` | Size Budget for recalled Turns. A Budget too small to hold one readable recollection carries none. |
| `PICHART_DOC_TOKENS` | `5000` | Size Budget for curated knowledge. A Concept too large for it is dropped rather than shortened — the bundle holds others, and `walk_documentation` reaches the rest at no Budget. |
| `PICHART_GRAPH_TOKENS` | `3000` | Size Budget for structure. |
| `PICHART_PACK_WARN_SHARE` | `0.75` | The share of the ceiling at which the extension says a Conversation's packs are creeping up. Reported once per Conversation; a pack that cannot be brought under the ceiling at all is reported every time. |
| `PICHART_TAIL_DEADLINE_MS` | `1500` | How long a Call waits for the verbatim tail before assembling without it. The tail is one indexed read — 47.9 ms at worst against this machine's 388-Turn store — so anything slower is a Store in trouble. |
| `PICHART_RECALL_DEADLINE_MS` | `5000` | How long a Call waits for recall. Its worst measured read is 81.4 ms, most of it embedding the query, and a fresh embedder adds 350 ms loading the model. |
| `PICHART_DOC_DEADLINE_MS` | `5000` | How long a Call waits for curated knowledge. |
| `PICHART_GRAPH_DEADLINE_MS` | `5000` | How long a Call waits for structure. |
| `PICHART_RETAIN_DAYS` | unset | Retire Turns that entered the Store longer ago than this, with their messages. Unset means nothing is ever removed: how long the Store keeps a Turn is your policy. Turns stored before arrival times were recorded have no age and are never retired, and Accounting survives whatever goes. |
| `PICHART_EXPLAIN_CANDIDATES` | `12` | How many excluded candidates each part of a Call records by identity, so `/pack why` can name them. Measured: pooling this machine's 403 real Turns into one Conversation, the Turn a user would ask about sat as deep as rank 12 among the candidates, and a head of 5 would have named it in fewer than half the cases it was reachable at all. What is beyond the head is still counted. |

## Recall

Ingested Turns are embedded with a pinned local model, so a decision made far outside the verbatim tail can still reach the model. A Turn is recalled only when it is similar enough to be worth carrying, so a Conversation with nothing relevant to say contributes nothing rather than its least-irrelevant Turns. Recalled Turns arrive as an attributed recollection — `[recalled from turn N of this conversation]` — under their own Budget, and can never displace the verbatim tail or the current prompt.

A Turn is embedded as a **bounded representation of the whole Turn**: its prompt, what the agent said, each tool call with the arguments it was made with, and what those calls returned. The model reads 512 tokens and silently drops the rest, so the parts compete for a share of a character allowance rather than being concatenated and cut — of the 48 Turns here larger than that cut, 3 used to carry their own conclusion inside their vector and 47 now do, and none carried a tool call at all before. A recall query carries the model's query instruction; a stored Turn never does, so rewording the instruction cannot invalidate the corpus.

A stored vector is valid only for the content and the model that produced it. A Turn whose text changes loses its vector and is re-embedded by the same background pass that embeds a new Turn; a vector produced by another embedding model is never ranked, counts as pending, and the condition is reported once naming both models. Recall over the current Conversation is exact rather than approximate — every Turn of it holding a valid vector is scored — so a growing corpus cannot quietly starve one Conversation's recall; `/pack` says when a recall could not see part of its Conversation because embedding has not caught up.

The model runs **out of process**, under the project's own Bun. The harness's bundled runtime cannot load the model's native dependencies (`Could not load the "sharp" module`), so the worker is spawned on first use and reused for the session. Nothing leaves the machine and no API key is needed; the first run downloads the model and caches it.

## Curated knowledge

The Doc Store is an [OKF](https://github.com/google/okf) bundle of Concepts — decisions, standards, guides — that outlive any one Conversation. It is machine-wide, so a decision written once is available in every Codebase.

**Indexing a bundle writes into it.** OKF identifies a Concept by its file path, so a move would silently destroy one Concept and create another — fatal once an index keys off identity. Every Conversation that starts with both a bundle and a Thread Store configured therefore gives each conformant Concept that lacks one a `cm_identity` key, written back through a temporary file and a rename (`ensureIdentities`, called from `readBundle` before the index is brought in line). Walking the bundle never writes; declining the Thread Store means nothing indexes it, so nothing writes either. It is one line of frontmatter, the format sanctions extra keys, and it happens once per Concept — but a bundle under version control goes dirty the first time this extension reads it, and that is worth knowing before it does. Authoring through `write_documentation` writes more, and deliberately.

Concepts are indexed by **section** rather than whole. A Concept that covers a decision, its rationale and its consequences has three subjects, and one vector for all three matches none of them well; sections are how a Concept is found, and the Concept is what is returned. Each section is embedded under the Concept's title and the author's own one-line summary, so a Concept is findable by a paraphrase of its subject and not only by the wording of its body. Measured by `scripts/measure-summary-placement.ts` over this repository's decisions and the vendored bundle: attaching the summary moved genuine queries from 0.244–0.438 to 0.229–0.427 while unrelated ones stayed at 0.597–0.644, and it put the right section of a multi-subject Concept first in 5 probes of 6 against 3 with the summary on the first section alone. The index is derived from the bundle exactly as the Thread Store is derived from the Journal: re-indexing embeds only sections whose text changed, Concepts removed from the bundle leave, and dropping the index loses nothing.

Two lifecycle rules keep curated knowledge honest:

- **Deprecated Concepts are withheld**, never merely ranked lower. A superseded decision presented as current is the one failure this Store must not have.
- **Current and human-reviewed Concepts win ties.** Among matches of comparable relevance, fresher and reviewed knowledge comes first — a tie-break, not a trust score mixed into a distance, so it stays possible to say why a Concept was chosen.

What reaches a pack is usually one section, and it says so — `[curated knowledge: metrics/gross-margin — part 2 of 4]`, with a note that the rest is readable through `walk_documentation` at no Budget. A fragment headed with the Concept's name alone reads as the Concept's complete answer, which is the one thing curated knowledge must not do. What a Concept records that it is **not** travels with it, because a definition served without the exclusions that qualify it invites the mistake they exist to prevent. Concepts arrive under their own Budget, and exhausting it never touches the verbatim tail or recalled Turns; `/pack` names the Concepts a Call carried.

Retrieval answers "what is relevant to this prompt". The `walk_documentation` tool answers the other question — "what is there" — by reading one **Level** at a time: its sub-levels and the Concepts directly in it, each with its description, without loading anything deeper. An author's own `index.md` listing supplies the order and the wording, because that ordering is a judgement about what matters first; a Concept the listing omits is appended and marked rather than hidden, and a Concept that cannot be read is named as broken rather than served empty. Walking costs no Budget: it is the agent deciding it needs the map, so the Context Pack is the same whether or not it looked.

### Writing a concept

`write_documentation` records a conclusion without leaving the Conversation: an id, a type, a title, a one-line summary, a body, and optionally what the Concept is not and what it was drawn from. The file is written through a temporary file and renamed into place, given a stable identity immediately, added to its Level's listing where that listing is curated, and indexed on the spot — so what was written in this Turn is retrievable in the next Call, with nothing restarted.

What an agent writes **cannot claim human review.** Trust is derived from who verified a Concept and retrieval ranks on it, so a request to record a human verifier is refused by name rather than stripped in silence. An authored Concept enters as a `draft`, unverified, recording the machine that wrote it. And a verification older than a Concept's most recent machine-recorded change stops counting toward its tier — otherwise revising a reviewed Concept would carry its review onto text no human has read. The signature stays in the file for whoever re-reviews it.

Authoring writes into the user's own bundle, which is usually under version control: a written Concept shows up as a change there, deliberately, exactly as identity assignment already does.

## Codebase structure

The Graph Store answers structural questions — what calls this, what does it import — from a parse rather than from a search. No embedding is involved: a symbol's name is exact, and "what calls `parseConcept`?" has one correct answer.

It uses [graphify](https://github.com/Graphify-Labs/graphify), installed at a pinned version into a private virtual environment under `~/.pi-chart/graphify`, because this machine had no `uv`, `pipx` or `pip` and `python3 -m venv` is always there.

**It writes into your repository, so it is off by default.** `graphify extract` creates `graphify-out/` in the Codebase and offers no way to redirect it; graphify intends that directory to be committed so a team shares one map, but that is not a thing to do to someone's repo unasked. `PICHART_GRAPH=on` opts in, and an existing extraction is read either way.

Only what a parser established is carried. Three separate conditions, because each excludes something the others do not:

- the edge's own `confidence` is `EXTRACTED` — `--code-only` still emits inferred `calls` at confidence 0.8;
- the relation is one the adapter knows to be programmatic — which drops `cites` and `semantically_similar_to`;
- both ends are code — which drops documentation nodes like `ADR-0002` and bare references like `ref_bun`.

A relation the adapter does not recognise is left out rather than assumed harmless, and output that does not meet what the adapter requires raises an error naming the missing field. A moving schema should cost recall, never correctness.

Symbols are matched by name, ignoring case and punctuation, so `recordPack`, `record_pack` and `.recordPack()` are one name. A bare English word that matches only a *method* name is dropped when the prompt also names something unambiguously — measured live, "do not read, grep, or list any files" was spending 457 tokens on `.read()` and `.list()` for a question about something else. A bare word matching a function or a type is kept, because nothing in ordinary prose looks like `assemble`.

The symbols in play come from the whole current Turn, not its opening prompt: most Calls of an agentic Turn are made after tool results the prompt could not have named, and "keep going" names nothing. Each message contributes its first 1,000 characters and only the Turn's 32 most recent messages are read — measured over 423 real Turns here, scanning the widest whole (1,805 messages, 1.58 M characters) costs 89 ms on the Call's own path against 1.1 ms bounded. A file in play counts too: naming `src/assembler.ts`, `./src/assembler.ts`, an absolute path, or the bare word `assembler` reaches the symbols that file defines, through the file the graph itself states rather than a suffix rule on the name. What the prompt names outranks what a file merely contains.

**Structure says how old it is.** The graph is re-extracted after every Turn as well as at session start — extraction is content-hash incremental, so an unchanged tree costs a scan rather than a build, and it runs in the background where nothing waits on it. Between that and the next Call, a file the agent just edited is older than the extraction, so each neighbourhood is compared against its own file's modification time and carried marked: `[codebase structure: assemble() (src/assembler.ts:L92) (older than the codebase)]`. Marked, never withheld — the Turn that edits code is the Turn that most needs a starting point — and per symbol, so one edited file does not stale the rest. A file whose age cannot be established counts as older.

A symbol contributes at most twelve connections and says how many it left out, so one hub cannot swallow the Budget: measured over this repository, a neighbourhood is 72 tokens at the median and 305 at worst. Which twelve is decided by what the connection says: what calls, imports, inherits from or depends on a symbol before what it merely contains or has as a member. Measured over this repository's own graph before that ranking, 188 of 684 kept connections were membership and 29 of 57 over-sized symbols had real uses displaced by them.

The Graph Store needs no Postgres: declining the Thread Store with `PICHART_DATABASE_URL=""` leaves structure and the Spec Store exactly as they were, and leaves the documentation bundle walkable and writable. What it takes with it is the Concept *index*, which lives in the same Postgres — so curated knowledge stops reaching a pack by meaning even though `walk_documentation` still reads every word of it.

## Stated intent

The Spec Store is the one store this project does not own, and the only one that puts nothing in a pack. A Codebase's specs reach the agent through the workflow that reads them; this store's job is to make sure that workflow has something to read.

At session start it checks the shape of `openspec/` — the root, `specs/`, `changes/`, `changes/archive/`, and `config.yaml` — and speaks only when a tree exists and is wrong. A Codebase with no tree at all is not spec-driven, which is its own business; `/specs` answers on demand. That check is here rather than delegated because OpenSpec does not make it: measured, both `openspec list` and `openspec validate --all --strict` exit 0 on a tree missing `specs/`, missing `changes/archive/`, or missing `config.yaml`. Content is a different matter — OpenSpec defines what valid content is, so `specs` reports its words verbatim rather than a paraphrase that would drift.

Nothing is created unasked. An `openspec/` tree is a claim about how a project is run, not a cache that can be regenerated, so initialization happens when you ask:

- `/specs` — verify the tree and report what OpenSpec says about its content
- `/specs init` — create what is missing, through `openspec init`, which leaves existing specs, changes, and configuration untouched

## The Thread Store

The Thread Store is embedded by default: PGlite — real Postgres compiled to WASM with an official pgvector build — running in this process and persisting to `~/.pi-chart/store` (move it with `PICHART_STORE_DIR`). There is nothing to start; `pi-chart setup` opens it, and a fresh machine needs only Bun.

For a heavier corpus, point the store at a Postgres server instead. Any pgvector-capable one works:

- A system package, or [Postgres.app](https://postgresapp.com).
- A hosted one — [Neon](https://neon.tech) and [Supabase](https://supabase.com) both ship pgvector.
- The bundled `compose.yaml`, for a local container:

```sh
docker compose up -d
export PICHART_DATABASE_URL=postgres://pi_chart:pi_chart@localhost:55432/thread_store
```

Whichever you name in `PICHART_DATABASE_URL`, `setup` checks it is reachable and never starts a server it does not own. The SQL and schema are the same as the embedded store, so the choice moves where content lives, not what can be retrieved. `compose.yaml` honours `PICHART_PG_PORT` for the port it publishes; the extension reads no port of its own — the URL you supply is dialled verbatim.

## What it records

The Thread Store holds two things, both keyed by Conversation, Turn, and Call.

**Turns**, ingested from the harness's Journal after each Turn completes — prompts, responses, tool calls, tool results, artifacts. This is a derived index, never the record: the Journal on disk is the record, and dropping the database and re-ingesting restores it (ADR-0002).

**Accounting**, one row per Call, read back grouped under its Turn:

- `floorTokens` — the Floor, reported by the harness as `nonMessageTokens`: system prompt, tool schemas, skills, and rules. Not controlled by the Assembler.
- `packTokens` — the measured pack size, `promptTokens − nonMessageTokens`; for a Turn, the widest its window reached.
- `calls[].parts` — which part of the Assembler contributed what, counted locally and **approximate**. Never used for the pack-versus-Floor figures.
- `calls[].tailSource` — `thread-store` or `harness-fallback`, so a Call assembled without the store is visible afterwards, for the Calls the store was there to record.
- `calls[].unassembled` — set when assembly failed and the harness's own array was used for that Call.
- `calls[].leadingTokens` — how much of the Pack the harness supplied itself and could therefore mark for caching. What a Call was charged says nothing about why without it.

## Develop

```sh
bun test          # fast, deterministic, no container, no model, no network — store suites included, on the embedded PGlite store
bun run typecheck

# Store-backed suites run on the embedded store under plain `bun test`.
# To run them against a Postgres server instead:
PICHART_DATABASE_URL=postgres://pi_chart:pi_chart@localhost:55432/thread_store \
  bun test test/postgres-store.test.ts

# Live: real sessions against a real model
PICHART_LIVE=1 bun test test/headless.test.ts

# Model: exercises the pinned embedding model rather than the stub
PICHART_EMBED=1 bun test test/embedder.test.ts

# Tools: against the real graphify and the real OpenSpec CLI
PICHART_GRAPHIFY=1 bun test test/graphify.test.ts
PICHART_OPENSPEC=1 bun test test/openspec.test.ts
```

Five suites are gated, each because a fake would prove the wrong thing. The store-backed tests need real Postgres because "the schema applies" and "SQL returns Turns in order" mean nothing against a stub. The live tests need a provider because they cover the claims that are only true when the harness and the model agree: that a pack reaches the model, that the Journal keeps what the model never saw, and that window sizes are reported. The model suite needs the pinned embedder because the stub shares tokens, so under it "by meaning" and "by wording" are the same claim. The tool suites need the real graphify and OpenSpec because they are the only evidence that `--code-only` still emits inferred edges, that `openspec init` does not damage an existing tree, and that a malformed change is diagnosed in OpenSpec's own words.

`test/fixtures/*.json` are message arrays captured from real sessions. Regenerate them with `test/capture-extension.ts`, which records what the harness passes to the `context` event and changes nothing:

```sh
PICHART_CAPTURE_FILE=/tmp/capture.jsonl omp -p -e test/capture-extension.ts "<prompt>"
```

## Reaching other conversations

Recall into a Context Pack never leaves the current Conversation — that scoping has held since the first slice and still does. When the answer is somewhere else, the agent calls `recall_across_conversations`, which searches every ingested Conversation under the same relevance threshold and returns hits with the Conversation and Codebase they came from.

It is a tool rather than a second recall tier on purpose: assembly stays deterministic, and a session that went looking elsewhere is readable in the transcript afterwards.

## The order of a pack

A Pack begins with the longest run of messages the harness itself supplied for that Call, carried unaltered and in its positions; then recalled Turns, curated knowledge and structure; then the rest of the verbatim tail; then the Turn in progress. Background still sits between the Turns already answered and the prompt it is background for — what passes it now are the completed Turns the harness already had. The run ends at a Turn boundary, so nothing assembled is ever carried between a tool call and its result.

The reason is measured. The harness marks a returned array for caching only as far as the first message that is not its own at that index, so a Pack opening with an assembled part is cached not at all: **0.0%** of the Pack across 545 governed Calls, against **97.2%** ungoverned (ADR-0005). Leading with the run takes a governed Call carrying curated knowledge from **13,934** to **6,298** tokens charged at the provider's multipliers — about what an ungoverned Call costs, for a Pack a third the size (ADR-0006).

Nothing is altered to lengthen the run. A message elision shortened, a Turn the Thread Store holds differently, a tail that starts later than the harness's array: each ends the run and is carried after it. A first Call has no completed Turn to lead with and caches nothing, which is the Call that fills the cache rather than reads it.

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
- `/pack` also says what each Call cost: `cache  33281 read, 108 written (92% of the pack read from cache)`. The share is of the Pack rather than of the window, because the Floor is most of a window and caches whatever the Pack does — a rate over the window reads about 70% on a Call where none of the Pack was cached at all (ADR-0005) — and the `prefix` line beside it says how much of the Pack the harness sent itself, which is what a cache reading is explained by (ADR-0006)
- `/pack summary` — the whole Conversation, with average Budget spend, how the estimate compared with the reported window sizes, where the harness compacted, and which Calls ran with the harness's memory backend not off
- `/pack budget <name> <n>` — change a Budget from the next Call; in memory only, so it never leaks into the next session. Counts: `tail`, `recall`, `docs`, `graph`. Sizes, in estimated tokens: `tail-tokens`, `recall-tokens`, `docs-tokens`, `graph-tokens`, and `pack` for the whole pack's ceiling

Part sizes are the local approximation and are labelled as such. Pack-versus-Floor uses the harness's own reported figures on both sides, and the `estimate` line puts our figure beside the harness's so the bias the Budgets are applied to is visible.

What a Call excluded is kept by identity, never by content: a Turn by its position, a Concept by its id, a symbol by its name, with the distance or size that decided. The Journal and the bundle stay the record of what was actually said.
