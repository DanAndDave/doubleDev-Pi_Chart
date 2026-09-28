## Context

`searchCorpus` (`src/extension.ts`) calls `CorpusSearch.searchAll(query, limit, recallMaxDistance)` and renders the hits with `renderSearch` (`src/report.ts`). Its tool result reaches the agent, not the Context Pack, so a model in this path leaves ADR-0003 intact (spec: "Searching is an action, not an assembly step").

omp resolves `TYPESAFE_API_KEY` from the environment, every `.env` it loads, and `/login typesafe`. A throwaway extension confirmed that `ctx.modelRegistry.getApiKeyForProvider("typesafe")` returns the key in a `session_start` handler (`docs/research/jev.md`, "Providing the key"). `HandlerContext` (`src/harness.ts`) does not declare `modelRegistry` yet.

Jev's API, cost, determinism and data handling are in `docs/research/jev.md`. What matters here: one `POST /v1/systemone` per question, a Noul answer in `[0, 1]`, 401/422/429/529 errors, and answers that are stable but not bit-identical.

## Goals / Non-Goals

**Goals:**
- A judge seam other surfaces can reuse (in-Conversation recall, Doc Store) without reshaping it.
- Every judge failure leaves the search working, as it does today.

**Non-Goals:**
- Memoizing verdicts. There is no pack to keep deterministic here, and a search is rarely repeated.
- Retrying 429/529. The agent can search again; a retry loop would spend the agent's time on a Turn that has a working fallback.

## Decisions

### The key is resolved by the host, once per session

At `session_start`, call `ctx.modelRegistry?.getApiKeyForProvider?.("typesafe", sessionId)` and keep the result. A throw or an absent method counts as no key. pi-chart never reads `TYPESAFE_API_KEY` itself.
- *Why:* the host already merges the environment, every `.env` and `/login`, and resolves the same key its own judge features use. Reading the variable ourselves would miss `/login` and the agent-level `.env` precedence.
- *Rejected:* resolving per search. The tool's `execute` does receive a context, but pi-chart's `ToolDefinition` does not declare it, and a key changing mid-session is not a case worth a second path.

### A `RelevanceJudge` interface, built from a key by an injected factory

`src/relevance-judge.ts` holds:
- `interface RelevanceJudge { judge(query: string, passage: string): Promise<number> }`, where the number is P(relevant).
- `JevJudge`, which takes the key and an optional `fetch`, pins `jev-1.13.0`, and asks one Noul over the state `{request, earlier_turn}`. The question is the one measured in the research.
- `JudgeFailure`, an error with a `rejected` flag (401) that is false for everything else.

`Dependencies` gains `judgeWith?: (key: string) => RelevanceJudge`. Production passes `(key) => new JevJudge(key)`; tests pass a stub.
- *Why a factory:* the key exists only after `session_start`, while `Dependencies` is built at load.
- *Why plain `fetch`, not `@typesafe-ai/sdk`:* the SDK's default 10 s timeout and 2 retries fight a deadline, it is 0.x with a shape change at 0.6.0, and one endpoint needs no client.
- *Why one question per Turn:* a batched state runs into Jev's "large irrelevant state" anti-pattern and the 32k limit, and would let an injection in one Turn sway the verdicts on the others.

### What is judged, and how many

- **Passage:** `embedText(hit.turn.messages)`, the Turn text already bounded to 1,200 characters. This is what the measurement judged, and it caps what leaves the machine per Turn.
- **Candidates:** with judging on, fetch `MAX_SEARCH_RESULTS` (20) by distance and judge them all in parallel. Keep those at or above `JUDGE_THRESHOLD` (0.5), in distance order, and take the first `limit`. At 20 requests this sits inside Jev's 20 req/s limit, and one round costs no more latency than judging `limit` would.
- *Rejected:* judging `limit` first and fetching more only on a refusal. It halves the tokens for small limits but adds a second round-trip on exactly the searches where distance did badly. At about $0.0006 per search, latency wins.

### One failure falls the whole search back

Any request that fails (thrown `JudgeFailure`, deadline, or an answer that is not a number in `[0, 1]`) discards all verdicts for that search. The search then returns the distance-only result for the requested `limit` and a line saying it was not judged, and why.
- *Why:* a result half-judged and half-not mixes two standards under one heading.
- **401:** judging is disabled for the rest of the session, and pi-chart announces once that the key was rejected, naming `/login typesafe` and `PICHART_JUDGE=off`.
- **Anything else:** reported in that search's result only. The next search tries again.
- **Deadline:** `JUDGE_DEADLINE_MS` = 3,000, through `AbortSignal.timeout` inside `JevJudge`. The measured maximum was 1,068 ms.

