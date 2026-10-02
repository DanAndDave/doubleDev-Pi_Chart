## Context

The proposal's Why section has the motivation and measurements. What the design has to work around:

- `GraphStore.refresh` (`src/graph-store.ts`) runs `graphify extract <codebase> --code-only` through `runProcess` with `EXTRACT_MS` = 60 s, and resolves when the run completes. `refresh` deduplicates in-flight runs per Codebase, but only inside one process.
- `src/extension.ts` refreshes at `session_start` and `agent_end`, both in the background, and awaits the refresh at `session_shutdown` so a headless run exits with a current graph.
- graphify 0.9.63 does not lock `graphify-out/`. It writes `graph.json` atomically (`write_json_atomic`), so a reader never sees a partial file. It prints a progress line every 100 files during AST extraction, then nothing for up to 255 s (resolution and dedup) and 151 s (build, clustering and write) on VS Code. It inherits its environment, so `GRAPHIFY_MAX_GRAPH_BYTES` already reaches it. Over the cap it exits 1 and prints `graph file <path> is <N> bytes, exceeds <M>-byte cap`.
- The private environment at `~/.pi-chart/graphify` always has a Python 3 interpreter, because graphify runs in it. The Graph Store is already POSIX-only: it runs `bin/graphify`, a layout Windows venvs do not have.
- Measured here: a child spawned with `Bun.spawn({ detached: true })` and `unref()` outlives its parent. A `flock` stays held while any process that inherited the descriptor is alive, even after the process that took it was killed with SIGKILL, and is released when the last of them exits.

## Goals / Non-Goals

**Goals:**
- A cold extraction of any Codebase that finishes within the deadline produces a graph, however short the sessions around it.
- Serialisation and liveness come from the kernel, not from PID files, so a killed run never has to be cleaned up.
- Nothing new on the path a Call waits on.

**Non-Goals:**
- Letting the user cancel a run. The deadline and `kill` are enough for this slice.
- Serialising graphify installs across processes. That race predates this change and is unchanged.
- Windows.

## Decisions

### A detached runner owns each extraction

`refresh(codebase)` installs graphify if needed (as today), records a request, and launches `src/graphify-runner.py` with the private environment's `bin/python`: detached, stdio ignored, `unref()`'d. It returns once the runner is spawned. The runner does the work and the waiting. The pi process only launches runs and reads what they leave behind.

- *Why a runner, not a detached `graphify` directly:* coalescing requests, the deadline, and recording the outcome all have to outlive the session too. A bare graphify run would have nothing left to enforce the deadline or say how it ended.
- *Why Python:* the runner needs `flock`, and so does the liveness guarantee above. Python is guaranteed wherever graphify is installed and has `fcntl.flock` in its standard library. Bun has no `flock`. `flock(1)` is util-linux-only and absent on macOS. A PID-file lock is what the kernel lock avoids: PIDs get reused, and a SIGKILLed holder leaves a stale file behind. ADR-0001 fixes the extension's language to TypeScript on Bun; the runner does not reopen it, because it is a CLI pi shells out to, like graphify itself, rather than code inside the Assembler.
- *Rejected:* keeping the pi process alive until the run completes. That is today's behaviour with a longer deadline, and it makes quitting during a cold extraction wait up to the deadline.
- *Rejected:* a silence-based watchdog. A healthy run was silent for 255 s, so any threshold that tolerates that also takes about as long to catch a real hang as a total deadline would.

### State lives beside the private environment, per Codebase

`~/.pi-chart/graphify/runs/<key>/`, where `<key>` is the first 16 hex characters of the SHA-256 of the Codebase's real path:

| File | Written by | Holds |
| --- | --- | --- |
| `codebase` | runner | the path, for a human reading the directory |
| `lock` | runner | held with `flock(LOCK_EX)` for the runner's whole life |
| `requested` | `refresh` | presence means another run is wanted |
| `run.log` | runner | the current or last run's combined output, truncated per run |
| `outcome.json` | runner | the last completed run: `runId`, `startedAt`, `endedAt`, `exitCode`, `stopped` (`"deadline"` or absent), and the last 4 KB of output. Written to a temp file and renamed into place |
| `current.json` | runner | `runId` and `startedAt` of the run in progress |
| `reported.<runId>` | a session | created with `O_EXCL`: this run's failure has been reported |

Nothing is written into the Codebase beyond what graphify already writes.

### Coalescing without a lost request

Requester (`refresh`): create `requested`, then launch a runner.

