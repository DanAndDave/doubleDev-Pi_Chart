# Can a Call be replayed

Type: task (AFK)
Status: closed
Blocked by: —

## Question

Can we rebuild the exact request a past Call sent from its Journal, and from the Stores as they stood at the time? Exact means the system prompt, tool schemas and messages, byte for byte. Ablation depends on this: it re-sends a Call with one unit removed. If a rebuild cannot be exact, what is the closest faithful substitute?

This ticket earns its place by unblocking "Ablation design". It produces a fact, not a decision.

## Done when

- A throwaway script rebuilds every Call of at least one pi-chart bench Conversation and one plain-omp bench Conversation.
- Each rebuild is checked against ground truth. That is either a captured request or, failing that, the provider's input-token total from the Call's `usage`, re-counted with the token-counting endpoint.
- The match rate and every divergence cause are recorded here under `## Resolution`, along with the script's location and its cost.

## What's known

- The following decide pi-chart's part of the window:
  - ADR-0003: the Assembler is deterministic.
  - ADR-0013: the tail's start is replayed from the Store's Turn sizes.
  - ADR-0015: the tail is the harness's own messages, with Pins and the Opening in the system prompt.
- The harness's own system prompt, tool roster and skills (the Floor) are not in the Journal. [INFERENCE] Rebuilding them may need omp's own code path, or a request capture.

## Resolution

**Verdict: exact.** Running omp's own code path again rebuilds a past Call's request byte for byte: system prompt, tool schemas and messages. The Floor is included, and so is pi-chart's part of the window. Two values have to be pinned first, the session id and the date. Nothing has to be reconstructed by hand. A stub stands in for the model. It answers each Call with the reply recorded in the Journal and gives each tool call the result the Journal recorded. omp then builds every request as it did the first time.

### How the rebuild works

- `replay-ext.ts` is a throwaway extension loaded with `-e`, beside pi-chart or alone. It wraps `globalThis.fetch` below omp's OAuth body patch, so it sees the exact body that leaves the process. omp 18.10 sends Anthropic Calls through its own `node:https` transport. It only goes through `fetch` when `PI_PROXY_ANTHROPIC` is set, so the script sets that to a dead address. The extension removes the proxy before a request is forwarded and refuses to load without it.
  - `REPLAY_MODE=record` forwards each request to Anthropic and keeps a copy.
  - `REPLAY_MODE=stub` sends nothing to the model and keeps the request omp built.
  - Both modes ask the token-counting endpoint (free) to count each request, using that request's own headers. Auth headers are never written to disk.
- `replay.ts replay` sets up the Run again:
  - It recreates the Codebase copy at the Run's original path from the commit. The path appears in the prompt.
  - It re-runs the Workload's Turns with `omp -p`, adding `-c` after the first Turn, under omp 18.10.4.
  - For pi-chart it gives the Run a fresh Thread Store database and migrates it before the first Turn. During the replay pi-chart fills that database the same way the original Run filled its own.
- `replay.ts check` lines each rebuilt Call up with ground truth:
  - the `usage` input total (input + cacheRead + cacheWrite);
  - the endpoint's count of the rebuilt request;
  - with `--record`, byte equality with the captured request, plus the JSON paths that differ;
  - for pi-chart, each Call's verbatim-tail Turn indices in the original Accounting against the replay's.

### Match rate (observed, `runs/check-*.json`)

| Run | Arm | Calls rebuilt | Bytes equal to captured request | Counted − `usage` within 43..46 | Accounting tail mismatches |
|---|---|---|---|---|---|
| `-tmp-pichart-bench-CeFV8o` (40-Turn bench, c6fe516) | plain omp | 129/129 | — (no capture) | 129/129 | — |
| `-tmp-pichart-bench-Ne5DGE` (40-Turn bench, c6fe516) | pi-chart | 125/125 | — (no capture) | 125/125 | 0 of 125 rows |
| `-tmp-pichart-bench-yokRnD` (3-Turn, recorded) | plain omp | 10/10 | **10/10** | 10/10 | — |
| `-tmp-pichart-bench-wGejU5` (3-Turn, recorded) | pi-chart | 9/9 | **9/9** | 9/9 | 0 of 9 rows |

The token check never matches exactly (0/N everywhere), and it is not meant to. The counting endpoint's offset from `usage` was measured directly on byte-identical requests: counting the *captured* request of the recorded Runs gives `usage` + 44..46 on all 19 Calls (`oracleOffsets`). On those Runs the rebuilt count equals the captured count on every Call (`countVsRecorded` = 0). For the 40-Turn benches, which have no capture, every rebuilt Call falls within 43..46 of `usage`. That is the same offset an exact request shows, and not a single Call falls outside it. The benches were rebuilt with the date and session id pinned. [INFERENCE] The benches are byte-exact as well. Only the 3-Turn Runs prove it at the byte level.