### The switch is a Config field; the session state lives in `register`

- `PICHART_JUDGE`: `auto` (the default) or `off`. Anything else is a `problems` entry, and judging is off. The setting is added to `SETTINGS`.
- `pi-chart judge auto|off` sets the same field in memory, following `setBudget`'s rule that a session experiment must not persist.
- `register` holds the session state: `judgeKey?: string`, `judgeRejected: boolean`, `judgeDisclosed: boolean`. Judging happens when `config.judge === "auto"`, a key is held, it has not been rejected, and `deps.judgeWith` is set.
- *Rejected:* a separate toggle file. A setting that persists is the environment's job; the README says where (`~/.omp/agent/.env`).

### Disclosure rides `announce`

Just before the first request of a session is sent, pi-chart calls `announce` once. The message names the endpoint, says that up to 1,200 characters per Turn are sent, and gives `PICHART_JUDGE=off` / `pi-chart judge off`. `announce` already reaches both the log and the status line.

### Status is a `Check` appended by the extension

`manageInstall` appends a `relevance judge` check to `install.check(...)`'s list:
- `on`: `ok`, naming `jev-1.13.0`.
- `off`: `ok`, naming how to turn it back on.
- `no key`: `ok`, naming `TYPESAFE_API_KEY`.
- `key rejected`: not `ok`.

`Installation` stays unaware of session state.

### Rendering

`renderSearch(found, judgement?)` takes an optional `{ refused: number } | { unjudged: string }`:
- `refused > 0` adds a line after the hits.
- All refused replaces the empty message with one saying the judge refused N Turns that distance admitted.
- `unjudged` adds a line naming the reason.

The tool `details` gain `judged`, `refused` and `unjudged`, so the transcript records which standard applied.

## Testing seams

- **`register(pi, deps)` through the existing harness in `test/extension.test.ts`**, driving `session_start` with a `modelRegistry` stub and `recall_across_conversations.execute`, with `judgeWith` returning a scripted stub judge. This is the target seam. It covers:
  - refusal, fill-up and order;
  - the refused count and the all-refused text;
  - no key (the stub is never constructed);
  - `PICHART_JUDGE=off`;
  - `pi-chart judge off` mid-session;
  - fallback on a throwing judge;
  - a 401 disabling the session and reporting once;
  - disclosure once, and none when nothing is sent;
  - the `pi-chart` status line.
- **`JevJudge` with an injected `fetch`**, for what only the HTTP boundary can show:
  - the request carries the bearer key, the pinned model and the two state fields;
  - a 401 is a rejected failure;
  - 429 and a malformed body are non-rejected failures;
  - the returned number is the Noul.
- **`loadConfig`** for `PICHART_JUDGE` parsing and the unrecognised-value problem, beside the existing config tests.
- **Live smoke** (not a permanent test): one `JevJudge.judge` call against the real endpoint with this repo's key, and one `omp -p` session in this repo calling `recall_across_conversations`, to see the judged result and the disclosure.

## Risks / Trade-offs

- [Turn text leaves the machine by default once a key exists, and the key may have been added only for omp's own features] → A one-time disclosure naming the switch; `off` keeps the key; the README states it next to "Nothing leaves the machine". An ADR recording "a hosted judge is off the assembly path and on by key" belongs to `grill-with-docs` if the operator wants the decision recorded before archive.
- [The threshold of 0.5 is untuned, and the negatives it was measured on are unlabelled] → A constant beside the model id, so the tuning change is one line plus a measurement script.
- [Adversarial text in a Turn could sway its own verdict] → One question per Turn confines the effect to that Turn, and distance still gates what is asked.
- [`jev-1.13.0` retired] → The judge answers 4xx, the search falls back and says why, and the constant is bumped.
- [`modelRegistry.getApiKeyForProvider` is not in pi-chart's typed harness surface and could change] → It is declared optional in `harness.ts`; its absence is "no key", which is today's behaviour.

## Migration Plan

Nothing to migrate. Rollback per machine: `PICHART_JUDGE=off`, or remove the key.

## Open Questions

- The tuned threshold. Deferrable: it changes one constant, not the specs or the seams.
