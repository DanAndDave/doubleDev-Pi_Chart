# Proposal: Cross-Conversation Search Judged by Jev

Triage: ready-for-agent

## Why

`recall_across_conversations` refuses a Turn only by embedding distance. The 0.52 cut was measured against off-topic text, but this tool's candidates are Turns from other Conversations of the *same* Codebase. That is where distance does worst: on 50 real pairs it admitted 32 unrelated Turns, while Jev (TypeSafe's hosted relevance model) admitted 12 and kept more genuine ones (48 against 43; AUROC 0.95 against 0.80; `docs/research/jev.md`, "Measured benefit"). The agent calls the tool when the current Conversation lacks the answer, and every unrelated Turn it gets back costs context and invites a wrong lead.

The key now has a home: `TYPESAFE_API_KEY`, which omp already resolves for its own judge features. This slice proves the key, switch, fallback and disclosure design on the one surface that needs no change to how packs are assembled (ADR-0003).

## What Changes

- When omp resolves a TypeSafe key for the session and judging is not switched off, each Turn that passes the distance threshold is sent to Jev with the query, one yes/no question per Turn, in parallel. Turns below the judge threshold are refused. The result keeps distance order and says how many Turns Jev refused.
- The search fetches more candidates than asked for (up to the existing 20-result ceiling), so a refusal does not simply shrink the answer.
- With no key, with judging off, or when Jev fails (rejected key, rate limit, timeout, malformed answer), the search returns exactly what it returns today and says it was not judged, and why. A rejected key is reported once a session.
- The first time a session sends Turn text to Jev, pi-chart says so once: what is sent, where it goes, and how to stop it.
- New setting `PICHART_JUDGE`: `auto` (default: on when a key resolves) or `off`. An unrecognised value is reported and treated as `off`. `pi-chart judge auto|off` changes it for the running session only.
- `pi-chart` gains a line saying whether the judge is on, off, or has no key.

**Not in scope:** judging in-Conversation recall or Doc Store hits (both change pack assembly and need an ADR-0003 amendment), reranking by Jev's probability, a tuned threshold (0.5 is an untuned midpoint), and gateway routing for zero data retention.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cross-conversation-search`: added requirements for judging search results with a hosted relevance model, falling back when it is unavailable, disclosing that Turn text leaves the machine, and switching judging off without removing the key.

## Impact

- **Code:** new `src/relevance-judge.ts`; `src/extension.ts` (`searchCorpus`, `session_start`, `pi-chart` command, production wiring); `src/harness.ts` (`modelRegistry` on the handler context); `src/config.ts` (`PICHART_JUDGE`); README settings table and the cross-conversation section.
- **Privacy:** with a key present and the setting at its default, Turn text (prompts, answers, tool output, bounded to 1,200 characters per Turn) goes to `api.typesafe.ai`, US-hosted, without zero data retention by default. The one-time notice and the `off` switch are the mitigation. This is the first path on which pi-chart sends content off the machine.
- **Cost:** about 730 input tokens per judged Turn ($0.042 per million); p50 ~210 ms per search.
- **Dependencies:** none added. The judge is a plain `fetch` to one endpoint.
- **Blocked by:** nothing.