Runner:
1. Try `flock(LOCK_EX | LOCK_NB)`. If it is held, exit 0: the holder will see `requested`.
2. Loop: if `requested` does not exist, go to 3. Otherwise delete it, write `current.json`, delete stale `reported.*` files, run graphify, and write `outcome.json`.
3. Release the lock. If `requested` exists now, go back to 1. Otherwise exit.

A request made before step 3's check is picked up by the loop. A request made after it launches a runner that finds the lock free. So no request is lost, and each run only picks up requests made after it started. The lock descriptor is passed to graphify (`pass_fds`), so a SIGKILLed runner whose graphify is still writing keeps the Codebase locked until graphify exits. This is what the "one at a time" requirement needs, and it never needs cleaning up.

### The deadline

graphify runs in its own process group (`start_new_session=True`), with `wait(timeout=deadline)`. At the deadline the runner sends `SIGTERM` to the group, waits 2 s (as `GRACE_MS` in `process.ts` does), sends `SIGKILL`, and records `stopped: "deadline"`. The group includes graphify's `ProcessPoolExecutor` workers.

`PICHART_GRAPH_EXTRACT_DEADLINE_MS` sets the deadline. The default is 3,600,000 ms (60 min), and `0` means none. It is parsed with `count`, like the other deadlines, added to `Config` as `graphExtractDeadlineMs` and to `SETTINGS`, and handed to `GraphStore` through a new `extractDeadlineMs` option. `EXTRACT_MS` is deleted.
- *Why 60 min:* VS Code took 470 s with 12 workers. A 4-worker laptop, or a monorepo two or three times that size, stays inside the deadline with room to spare. The cost of a hung graphify is that it holds the Codebase for up to an hour. Refreshes wait behind it through `requested`, and none of them blocks the user.

### Launch and completion are separate