### Divergence causes (each observed, then removed)

1. **Session id → `metadata.user_id` and `cch`.** A replay runs as a new omp session. That changes `metadata.user_id`, and it changes the billing hash `cch` in system block 0, which omp computes over the body. Run with `--new-session` (the session id left unpinned): bytes equal 0/10 for plain omp and 0/9 for pi-chart. The token counts stay in the 43..46 offset on plain omp (`check-vanilla-newsession.json`). Fix: `REPLAY_SESSION_ID` puts the original id back before omp computes `cch`.
2. **Date → first message, then thinking blocks.** omp's first user message carries `Today: <local date>`. A replay on another day changes that prefix. This was tested on the next calendar day via `TZ`, with `--today-now`. Bytes equal 0/10, and only 2/10 Calls stayed in the offset band. The rebuilt count fell short of the captured count by 1, 0, then 69 to 143 tokens, growing with the Call index (`check-vanilla-nextday.json`). [INFERENCE] The server drops every thinking block signed against the old prefix, so the loss grows with every later Call. Fix: `REPLAY_TODAY` pins the original date. 10/10 bytes equal on the next day (`check-vanilla-nextday-pinned.json`).
3. **Thread Store timing (pi-chart only).** On a fresh database that is not yet migrated, pi-chart migrates inside the first Turn. That misses the Thread Store deadline, so the first Turn's Calls go out without the Opening in system block 4. Those Calls counted 55 tokens short, and 110 short on one Call (`check-pichart-newsession-unmigrated.json`, Calls 0–2). Later Turns matched the offset band. Fix: migrate before the first Turn, as the original store had been. This is what `replay.ts` now does. Ablation inherits this lesson: pi-chart's window depends on the Thread Store's timing as well as its contents.

No other divergence showed up on any Call. Not in the system prompt, the tool roster or schemas, skills, the message bodies, or pi-chart's Pins, Opening or tail. The rebuilt pi-chart Accounting matched the original's verbatim-tail Turns on all 134 rows (125 + 9).

### What Ablation would reuse

- **Entry point:** `replay-ext.ts` in stub mode. Its fetch wrapper is the single place where the finished request is visible and can be changed before it is counted or sent. That is where an Arm would remove one unit.
- **Inputs a replay needs:**
  - the main-session Journal: replies, tool results, header id and timestamp;
  - the commit the Codebase copy was made from, recreated at the Run's original `cwd`;
  - the Workload prompts in order (`bench-tokens.ts` doesn't record them in the Journal; `replay.ts` copies its prompts);
  - the same omp build (18.10.4);
  - `REPLAY_SESSION_ID` and `REPLAY_TODAY`;
  - for pi-chart, a fresh Thread Store database migrated before the first Turn.
- **Ground truth for a counted Ablation:** the endpoint's count of the unchanged rebuilt request, *not* `usage`. The two differ by a constant-ish 43–46 tokens. Ablation measures a difference between two counts, so the offset cancels out.
- **Caveats** (all [INFERENCE], not exercised):
  - Removing a unit early in a Call changes the prefix. Per cause 2, the server may then drop the thinking blocks signed against it, so the counted saving would include thinking tokens the unit itself never held.
  - The Floor is rebuilt from whatever skills, rules and omp config are installed at replay time. It matched within a day here, but host changes would leak in.
  - The stub answers Call k with the Journal's k-th reply, so it only holds while the replay asks the same Calls in the same order. That is fine for rebuilding a Call. A sent Ablation, where the model really answers, would go off script after the first changed reply.

### Script, how to run, spend

- **Scripts:** `openspec/changes/context-need-measures/evidence/`
  - `replay.ts`, with `record`, `replay` and `check` subcommands; usage is in its header;
  - `replay-ext.ts`;
  - `run-all.sh`: stub replays and checks of the four Runs above;
  - `nextday.sh`: the date experiment;
  - checks in `runs/`.
- **Requirements:** the compose Thread Store up, omp 18.10.4 under mise, and the four Journals under `~/.omp/agent/sessions`. Captures go to `/tmp/pichart-replay`. The 3-Turn checks also read the recorded captures and manifests in `/tmp/pichart-replay/rec-{vanilla,pichart}`. If `/tmp` has been cleared, run `bun replay.ts record --arm … --turns 3 --out /tmp/pichart-replay/rec-…` again first; that costs model spend again, about $0.17 per Arm. `sh run-all.sh` took 155 s and printed the four summaries above.
- **Spend: $0.34 model spend.** That covers the two 3-Turn recorded Runs, $0.184 for plain omp and $0.160 for pi-chart, summed from their Journals' `usage.cost`. Stub replays and the token-counting endpoint cost nothing.
