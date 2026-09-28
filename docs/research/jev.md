# Jev (TypeSafe AI) as a relevance judge for the Thread Store and Doc Store — research report

Researched 2026-09-27. TypeSafe doc line numbers refer to each page's `.md` alternate (e.g. `https://docs.typesafe.ai/api.md`). Unobserved claims are marked `[INFERENCE]`.

## What Jev is

- A "System One" **decision model**: you send a `state` plus named, typed questions; it returns probabilities, not text. Not a replacement for the coding-agent LLM (https://docs.typesafe.ai/introduction, `/introduction/coding-agents.md:9-19`).
- Three primitives, mixable in one request, each question evaluated independently (`/api.md:56`):
  - **Noul**: P(yes) for a yes/no question → `{"type":"noul","noul":0.95}`. No confidence field.
  - **Choice**: one of ≤255 options → `choice`, `probabilities` (sum to 1), `confidence` (`/api.md:125,268-281`).
  - **Score**: ordered rubric, 2–10 levels → expected level `score`, `probabilities`, `confidence` (`/api.md:163,309-322`).
- Model: `jev-1.13.0`; aliases `jev-latest`/`jev-preview` move on release. **Pin the versioned id** if thresholds are tuned against it (`/models.md:11-40`).
- Context: 64k per request, 32k for state + longest question (`/models.md:15,20`). Cloudflare, Vercel and OpenRouter list 32k — budget against 32k.

## API

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>` (`/api.md:13-17`).
- Body: `{ model, state, questions: { <id>: { type, instructions, criteria? } } }`. Instructions may reference state fields in backticks (`/api.md:23-69`).
- Response: `{ model, answers: { <id>: Answer }, usage: { input_tokens, output_tokens } }` (`/api.md:184-219`).
- Errors: 401, 422 (validation; Pydantic AI reports 400), 429, 529. Retry 429/529 with backoff (`/api.md:329-338`).
- No rerank endpoint. The documented rerank is one Noul per query–candidate pair, sorted by `noul` (`/cookbooks/rerank_typesafe.md:137-143`).
- TS SDK `@typesafe-ai/sdk@0.6.0` (published 2026-09-15; first public release 0.5.7; 0.6.0 changed the Score criteria shape). Reads `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`. Defaults: 10 s timeout per attempt, 2 retries on 408/429/5xx. At `logLevel: 'debug'` it logs request bodies unredacted (`/sdk/javascript/api/…`). Runs under Bun: the SDK sends `X-TypeSafe-Runtime: bun/<v>`, and the smoke test below succeeded.

## Cost, latency, limits

- $0.042 / M input tokens; output tokens free (`/models.md:13,18`).
- 250k tokens/s and 1,200 requests/min (20 req/s), "adjusting dynamically" (`/models.md:14,24`).
- Latency: docs say "about 100 ms" (`/concepts/how-to-build-with-system-one.md:290`); the launch blog says 70–500 ms end-to-end from US West. No primary source backs the "11–35 ms" figure circulating in secondary write-ups.

## Determinism and calibration

- **Not deterministic.** TypeSafe claims only "stable answers across repeated evaluations" (`/concepts/how-to-build-with-system-one.md:297-298`). Its own cookbooks show run-to-run noise: 2 of 8 Nouls drifted (`/cookbooks/parallel_questions.md:278-285`), and one value moved between 0.43 and 0.53 (consistency cookbook). Temperature and other sampling controls are ignored (https://pydantic.dev/docs/ai/models/typesafe/).
- Calibrated in aggregate, not per answer (`/concepts/system-one.md:21`). Score magnitudes are weakly calibrated. A Noul and a Choice asking the same thing are not comparable (`/model-jaggedness/jev-1.13.md:76,116-137`).

## Data handling

- Not trained on customer inputs (`/models.md:56`; https://typesafe.ai/legal/privacy-policy).
- Retention is "as long as necessary"; hosted in the US. Zero data retention is enterprise-only via sales (`/legal.md:17`). Through gateways: Cloudflare lists ZDR "Yes"; Vercel AI Gateway exposes a per-request `zeroDataRetention` flag.
- Relevant here: Thread Store candidates are Turns, which contain code and tool output.

## Documented patterns that fit

- **Relevance gate between retrieval and the prompt** (`/cookbooks/classifying_rag_passages.md:15-22,105-114,290-311`): one request per passage, state `{query, passage}`, Nouls `is_relevant`, `contains_answer_evidence`, `contradicts_query_premise`, `contains_prompt_injection`, with thresholds held in code (0.45 / 0.55 / 0.70 / 0.70).
- **Rerank a shortlist** (`/cookbooks/rerank_typesafe.md:7`): over a BM25 top-30, top-1 went from 5% to 18% and top-10 from 38% to 62%.
- **Progressive disclosure** (`/cookbooks/skill_suggestion.md:22-27`): a Choice over 182 one-line descriptions, plus a Noul asking "needed at all?"; then a second pass reads the top 3 in full and may reject all of them. Choice always ranks *something* first, so it needs the companion Noul (`/cookbooks/semantic_find.md:27-31,137-146`).
- **Anti-patterns** (`/model-jaggedness/jev-1.13.md:17-27,94-108,145-152`):
  - Large states padded with irrelevant detail.
  - Adversarial text in the state (tool output can carry it).
  - Arithmetic, counting, dates, multi-hop reasoning.
  - Several judgments folded into one question.

## Live smoke test (this machine, this repo's key)

Bun 1.4.2, working directory = repo root.

- The key was first stored as `JEV-API-KEY` and has since been renamed `TYPESAFE_API_KEY`, which is the name both the SDK and omp read.
- Bun's `.env` autoload loaded the key, and it authenticates directly against `api.typesafe.ai`.

| Call | Status | Round trip | Server time (`x-envoy-upstream-service-time`) | Input tokens |
|---|---|---|---|---|
| `GET /v1/models` | 200 | 936 ms (cold) | 14 ms | — |
| Noul "is `passage` relevant to `query`?" | 200 | 231 ms | 83 ms | 338 (→ 0.98) |
| Choice answers/related/unrelated | 200 | 197 ms | 49 ms | 402 |
| Score, 3 levels | 200 | 191 ms | 43 ms | 372 |
| SDK `systemOne` + `noul` | ok | 403 ms | — | same as raw Noul |

## How pi-chart decides relevance today

Both stores use a single embedding-distance threshold on `current.prompt`, which is the Turn's prompt. It is the same for every Call of a Turn.

- **Thread Store**: `PostgresStore.similarTurns` (`src/postgres-store.ts:657-734`).
  - Takes the nearest `recallTurns + tailTurns` = 12 contenders in the Conversation (`src/extension.ts:1302-1307`), exactly, not approximately.
  - Keeps those with `distance <= recallMaxDistance` (0.52, `src/config.ts:147`). The contenders it refuses come back as named `misses`.
  - A Turn's embed text is bounded to `EMBED_CHARACTERS` = 1200 (`src/embed-text.ts:34`).
- **Doc Store**: `PostgresStore.searchConcepts` (`src/postgres-store.ts:1310-1447`).
  - Takes `docConcepts * 2` = 4 (`src/extension.ts:1378-1382`) × `CANDIDATE_FACTOR` 10 nearest sections from the HNSW index.
  - Filters on `docMaxDistance` 0.5 and withholds deprecated Concepts.
  - Ranks within `BAND` of the best match by staleness, then trust.
  - The threshold was set empirically (`scripts/measure-doc-threshold.ts`).
- Both run under `inTime` deadlines (`src/extension.ts:797`; 5 s default, `src/config.ts:185`). On a timeout, the part is dropped and the pack is assembled without it.

## Constraints Jev collides with

1. **ADR-0003**: "No model plans retrieval. Two packs built from the same state are identical and diffable." Jev is a model in the selection path, and it is not deterministic, so using it needs a new ADR that amends ADR-0003. The ADR can keep the invariant by making the verdict *state*: memoize each verdict in the Thread Store, keyed by `(pinned model id, prompt hash, candidate identity + content hash)`. A rebuilt pack then reads the stored probability instead of re-asking. [INFERENCE: design proposal, not measured.]
2. **ADR-0007**: the default install has no external dependency. Jev is hosted only, in the US, and does not guarantee zero data retention by default. Without a key it must therefore stay off the default path, and when it fails pi-chart must fall back to today's distance cut. Turning it on automatically when a key is present is a user decision; see below.
3. **Hot path latency**: about 200 ms per round trip, against a 5 s deadline. It is paid on the first Call of a Turn only if verdicts are memoized per prompt; later Calls of the same Turn reuse them.
4. **Key naming**: settled. Use `TYPESAFE_API_KEY` and let omp resolve it; see the next section.

## Providing the key, and switching Jev on and off

omp already treats TypeSafe as a provider:
- `TYPESAFE_API_KEY` is one of omp's provider variables (`omp --help`; `omp://environment-variables.md:399-407`). Alternatively, `/login typesafe` stores the key.
- omp loads `.env` files into its process environment before any provider lookup. The first file that defines a variable wins, in this order: the shell environment, `<cwd>/.env`, `~/.omp/agent/.env`, `~/.omp/.env`, `~/.env` (`omp://providers.md:175-185`).
- omp's own judge features (the `auto` thinking level, unexpected-stop detection, AI staging, `find`, judged rules) use the same key (`omp://local-models.md:225`).

Measured with a throwaway extension loaded through `omp -p -e`:
- `ctx.modelRegistry.getApiKeyForProvider("typesafe")` returned the key when omp was launched in this repo. It came from `<cwd>/.env` and was identical to `process.env.TYPESAFE_API_KEY`.
- Launched in an empty directory, the same call returned `undefined`.
- So a key in a repo-local `.env` reaches pi-chart only in sessions started in that repo. A key meant for every Codebase belongs in `~/.omp/agent/.env`, a shell profile, or `/login typesafe`.

Recommended design:
- **The key.** pi-chart never stores or names its own key. Each session, it asks the host with `ctx.modelRegistry.getApiKeyForProvider("typesafe")`, which covers the environment, every `.env` file and `/login` in one call. This needs `modelRegistry` added to `HandlerContext` (`src/harness.ts:35`).
- **The switch.** A new setting, `PICHART_JUDGE`, taking `auto` (the default) or `off`. The key and the switch are separate, so turning Jev off never touches the key. Registering it in `SETTINGS` (`src/config.ts:195`) and the README table follows the existing pattern.
  - `auto`: on when a key resolves, and otherwise today's distance cut. A key that is present but rejected (401) reports once and falls back to the distance cut.
  - `off`: never calls Jev, whether or not a key is present.
- **Toggling for a session.** `/pack judge on|off` changes the setting for the running session only, like `/pack budget` (`src/config.ts:320-326`: "in memory only … an experiment that silently persists into tomorrow's sessions is a trap").
- **Toggling persistently.** Put `PICHART_JUDGE=off` in `~/.omp/agent/.env`.
- **Visibility.**
  - `/pi-chart` gains a line such as `ok relevance judge  jev-1.13.0 via TYPESAFE_API_KEY; PICHART_JUDGE=off to stop`.
  - `/pack` names which cut refused each candidate.

**Risk in turning Jev on automatically.** The same key already drives omp's own judge features. So a user who added the key only for those would find pi-chart sending their Turns (prompts, code, tool output) to a US-hosted service that does not guarantee zero data retention, without ever having chosen that for pi-chart.
- This runs against the README's "Nothing leaves the machine and no API key is needed" (`README.md:146`). It also runs against the graph setting's principle that something the user did not ask for is "asked for rather than assumed" (`src/config.ts:30-34`).
- The mitigation that keeps automatic switch-on: the first time a session sends a Turn to Jev, pi-chart says so once, naming the endpoint and the off switch. This follows the `problems` pattern (`src/config.ts:7-12`: "a setting silently ignored is a setting someone believes is in force").

## Measured benefit

Throwaway script, 2026-09-27, deleted after the run. Pinned embedder `bge-small-en-v1.5` with the query instruction, as `similarTurns` uses it; `jev-1.13.0` with one Noul.

Pairs, all from real Turns of this machine's pi-chart and context-manager Conversations:
- **Genuine** (50): a Turn's prompt against the rest of that same Turn, the answer without the prompt. This is the task-1.4 method from `openspec/changes/archive/2026-09-20-recall-fidelity/tasks.md:6`.
- **Other** (50): the same prompt against a Turn from a *different* Conversation of the same Codebase. These are unlabelled; some may genuinely be related.
- Jev was given the state `{request, earlier_turn}` and the question "Is `earlier_turn` about the same task or subject as `request`, so that recalling it would help an assistant answer `request`?".

| Cut | Genuine kept | Other admitted | AUROC |
|---|---|---|---|
| distance ≤ 0.52 (today) | 43 / 50 | 32 / 50 | 0.80 |
| Jev ≥ 0.5 | 48 / 50 | 12 / 50 | 0.95 |
| both (distance, then Jev) | 42 / 50 | 5 / 50 | — |
| either | 49 / 50 | 39 / 50 | — |

- **Distance on same-project content.** The 0.52 cut was validated against *off-topic* passages, where it admits 0 of 99. Against Turns from the same Codebase it admits 32 of 50. Jev refused 27 of those 32 and kept 6 genuine Turns that distance had refused.
- **Stability.** Re-asking 40 pairs moved `noul` by 0.013 on average and 0.05 at most. No verdict crossed 0.5. Answers are stable, but they are not bit-identical.
- **Cost and latency.**
  - 727 input tokens per judgement on average, so a 12-candidate recall costs about 8.7k tokens, about $0.00037.
  - At 6 requests in parallel, latency was p50 213 ms, p90 403 ms, max 1,068 ms.

How often each seam would fire on this machine:
- **In-Conversation recall** only matters when a Conversation outgrows the verbatim tail of 8 Turns: 6 of 339 top-level Journals do (median 2 Turns, longest 33). Jev improves this cut, but it rarely runs.
- **`recall_across_conversations`**: 19 calls in the recorded Journals. Its candidates are exactly the "other Conversation, same Codebase" pool measured above, where distance does worst. It is a tool result, not part of the Context Pack, so it needs no ADR-0003 amendment.
- **Doc Store**: the bundle at `~/.pi-chart/bundle` currently holds no Concepts, so gating it has no benefit to measure here.

## Recommended integration, in order of value

1. **`recall_across_conversations`: Jev gates the corpus-wide hits.** (`searchCorpus`, `src/extension.ts:1056`)
   - One Noul request per hit, sent in parallel.
   - Drop hits below the threshold, and say how many were dropped.
   - Why first:
     - The measured win is on this exact candidate pool.
     - It runs off the Assembler path, so ADR-0003 is untouched.
     - It is the smallest change that proves the key, switch, fallback and disclosure design end to end.
2. **Thread Store in-Conversation recall: distance pre-filter, then Jev.** (`recallFor`, `src/extension.ts:1282`)
   - Keep distance ≤ 0.52 as a pre-filter, then require `noul >= 0.5`. Measured: this admitted 5 of 50 other-Conversation Turns against 32, while keeping 42 of 50 genuine against 43.
   - A candidate Jev refuses goes into `misses`, with its probability next to its distance.
   - Needs the ADR-0003 amendment, with verdicts memoized per `(model, prompt hash, candidate hash)`.
   - Real but infrequent: it fires only in Conversations longer than the tail.
3. **Doc Store: gate the Concept hits the same way.** No benefit is measurable here until the bundle holds Concepts.
   - Send one request per section surviving `best`, with the same Noul. Add `contradicts_query_premise` only if a use for it emerges.
   - Keep the deprecation and trust/staleness rules exactly as they are. They are lifecycle rules, not relevance judgements.
4. **Later, a separate change: Level-based progressive disclosure for the Doc Store.**
   - Run a Choice over one Level's Concept descriptions (≤255), plus a Noul asking "is curated knowledge needed at all?".
   - Then run a second pass over the top few full Concepts. This fits the Level concept in `CONTEXT.md` and needs no embeddings. A machine-wide bundle over 255 Concepts needs a two-pass walk.

Not recommended:
- **One batched request with every candidate in a single state.** It is cheaper per request, but it runs into the "large irrelevant state" anti-pattern and the 32k state limit, and lets an injection in one Turn sway the verdicts on the others.
- **Score for ranking.** Its magnitudes are weakly calibrated.

Implementation shape:
- Put Jev behind a `RelevanceJudge` interface injected like `Embedder` (`src/embedder.ts`), with a stub for tests.
- Use a plain `fetch` to the one endpoint instead of the 0.x SDK. The SDK's default 10 s timeout and 2 retries fight the `inTime` deadline, and its Score shape changed at 0.6.0. The SDK would also work if configured with `retry` off and a timeout below the deadline.
- Record verdicts in Accounting so `/pack` can say "refused by Jev at 0.21" rather than just "refused".

## Open decisions for `grill-with-docs`

- The ADR-0003 amendment: are memoized verdicts enough to call the pack deterministic? The measured drift was 0.05 at most, with no flipped verdicts, but the answers are not bit-identical.
- Is sending Turn text (code, tool output) to a US-hosted service without zero data retention acceptable? The alternative is routing through a gateway that offers it (Cloudflare, or Vercel with the flag).
- Turning Jev on automatically when a key is present, versus requiring a pi-chart-specific opt-in, given that omp's own judge features share the key.
- The threshold. The 0.5 used above is an untuned midpoint; TypeSafe's relevance cookbook uses 0.45. A `scripts/measure-jev-threshold.ts` in the mould of `measure-doc-threshold.ts`, with *labelled* same-Codebase negatives, would settle it and the unlabelled-negative caveat.

## Sources excluded

- **jevtypesafe.org**: self-described "unofficial community resource". It resells access through `/api/v1/decide`, with `jv_live_` keys and `JEV_API_KEY`.
- **aiagentskit.com, dev.to, the LangChain blog and the pjburnhill gist**: restatements of the official docs, and the source of the unsupported 11–35 ms figure.
