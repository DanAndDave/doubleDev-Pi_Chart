# Proposal: A deadline stops the whole program

Triage: ready-for-agent

## Why

`runProcess` (`src/process.ts`) signals one process and then waits for the output pipes to close. A program that left a child behind keeps those pipes open, so the call returns when that child exits rather than at the deadline — which is the one thing the deadline exists to guarantee.

Measured on Ubuntu 24.04, Bun 1.4.2, in a fresh clone: `test/process.test.ts` → "a command that outlives its deadline is stopped and says so" times out at 5,000 ms against a 200 ms deadline, and the underlying call settles only after the orphaned `sleep 30` exits. The cause is not the test's shell: `/bin/sh` is dash there, and dash forks rather than execs the last command of a list, so `SIGTERM` reaches the shell while `sleep` keeps the inherited stdout. On a machine where `/bin/sh` execs that last command — bash, as on macOS — the same code passes, which is why this has not been seen before. Any program that genuinely spawns children reproduces it on every platform.

The programs this project runs do spawn children. `pip install graphify` (`INSTALL_MS`, 300 s) runs build subprocesses; `openspec validate --all --strict` (`OPENSPEC_MS`, 30 s) and `docker compose up -d --wait` (`COMPOSE_MS`, 120 s) each run their own. A deadline reached while a grandchild is alive today hands the caller no answer and leaves the processes running: the Spec Store's check at session start, and `pi-chart setup`, wait past their own bound on a machine that is already in trouble.

`context-assembly` already requires that a program serving a part be stopped at its deadline and the condition reported. The code satisfies it only for a program that leaves nothing behind. This change makes the requirement say "and every process it started", and makes the code do it.

## What Changes

- A program is run in its own process group, and a deadline stops that group — the program and every process it started — rather than the one process.
- The call returns at its deadline whatever the program left running, so a caller's wait is bounded by the deadline it gave.
- The partial output and the existing timeout wording are unchanged: what the program printed before it was stopped is still the diagnosis.
- `test/process.test.ts` gains a case whose child survives its parent deliberately on every shell, so the platform-dependent coincidence that hid this cannot hide it again.

**Not in scope:** the detached graphify runner, which already stops its own process group from Python (`src/graphify-runner.py`); the deadlines themselves; Windows, which the Graph Store already excludes by running `bin/graphify`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `context-assembly`: stopping a program at its deadline now means stopping the processes it started as well, and the call returns at the deadline regardless of what the program left behind.

## Impact

- **Code:** `src/process.ts` (`runProcess` spawns detached and signals the process group); `test/process.test.ts`.
- **Callers:** none change. `GraphStore`, `SpecStore` and `Installation` all reach the program through the `RunCommand` seam and are unaffected.
- **Behaviour:** a program now runs in its own process group, so it no longer receives the terminal's `SIGINT` through pi's group. Every program run this way is a background step the session reports on, not an interactive one.
- **Blocked by:** nothing.