`refresh(codebase): Promise<Launch>`, where `Launch = { finished: Promise<void> }`. The outer promise resolves once the runner is spawned. `finished` resolves when the run that serves this request has ended: it waits for `spawned.exited` while the pi process lives, then, because a runner that found the Codebase held exits at once and leaves the holder to pick the request up, asks `status` every 5 s (an unref'd timer) until the lock is free. Only an install failure or a spawn failure rejects the outer promise. `finished` never rejects: a run's failure is read from `outcome.json` (below).

The in-process `refreshing` map now deduplicates concurrent launches instead of runs.

### Reading outcomes, and reporting each failure once

`GraphStore.takeFailure(codebase): Promise<ExtractionFailure | undefined>` reads `outcome.json`. If the last run failed and `reported.<runId>` can be created with `O_EXCL`, it returns the failure. Otherwise it returns `undefined`. `ExtractionFailure` is an `Error` with a `kind`:
- `"size-cap"`: exit code non-zero, and the output matches `/is ([\d_]+) bytes, exceeds ([\d_]+)-byte cap/`. Carries both numbers.
- `"deadline"`: `stopped === "deadline"`. The message names the deadline in minutes, `PICHART_GRAPH_EXTRACT_DEADLINE_MS`, and the output tail.
- `"failed"`: any other non-zero exit. The message carries the output tail, as today's does.

The extension calls `takeFailure` when a `Launch.finished` settles (the session that asked, while it is open), at `session_start` (a failure no open session claimed), and at `agent_end` before launching the next refresh. A `"size-cap"` failure goes through `announce` once per session (flag `sizeCapReported`). The announcement names the size, the cap, `GRAPHIFY_MAX_GRAPH_BYTES`, `.graphifyignore`, and that a 544 MB graph measured 4.0 s and 2.6 GiB to read. Later size-cap failures in that session are claimed and not repeated. Every other kind goes to `deps.report`.
- *Why claim with `O_EXCL`:* two sessions open in one Codebase would otherwise both report the same failure.

### Shutdown waits for the launch, not the run

`session_shutdown` stops calling `refresh`. It awaits the most recent launch promise this session started, so the refresh `agent_end` asked for is spawned before the process exits. It does not await `finished`. The old test "shutdown waits for the refresh a turn started" is replaced by one asserting exactly that.
- *Rejected:* calling `refresh` again at shutdown. It would add a full scan per session end (25 s warm on VS Code) to do what `agent_end` already requested.

### Status is asked of the runner

`GraphStore.extraction(codebase): Promise<{ running?: { since: number }; last?: Outcome & { failure?: kind } }>` runs `bin/python graphify-runner.py status <state-dir>` with the existing `VERSION_MS` deadline. It tries the lock without blocking, so "running" is what the kernel says, and it reads `current.json` and `outcome.json`. A refresh this process has under way but not yet spawned (graphify still installing, up to `INSTALL_MS`) also counts as running, so a first session on a fresh machine is not told to switch extraction on. It is used in two places:
- `reportMissingGraph`, which runs off the Call path: the lookup is started and not awaited, and the announcement follows it. With a run in progress it says: "Structure is configured but this codebase's first extraction is still running (started HH:MM); structure arrives when it finishes." With nothing running, it keeps today's text.
- `/pi-chart`: the extension rewrites the `codebase graph` check's `detail` when extraction is on, following `withJudge`'s precedent that `Installation` stays unaware of session state. The detail adds "extracting since HH:MM" and/or "last run: ok at HH:MM" or "last run failed: <kind>".

### Tests that awaited completion

`test/graphify.test.ts` and `test/headless.test.ts` call `await (await store.refresh(cwd)).finished`.

## Testing seams

- **The runner, as a real process** (`test/graphify-runner.test.ts`, beside `test/process.test.ts`), running system `python3` against a fake graphify: a shell script given with `--graphify` that sleeps, prints, spawns a child, or exits as the test decides. This is the target seam for the requirements the kernel enforces:
  - one run while two runners race;
  - a request made during a run gives exactly one follow-up run, and several requests still give one;
  - a runner killed with SIGKILL does not block the next one once its graphify exits;
  - at the deadline the fake and its child are gone (checked by pid, as `process.test.ts` does) and `outcome.json` says `deadline`;
  - `GRAPHIFY_MAX_GRAPH_BYTES` in the environment reaches the fake;
  - `status` reports running, and since when.
- **`GraphStore` with injected file operations and launcher** (`test/graph-store.test.ts`): `refresh` writes the request and resolves at launch rather than at the end of the run; the deadline reaches the runner's arguments; `takeFailure` classifies size-cap, deadline and failed from `outcome.json` fixtures, and returns a failure once. `GraphStoreOptions` gains `launch` (the detached spawn) and `claim` (the `O_EXCL` create), as siblings of `run` and `exists`.
- **`register(pi, deps)` through the existing harness** (`test/extension.test.ts`), with a `GraphStore` whose launcher is scripted: shutdown resolves while `finished` is pending; the last `agent_end`'s launch happens before shutdown resolves; a failure is reported once whether it is claimed at `finished`, at `session_start` or at `agent_end`; size-cap is announced once over several Turns and the previous graph is still carried; in-progress and no-graph give their own texts; the `/pi-chart` line.
- **`loadConfig`** for `PICHART_GRAPH_EXTRACT_DEADLINE_MS`, beside the existing config tests.
- **Live smoke** (not a permanent test), against the VS Code clone: an `omp -p` session with `PICHART_GRAPH=on` ends seconds after it starts; the runner completes; a second session reads the graph. A second refresh on that 544 MB graph gives the size-cap announcement once.

## Risks / Trade-offs

- [A run keeps using CPU after the user quits pi, for up to the deadline] → That is the point of this change. The `/pi-chart` line says a run is in progress, and `run.log` and `current.json` sit in a directory named in the README.
- [A run that outlives its session may fail with nobody watching] → `outcome.json` survives, and the next session in that Codebase reports it once.
- [`spawned.exited` might not resolve for an `unref()`'d detached child while the parent is alive (unverified)] → Task 2.2 checks it first. If it does not resolve, `finished` falls back to polling the lock through `status` every 5 s with an unref'd timer, and nothing else in the design changes.
- [The size-cap message is graphify's text, not an API] → graphify is pinned at 0.9.63. A pin move that changes the text makes the failure fall back to `"failed"`, which still reports the raw output. `test/graphify.test.ts` gains a live case that forces the cap with `GRAPHIFY_MAX_GRAPH_BYTES=1000` (checked by hand: exit 1, matching text) to catch it.
- [A 60-minute default hides a real hang for an hour] → Nothing waits on a run, so a hang costs freshness, not responsiveness. The deadline report names the setting.

## Migration Plan

Nothing to migrate. `runs/` is created on the first refresh. An old session still running while a new one starts can run graphify alongside a runner in the same Codebase. graphify's atomic write keeps the graph readable, and it cannot happen once every session is on this version. To roll back, revert the change. Stale `runs/` directories do no harm and can be deleted.
