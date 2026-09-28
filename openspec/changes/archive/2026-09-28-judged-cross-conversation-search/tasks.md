## 1. The judge

- [x] 1.1 Add `src/relevance-judge.ts` with `RelevanceJudge`, `JudgeFailure` (with `rejected`), `JevJudge` (plain `fetch`, pinned `jev-1.13.0`, one Noul over `{request, earlier_turn}`, 3 s abort), `JUDGE_THRESHOLD`. Verify with injected-`fetch` tests: the request carries the bearer key, the model and both state fields; 401 is rejected; 429 and a malformed body are not; the Noul is returned
- [x] 1.2 Smoke one live `JevJudge.judge` call with this repo's `TYPESAFE_API_KEY` and record the probability and round trip in this task

  A related Turn (retries/backoff) scored 0.800 in 405 ms (cold); an unrelated one (CSS renames) scored 0.020 in 196 ms.

## 2. The switch

- [x] 2.1 Add `judge: "auto" | "off"` to `Config`, parse `PICHART_JUDGE` (unrecognised → `off` plus a `problems` entry), and add it to `SETTINGS`. Verify with `loadConfig` tests and the existing `SETTINGS`-against-source check in `test/install.test.ts`
- [x] 2.2 Declare optional `modelRegistry.getApiKeyForProvider` on `HandlerContext`, resolve the `typesafe` key at `session_start` (a throw counts as no key), and add `judgeWith` to `Dependencies`. Wire `(key) => new JevJudge(key)` in production. Verify through the `session_start` seam that no key means the judge factory is never called

## 3. Judged search

- [x] 3.1 With judging on, fetch `MAX_SEARCH_RESULTS` by distance, judge them in parallel, keep verdicts ≥ threshold in distance order, and take `limit`. Verify at the tool seam: refusal, fill-up past a refusal, order, and at most `limit` returned
- [x] 3.2 Extend `renderSearch` and the tool `details` with the refused count, the all-refused message and the unjudged reason. Verify at the tool seam, and pin the all-refused and unjudged wording in `test/report.test.ts` only where a consumer reads it
- [x] 3.3 Fall back to the distance-only result on any judge failure and say why. On 401, announce once and stop judging for the session. Verify at the tool seam: a throwing judge, a malformed answer, and two searches after a 401 (one report, no second call)
- [x] 3.4 Announce the disclosure once, just before the first request of a session. Verify: two judged searches give one disclosure; no key, or `off`, gives none

## 4. Visibility and control

- [x] 4.1 Add `pi-chart judge auto|off` (in memory only) and the `relevance judge` line to `pi-chart`'s output. Verify at the command seam: each state (on, off, no key, rejected) renders, and a search after `judge off` does not call the judge
- [x] 4.2 Document `PICHART_JUDGE` in the README settings table, and in the cross-conversation section say what is sent, where, and how to stop it, next to "Nothing leaves the machine"

## 5. Close

- [x] 5.1 Smoke in a real `omp -p` session in this repo: `recall_across_conversations` returns a judged result and the disclosure appears once; with `PICHART_JUDGE=off` it returns the distance-only result with no disclosure

  Run against a fresh `PICHART_STORE_DIR`, seeded by two `omp -p` sessions, because `~/.pi-chart/store` aborts in PGlite when opened. That abort happens with HEAD's code too and shows in logs from before this change. Judged run: details `{judged: true, refused: 0, results: 1}`, and the disclosure was logged once. With `PICHART_JUDGE=off`: `{judged: false, results: 2}`, and no disclosure appeared in that session's log.
- [x] 5.2 Run the type checker and the full suite, and `openspec validate judged-cross-conversation-search`

  `tsc --noEmit` is clean. `bun test`: 660 pass, 0 fail. `openspec validate --strict`: valid.
