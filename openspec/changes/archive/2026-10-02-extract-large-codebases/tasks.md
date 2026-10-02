## 1. The runner

- [x] 1.1 Add `src/graphify-runner.py` (standard library only) with `run <state-dir> --codebase <path> --graphify <exe> --deadline-ms <n>` and `status <state-dir>`: the `flock` protocol, the `requested` loop, `current.json`, the atomic `outcome.json`, the truncated `run.log`, the lock descriptor passed to graphify, and a process group with TERM, then KILL 2 s later, at the deadline. Verify with `test/graphify-runner.test.ts` running `python3` against a fake graphify script: two racing runners give one run; a request made mid-run gives one follow-up and several give one; a SIGKILLed runner does not block the next once its child exits; at the deadline the fake and its child are gone by pid and the outcome says `deadline`; `GRAPHIFY_MAX_GRAPH_BYTES` reaches the fake; `status` reports running and since when
- [x] 1.2 Resolve the runner as `new URL("./graphify-runner.py", import.meta.url).pathname`, as `embedder.ts` resolves its worker. The package is private and omp loads `src/` directly, so there is no build step to include it in. Verify with `test/graph-store.test.ts`: the default launcher's argument names a file that exists

## 2. The Graph Store

- [x] 2.1 Add `graphExtractDeadlineMs` to `Config` (`PICHART_GRAPH_EXTRACT_DEADLINE_MS`, default 3,600,000, `0` means none) and to `SETTINGS`. Verify with `loadConfig` tests and the existing `SETTINGS` check in `test/install.test.ts`
- [x] 2.2 Before relying on it, check whether `spawned.exited` resolves for a `detached` and `unref()`'d child while the parent is alive, using a throwaway script. Record the result in this task. If it does not resolve, use the lock-polling fallback from design.md
  - Result (Bun 1.4.2): it resolves. A detached, `unref()`'d `sh -c "sleep 1; exit 3"` gave `exited` → `3` after 1,002 ms while the parent was kept alive, so `finished` is `spawned.exited` and the fallback is not needed. A related finding: `Bun.spawn` does not pass on `process.env` changes made after startup unless `env` is given, so the launcher passes `env: process.env` explicitly. Without that, `GRAPHIFY_MAX_GRAPH_BYTES` set at runtime never reached graphify; the live size-cap case caught it.
- [x] 2.3 Change `refresh` to return `Launch` (`{ finished }`): install, write `requested`, spawn the runner detached through a new `launch` option, and deduplicate launches in process. Delete `EXTRACT_MS`. Take the deadline from a new `extractDeadlineMs` option, wired from config in `piChart`. Verify in `test/graph-store.test.ts`: `refresh` resolves while the run is pending; the request is written before the launch; the deadline reaches the runner's arguments; an install failure rejects `refresh`
- [x] 2.4 Add `takeFailure` (classifying size-cap, deadline and failed from `outcome.json`, claimed with `O_EXCL` through a new `claim` option) and `extraction` (through `status`). Verify in `test/graph-store.test.ts` with outcome fixtures: each kind is classified with its numbers; a claimed failure is not returned twice; a successful outcome returns nothing
- [x] 2.5 Update `test/graphify.test.ts` and `test/headless.test.ts` to await `finished`, and add a live case forcing the cap with `GRAPHIFY_MAX_GRAPH_BYTES=1000` that `takeFailure` classifies as `size-cap`. Verify with `PICHART_GRAPHIFY=1 bun test test/graphify.test.ts`

## 3. The session

- [x] 3.1 In `src/extension.ts`, stop calling `refresh` at `session_shutdown`. Await this session's last launch instead. Keep `session_start` and `agent_end` launching. Replace "shutdown waits for the refresh a turn started" with tests showing that shutdown resolves while `finished` is pending, and that the last `agent_end`'s launch happens before shutdown resolves
- [x] 3.2 Report failures through `takeFailure` when `finished` settles, at `session_start`, and at `agent_end`. Size-cap goes through `announce` once per session, naming the size, the cap, `GRAPHIFY_MAX_GRAPH_BYTES`, `.graphifyignore` and the measured read cost; everything else goes to `report`. Verify at the harness seam: one report per failure whichever path claims it; size-cap once over three Turns, with `[codebase structure:` still carried from the previous graph
- [x] 3.3 Make `reportMissingGraph` ask `extraction` off the Call path and use the in-progress text when a run is going, keeping today's text otherwise. Rewrite the `codebase graph` detail in `/pi-chart` with running and last-run state. Verify at the harness seam: both announcement texts, and the `/pi-chart` line while a run is going and after one failed

## 4. Documentation

- [x] 4.1 README: add `PICHART_GRAPH_EXTRACT_DEADLINE_MS` to the settings table. In the codebase-graph section, say that extraction outlives the session, where `runs/` and `run.log` live, and what the size-cap report means and why pi-chart leaves the cap alone. Verify by reading the rendered section
- [x] 4.2 Correct the `EXTRACT_MS`-era comments in `src/graph-store.ts` and `src/extension.ts` (the shutdown and `extract()` doc comments) so none says a session waits for extraction. Verify with `grep -n "waits\|EXTRACT_MS" src/graph-store.ts src/extension.ts`

## 5. Close

- [x] 5.1 Smoke against a shallow VS Code clone: run an `omp -p` session with `PICHART_GRAPH=on` and let it end before the extraction does; see the runner complete in `outcome.json`; see a second session read the graph; see a refresh of the 544 MB graph announce the size cap once. Record timings here
  - Results, VS Code `3daf19a0` (shallow, 381 MB), 12 cores, 2026-10-02:
    - Session one (`omp -p`, `PICHART_GRAPH=on`, no graph yet) ended about 4 s in. Its runner (pid 958969) was still holding the lock afterwards, and `status` reported `running` since 11:16. The session announced the in-progress text rather than "has no graph".
    - The cold run took 528.1 s. While it ran, session one's `agent_end` request was queued, so exactly one follow-up run started, took 28.9 s, and graphify refused it at the size cap: `graph.json` is 555,577,245 bytes against 536,870,912 (exit 1, recorded in `outcome.json` and `run.log`).
    - Session two (14.7 s) answered "which functions call createDecorator?" from the injected structure (`debounce()` and `throttle()` in `src/vs/base/common/decorators.ts`) with no file read. It announced the size cap once (556 MB against a 537 MB cap, `GRAPHIFY_MAX_GRAPH_BYTES`, `.graphifyignore`), and claimed the failure session one never saw.
    - Seen in session two but caused by the 556 MB parse: Recall and the Doc Store each missed their 5,000 ms deadline on the first Call.
- [x] 5.2 Run `tsc --noEmit`, the full `bun test`, and `openspec validate extract-large-codebases --strict`
